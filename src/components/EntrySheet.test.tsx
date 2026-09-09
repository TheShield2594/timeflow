/**
 * One record, one sheet, three modes. What it writes is a time entry, which
 * is the thing this app exists to get right — so the tests here are about the
 * payload and the two paths that can produce a wrong one: an overnight span,
 * and a retry after a half-saved split.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { EntrySheet, draftForEntry, draftForSpan } from "./EntrySheet";
import { DEFAULT_WORKING_HOURS } from "../hooks/useWorkingHours";
import type { Project, Task, TimeEntry } from "../types";

vi.mock("@microsoft/power-apps/app", () => ({ getContext: vi.fn() }));
vi.mock("../services/userService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/userService")>()),
  getCurrentUser: () => ({ id: "user-1", email: "u@example.com", displayName: "U", environmentId: "env-1" }),
}));
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const DATE = "2026-09-08";
const projects: Project[] = [
  { id: "p1", name: "Alpha", color: "#719500", isActive: true, createdAt: "" },
  { id: "p2", name: "Archived", color: "#00739F", isActive: false, createdAt: "" },
];
const tasks: Task[] = [{ id: "t1", projectId: "p1", name: "Build", isActive: true }];

const saved: TimeEntry = {
  id: "e1", projectId: "p1", description: "Rebuild the timer bar",
  startTime: `${DATE}T15:05:00`, endTime: `${DATE}T16:29:00`, durationMinutes: 84,
  date: DATE, userId: "u1", userDisplayName: "U", ratio: 2, jiraTicket: "PROJ-411",
};

function renderSheet(over: Partial<React.ComponentProps<typeof EntrySheet>> = {}) {
  const onSave = vi.fn().mockResolvedValue({});
  const onClose = vi.fn();
  const view = render(
    <EntrySheet
      mode="create"
      initial={draftForSpan(DATE, 10 * 60, 11 * 60, "p1")}
      projects={projects}
      tasks={tasks}
      dayEntries={[]}
      workingHours={DEFAULT_WORKING_HOURS}
      nowMinutes={18 * 60}
      onSave={onSave}
      onClose={onClose}
      {...over}
    />
  );
  return { ...view, onSave, onClose };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("EntrySheet payload", () => {
  it("writes ISO instants and a duration derived from them", async () => {
    const { onSave } = renderSheet();
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Standup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      date: DATE,
      description: "Standup",
      projectId: "p1",
      durationMinutes: 60,
    });
  });

  it("keeps the billing account a whole number and never a multiplier (#71)", async () => {
    const { onSave } = renderSheet();
    fireEvent.change(screen.getByLabelText(/Billing account/), { target: { value: "2.6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].ratio).toBe(3);
  });

  it("won't save without a project, because an entry has to be filed somewhere", () => {
    renderSheet({ initial: draftForSpan(DATE, 600, 660) });
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("EntrySheet overnight spans", () => {
  it("asks before writing an entry that ends before it starts", async () => {
    const { onSave } = renderSheet();
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "02:00" } });

    // Neither answer is assumed: one produces a 16-hour entry, the other two
    // entries on two dates, and only the person who worked it knows which.
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Keep as one entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // 10:00 today to 02:00 tomorrow.
    expect(onSave.mock.calls[0][0].durationMinutes).toBe(16 * 60);
  });

  it("splits at midnight onto two dates when asked", async () => {
    const { onSave } = renderSheet();
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "02:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Split at midnight" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[0][0]).toMatchObject({ date: DATE, durationMinutes: 14 * 60 });
    expect(onSave.mock.calls[1][0]).toMatchObject({ date: "2026-09-09", durationMinutes: 2 * 60 });
  });

  it("does not re-save the first half when only the second one failed", async () => {
    // Retrying a half-saved split used to write the first half twice, which
    // double-counts time that was already recorded.
    const onSave = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({});
    renderSheet({ onSave });

    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "02:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Split at midnight" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(3));
    // The third call is the *second* half again, not the first.
    expect(onSave.mock.calls[2][0]).toMatchObject({ date: "2026-09-09" });
  });
});

describe("EntrySheet modes", () => {
  it("stops without a Time row — the clock already decided that span", () => {
    renderSheet({ mode: "stop", initial: draftForEntry(saved), entryId: saved.id, onDelete: vi.fn() });
    expect(screen.queryByLabelText("Time")).toBeNull();
    expect(screen.getByText("1h 24m")).toBeTruthy();
    expect(screen.getByText("15:05 – 16:29 · Tuesday 8 September")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  });

  it("deletes immediately, with no confirmation dialog to answer twice", () => {
    // Confirming twice for something reversible is the pattern this app is
    // done with: the delete offers undo instead.
    const onDelete = vi.fn();
    renderSheet({ mode: "edit", initial: draftForEntry(saved), entryId: saved.id, onDelete });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/sure|confirm/i)).toBeNull();
  });

  it("keeps an archived project listed on an entry that already uses it", () => {
    renderSheet({ mode: "edit", initial: draftForEntry({ ...saved, projectId: "p2" }), entryId: saved.id });
    const select = screen.getByLabelText("Project") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toContain("Archived (archived)");
  });
});

describe("EntrySheet gap nudge", () => {
  it("names the hole this entry left behind and offers to fill it", () => {
    const onFillGap = vi.fn();
    renderSheet({
      mode: "stop",
      initial: draftForEntry(saved),
      entryId: saved.id,
      dayEntries: [saved],
      onFillGap,
    });

    // 08:00–15:05 is untracked before it; the sheet points at the nearest one.
    expect(screen.getByText(/still untracked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fill it" }));
    expect(onFillGap).toHaveBeenCalled();
  });
});

describe("EntrySheet zero-length stop", () => {
  it("still saves a timer started and stopped inside the same minute", () => {
    // stopAt clamps that span to zero, and it's a mis-click away at any time.
    // The entry is already written by then, so refusing Save would strand the
    // one sheet whose whole job is correcting what was written.
    const instant: TimeEntry = {
      ...saved, id: "blip", startTime: `${DATE}T15:05:00`, endTime: `${DATE}T15:05:00`, durationMinutes: 0,
    };
    renderSheet({ mode: "stop", initial: draftForEntry(instant), entryId: instant.id, onDelete: vi.fn() });

    expect(screen.getByText("0m")).toBeTruthy();
    expect(screen.queryByText("End time must be after the start time.")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false);
  });
});

describe("EntrySheet gap bounds", () => {
  it("does not read today's clock onto a past day", () => {
    // nowMinutes is 10:00, but the entry is on a day that has already ended.
    // Capping a past day at today's clock would report the afternoon as
    // untracked when there is nothing left of that day to track.
    const past = "2026-09-01";
    const pastEntry: TimeEntry = {
      ...saved, id: "old", date: past,
      startTime: `${past}T08:00:00`, endTime: `${past}T18:00:00`, durationMinutes: 600,
    };
    renderSheet({
      mode: "edit",
      initial: draftForEntry(pastEntry),
      entryId: pastEntry.id,
      dayEntries: [pastEntry],
      nowMinutes: 10 * 60,
      onFillGap: vi.fn(),
    });

    // The day is fully tracked, so there is nothing to point at.
    expect(screen.queryByText(/still untracked/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Fill it" })).toBeNull();
  });
});

describe("EntrySheet dismissal", () => {
  it("ignores a backdrop click once there is typed work to lose (#104)", () => {
    const { onClose, container } = renderSheet();
    fireEvent.click(container.querySelector(".sheet-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Standup" } });
    // A backdrop click is the one dismissal nobody ever aims — it's what a
    // mis-aimed click at the sheet's edge lands on.
    fireEvent.click(container.querySelector(".sheet-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
