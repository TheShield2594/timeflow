import React from "react";
import { TimesheetPage } from "./TimesheetPage";
import { CalendarPage } from "./CalendarPage";
import { ReportsPage } from "./ReportsPage";
import { ProjectsPage } from "./ProjectsPage";
import type { TimeEntry, Project, Task } from "../types";

export type Page = "timesheet" | "calendar" | "reports" | "projects";

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
  entries: TimeEntry[];
  projects: Project[];
  tasks: Task[];
  totalMinutesByProject: Map<string, number>;
  onDelete: (id: string) => void;
  onEdit: (id: string, data: Partial<TimeEntry>) => Promise<TimeEntry>;
  onCreate: (data: Omit<TimeEntry, "id">) => Promise<TimeEntry>;
  onAddProject: (data: Omit<Project, "id" | "createdAt">) => Promise<Project>;
  onEditProject: (id: string, data: Partial<Project>) => Promise<Project>;
  onAddTask: (data: Omit<Task, "id">) => Promise<Task>;
  onLoadTasksForProject: (projectId: string) => void;
}

export const PageRouter: React.FC<Props> = ({
  page, loading, entries, projects, tasks, totalMinutesByProject,
  onDelete, onEdit, onCreate, onAddProject, onEditProject, onAddTask, onLoadTasksForProject,
}) => {
  if (loading) {
    return page === "reports" ? <ReportsSkeleton /> : <PageSkeleton />;
  }

  if (page === "timesheet") {
    return (
      <TimesheetPage
        entries={entries}
        projects={projects}
        tasks={tasks}
        onDelete={onDelete}
        onEdit={onEdit}
        onCreate={onCreate}
        onLoadTasksForProject={onLoadTasksForProject}
      />
    );
  }

  if (page === "calendar") {
    return (
      <CalendarPage
        entries={entries}
        projects={projects}
        tasks={tasks}
        onCreateEntry={onCreate}
        onEdit={onEdit}
        onDelete={onDelete}
        onLoadTasksForProject={onLoadTasksForProject}
      />
    );
  }

  if (page === "reports") {
    return (
      <ReportsPage
        entries={entries}
        projects={projects}
        tasks={tasks}
      />
    );
  }

  return (
    <ProjectsPage
      projects={projects}
      tasks={tasks}
      totalMinutesByProject={totalMinutesByProject}
      onAddProject={onAddProject}
      onEditProject={onEditProject}
      onAddTask={onAddTask}
    />
  );
};
