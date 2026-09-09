/**
 * The pages past Timer and Timesheet are code-split (#116), so navigating
 * to one now involves a chunk fetch that can be pending, and can fail. Both
 * paths have to land somewhere the user can act on.
 *
 * The router also reads its data from context rather than props (#115), so
 * these render it inside the real DataProvider over a stubbed service — which
 * is the honest test of the wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { PageRouter } from "./PageRouter";
import { DEFAULT_WORKING_HOURS } from "../hooks/useWorkingHours";
import type { TimerState } from "../types";
import { DataRangeProvider } from "../contexts/DataRangeContext";
import { DataProvider } from "../contexts/DataContext";
import { ToastProvider } from "../contexts/ToastContext";

vi.mock("@microsoft/power-apps/app", () => ({ getContext: vi.fn() }));
vi.mock("../services/userService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/userService")>()),
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
}));
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const empty = { items: [], truncated: null };
vi.mock("../services/dataverseService", () => ({
  getTimeEntries: vi.fn(async () => empty),
  getProjects: vi.fn(async () => empty),
  getAllTasks: vi.fn(async () => empty),
  getTasksForProject: vi.fn(async () => empty),
  createTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deactivateProject: vi.fn(),
  reactivateProject: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deactivateTask: vi.fn(),
  reactivateTask: vi.fn(),
  hasForeignUserEntries: vi.fn(() => false),
}));

const IDLE_TIMER: TimerState = {
  isRunning: false, startTime: null, projectId: null, taskId: null, description: "",
};

function renderRouter(page: React.ComponentProps<typeof PageRouter>["page"]) {
  return render(
    <ToastProvider>
      <DataRangeProvider>
        <DataProvider>
          <PageRouter
            page={page}
            timerBusy={false}
            onContinue={vi.fn()}
            workingHours={DEFAULT_WORKING_HOURS}
            timerScreen={{
              timer: IDLE_TIMER,
              draft: { projectId: "", description: "" },
              onDraftChange: vi.fn(),
              onStart: vi.fn(),
              onStop: vi.fn(),
              onRetryStop: vi.fn(),
              onUpdate: vi.fn(),
              focusProjectNonce: 0,
              targetHours: 40,
              onSetTarget: vi.fn(),
              shortcutHint: "Ctrl + .",
            }}
          />
        </DataProvider>
      </DataRangeProvider>
    </ToastProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  // jsdom doesn't implement scrollTo; CalendarPage scrolls to the workday on
  // mount, and the resulting throw would land the page on its ErrorBoundary.
  Element.prototype.scrollTo = vi.fn();
  // CalendarPage probes it on mount; without a stub the page throws into its
  // ErrorBoundary, the skeleton still disappears, and the assertions below
  // would pass on the fallback instead of the page.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("PageRouter over the data context", () => {
  it("renders an eager page from context data, with no props threaded through", async () => {
    const { container } = renderRouter("timesheet");
    // The first data load is still in flight, so the skeleton is up.
    expect(container.querySelector(".skeleton-page")).toBeTruthy();
    // Then Timesheet, which ships in the entry chunk and needs no chunk fetch.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Timesheet" })).toBeTruthy());
  });

  // Each page is identified by something only it renders, so the assertion
  // can't be satisfied by the ErrorBoundary fallback (which would also clear
  // the skeleton).
  const LAZY_PAGES = [
    ["calendar", () => screen.getByRole("grid", { name: "Week calendar" })],
    ["reports", () => screen.getByRole("heading", { name: "Reports" })],
    ["projects", () => screen.getByRole("heading", { name: "Projects" })],
  ] as const;

  it.each(LAZY_PAGES)("resolves the lazily-loaded %s page behind a skeleton", async (page, findPage) => {
    const { container } = renderRouter(page);

    // Whatever the chunk is doing, the user sees the same skeleton the first
    // data load uses rather than an empty frame.
    expect(container.querySelector(".skeleton-page")).toBeTruthy();

    await waitFor(() => expect(findPage()).toBeTruthy());
    expect(container.querySelector(".skeleton-page")).toBeNull();
  });

  it("hides the Team page without a team, whatever the nav did", async () => {
    // The nav item only renders for managers, but the router guards anyway.
    const { container } = renderRouter("team");
    await waitFor(() => expect(container.querySelector(".skeleton-page")).toBeNull());
    expect(container.textContent).toBe("");
  });
});
