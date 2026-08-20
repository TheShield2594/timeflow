import React, { Suspense } from "react";
import { OverviewPage } from "./OverviewPage";
import { TimesheetPage } from "./TimesheetPage";
import { ErrorBoundary } from "./ErrorBoundary";
import { useData } from "../contexts/DataContext";
import type { TeamContext } from "../services/teamService";
import type { TimeEntry } from "../types";

export type Page = "overview" | "timesheet" | "calendar" | "reports" | "projects" | "team";

/**
 * The pages are memoized here rather than at their own exports so each stays a
 * plain component for the tests that render it directly.
 *
 * None of them were memoized before, so anything that re-rendered the app
 * shell re-reconciled the whole mounted page — on the Calendar, ~720 elements
 * and a couple of thousand fresh closures (#95). The 1 Hz timer tick that made
 * that continuous is gone now, but the shell still re-renders on every entry
 * edit, toast and range change, and none of those change most pages' props.
 */
const Overview = React.memo(OverviewPage);
const Timesheet = React.memo(TimesheetPage);

/**
 * Everything past the first two screens is code-split (#116).
 *
 * Overview is where the app lands and Timesheet is one click away on nearly
 * every session, so both stay in the entry chunk — deferring them would only
 * buy a spinner. Calendar, Reports, Projects and Team are each visited by
 * some sessions and none, and Calendar alone is the largest component in the
 * app; splitting them is what keeps the first paint from carrying pages the
 * user may never open.
 *
 * React.lazy resolves the module once and caches it, so the fetch happens on
 * the first navigation to a page and never again. The memo goes on the loaded
 * module rather than around the lazy wrapper, so these keep the same
 * re-render behavior the eager pages above have.
 */
const Calendar = React.lazy(() => import("./CalendarPage").then((m) => ({ default: React.memo(m.CalendarPage) })));
const Reports = React.lazy(() => import("./ReportsPage").then((m) => ({ default: React.memo(m.ReportsPage) })));
const Projects = React.lazy(() => import("./ProjectsPage").then((m) => ({ default: React.memo(m.ProjectsPage) })));
const Team = React.lazy(() => import("./TeamPage").then((m) => ({ default: React.memo(m.TeamPage) })));

/** Skeleton shown only on the very first data load — shaped like the timesheet. */
export const PageSkeleton: React.FC = () => (
  <div className="page-skeleton" aria-hidden="true">
    <div className="skeleton skeleton--title" />
    {[0, 1, 2].map((g) => (
      <div key={g} className="page-skeleton__group">
        <div className="skeleton skeleton--label" />
        {[0, 1].map((r) => (
          <div key={r} className="skeleton skeleton--row" />
        ))}
      </div>
    ))}
  </div>
);

/** Skeleton shaped like the Reports page — KPI strip + bar chart. */
export const ReportsSkeleton: React.FC = () => (
  <div className="reports-skeleton" aria-hidden="true">
    <div className="skeleton skeleton--title" style={{ width: 120, marginBottom: 18 }} />
    <div className="reports-skeleton__kpis">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton skeleton--kpi" />
      ))}
    </div>
    <div className="skeleton skeleton--chart" style={{ marginBottom: 16 }} />
    <div className="skeleton skeleton--row" style={{ height: 120 }} />
  </div>
);

/**
 * What the router needs that isn't data. Entries, projects, tasks and every
 * mutation over them come from `useData()` — this used to be 19 props, all of
 * them forwarded verbatim from AppContent to a page that wanted them (#115).
 * What's left is the four things that genuinely belong to the shell.
 */
interface Props {
  page: Page;
  /** True while a timer is running or retrying a stop — pages disable "Continue". */
  timerBusy: boolean;
  onContinue: (entry: TimeEntry) => void;
  onGoToProjects?: () => void;
  /** Non-null with reports = the user manages people; enables the Team page. */
  teamContext?: TeamContext | null;
}

/**
 * One boundary per page rather than one for the app: a render crash in Reports
 * used to blank the entire app, including the running timer, and the only way
 * back was a reload (#111). Keyed on `page` so navigating away clears it.
 */
export const PageRouter: React.FC<Props> = (props) => (
  <ErrorBoundary scope={props.page} resetKey={props.page}>
    {/* The same skeletons the first data load uses, so a chunk fetch and a
        slow read look alike to the user rather than introducing a second
        kind of waiting. Inside the boundary: a chunk that fails to load is a
        render error, and it should land on the page-level fallback with its
        Retry rather than blanking the app. */}
    <Suspense fallback={pageSkeletonFor(props.page)}>
      <PageContent {...props} />
    </Suspense>
  </ErrorBoundary>
);

function pageSkeletonFor(page: Page): React.ReactElement {
  return page === "reports" || page === "overview" ? <ReportsSkeleton /> : <PageSkeleton />;
}

const PageContent: React.FC<Props> = ({
  page, timerBusy, onContinue, onGoToProjects, teamContext,
}) => {
  const {
    entries, projects, tasks, loading, rangeLoading,
    createEntry, editEntry, deleteEntry, refreshEntries: _refresh,
    addProject, editProject, archiveProject, restoreProject,
    addTask, deleteTask, renameTask, loadTasksForProject,
  } = useData();

  if (loading) return pageSkeletonFor(page);

  if (page === "overview") {
    return (
      <Overview
        entries={entries}
        projects={projects}
        tasks={tasks}
        timerBusy={timerBusy}
        onContinue={onContinue}
        onCreate={createEntry}
        onLoadTasksForProject={loadTasksForProject}
        onGoToProjects={onGoToProjects}
      />
    );
  }

  if (page === "timesheet") {
    return (
      <Timesheet
        entries={entries}
        projects={projects}
        tasks={tasks}
        timerBusy={timerBusy}
        rangeLoading={rangeLoading}
        onDelete={deleteEntry}
        onEdit={editEntry}
        onCreate={createEntry}
        onContinue={onContinue}
        onLoadTasksForProject={loadTasksForProject}
        onGoToProjects={onGoToProjects}
      />
    );
  }

  if (page === "calendar") {
    return (
      <Calendar
        entries={entries}
        projects={projects}
        tasks={tasks}
        rangeLoading={rangeLoading}
        onCreateEntry={createEntry}
        onEdit={editEntry}
        onDelete={deleteEntry}
        onLoadTasksForProject={loadTasksForProject}
      />
    );
  }

  if (page === "reports") {
    return (
      <Reports
        entries={entries}
        projects={projects}
        tasks={tasks}
        rangeLoading={rangeLoading}
      />
    );
  }

  if (page === "team") {
    // The nav item only renders for managers, but guard anyway: without a
    // team there is nothing to show.
    if (!teamContext || teamContext.reports.length === 0) return null;
    return <Team teamContext={teamContext} projects={projects} tasks={tasks} />;
  }

  if (page === "projects") {
    return (
      <Projects
        projects={projects}
        tasks={tasks}
        entries={entries}
        onAddProject={addProject}
        onEditProject={editProject}
        onArchiveProject={archiveProject}
        onRestoreProject={restoreProject}
        onAddTask={addTask}
        onDeleteTask={deleteTask}
        onRenameTask={renameTask}
        onLoadTasksForProject={loadTasksForProject}
      />
    );
  }

  return null;
};
