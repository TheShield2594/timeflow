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

  it("archiveProject optimistically flags the project inactive and keeps it in the list", async () => {
    vi.mocked(svc.getProjects).mockResolvedValue([makeProject()]);

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.archiveProject(result.current.projects[0]);
    });

    expect(svc.deactivateProject).toHaveBeenCalledWith("p1");
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0].isActive).toBe(false);
  });

  it("rolls the archive back and toasts when the server call fails", async () => {
    vi.mocked(svc.getProjects).mockResolvedValue([makeProject()]);
    vi.mocked(svc.deactivateProject).mockRejectedValueOnce(new Error("offline"));

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.archiveProject(result.current.projects[0])).rejects.toThrow("offline");
    });

    expect(result.current.projects[0].isActive).toBe(true);
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("offline"), "error");
  });

  it("restoreProject reactivates an archived project", async () => {
    vi.mocked(svc.getProjects).mockResolvedValue([makeProject({ isActive: false })]);

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.restoreProject(result.current.projects[0]);
    });

    expect(svc.reactivateProject).toHaveBeenCalledWith("p1");
    expect(result.current.projects[0].isActive).toBe(true);
  });

  it("rolls the restore back and toasts when the server call fails", async () => {
    vi.mocked(svc.getProjects).mockResolvedValue([makeProject({ isActive: false })]);
    vi.mocked(svc.reactivateProject).mockRejectedValueOnce(new Error("offline"));

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.restoreProject(result.current.projects[0])).rejects.toThrow("offline");
    });

    expect(result.current.projects[0].isActive).toBe(false);
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("offline"), "error");
  });
});

describe("useProjects with a dropped response body (#70)", () => {
  it("keeps the temp id and re-reads the list when no server id comes back", async () => {
    vi.mocked(svc.getProjects).mockResolvedValue([]);
    vi.mocked(svc.createProject).mockResolvedValue(makeProject({ id: "", name: "New" }));

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const reconciled = makeProject({ id: "real-3", name: "New" });
    vi.mocked(svc.getProjects).mockResolvedValue([reconciled]);

    let created!: Project;
    await act(async () => {
      created = await result.current.addProject({ name: "New", color: "#111111", isActive: true });
    });

    // An "" id would send later edits and archives to the collection endpoint.
    expect(created.id).not.toBe("");
    // It also stays visible in the pickers rather than being archived by a
    // statecode the response never carried.
    expect(created.isActive).toBe(true);
    await waitFor(() => expect(result.current.projects).toEqual([reconciled]));
  });

  it("refuses to edit or archive a project whose id is still unknown", async () => {
    vi.mocked(svc.getProjects).mockResolvedValue([]);
    vi.mocked(svc.createProject).mockResolvedValue(makeProject({ id: "" }));

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The reconciling re-read fails too, so the project stays pending — this
    // is the window in which the temp-id guards have to hold.
    vi.mocked(svc.getProjects).mockRejectedValue(new Error("still offline"));

    let created!: Project;
    await act(async () => {
      created = await result.current.addProject({ name: "New", color: "#111111", isActive: true });
    });

    await act(async () => {
      await expect(result.current.editProject(created.id, { name: "x" }))
        .rejects.toThrow(/not yet saved/);
      await expect(result.current.archiveProject(created)).rejects.toThrow(/not yet saved/);
    });

    expect(svc.updateProject).not.toHaveBeenCalled();
    // deactivateProject deliberately treats a 404 as success, so an unguarded
    // archive here would have looked like it worked.
    expect(svc.deactivateProject).not.toHaveBeenCalled();
  });

  it("merges an update over the existing project rather than replacing it", async () => {
    const existing = makeProject({ id: "p1", name: "Original", isActive: true });
    vi.mocked(svc.getProjects).mockResolvedValue([existing]);
    // Dropped body: the service reports only what it sent, and deliberately
    // omits isActive because the row carried no statecode to derive it from.
    vi.mocked(svc.updateProject).mockResolvedValue({ id: "p1", name: "Renamed" } as Project);

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.editProject("p1", { name: "Renamed" });
    });

    expect(result.current.projects[0]).toMatchObject({
      id: "p1",
      name: "Renamed",
      // Not archived by omission — the project stays in the pickers.
      isActive: true,
      createdAt: "2024-01-01T00:00:00Z",
    });
  });
});
