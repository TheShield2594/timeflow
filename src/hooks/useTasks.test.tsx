/**
 * The bootstrap bulk load (#111), and the optimistic mutations around it.
 *
 * A failed bulk load was swallowed to `console.error` with no signal to the
 * user and none to us, while task names rendered blank across the timesheet,
 * calendar, reports and the CSV export.
 *
 * The mutations below are the most intricate optimistic-update logic in the
 * app — every one of them writes the UI before the server agrees and has to
 * put it back if the server disagrees — and until #114 they were the least
 * covered.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { useTasks } from "./useTasks";
import * as svc from "../services/dataverseService";
import type { Task } from "../types";

const toastSpy = vi.fn();
const telemetrySpy = vi.fn();
vi.mock("../contexts/ToastContext", () => ({ useToast: () => toastSpy }));
vi.mock("../services/telemetry", () => ({ reportTelemetry: (e: unknown) => telemetrySpy(e) }));
vi.mock("../services/dataverseService", () => ({
  getAllTasks: vi.fn(),
  getTasksForProject: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deactivateTask: vi.fn(),
  reactivateTask: vi.fn(),
}));

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1", projectId: "proj-1", name: "Design", isActive: true, ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useTasks bootstrap load", () => {
  it("groups every task by project", async () => {
    vi.mocked(svc.getAllTasks).mockResolvedValue([task(), task({ id: "t2", projectId: "proj-2" })]);

    const { result } = renderHook(() => useTasks());

    await waitFor(() => expect(result.current.tasks).toHaveLength(2));
    expect(toastSpy).not.toHaveBeenCalled();
    expect(telemetrySpy).not.toHaveBeenCalled();
  });

  it("reports a failed bulk load and tells the user their task names may be missing", async () => {
    vi.mocked(svc.getAllTasks).mockRejectedValue(new Error("throttled"));

    renderHook(() => useTasks());

    await waitFor(() => expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "bulk_task_load_failed",
        severity: "error",
        props: expect.objectContaining({ error: "throttled" }),
      })
    ));
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("task names"), "error");
  });
});

/** A hook whose bootstrap load has already settled, so each test starts from
 *  a known map rather than racing the effect. */
async function mountedWith(initial: Task[]) {
  vi.mocked(svc.getAllTasks).mockResolvedValue(initial);
  const { result } = renderHook(() => useTasks());
  await waitFor(() => expect(result.current.tasks).toHaveLength(initial.length));
  return result;
}

describe("useTasks.addTask", () => {
  it("shows the task immediately, then swaps in the server record", async () => {
    const result = await mountedWith([]);
    vi.mocked(svc.createTask).mockImplementation(async (data) => ({ ...data, id: "server-1" }));

    let pending!: Promise<Task>;
    act(() => { pending = result.current.addTask({ projectId: "proj-1", name: "New", isActive: true }); });
    // Optimistic row is on screen before the create resolves, under a temp id.
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].id).toMatch(/^temp-/);

    await act(async () => { await pending; });
    expect(result.current.tasks).toEqual([
      { id: "server-1", projectId: "proj-1", name: "New", isActive: true },
    ]);
  });

  it("keeps the temp id when the response body is dropped, and re-reads to reconcile (#70)", async () => {
    const result = await mountedWith([]);
    // A dropped body: the row exists server-side but came back without its id.
    vi.mocked(svc.createTask).mockImplementation(async (data) => ({ ...data, id: "" }));
    vi.mocked(svc.getTasksForProject).mockResolvedValue([task({ id: "server-9", name: "New" })]);

    await act(async () => { await result.current.addTask({ projectId: "proj-1", name: "New", isActive: true }); });

    // An id of "" would send a later rename or delete to the collection
    // endpoint, so the temp id is held until the re-read lands.
    await waitFor(() => expect(result.current.tasks[0].id).toBe("server-9"));
    expect(svc.getTasksForProject).toHaveBeenCalledWith("proj-1");
  });

  it("rolls the optimistic row back out when the create fails", async () => {
    const result = await mountedWith([]);
    vi.mocked(svc.createTask).mockRejectedValue(new Error("offline"));

    await act(async () => {
      await expect(result.current.addTask({ projectId: "proj-1", name: "New", isActive: true }))
        .rejects.toThrow("offline");
    });

    expect(result.current.tasks).toHaveLength(0);
    expect(toastSpy).toHaveBeenCalledWith("Could not create task: offline", "error");
  });

  it("refuses to attach a task to a project that is still saving", async () => {
    const result = await mountedWith([]);

    await act(async () => {
      await expect(result.current.addTask({ projectId: "temp-abc", name: "New", isActive: true }))
        .rejects.toThrow("Project not yet saved");
    });

    expect(svc.createTask).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("still saving"), "error");
  });
});

describe("useTasks.deleteTask", () => {
  it("deactivates rather than removing, so historical entries keep their names", async () => {
    const result = await mountedWith([task()]);
    vi.mocked(svc.deactivateTask).mockResolvedValue(undefined);

    await act(async () => { await result.current.deleteTask(task()); });

    expect(svc.deactivateTask).toHaveBeenCalledWith("t1");
    expect(result.current.tasks).toEqual([task({ isActive: false })]);
  });

  it("puts the task back when the deactivate fails", async () => {
    const result = await mountedWith([task()]);
    vi.mocked(svc.deactivateTask).mockRejectedValue(new Error("boom"));

    await act(async () => {
      await expect(result.current.deleteTask(task())).rejects.toThrow("boom");
    });

    expect(result.current.tasks).toEqual([task()]);
    expect(toastSpy).toHaveBeenCalledWith("Could not delete task: boom", "error");
  });

  it("refuses a temp id — since #70 it can mean 'saved, id unknown', not 'never saved'", async () => {
    const result = await mountedWith([]);

    await act(async () => {
      await expect(result.current.deleteTask(task({ id: "temp-1" }))).rejects.toThrow("Task not yet saved");
    });

    expect(svc.deactivateTask).not.toHaveBeenCalled();
  });
});

describe("useTasks.renameTask", () => {
  it("keeps the optimistic name on success rather than adopting the response", async () => {
    const result = await mountedWith([task()]);
    vi.mocked(svc.updateTask).mockResolvedValue({ id: "t1", projectId: "", name: "", isActive: true });

    await act(async () => { await result.current.renameTask(task(), "  Redesign  "); });

    // Trimmed, and not overwritten by the (deliberately blank) response body.
    expect(svc.updateTask).toHaveBeenCalledWith("t1", { name: "Redesign" });
    expect(result.current.tasks).toEqual([task({ name: "Redesign" })]);
  });

  it("restores the old name when the update fails", async () => {
    const result = await mountedWith([task()]);
    vi.mocked(svc.updateTask).mockRejectedValue(new Error("conflict"));

    await act(async () => {
      await expect(result.current.renameTask(task(), "Redesign")).rejects.toThrow("conflict");
    });

    expect(result.current.tasks).toEqual([task()]);
    expect(toastSpy).toHaveBeenCalledWith("Could not rename task: conflict", "error");
  });

  it("does nothing for a blank or unchanged name", async () => {
    const result = await mountedWith([task()]);

    await act(async () => {
      await result.current.renameTask(task(), "   ");
      await result.current.renameTask(task(), "Design");
    });

    expect(svc.updateTask).not.toHaveBeenCalled();
  });
});

describe("useTasks.restoreTask", () => {
  it("reactivates the same record, and re-hides it if the server refuses", async () => {
    const result = await mountedWith([task({ isActive: false })]);
    vi.mocked(svc.reactivateTask).mockResolvedValue(undefined);

    await act(async () => { await result.current.restoreTask(task({ isActive: false })); });
    expect(result.current.tasks).toEqual([task()]);

    vi.mocked(svc.reactivateTask).mockRejectedValue(new Error("nope"));
    await act(async () => {
      await expect(result.current.restoreTask(task())).rejects.toThrow("nope");
    });
    expect(result.current.tasks).toEqual([task({ isActive: false })]);
  });
});

describe("useTasks.loadTasksForProject", () => {
  it("skips a project the bulk load already covered", async () => {
    const result = await mountedWith([task()]);

    await act(async () => { await result.current.loadTasksForProject("proj-1"); });

    expect(svc.getTasksForProject).not.toHaveBeenCalled();
  });

  it("lazily fills a project the bulk load missed", async () => {
    const result = await mountedWith([]);
    vi.mocked(svc.getTasksForProject).mockResolvedValue([task({ id: "t9", projectId: "proj-9" })]);

    await act(async () => { await result.current.loadTasksForProject("proj-9"); });

    expect(result.current.tasks).toEqual([task({ id: "t9", projectId: "proj-9" })]);
  });

  it("surfaces a lazy-load failure to the user", async () => {
    const result = await mountedWith([]);
    vi.mocked(svc.getTasksForProject).mockRejectedValue(new Error("throttled"));

    await act(async () => { await result.current.loadTasksForProject("proj-9"); });

    expect(toastSpy).toHaveBeenCalledWith("Could not load tasks: throttled", "error");
  });
});

describe("useTasks bootstrap vs. in-flight state", () => {
  it("lets a lazily-loaded project win over the bulk load that lands after it", async () => {
    // The bulk fetch is slow; a lazy load for one project resolves first. The
    // late bulk result must not clobber the fresher list — that would drop an
    // optimistic add made in the meantime.
    let releaseBulk!: (all: Task[]) => void;
    vi.mocked(svc.getAllTasks).mockReturnValue(new Promise((res) => { releaseBulk = res; }));
    vi.mocked(svc.getTasksForProject).mockResolvedValue([task({ id: "fresh", name: "Fresh" })]);

    const { result } = renderHook(() => useTasks());
    await act(async () => { await result.current.loadTasksForProject("proj-1"); });
    expect(result.current.tasks).toEqual([task({ id: "fresh", name: "Fresh" })]);

    await act(async () => { releaseBulk([task({ id: "stale", name: "Stale" })]); });

    expect(result.current.tasks).toEqual([task({ id: "fresh", name: "Fresh" })]);
  });
});
