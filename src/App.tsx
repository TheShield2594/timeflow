import React, { useState, useMemo, useCallback } from "react";
import { TimerBar } from "./components/TimerBar";
import { TimesheetPage } from "./components/TimesheetPage";
import { ReportsPage } from "./components/ReportsPage";
import { ProjectsPage } from "./components/ProjectsPage";
import { CalendarPage } from "./components/CalendarPage";
import { useProjects, useTasks, useTimeEntries, useTimer } from "./hooks";

import type { TimeEntry } from "./types";

type Page = "timesheet" | "calendar" | "reports" | "projects";

const App: React.FC = () => {
  const [page, setPage] = useState<Page>("timesheet");

  const { projects, addProject } = useProjects();
  const { tasks, addTask } = useTasks();
  const { entries, loading, deleteEntry, editEntry, createEntry, refresh } = useTimeEntries();

  const handleNewEntry = useCallback(
    (_entry: TimeEntry) => { refresh(); },
    [refresh]
  );

  const { timer, elapsed, start, stop, update } = useTimer(handleNewEntry);

  const totalMinutesByProject = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((e) => {
      map.set(e.projectId, (map.get(e.projectId) || 0) + (e.durationMinutes || 0));
    });
    return map;
  }, [entries]);

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">

        <nav className="sidebar__nav">
          {(["timesheet", "calendar", "reports", "projects"] as Page[]).map((p) => (
            <button
              key={p}
              className={`sidebar__link ${page === p ? "sidebar__link--active" : ""}`}
              onClick={() => setPage(p)}
            >
              <span className="sidebar__link-icon">
                {p === "timesheet" ? "📋" : p === "calendar" ? "📅" : p === "reports" ? "📊" : "📁"}
              </span>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </nav>
        {timer.isRunning && (
          <div className="sidebar__running">
            <div className="sidebar__running-dot" />
            <span>Timer running</span>
          </div>
        )}
      </aside>

      {/* Main area */}
      <div className="main">
        <TimerBar
          projects={projects}
          tasks={tasks}
          isRunning={timer.isRunning}
          elapsed={elapsed}
          currentProjectId={timer.projectId}
          currentTaskId={timer.taskId}
          description={timer.description}
          ratio={timer.ratio}
          onStart={start}
          onStop={stop}
          onUpdate={update}
        />

        <div className="main__content">
          {loading ? (
            <div className="loading">Loading…</div>
          ) : page === "timesheet" ? (
            <TimesheetPage entries={entries} projects={projects} tasks={tasks} onDelete={deleteEntry} onEdit={editEntry} />
          ) : page === "calendar" ? (
            <CalendarPage entries={entries} projects={projects} tasks={tasks} onCreateEntry={createEntry} onEdit={editEntry} onDelete={deleteEntry} />
          ) : page === "reports" ? (
            <ReportsPage entries={entries} projects={projects} tasks={tasks} />
          ) : (
            <ProjectsPage
              projects={projects}
              tasks={tasks}
              totalMinutesByProject={totalMinutesByProject}
              onAddProject={addProject}
              onAddTask={addTask}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
