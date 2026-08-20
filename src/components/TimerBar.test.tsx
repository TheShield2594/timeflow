import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { Project, Task } from "../types";
import { TimerBar } from "./TimerBar";

// The hooks barrel transitively imports the generated Dataverse SDK; the bar
// only needs the formatters from it, so stub the rest (same approach as
// CalendarPage.test.tsx) to avoid loading the SDK's broken transitive deps.
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));
// The SDK's app entrypoint has an extensionless internal import that Node's
// ESM resolver can't follow, which is why userService used to be replaced
// wholesale here. Stubbing just that one module lets the real userService
// load, so the mock below can spread it.
vi.mock("@microsoft/power-apps/app", () => ({ getContext: vi.fn() }));
vi.mock("../services/userService", async (importOriginal) => ({
  // Spread the real module: replacing it wholesale left isPowerAppsHost
  // undefined, and the resulting TypeError was swallowed into a hook
  // error state that the assertions never looked at (#114).
  ...(await importOriginal<typeof import("../services/userService")>()),
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
      startTime={null}
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

// Matched by prefix: the accessible name now carries the keyboard shortcut
// too, and which modifier it names depends on the platform (#99).
const startButton = () => screen.getByRole("button", { name: /^Start timer/ });

/** Drive the type-ahead the way a user does: open it, then pick a row. */
function pickFromCombobox(ariaLabel: string, optionName: string) {
  const input = screen.getByRole("combobox", { name: ariaLabel });
  fireEvent.mouseDown(input);
  fireEvent.mouseDown(screen.getByRole("option", { name: optionName }));
}

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
    pickFromCombobox("Project", "Alpha");
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
    pickFromCombobox("Project", "Alpha");
    fireEvent.change(screen.getByLabelText("What are you working on?"), {
      target: { value: "Fixing the timer" },
    });
    fireEvent.click(startButton());

    expect(onStart).toHaveBeenCalledWith("p1", null, "Fixing the timer", undefined, undefined);
    expect(screen.queryByText("Pick a project first")).toBeNull();
  });

  // The bar derives the clock from the session's start rather than being
  // handed a counter, so that the once-a-second render stays inside it (#95).
  it("shows the elapsed time inside the running button rather than beside it", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-08-14T12:00:00.000Z").getTime();
      vi.setSystemTime(now);
      renderBar({
        isRunning: true,
        startTime: new Date(now - 4521 * 1000).toISOString(),
        currentProjectId: "p1",
      });
      const stop = screen.getByRole("button", { name: /^Stop timer/ });
      expect(stop.textContent).toContain("01:15:21");

      act(() => { vi.advanceTimersByTime(1000); });
      expect(stop.textContent).toContain("01:15:22");
    } finally {
      vi.useRealTimers();
    }
  });
});

/** The bar with just enough props to flip between running and stopped. */
const StatusHarness: React.FC<{ isRunning: boolean; startTime?: string }> = ({ isRunning, startTime }) => (
  <TimerBar
    projects={projects}
    tasks={tasks}
    isRunning={isRunning}
    startTime={isRunning ? startTime ?? new Date().toISOString() : null}
    currentProjectId={isRunning ? "p1" : null}
    currentTaskId={null}
    description=""
    onStart={vi.fn()}
    onStop={vi.fn()}
    onUpdate={vi.fn()}
    onAddTask={vi.fn()}
    onLoadTasksForProject={vi.fn()}
  />
);

describe("TimerBar screen-reader status", () => {
  // aria-label REPLACES an element's content for the accessible name, so the
  // elapsed digits rendered inside the Stop button were unreachable — there
  // was no way for a non-visual user to learn how long they'd been tracking.
  it("carries the elapsed time the Stop button's aria-label hides", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-08-14T12:00:00.000Z").getTime();
      vi.setSystemTime(now);
      render(<StatusHarness isRunning startTime={new Date(now - 3661 * 1000).toISOString()} />);

      expect(screen.getByRole("status").textContent).toBe("Timer running, 1 hour 1 minute elapsed");
    } finally {
      vi.useRealTimers();
    }
  });

  // Per-second updates would be an announcement storm; the region is quantised
  // to whole minutes so the text only changes 60x less often than the clock.
  it("holds its text steady between minute boundaries", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-08-14T12:00:00.000Z").getTime();
      vi.setSystemTime(now);
      render(<StatusHarness isRunning startTime={new Date(now - 120 * 1000).toISOString()} />);
      expect(screen.getByRole("status").textContent).toBe("Timer running, 2 minutes elapsed");

      act(() => { vi.advanceTimersByTime(59_000); });
      expect(screen.getByRole("status").textContent).toBe("Timer running, 2 minutes elapsed");

      act(() => { vi.advanceTimersByTime(1000); });
      expect(screen.getByRole("status").textContent).toBe("Timer running, 3 minutes elapsed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays silent on load, so a reload doesn't open with 'Timer stopped'", () => {
    render(<StatusHarness isRunning={false} />);
    // The region itself must exist from the start — assistive tech doesn't
    // announce a live region that arrives with its content already in it.
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("announces the stop once a session has actually run", () => {
    const { rerender } = render(<StatusHarness isRunning={false} />);
    rerender(<StatusHarness isRunning />);
    rerender(<StatusHarness isRunning={false} />);

    expect(screen.getByRole("status").textContent).toBe("Timer stopped");
  });

  it("names the keyboard shortcut in the button's accessible name, not an aria-hidden hint", () => {
    render(<StatusHarness isRunning={false} />);
    const start = screen.getByRole("button", { name: /^Start timer/ });

    expect(start.getAttribute("aria-label")).toMatch(/keyboard shortcut (Command|Control) period/);
  });
});

describe("TimerBar layout", () => {
  it("puts the required project field first, ahead of the optional ones", () => {
    renderBar();
    const bar = document.querySelector(".timer-bar__inner")!;
    const order = [...bar.querySelectorAll(".combobox__input, .timer-bar__desc, .timer-bar__extras-toggle")]
      .map((el) => el.getAttribute("aria-label") ?? el.textContent);

    // Project gates the action, so it reads first; ratio/ticket are folded
    // away at the end.
    expect(order[0]).toBe("Project");
    expect(order[1]).toBe("What are you working on?");
    expect(order[2]).toBe("+ Ratio · Ticket");
  });

  it("marks the bar as running so the state is visible at a glance", () => {
    const { container } = renderBar({ isRunning: true, currentProjectId: "p1" });
    expect(container.querySelector(".timer-bar--running")).not.toBeNull();
  });
});

describe("TimerBar project combobox", () => {
  it("filters projects as you type instead of making you scan the whole list", () => {
    renderBar({ projects: [...projects, { id: "p2", name: "Beta", color: "#222", isActive: true, createdAt: "" }] });
    const input = screen.getByRole("combobox", { name: "Project" });
    fireEvent.mouseDown(input);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Alpha", "Beta"]);

    fireEvent.change(input, { target: { value: "bet" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Beta"]);
  });

  it("commits the highlighted option on Enter", () => {
    const { onStart } = renderBar();
    const input = screen.getByRole("combobox", { name: "Project" });
    fireEvent.mouseDown(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    fireEvent.click(startButton());
    expect(onStart).toHaveBeenCalledWith("p1", null, "", undefined, undefined);
  });

  it("leaves the selection alone on Escape", () => {
    renderBar();
    const input = screen.getByRole("combobox", { name: "Project" });
    fireEvent.mouseDown(input);
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Task" })).toBeNull();
  });

  it("keeps the new-task action reachable when the search matches nothing", () => {
    renderBar();
    pickFromCombobox("Project", "Alpha");
    const taskInput = screen.getByRole("combobox", { name: "Task" });
    fireEvent.mouseDown(taskInput);
    fireEvent.change(taskInput, { target: { value: "zzzz" } });

    // Coming up empty is exactly when creating one is the obvious next move.
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["+ New task…"]);
  });
});

describe("TimerBar ratio/ticket disclosure", () => {
  it("keeps ratio and ticket out of the way until asked for", () => {
    renderBar();
    expect(screen.queryByLabelText(/Billing ratio/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ Ratio · Ticket" }));
    expect(screen.getByLabelText(/Billing ratio/)).not.toBeNull();
    expect(screen.getByLabelText("Ticket reference for this entry")).not.toBeNull();
  });

  it("summarises what is set so a collapsed value is never invisible", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "+ Ratio · Ticket" }));
    fireEvent.change(screen.getByLabelText(/Billing ratio/), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Ticket reference for this entry"), {
      target: { value: "PROJ-123" },
    });
    // Collapse it again — the values have to still be visible on the chip.
    fireEvent.click(screen.getByRole("button", { name: /Ratio 2/ }));
    expect(screen.getByRole("button", { name: "Ratio 2 · PROJ-123" })).not.toBeNull();
  });

  it("carries the ticket through to onStart", () => {
    const { onStart } = renderBar();
    pickFromCombobox("Project", "Alpha");
    fireEvent.click(screen.getByRole("button", { name: "+ Ratio · Ticket" }));
    fireEvent.change(screen.getByLabelText("Ticket reference for this entry"), {
      target: { value: "PROJ-9" },
    });
    fireEvent.click(startButton());

    expect(onStart).toHaveBeenCalledWith("p1", null, "", undefined, "PROJ-9");
  });
});
