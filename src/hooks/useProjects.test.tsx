import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { useProjects } from "./useProjects";
import * as svc from "../services/dataverseService";
import type { Project } from "../types";

const toastSpy = vi.fn();
vi.mock("../contexts/ToastContext", () => ({ useToast: () => toastSpy }));
vi.mock("../services/dataverseService", () => ({
  getProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deactivateProject: vi.fn().mockResolvedValue(undefined),
  reactivateProject: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Project One",
    color: "#000000",
    isActive: true,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useProjects", () => {
  it("loads projects on mount", async () => {
    vi.mocked(svc.getProjects).mockResolvedValue([makeProject()]);

    const { result } = renderHook(() => useProjects());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projects).toEqual([makeProject()]);
  });

  it("shows the new project optimistically, then replaces it with the server record", async () => {
    vi.mocked(svc.getProjects).mockResolvedValue([]);
    const real = makeProject({ id: "real-1", name: "New" });
    let resolveCreate!: (p: Project) => void;
    vi.mocked(svc.createProject).mockImplementation(
      () => new Promise((res) => { resolveCreate = res; })
    );

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let addPromise!: Promise<Project>;
    act(() => {
      addPromise = result.current.addProject({ name: "New", color: "#111111", isActive: true });
    });

    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0].id).not.toBe("real-1");

    await act(async () => {
      resolveCreate(real);
      await addPromise;
    });

    expect(result.current.projects).toEqual([real]);
  });

  it("rolls back the optimistic project and toasts on create failure", async () => {
    vi.mocked(svc.getProjects).mockResolvedValue([]);
    vi.mocked(svc.createProject).mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(
        result.current.addProject({ name: "New", color: "#111111", isActive: true })
      ).rejects.toThrow("network down");
    });

    expect(result.current.projects).toEqual([]);
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("network down"), "error");
  });

  it("rolls back an optimistic edit and restores the original on failure", async () => {
    const original = makeProject({ name: "Original" });
    vi.mocked(svc.getProjects).mockResolvedValue([original]);
    vi.mocked(svc.updateProject).mockRejectedValue(new Error("save failed"));

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(
        result.current.editProject(original.id, { name: "Changed" })
      ).rejects.toThrow("save failed");
    });

    expect(result.current.projects).toEqual([original]);
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("save failed"), "error");
  });
});
