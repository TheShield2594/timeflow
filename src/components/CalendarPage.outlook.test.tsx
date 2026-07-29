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
// Muting is backed by localStorage in the real module; here it's a plain set
// the tests can drive and assert on directly.
let mutedSubjects = new Set<string>();
const subjectKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
vi.mock("../services/outlookService", () => ({
  getCalendarEvents: (from: string, to: string) => getCalendarEvents(from, to),
  readLoggedEventIds: () => new Set<string>(),
  markEventLogged: (id: string) => markEventLogged(id),
  readMutedSubjects: () => new Set(mutedSubjects),
  muteSubject: (s: string) => { mutedSubjects.add(subjectKey(s)); return new Set(mutedSubjects); },
  clearMutedSubjects: () => { mutedSubjects = new Set(); return new Set<string>(); },
  subjectKey: (s: string) => subjectKey(s),
  OutlookNotConnectedError: class OutlookNotConnectedError extends Error {},
}));

beforeEach(() => {
  localStorage.clear();
  mutedSubjects = new Set();
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
    fireEvent.click(await screen.findByRole("button", { name: /Log time for Outlook meeting: Design review/ }));

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

  it("cycles on → faded → off, hiding the overlay only at the end", async () => {
    getCalendarEvents.mockResolvedValue([meetingToday()]);
    const { container } = renderCalendar();

    // Faded keeps the meetings present and clickable — with twenty-plus a
    // week, "on" and "off" are both wrong most of the time.
    fireEvent.click(await screen.findByRole("button", { name: "Outlook: on" }));
    expect(screen.getByRole("button", { name: "Outlook: faded" })).toBeTruthy();
    expect(localStorage.getItem("tt_show_outlook:env-1:user-1")).toBe("faded");
    expect(screen.queryByRole("button", { name: /Log time for Outlook meeting/ })).not.toBeNull();
    expect(container.querySelector(".calendar--outlook-faded")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Outlook: faded" }));
    expect(screen.queryByRole("button", { name: /Log time for Outlook meeting/ })).toBeNull();
    expect(localStorage.getItem("tt_show_outlook:env-1:user-1")).toBe("off");

    fireEvent.click(screen.getByRole("button", { name: "Outlook: off" }));
    expect(screen.getByRole("button", { name: "Outlook: on" })).toBeTruthy();
  });

  it("migrates the old boolean preference rather than resetting it", async () => {
    // Anyone who had deliberately hidden the overlay shouldn't get it back.
    localStorage.setItem("tt_show_outlook:env-1:user-1", "0");
    getCalendarEvents.mockResolvedValue([meetingToday()]);
    renderCalendar();
    expect(await screen.findByRole("button", { name: "Outlook: off" })).toBeTruthy();
  });

  it("shows the not-connected hint when the connector isn't set up", async () => {
    const { OutlookNotConnectedError } = await import("../services/outlookService");
    getCalendarEvents.mockRejectedValue(new OutlookNotConnectedError());
    renderCalendar();
    expect(await screen.findByRole("button", { name: "Outlook: not connected" })).toBeTruthy();
  });

  it("mutes a recurring subject across the whole week, and offers an undo", async () => {
    const base = meetingToday();
    // The same recurring block on two days, plus one real meeting.
    getCalendarEvents.mockResolvedValue([
      base,
      { ...base, id: "ev-2", subject: "Do Not Schedule" },
      {
        ...base, id: "ev-3", subject: "do not schedule  ",
        startTime: new Date(`${todayStr()}T14:00:00`).toISOString(),
        endTime: new Date(`${todayStr()}T15:00:00`).toISOString(),
      },
    ]);
    renderCalendar();

    fireEvent.click((await screen.findAllByRole("button", { name: /Hide all "Do Not Schedule"/ }))[0]);

    // Both occurrences go, including the one whose subject differs only by
    // case and stray whitespace; the unrelated meeting stays.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Outlook meeting: Do Not Schedule/i })).toBeNull();
    });
    expect(screen.getByRole("button", { name: /Outlook meeting: Design review/ })).toBeTruthy();

    // Reversible without hunting for a settings screen.
    fireEvent.click(screen.getByRole("button", { name: "2 hidden — undo" }));
    expect(screen.getAllByRole("button", { name: /Outlook meeting: Do Not Schedule/i }).length).toBe(2);
  });

  it("walks the day's meetings one modal at a time from the header's Log button", async () => {
    const base = meetingToday();
    getCalendarEvents.mockResolvedValue([
      base,
      {
        ...base, id: "ev-2", subject: "Standup",
        startTime: new Date(`${todayStr()}T14:00:00`).toISOString(),
        endTime: new Date(`${todayStr()}T14:30:00`).toISOString(),
      },
    ]);
    const { onCreateEntry } = renderCalendar();

    fireEvent.click(await screen.findByRole("button", { name: "Log 2" }));
    expect(screen.getByRole("dialog", { name: "Log Time · 1 of 2" })).toBeTruthy();
    expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe("Design review");

    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Saving advances to the next meeting instead of dropping you back on
    // the grid to hunt down the rest.
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Log Time · 2 of 2" })).toBeTruthy());
    expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe("Standup");

    // Cancelling abandons the rest of the run — only a save advances it.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onCreateEntry).toHaveBeenCalledTimes(1);
  });

  it("does not advance the queue, or tick the ghost off, when the save failed", async () => {
    // A save that throws leaves the modal open for retry. If the user gives up
    // and cancels, the run must stop there — advancing would skip past a
    // meeting nothing was recorded for, and marking it logged would hide that.
    const base = meetingToday();
    getCalendarEvents.mockResolvedValue([
      base,
      {
        ...base, id: "ev-2", subject: "Standup",
        startTime: new Date(`${todayStr()}T14:00:00`).toISOString(),
        endTime: new Date(`${todayStr()}T14:30:00`).toISOString(),
      },
    ]);
    const onCreateEntry = vi.fn().mockRejectedValue(new Error("network"));
    renderCalendar(onCreateEntry);

    fireEvent.click(await screen.findByRole("button", { name: "Log 2" }));
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onCreateEntry).toHaveBeenCalledTimes(1));
    // Still on the first meeting, and nothing was marked logged.
    expect(screen.getByRole("dialog", { name: "Log Time · 1 of 2" })).toBeTruthy();
    expect(markEventLogged).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not advance past a half-saved overnight split", async () => {
    // The reported path: an overnight split calls onSave twice. If the first
    // half lands and the second fails, the entry is only half-recorded — so
    // cancelling from there must not advance the queue or tick the ghost off.
    const base = meetingToday();
    getCalendarEvents.mockResolvedValue([
      base,
      {
        ...base, id: "ev-2", subject: "Standup",
        startTime: new Date(`${todayStr()}T14:00:00`).toISOString(),
        endTime: new Date(`${todayStr()}T14:30:00`).toISOString(),
      },
    ]);
    const onCreateEntry = vi.fn()
      .mockResolvedValueOnce({})                       // first half saves
      .mockRejectedValue(new Error("network"));        // second half fails
    renderCalendar(onCreateEntry);

    fireEvent.click(await screen.findByRole("button", { name: "Log 2" }));
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p1" } });
    // End before start = overnight; take the split.
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "09:00" } });
    fireEvent.click(await screen.findByRole("button", { name: "Split at midnight" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onCreateEntry).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("dialog", { name: "Log Time · 1 of 2" })).toBeTruthy();
    expect(markEventLogged).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers a retry on transient load errors", async () => {
    getCalendarEvents.mockRejectedValueOnce(new Error("503"));
    getCalendarEvents.mockResolvedValue([meetingToday()]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderCalendar();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: /Log time for Outlook meeting: Design review/ })).toBeTruthy();
    errSpy.mockRestore();
  });
});
