/**
 * The running timer as every other page sees it (#203).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { TimerNavStatus } from "./TimerNavStatus";
import type { TimerState } from "../types";

const idle: TimerState = {
  isRunning: false, startTime: null, projectId: null, taskId: null, description: "",
};

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("TimerNavStatus", () => {
  it("shows nothing while no timer is running", () => {
    const { container } = render(<TimerNavStatus timer={idle} />);
    expect(container.textContent).toBe("");
  });

  it("shows the elapsed clock, ticking on its own", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T10:00:00Z"));
    const running: TimerState = {
      ...idle, isRunning: true, projectId: "p1", startTime: "2026-11-25T08:35:55Z",
    };
    render(<TimerNavStatus timer={running} projectColor="#719500" />);
    expect(screen.getByText("01:24:05")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("01:24:06")).toBeTruthy();
  });

  it("keeps the ticking digits out of the accessible name", () => {
    const running: TimerState = { ...idle, isRunning: true, projectId: "p1", startTime: new Date().toISOString() };
    render(<button type="button">Timer<TimerNavStatus timer={running} /></button>);
    expect(screen.getByRole("button", { name: "Timer, running" })).toBeTruthy();
  });

  it("says a stop that failed to save is not saved, instead of freezing the clock", () => {
    const pending: TimerState = {
      ...idle, projectId: "p1", startTime: "2026-11-25T08:00:00Z", pendingStopAt: "2026-11-25T09:00:00Z",
    };
    render(<TimerNavStatus timer={pending} />);
    expect(screen.getByText("Not saved")).toBeTruthy();
  });
});
