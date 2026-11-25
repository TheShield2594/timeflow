/**
 * The undo offers behind the three destructive actions (#115). The rule worth
 * pinning is that the offer only appears when the destructive call actually
 * succeeded — an "Undo" on something that never happened is a lie the user
 * then acts on.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useUndoableMutations } from "./useUndoableMutations";
import type { Project, Task, TimeEntry } from "../types";

const toastSpy = vi.fn();
vi.mock("../contexts/ToastContext", () => ({ useToast: () => toastSpy }));

const entry: TimeEntry = {
  id: "e1", projectId: "p1", description: "Standup",
  startTime: "2026-03-01T09:00:00Z", endTime: "2026-03-01T09:30:00Z",
  durationMinutes: 30, date: "2026-03-01",
  userId: "user-1", userDisplayName: "User One",
};
const task: Task = { id: "t1", projectId: "p1", name: "Design", isActive: true };
const project: Project = { id: "p1", name: "Alpha", color: "#719500", isActive: true, createdAt: "" };

function setup(over: Partial<Parameters<typeof useUndoableMutations>[0]> = {}) {
  const deps = {
    entries: [entry],
    deleteEntry: vi.fn().mockResolvedValue(undefined),
    createEntry: vi.fn().mockResolvedValue(entry),
    editEntry: vi.fn().mockImplementation(async (_id: string, data: Partial<TimeEntry>) => ({ ...entry, ...data })),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    restoreTask: vi.fn().mockResolvedValue(undefined),
    archiveProject: vi.fn().mockResolvedValue(undefined),
    restoreProject: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  const { result } = renderHook(() => useUndoableMutations(deps));
  return { result, deps };
}

/** Run the Undo action off the most recent toast. */
async function pressUndo() {
  const calls = toastSpy.mock.calls;
  const action = calls[calls.length - 1]?.[2];
  expect(action?.label).toBe("Undo");
  await act(async () => { action.onAction(); });
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("deleting an entry", () => {
  it("re-creates it from a snapshot, without the fields the service owns", async () => {
    // Time entries are the app's only hard delete, so undo genuinely has to
    // write a new row — and ownership isn't the caller's to pass (#115).
    const { result, deps } = setup();

    await act(async () => { await result.current.deleteEntry("e1"); });
    await pressUndo();

    expect(deps.createEntry).toHaveBeenCalledWith({
      projectId: "p1", description: "Standup",
      startTime: "2026-03-01T09:00:00Z", endTime: "2026-03-01T09:30:00Z",
      durationMinutes: 30, date: "2026-03-01",
    });
  });

  it("offers no undo when the delete failed", async () => {
    const { result } = setup({ deleteEntry: vi.fn().mockRejectedValue(new Error("offline")) });

    await act(async () => { await result.current.deleteEntry("e1"); });

    // The hook already toasted the error; a second toast offering to undo
    // something that didn't happen would be worse than silence.
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("stays silent when the entry isn't in the list to snapshot", async () => {
    const { result, deps } = setup({ entries: [] });

    await act(async () => { await result.current.deleteEntry("e1"); });

    expect(deps.deleteEntry).toHaveBeenCalledWith("e1");
    expect(toastSpy).not.toHaveBeenCalled();
  });
});

describe("deleting a task and archiving a project", () => {
  it("undoes by reactivating the same record, never by re-creating it", async () => {
    // Both are soft deletes. A re-create would mint a new id and strip the
    // name off every historical entry pointing at the old one.
    const { result, deps } = setup();

    await act(async () => { await result.current.deleteTask(task); });
    await pressUndo();
    expect(deps.restoreTask).toHaveBeenCalledWith(task);

    await act(async () => { await result.current.archiveProject(project); });
    await pressUndo();
    expect(deps.restoreProject).toHaveBeenCalledWith(project);
  });

  it("offers no undo when the deactivate failed", async () => {
    const { result } = setup({
      deleteTask: vi.fn().mockRejectedValue(new Error("boom")),
      archiveProject: vi.fn().mockRejectedValue(new Error("boom")),
    });

    await act(async () => { await result.current.deleteTask(task); });
    await act(async () => { await result.current.archiveProject(project); });

    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("swallows a failed undo — the hook behind it already said so", async () => {
    const { result } = setup({ restoreTask: vi.fn().mockRejectedValue(new Error("still offline")) });

    await act(async () => { await result.current.deleteTask(task); });
    await expect(pressUndo()).resolves.not.toThrow();
  });
});

describe("editing an entry (#205)", () => {
  // Local wall-clock times, so the toast's readings are predictable in the
  // suite's America/New_York.
  const local: TimeEntry = {
    ...entry,
    startTime: new Date("2026-03-03T09:00:00").toISOString(),
    endTime: new Date("2026-03-03T09:30:00").toISOString(),
    date: "2026-03-03",
  };
  const iso = (s: string) => new Date(s).toISOString();

  it("says where a moved entry went, and Undo puts it back", async () => {
    const { result, deps } = setup({ entries: [local] });
    const moved = {
      date: "2026-03-04",
      startTime: iso("2026-03-04T14:15:00"), endTime: iso("2026-03-04T14:45:00"), durationMinutes: 30,
    };

    await act(async () => { await result.current.editEntry("e1", moved); });

    expect(toastSpy).toHaveBeenCalledWith(
      "Moved “Standup” to Wed, Mar 4, 2:15 PM.", "info", expect.objectContaining({ label: "Undo" }),
    );
    await pressUndo();
    // Only what the move changed — the duration it kept isn't rewritten.
    expect(deps.editEntry).toHaveBeenLastCalledWith("e1", {
      date: local.date, startTime: local.startTime, endTime: local.endTime,
    });
  });

  it("calls a move within the day by its time alone", async () => {
    const { result } = setup({ entries: [local] });
    await act(async () => {
      await result.current.editEntry("e1", {
        date: local.date, startTime: iso("2026-03-03T09:15:00"), endTime: iso("2026-03-03T09:45:00"), durationMinutes: 30,
      });
    });
    expect(toastSpy.mock.calls[0][0]).toBe("Moved “Standup” to 9:15 AM.");
  });

  it("calls a dragged edge a resize", async () => {
    const { result, deps } = setup({ entries: [local] });
    await act(async () => {
      await result.current.editEntry("e1", { endTime: iso("2026-03-03T10:30:00"), durationMinutes: 90 });
    });
    expect(toastSpy.mock.calls[0][0]).toBe("Resized “Standup” to 9:00 AM – 10:30 AM.");
    await pressUndo();
    expect(deps.editEntry).toHaveBeenLastCalledWith("e1", { endTime: local.endTime, durationMinutes: 30 });
  });

  it("clears on Undo what the edit filled in, rather than leaving it", async () => {
    // undefined means "leave alone" to the service, so an Undo that wrote it
    // back would keep the ticket the edit added.
    const { result, deps } = setup({ entries: [local] });
    await act(async () => { await result.current.editEntry("e1", { jiraTicket: "PROJ-9", description: "Standup" }); });
    expect(toastSpy.mock.calls[0][0]).toBe("Saved changes to “Standup”.");
    await pressUndo();
    expect(deps.editEntry).toHaveBeenLastCalledWith("e1", { jiraTicket: null });
  });

  it("says nothing when a Save changed nothing, even if the times were reformatted", async () => {
    const { result } = setup({ entries: [local] });
    await act(async () => {
      await result.current.editEntry("e1", {
        description: "Standup",
        startTime: local.startTime.replace(".000Z", "Z"),
        endTime: local.endTime,
      });
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("rethrows a failed edit, so the sheet stays open to retry — and offers no undo", async () => {
    const { result } = setup({ entries: [local], editEntry: vi.fn().mockRejectedValue(new Error("offline")) });
    await act(async () => {
      await expect(result.current.editEntry("e1", { description: "x" })).rejects.toThrow("offline");
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });
});
