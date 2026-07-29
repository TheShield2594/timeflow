import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { Project, Task } from "../types";
import { TimerBar } from "./TimerBar";

// The hooks barrel transitively imports the generated Dataverse SDK; the bar
// only needs the formatters from it, so stub the rest (same approach as
// CalendarPage.test.tsx) to avoid loading the SDK's broken transitive deps.
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));
vi.mock("../services/userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "u1@example.com", displayName: "User One", environmentId: "env-1" }),
}));

const projects: Project[] = [
  { id: "p1", name: "Alpha", color: "#111111", isActive: true, createdAt: "" },
];
const tasks: Task[] = [{ id: "t1", projectId: "p1", name: "Build", isActive: true }];

function renderBar(overrides: Partial<React.ComponentProps<typeof TimerBar>> = {}) {
  const onStart = vi.fn();
  const onStop = vi.fn();
  const utils = render(
    <TimerBar
      projects={projects}
      tasks={tasks}
      isRunning={false}
      elapsed={0}
      currentProjectId={null}
      currentTaskId={null}
      description=""
      onStart={onStart}
      onStop={onStop}
      onUpdate={vi.fn()}
      onAddTask={vi.fn()}
      onLoadTasksForProject={vi.fn()}
      {...overrides}
    />
  );
  return { ...utils, onStart, onStop };
}

const startButton = () => screen.getByRole("button", { name: "Start timer" });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("TimerBar Start button", () => {
  it("stays enabled with no project selected", () => {
    // A greyed-out primary action reads as a broken app; the button is live
    // and redirects instead.
    renderBar();
    expect(startButton().hasAttribute("disabled")).toBe(false);
  });

  it("sends you to the project picker instead of starting an untagged timer", () => {
    const { onStart } = renderBar();
    fireEvent.click(startButton());

    expect(onStart).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText("Project"));
    expect(screen.getByText("Pick a project first")).not.toBeNull();
  });

  it("drops the hint once a project is chosen", () => {
    renderBar();
    fireEvent.click(startButton());
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p1" } });
    expect(screen.queryByText("Pick a project first")).toBeNull();
  });

  it("stops nagging on its own so the bar doesn't keep a stale warning", () => {
    vi.useFakeTimers();
    renderBar();
    fireEvent.click(startButton());
    expect(screen.getByText("Pick a project first")).not.toBeNull();

    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByText("Pick a project first")).toBeNull();
  });

  it("starts normally once a project is selected", () => {
    const { onStart } = renderBar();
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("What are you working on?"), {
      target: { value: "Fixing the timer" },
    });
    fireEvent.click(startButton());

    expect(onStart).toHaveBeenCalledWith("p1", null, "Fixing the timer", undefined);
    expect(screen.queryByText("Pick a project first")).toBeNull();
  });

  it("shows the elapsed time inside the running button rather than beside it", () => {
    renderBar({ isRunning: true, elapsed: 4521, currentProjectId: "p1" });
    const stop = screen.getByRole("button", { name: "Stop timer" });
    expect(stop.textContent).toContain("01:15:21");
  });
});
