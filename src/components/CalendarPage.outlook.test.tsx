import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CalendarPage } from "./CalendarPage";
import { DataRangeProvider } from "../contexts/DataRangeContext";
import type { OutlookEvent } from "../types";

vi.mock("../services/userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
}));
// See CalendarPage.test.tsx — keeps the generated SDK's transitive deps out
// of the test module graph.
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const getCalendarEvents = vi.fn<(from: string, to: string) => Promise<OutlookEvent[]>>();
const markEventLogged = vi.fn<(id: string) => Set<string>>(() => new Set(["ev-1"]));
vi.mock("../services/outlookService", () => ({
  getCalendarEvents: (from: string, to: string) => getCalendarEvents(from, to),
  readLoggedEventIds: () => new Set<string>(),
  markEventLogged: (id: string) => markEventLogged(id),
  OutlookNotConnectedError: class OutlookNotConnectedError extends Error {},
}));

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function meetingToday(): OutlookEvent {
  return {
    id: "ev-1",
    subject: "Design review",
    startTime: new Date(`${todayStr()}T10:00:00`).toISOString(),
    endTime: new Date(`${todayStr()}T11:00:00`).toISOString(),
  };
}

function renderCalendar(onCreateEntry = vi.fn().mockResolvedValue({})) {
  const utils = render(
    <DataRangeProvider>
      <CalendarPage
        entries={[]}
        projects={[{ id: "p1", name: "Project One", color: "#719500", isActive: true, createdAt: "" }]}
        tasks={[]}
        onCreateEntry={onCreateEntry}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    </DataRangeProvider>
  );
  return { ...utils, onCreateEntry };
}

describe("CalendarPage Outlook overlay", () => {
  it("renders this week's meetings as ghost blocks", async () => {
    getCalendarEvents.mockResolvedValue([meetingToday()]);
    renderCalendar();
    expect(await screen.findByRole("button", { name: /Log time for Outlook meeting: Design review/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Outlook: on" })).toBeTruthy();
  });

  it("clicking a ghost opens Log Time prefilled from the meeting, and saving marks it logged", async () => {
    getCalendarEvents.mockResolvedValue([meetingToday()]);
    const { onCreateEntry } = renderCalendar();
    fireEvent.click(await screen.findByRole("button", { name: /Design review/ }));

    const dialog = screen.getByRole("dialog", { name: "Log Time" });
    expect(dialog).toBeTruthy();
    expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe("Design review");
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("10:00");
    expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("11:00");

    // Meetings prefill the times but never the project — pick one and save.
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onCreateEntry).toHaveBeenCalledTimes(1));
    expect(onCreateEntry.mock.calls[0][0].description).toBe("Design review");
    expect(onCreateEntry.mock.calls[0][0].durationMinutes).toBe(60);
    await waitFor(() => expect(markEventLogged).toHaveBeenCalledWith("ev-1"));
  });

  it("hides the overlay (without fetching) when toggled off, and persists the choice", async () => {
    getCalendarEvents.mockResolvedValue([meetingToday()]);
    renderCalendar();
    fireEvent.click(await screen.findByRole("button", { name: "Outlook: on" }));
    expect(screen.queryByRole("button", { name: /Design review/ })).toBeNull();
    expect(localStorage.getItem("tt_show_outlook:env-1:user-1")).toBe("0");
    expect(screen.getByRole("button", { name: "Outlook: off" })).toBeTruthy();
  });

  it("shows the not-connected hint when the connector isn't set up", async () => {
    const { OutlookNotConnectedError } = await import("../services/outlookService");
    getCalendarEvents.mockRejectedValue(new OutlookNotConnectedError());
    renderCalendar();
    expect(await screen.findByRole("button", { name: "Outlook: not connected" })).toBeTruthy();
  });

  it("offers a retry on transient load errors", async () => {
    getCalendarEvents.mockRejectedValueOnce(new Error("503"));
    getCalendarEvents.mockResolvedValue([meetingToday()]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderCalendar();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: /Design review/ })).toBeTruthy();
    errSpy.mockRestore();
  });
});
