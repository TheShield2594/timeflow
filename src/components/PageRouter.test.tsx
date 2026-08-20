/**
 * The pages past Overview and Timesheet are code-split (#116), so navigating
 * to one now involves a chunk fetch that can be pending, and can fail. Both
 * paths have to land somewhere the user can act on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { PageRouter } from "./PageRouter";
import { DataRangeProvider } from "../contexts/DataRangeContext";

vi.mock("@microsoft/power-apps/app", () => ({ getContext: vi.fn() }));
vi.mock("../services/userService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/userService")>()),
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
}));
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const baseProps = {
  loading: false,
  rangeLoading: false,
  entries: [],
  projects: [],
  tasks: [],
  timerBusy: false,
  onDelete: vi.fn(),
  onEdit: vi.fn(),
  onCreate: vi.fn(),
  onContinue: vi.fn(),
  onAddProject: vi.fn(),
  onEditProject: vi.fn(),
  onArchiveProject: vi.fn(),
  onRestoreProject: vi.fn(),
  onAddTask: vi.fn(),
  onDeleteTask: vi.fn(),
  onRenameTask: vi.fn(),
  onLoadTasksForProject: vi.fn(),
} as unknown as React.ComponentProps<typeof PageRouter>;

beforeEach(() => {
  localStorage.clear();
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

describe("PageRouter code splitting", () => {
  it("renders an eager page synchronously — no skeleton flash on the landing screen", () => {
    render(
      <DataRangeProvider>
        <PageRouter {...baseProps} page="timesheet" />
      </DataRangeProvider>
    );
    // Present on the first paint, not after a tick: Timesheet ships in the
    // entry chunk precisely so it doesn't have to wait for one.
    expect(screen.getByText("Timesheet")).toBeTruthy();
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
    const { container } = render(
      <DataRangeProvider>
        <PageRouter {...baseProps} page={page} />
      </DataRangeProvider>
    );

    // Whatever the chunk is doing, the user sees the same skeleton the first
    // data load uses rather than an empty frame.
    expect(container.querySelector(".page-skeleton, .reports-skeleton")).toBeTruthy();

    await waitFor(() => expect(findPage()).toBeTruthy());
    expect(container.querySelector(".page-skeleton, .reports-skeleton")).toBeNull();
  });

  it("still shows the loading skeleton before the first data load, on any page", () => {
    const { container } = render(
      <DataRangeProvider>
        <PageRouter {...baseProps} page="reports" loading />
      </DataRangeProvider>
    );
    expect(container.querySelector(".reports-skeleton")).toBeTruthy();
  });
});
