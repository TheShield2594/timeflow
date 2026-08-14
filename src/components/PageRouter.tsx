import React from "react";
import { OverviewPage } from "./OverviewPage";
import { TimesheetPage } from "./TimesheetPage";
import { CalendarPage } from "./CalendarPage";
import { ReportsPage } from "./ReportsPage";
import { ProjectsPage } from "./ProjectsPage";
import { TeamPage } from "./TeamPage";
import type { TeamContext } from "../services/teamService";
import type { TimeEntry, Project, Task } from "../types";

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
const Calendar = React.memo(CalendarPage);
const Reports = React.memo(ReportsPage);
const Projects = React.memo(ProjectsPage);
const Team = React.memo(TeamPage);

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

interface Props {
  page: Page;
  loading: boolean;
  rangeLoading: boolean;
  entries: TimeEntry[];
  projects: Project[];
  tasks: Task[];
  timerBusy: boolean;
  onDelete: (id: string) => void;
  onEdit: (id: string, data: Partial<TimeEntry>) => Promise<TimeEntry>;
  onCreate: (data: Omit<TimeEntry, "id">) => Promise<TimeEntry>;
  onContinue: (entry: TimeEntry) => void;
  onAddProject: (data: Omit<Project, "id" | "createdAt">) => Promise<Project>;
  onEditProject: (id: string, data: Partial<Project>) => Promise<Project>;
  onArchiveProject: (project: Project) => void;
  onRestoreProject: (project: Project) => Promise<void>;
  onAddTask: (data: Omit<Task, "id">) => Promise<Task>;
  onDeleteTask: (task: Task) => void;
  onRenameTask: (task: Task, newName: string) => Promise<void>;
  onLoadTasksForProject: (projectId: string) => void;
  onGoToProjects?: () => void;
  /** Non-null with reports = the user manages people; enables the Team page. */
  teamContext?: TeamContext | null;
}

export const PageRouter: React.FC<Props> = ({
  page, loading, rangeLoading, entries, projects, tasks, timerBusy,
  onDelete, onEdit, onCreate, onContinue, onAddProject, onEditProject,
  onArchiveProject, onRestoreProject, onAddTask, onDeleteTask, onRenameTask, onLoadTasksForProject, onGoToProjects,
  teamContext,
}) => {
  if (loading) {
    return page === "reports" || page === "overview" ? <ReportsSkeleton /> : <PageSkeleton />;
  }

  if (page === "overview") {
    return (
      <Overview
        entries={entries}
        projects={projects}
        tasks={tasks}
        timerBusy={timerBusy}
        onContinue={onContinue}
        onCreate={onCreate}
        onLoadTasksForProject={onLoadTasksForProject}
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
        onDelete={onDelete}
        onEdit={onEdit}
        onCreate={onCreate}
        onContinue={onContinue}
        onLoadTasksForProject={onLoadTasksForProject}
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
        onCreateEntry={onCreate}
        onEdit={onEdit}
        onDelete={onDelete}
        onLoadTasksForProject={onLoadTasksForProject}
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
        onAddProject={onAddProject}
        onEditProject={onEditProject}
        onArchiveProject={onArchiveProject}
        onRestoreProject={onRestoreProject}
        onAddTask={onAddTask}
        onDeleteTask={onDeleteTask}
        onRenameTask={onRenameTask}
        onLoadTasksForProject={onLoadTasksForProject}
      />
    );
  }

  return null;
};
