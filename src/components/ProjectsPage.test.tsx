/**
 * Projects is one list with an accordion, not a grid of cards, and the two
 * things worth pinning down are the ones a redesign can quietly break: that
 * only one project is open at a time, and that no two active projects can be
 * given the same colour — the dot is often the only thing telling one row's
 * project from another's.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import { ProjectsPage } from "./ProjectsPage";
import { renderWithData } from "../test/dataHarness";
import type { Project, Task, TimeEntry } from "../types";

// The hooks barrel transitively pulls in the generated Dataverse SDK; stub it
// out so this test doesn't need a Power Apps host.
vi.mock("@microsoft/power-apps/app", () => ({ getContext: vi.fn() }));
vi.mock("../services/userService", async (importOriginal) => ({
  // Spread the real module: replacing it wholesale left isPowerAppsHost
  // undefined, and the resulting TypeError was swallowed into a hook error
  // state that the assertions never looked at (#114).
  ...(await importOriginal<typeof import("../services/userService")>()),
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
}));
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const projects: Project[] = [
  { id: "p1", name: "Alpha", color: "#719500", isActive: true, createdAt: "", ratio: 2 },
  { id: "p2", name: "Beta", color: "#00739F", isActive: true, createdAt: "" },
  { id: "p3", name: "Archived One", color: "#CC4F00", isActive: false, createdAt: "" },
];
const tasks: Task[] = [
  { id: "t1", projectId: "p1", name: "Build", isActive: true },
  { id: "t2", projectId: "p1", name: "Review", isActive: true },
  { id: "t3", projectId: "p2", name: "Discovery", isActive: true },
];
const entries: TimeEntry[] = [
  { id: "e1", projectId: "p1", taskId: "t1", startTime: "2026-09-01T09:00:00", endTime: "2026-09-01T11:00:00",
    durationMinutes: 120, date: "2026-09-01", userId: "u1", userDisplayName: "U" },
  { id: "e2", projectId: "p2", startTime: "2026-09-01T11:00:00", endTime: "2026-09-01T12:00:00",
    durationMinutes: 60, date: "2026-09-01", userId: "u1", userDisplayName: "U" },
];

const renderPage = (data = {}) =>
  renderWithData(<ProjectsPage />, { projects, tasks, entries, ...data });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ProjectsPage list", () => {
  it("sorts by hours and shows each project's task count and billing account", () => {
    renderPage();
    const names = [...document.querySelectorAll(".projects__name")].map((el) => el.textContent);
    expect(names[0]).toContain("Alpha");
    expect(screen.getByText("2 tasks · Account 2")).toBeTruthy();
    // A project with no billing account says so rather than leaving a gap the
    // reader has to interpret.
    expect(screen.getByText("1 task · no billing account")).toBeTruthy();
  });

  it("opens one project at a time, with its tasks under its own row", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(screen.getByText("Build")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
    expect(screen.getByText("Discovery")).toBeTruthy();
    expect(screen.queryByText("Build")).toBeNull();
  });

  it("scopes the archived list behind its own segment", () => {
    renderPage();
    expect(screen.queryByText(/Archived One/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Archived 1" }));
    expect(screen.getByText(/Archived One/)).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
  });
});

describe("ProjectsPage task creation", () => {
  it("hands the typed name back when the write fails (#153)", async () => {
    const addTask = vi.fn().mockRejectedValue(new Error("Dataverse said no"));
    renderPage({ addTask });

    fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    const field = screen.getByLabelText("New task name") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Discovery call" } });
    fireEvent.keyDown(field, { key: "Enter" });

    // The clear happens before the await, so the field is empty while the
    // write is in flight — that is what stops Enter-then-blur sending twice.
    expect(screen.queryByLabelText("New task name")).toBeNull();

    await vi.waitFor(() => {
      const reopened = screen.getByLabelText("New task name") as HTMLInputElement;
      expect(reopened.value).toBe("Discovery call");
    });
    expect(addTask).toHaveBeenCalledTimes(1);
  });

  it("keeps the field clear when the write succeeds", async () => {
    const addTask = vi.fn().mockResolvedValue({ id: "t9", projectId: "p1", name: "Discovery call", isActive: true });
    renderPage({ addTask });

    fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    const field = screen.getByLabelText("New task name") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Discovery call" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await vi.waitFor(() => expect(addTask).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText("New task name")).toBeNull();
  });
});

describe("ProjectsPage colour picker", () => {
  it("refuses a colour another active project already wears", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));

    const swatches = within(screen.getByRole("dialog")).getAllByRole("button", { name: /^#/ });
    const taken = swatches.filter((s) => s.hasAttribute("disabled")).map((s) => s.getAttribute("aria-label"));
    // Both active projects' colours are out; the archived one's is free again.
    expect(taken).toEqual(expect.arrayContaining([
      expect.stringContaining("#719500"),
      expect.stringContaining("#00739F"),
    ]));
    expect(taken.some((label) => label!.includes("#CC4F00"))).toBe(false);
  });

  it("opens a new project on a colour nobody is using", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    const selected = within(screen.getByRole("dialog"))
      .getAllByRole("button", { name: /^#/ })
      .find((s) => s.getAttribute("aria-pressed") === "true")!;
    expect(selected.hasAttribute("disabled")).toBe(false);
    expect(selected.getAttribute("aria-label")).not.toBe("#719500");
  });
});

describe("ProjectsPage paging", () => {
  it("shows five projects and reveals the rest on demand", () => {
    const many: Project[] = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`, name: `Project ${i}`, color: "#719500", isActive: true, createdAt: "",
    }));
    renderPage({ projects: many, tasks: [], entries: [] });

    expect(screen.queryByText("Project 7")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 7 more" }));
    expect(screen.getByText("Project 7")).toBeTruthy();
  });
});

describe("ProjectsPage empty state", () => {
  it("says what a project is for rather than 'no projects'", () => {
    renderPage({ projects: [], tasks: [], entries: [] });
    expect(screen.getByText("Time is tracked against a project")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create a project" })).toBeTruthy();
  });
});
