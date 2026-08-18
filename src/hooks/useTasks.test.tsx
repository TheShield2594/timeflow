/**
 * The bootstrap bulk load (#111). A failure here was swallowed to
 * `console.error` with no signal to the user and none to us, while task names
 * rendered blank across the timesheet, calendar, reports and the CSV export.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
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
