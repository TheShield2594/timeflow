/**
 * The timer screen replaces both the timer bar and the Overview page, so it
 * carries the app's one primary action and the day it belongs to. What's
 * tested here is what the hero *says*: a running clock, an idle one, and a
 * failed save — three states that used to be a bar, a toast and a button
 * label, and now all read as the same subject.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { TimerPage } from "./TimerPage";
import { renderWithData, TEST_WORKING_HOURS } from "../test/dataHarness";
import { addDaysStr, localDateStr } from "../utils/dates";
import type { Project, TimeEntry, TimerState } from "../types";

vi.mock("@microsoft/power-apps/app", () => ({ getContext: vi.fn() }));
vi.mock("../services/userService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/userService")>()),
  getCurrentUser: () => ({ id: "user-1", email: "u@example.com", displayName: "U", environmentId: "env-1" }),
}));
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const today = localDateStr();
const projects: Project[] = [
  { id: "p1", name: "Alpha", color: "#719500", isActive: true, createdAt: "" },
];

const IDLE: TimerState = {
  isRunning: false, startTime: null, projectId: null, taskId: null, description: "",
};

function entry(over: Partial<TimeEntry> & { id: string }): TimeEntry {
  return {
    projectId: "p1", date: today,
    startTime: `${today}T09:00:00`, endTime: `${today}T10:00:00`,
    durationMinutes: 60, userId: "u1", userDisplayName: "U",
    ...over,
  };
}

function renderTimer(
  timer: Partial<TimerState> = {},
  data: Parameters<typeof renderWithData>[1] = {},
  props: Partial<React.ComponentProps<typeof TimerPage>> = {},
) {
  const handlers = {
    onDraftChange: vi.fn(), onStart: vi.fn(), onStop: vi.fn(),
    onRetryStop: vi.fn(), onUpdate: vi.fn(), onSetTarget: vi.fn(), onContinue: vi.fn(),
  };
  const view = renderWithData(
    <TimerPage
      timer={{ ...IDLE, ...timer }}
      draft={{ projectId: "", description: "" }}
      focusProjectNonce={0}
      targetHours={40}
      workingHours={TEST_WORKING_HOURS}
      timerBusy={false}
      shortcutHint="Ctrl + ."
      {...handlers}
      {...props}
    />,
    { projects, ...data },
  );
  return { ...view, ...handlers };
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("TimerPage hero", () => {
  it("offers Start when idle and Stop while running", () => {
    const { onStart } = renderTimer();
    expect(screen.getByText("Not running")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalled();
    cleanup();

    const { onStop } = renderTimer({
      isRunning: true, startTime: `${today}T09:00:00`, projectId: "p1", description: "Rebuild the timer bar",
    });
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText(/started 9:00 AM/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("keeps the description editable for the length of a session", () => {
    // A session runs for hours, and the description is the one field somebody
    // notices they got wrong halfway through.
    const { onUpdate } = renderTimer({
      isRunning: true, startTime: `${today}T09:00:00`, projectId: "p1", description: "Rebuil",
    });
    fireEvent.change(screen.getByLabelText("What are you working on?"), {
      target: { value: "Rebuild the timer bar" },
    });
    expect(onUpdate).toHaveBeenCalledWith({ description: "Rebuild the timer bar" });
  });

  it("takes over the hero when a save failed, and retries with the original end time", () => {
    // Never with "now": retrying at the current clock would silently grow the
    // entry by however long the failure lasted (#32).
    const pendingStopAt = `${today}T16:29:00`;
    const { onRetryStop } = renderTimer({
      pendingStopAt, projectId: "p1", startTime: `${today}T09:00:00`,
    });

    expect(screen.getByText("Not saved")).toBeTruthy();
    expect(screen.getByText(/Stopped at 4:29 PM/)).toBeTruthy();
    // The clock freezes at the length the entry actually had rather than
    // resetting to zero: the hero is still about that session.
    expect(screen.getByText("07:29:00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    expect(onRetryStop).toHaveBeenCalledWith(pendingStopAt);
  });

  it("flashes the hint rather than disabling Start when no project is picked", () => {
    // A greyed-out primary action reads as a broken app; this reads as an
    // instruction.
    renderTimer({}, {}, { focusProjectNonce: 1 });
    expect(document.querySelector(".timer-hero__hint")!.textContent).toBe("Pick a project first.");
  });
});

describe("TimerPage day", () => {
  it("reports what is tracked and what is still missing from the day", () => {
    renderTimer({}, { entries: [entry({ id: "a", description: "Standup" })] });
    expect(screen.getByText("1h tracked")).toBeTruthy();
    // 08:00–09:00 and 10:00 onward are untracked inside an 08:00–18:00 day.
    expect(screen.getByText(/gaps · .* untracked/)).toBeTruthy();
  });

  it("offers yesterday's work where the timer is, not below the fold", () => {
    const yesterday = addDaysStr(today, -1);
    const { onContinue } = renderTimer({}, {
      entries: [entry({
        id: "y", date: yesterday, description: "Rebuild the timer bar",
        startTime: `${yesterday}T09:00:00`, endTime: `${yesterday}T10:00:00`,
      })],
    });

    expect(screen.getByText("Yesterday you worked on")).toBeTruthy();
    // Two Starts on screen: the hero's and the resume row's. The resume row's
    // is the one that restarts a specific entry.
    const resume = screen.getAllByRole("button", { name: "Start" })[1];
    fireEvent.click(resume);
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ id: "y" }));
  });

  it("teaches the gesture rather than saying 'no data'", () => {
    renderTimer();
    expect(screen.getByText("Nothing logged today")).toBeTruthy();
    expect(screen.getByText(/drag across the bar/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log past time" })).toBeTruthy();
  });

  it("steers a first-run user with no projects to Projects instead", () => {
    const onGoToProjects = vi.fn();
    renderTimer({}, { projects: [] }, { onGoToProjects });
    fireEvent.click(screen.getByRole("button", { name: "Create a project" }));
    expect(onGoToProjects).toHaveBeenCalled();
  });
});

describe("TimerPage week rail", () => {
  it("reports the week against the target as one ring and one sentence", () => {
    renderTimer({}, {
      entries: [
        entry({ id: "a", durationMinutes: 120 }),
        entry({ id: "b", durationMinutes: 60 }),
      ],
    });
    expect(screen.getByText("3h")).toBeTruthy();
    expect(screen.getByRole("button", { name: /of 40h · \d+%/ })).toBeTruthy();
  });

  it("offers to set a target rather than showing a ring against nothing", () => {
    renderTimer({}, {}, { targetHours: 0 });
    expect(screen.getByRole("button", { name: "Set a weekly target" })).toBeTruthy();
  });
});
