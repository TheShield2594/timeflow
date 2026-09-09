/**
 * One record, one sheet, three modes. What it writes is a time entry, which
 * is the thing this app exists to get right — so the tests here are about the
 * payload and the two paths that can produce a wrong one: an overnight span,
 * and a retry after a half-saved split.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
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
      entriesOnDate={() => []}
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
    fireEvent.change(screen.getByLabelText(/^Ratio/), { target: { value: "2.6" } });
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
  it("stops without a Time or Date row — the clock already decided both", () => {
    renderSheet({ mode: "stop", initial: draftForEntry(saved), entryId: saved.id, onDelete: vi.fn() });
    expect(screen.queryByLabelText("Time")).toBeNull();
    expect(screen.queryByLabelText("Date")).toBeNull();
    expect(screen.getByText("1h 24m")).toBeTruthy();
    expect(screen.getByText("3:05 PM – 4:29 PM · Tuesday, September 8")).toBeTruthy();
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

describe("EntrySheet re-dating (#151)", () => {
  it("writes the entry to the edited date", async () => {
    const { onSave } = renderSheet({ mode: "edit", initial: draftForEntry(saved), entryId: saved.id });

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-04" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // The instants move with it, not just the date column — a row whose
    // startTime still says 8 September is a wrong number, not a wrong label.
    expect(onSave.mock.calls[0][0]).toMatchObject({
      date: "2026-09-04",
      startTime: new Date("2026-09-04T15:05:00").toISOString(),
      endTime: new Date("2026-09-04T16:29:00").toISOString(),
      durationMinutes: 84,
    });
  });

  it("moves the day bar and the gap nudge onto the edited date", () => {
    // 8 September is fully tracked 08:00–18:00; 4 September holds nothing.
    const fullDay: TimeEntry = {
      ...saved, id: "full", startTime: `${DATE}T08:00:00`, endTime: `${DATE}T18:00:00`, durationMinutes: 600,
    };
    renderSheet({
      mode: "edit",
      initial: draftForEntry(fullDay),
      entryId: fullDay.id,
      entriesOnDate: (date) => (date === DATE ? [fullDay] : []),
      onFillGap: vi.fn(),
    });
    expect(screen.queryByText(/still untracked/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-04" } });

    // The bar is now describing 4 September, where the same 08:00–18:00 span
    // leaves nothing untracked either — but it is that day it is answering
    // about, which is the whole point of recomputing it.
    expect(screen.getByText("8:00 AM – 6:00 PM · Friday, September 4")).toBeTruthy();
  });

  it("draws no day at all for a date outside the loaded range", async () => {
    // null is not "nobody worked that day" — a bar built from an unfetched
    // day would report the whole of it as untracked.
    const { onSave } = renderSheet({
      mode: "edit",
      initial: draftForEntry(saved),
      entryId: saved.id,
      entriesOnDate: (date) => (date === DATE ? [saved] : null),
    });
    expect(document.querySelector(".day-bar")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2019-04-01" } });

    expect(document.querySelector(".day-bar")).toBeNull();
    expect(screen.getByText(/outside the range loaded/)).toBeTruthy();

    // Still saves to it: the sheet can't draw that day, which is not the same
    // as refusing to file time against it.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ date: "2019-04-01" });
  });

  it("refuses to save with the date cleared, and says why", () => {
    renderSheet({ mode: "edit", initial: draftForEntry(saved), entryId: saved.id });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "" } });

    expect(screen.getByText("Pick a date.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("EntrySheet midnight-ending draft", () => {
  it("renders an end time the element accepts", () => {
    // "24:00" is not a valid HTML time string, and the browser sanitizes an
    // invalid value to "" — so this field came up blank on a span ending at
    // the end of the day.
    renderSheet({ initial: draftForSpan(DATE, 23 * 60, 24 * 60) });

    const end = screen.getByLabelText("End time") as HTMLInputElement;
    expect(end.value).toBe("00:00");
    // And it is still one hour, on the *next* midnight rather than this one.
    expect(screen.getByText("1h")).toBeTruthy();
    expect(screen.getByText(/\(next day\)/)).toBeTruthy();
  });

  it("saves that hour against the day it started on", async () => {
    const { onSave } = renderSheet({ initial: draftForSpan(DATE, 23 * 60, 24 * 60, "p1") });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      date: DATE,
      startTime: new Date(`${DATE}T23:00:00`).toISOString(),
      endTime: new Date("2026-09-09T00:00:00").toISOString(),
      durationMinutes: 60,
    });
  });
});

describe("EntrySheet task creation (#153)", () => {
  it("hands the typed name back when the write fails", async () => {
    const onAddTask = vi.fn().mockRejectedValue(new Error("Dataverse said no"));
    renderSheet({ onAddTask });

    fireEvent.click(screen.getByRole("button", { name: /New task/ }));
    const field = screen.getByLabelText("New task name") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Discovery call" } });
    fireEvent.keyDown(field, { key: "Enter" });

    // Cleared before the await, which is what stops Enter-then-blur filing
    // the same name twice while the first request is still in flight.
    expect(screen.queryByLabelText("New task name")).toBeNull();

    await waitFor(() => {
      const reopened = screen.getByLabelText("New task name") as HTMLInputElement;
      expect(reopened.value).toBe("Discovery call");
    });
    expect(onAddTask).toHaveBeenCalledTimes(1);
  });

  it("does not shove a slow failure's name over a draft started since", async () => {
    let reject: (e: Error) => void = () => {};
    const onAddTask = vi.fn().mockReturnValue(new Promise((_, r) => { reject = r; }));
    renderSheet({ onAddTask });

    fireEvent.click(screen.getByRole("button", { name: /New task/ }));
    fireEvent.change(screen.getByLabelText("New task name"), { target: { value: "First name" } });
    fireEvent.keyDown(screen.getByLabelText("New task name"), { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: /New task/ }));
    fireEvent.change(screen.getByLabelText("New task name"), { target: { value: "Second name" } });

    // act, not waitFor: the overwrite would land in the rejection's own
    // microtask, and a waitFor whose condition already holds returns first.
    await act(async () => { reject(new Error("Dataverse said no")); });

    expect((screen.getByLabelText("New task name") as HTMLInputElement).value).toBe("Second name");
  });

  it("selects the new task and closes the field when the write succeeds", async () => {
    const created: Task = { id: "t9", projectId: "p1", name: "Discovery call", isActive: true };
    const onAddTask = vi.fn().mockResolvedValue(created);
    renderSheet({ onAddTask, tasks: [...tasks, created] });

    fireEvent.click(screen.getByRole("button", { name: /New task/ }));
    fireEvent.change(screen.getByLabelText("New task name"), { target: { value: "Discovery call" } });
    fireEvent.keyDown(screen.getByLabelText("New task name"), { key: "Enter" });

    await waitFor(() => expect((screen.getByLabelText("Task") as HTMLSelectElement).value).toBe("t9"));
    expect(screen.queryByLabelText("New task name")).toBeNull();
  });
});

describe("EntrySheet gap nudge", () => {
  it("names the hole this entry left behind and offers to fill it", () => {
    const onFillGap = vi.fn();
    renderSheet({
      mode: "stop",
      initial: draftForEntry(saved),
      entryId: saved.id,
      entriesOnDate: () => [saved],
      onFillGap,
    });

    // 08:00–15:05 is untracked before it; the sheet points at the nearest one.
    expect(screen.getByText(/still untracked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fill it" }));
    // The date comes first, and it is the draft's — a gap found after a
    // re-date belongs to the day it was found on.
    expect(onFillGap).toHaveBeenCalledWith(DATE, expect.any(Number), expect.any(Number));
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
      entriesOnDate: () => [pastEntry],
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
