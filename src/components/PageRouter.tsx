import React, { Suspense } from "react";
import { TimerPage, type TimerDraft } from "./TimerPage";
import { TimesheetPage } from "./TimesheetPage";
import { ErrorBoundary } from "./ErrorBoundary";
import { useData } from "../contexts/DataContext";
import type { TeamContext } from "../services/teamService";
import type { TimeEntry, TimerState } from "../types";
import type { WorkingHours } from "../hooks/useWorkingHours";

export type Page = "timer" | "timesheet" | "calendar" | "reports" | "projects" | "team";

/**
 * The pages are memoized here rather than at their own exports so each stays a
 * plain component for the tests that render it directly.
 *
 * None of them were memoized before, so anything that re-rendered the app
 * shell re-reconciled the whole mounted page — on the Calendar, ~720 elements
 * and a couple of thousand fresh closures (#95).
 */
const Timer = React.memo(TimerPage);
const Timesheet = React.memo(TimesheetPage);

/**
 * Everything past the first two screens is code-split (#116).
 *
 * Timer is where the app lands and Timesheet is one click away on nearly
 * every session, so both stay in the entry chunk — deferring them would only
 * buy a skeleton. Calendar, Reports, Projects and Team are each visited by
 * some sessions and none, and Calendar alone is the largest component in the
 * app; splitting them is what keeps the first paint from carrying pages the
 * user may never open.
 */
const Calendar = React.lazy(() => import("./CalendarPage").then((m) => ({ default: React.memo(m.CalendarPage) })));
const Reports = React.lazy(() => import("./ReportsPage").then((m) => ({ default: React.memo(m.ReportsPage) })));
const Projects = React.lazy(() => import("./ProjectsPage").then((m) => ({ default: React.memo(m.ProjectsPage) })));
const Team = React.lazy(() => import("./TeamPage").then((m) => ({ default: React.memo(m.TeamPage) })));

/**
 * Skeletons, not spinners.
 *
 * A spinner says "wait"; a skeleton says what is coming, so arrival is a fill
 * rather than a swap. Each one is the shape of the screen it stands in for —
 * which is why there are four of them rather than one generic block.
 */
export const TimerSkeleton: React.FC = () => (
  <div className="skeleton-page" aria-hidden="true">
    <div className="skeleton skeleton--title" />
    <div className="skeleton skeleton--clock" />
    <div className="skeleton-page__cols">
      <div className="skeleton-stack">
        <div className="skeleton skeleton--bar" />
        {[0, 1, 2].map((i) => <div key={i} className="skeleton skeleton--row" />)}
      </div>
      <div className="skeleton skeleton--ring" />
    </div>
  </div>
);

export const ListSkeleton: React.FC = () => (
  <div className="skeleton-page" aria-hidden="true">
    <div className="skeleton skeleton--title" />
    {[0, 1, 2].map((group) => (
      <div key={group} className="skeleton-stack">
        <div className="skeleton skeleton--line" />
        {[0, 1].map((row) => <div key={row} className="skeleton skeleton--row" />)}
      </div>
    ))}
  </div>
);

export const ChartSkeleton: React.FC = () => (
  <div className="skeleton-page" aria-hidden="true">
    <div className="skeleton skeleton--title" />
    <div className="skeleton skeleton--chart" />
    <div className="skeleton-stack">
      {[0, 1, 2].map((i) => <div key={i} className="skeleton skeleton--row" />)}
    </div>
  </div>
);

/** Everything the timer screen needs that isn't data — all of it the shell's. */
export interface TimerScreenProps {
  timer: TimerState;
  draft: TimerDraft;
  onDraftChange: (patch: Partial<TimerDraft>) => void;
  onStart: () => void;
  onStop: () => void;
  onRetryStop: (endIso: string) => void;
  onUpdate: (patch: { description?: string }) => void;
  focusProjectNonce: number;
  targetHours: number;
  onSetTarget: (hours: number) => void;
  shortcutHint: string;
}

/**
 * What the router needs that isn't data. Entries, projects, tasks and every
 * mutation over them come from `useData()` — this used to be 19 props, all of
 * them forwarded verbatim from AppContent to a page that wanted them (#115).
 * What's left belongs to the shell: which page, whether the timer is busy, the
 * timer itself, and the two settings the shell owns.
 */
interface Props {
  page: Page;
  /** True while a timer is running or retrying a stop — pages disable "Start". */
  timerBusy: boolean;
  onContinue: (entry: TimeEntry) => void;
  onGoToProjects?: () => void;
  /** Non-null with reports = the user manages people; enables the Team page. */
  teamContext?: TeamContext | null;
  workingHours: WorkingHours;
  timerScreen: TimerScreenProps;
}

/**
 * One boundary per page rather than one for the app: a render crash in Reports
 * used to blank the entire app, including the running timer, and the only way
 * back was a reload (#111). Keyed on `page` so navigating away clears it.
 */
export const PageRouter: React.FC<Props> = (props) => (
  <ErrorBoundary scope={props.page} resetKey={props.page}>
    {/* The same skeletons the first data load uses, so a chunk fetch and a
        slow read look alike to the user rather than introducing a second kind
        of waiting. Inside the boundary: a chunk that fails to load is a render
        error, and it should land on the page-level fallback with its Retry
        rather than blanking the app. */}
    <Suspense fallback={skeletonFor(props.page)}>
      <PageContent {...props} />
    </Suspense>
  </ErrorBoundary>
);

function skeletonFor(page: Page): React.ReactElement {
  if (page === "timer") return <TimerSkeleton />;
  if (page === "reports" || page === "team") return <ChartSkeleton />;
  return <ListSkeleton />;
}

const PageContent: React.FC<Props> = ({
  page, timerBusy, onContinue, onGoToProjects, teamContext, workingHours, timerScreen,
}) => {
  const { loading } = useData();

  if (loading) return skeletonFor(page);

  if (page === "timer") {
    return (
      <Timer
        {...timerScreen}
        workingHours={workingHours}
        onContinue={onContinue}
        timerBusy={timerBusy}
        onGoToProjects={onGoToProjects}
      />
    );
  }

  if (page === "timesheet") {
    return (
      <Timesheet workingHours={workingHours} onGoToProjects={onGoToProjects} />
    );
  }

  if (page === "calendar") return <Calendar workingHours={workingHours} />;

  if (page === "reports") return <Reports />;

  if (page === "team") {
    // The nav item only renders for managers, but guard anyway: without a
    // team there is nothing to show.
    if (!teamContext || teamContext.reports.length === 0) return null;
    return <Team teamContext={teamContext} />;
  }

  if (page === "projects") return <Projects />;

  return null;
};
