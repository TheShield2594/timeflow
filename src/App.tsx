import React, { useState, useMemo, useCallback, useEffect, Component } from "react";
import { TimerBar } from "./components/TimerBar";
import { IdleModal } from "./components/IdleModal";
import { PageRouter, Page } from "./components/PageRouter";
import { IconHome, IconTimesheet, IconCalendar, IconChart, IconFolder, IconMoon, IconSun } from "./components/Icons";
import { useProjects, useTasks, useTimeEntries, useTimer } from "./hooks";
import { useActivityTracker, useTimerSafetyMonitor, MAX_DURATION_MS } from "./hooks/useTimerSafety";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useTheme, Theme } from "./hooks/useTheme";
import { setPaginationWarningHandler } from "./services/dataverseService";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import { DataRangeProvider, useDataRange } from "./contexts/DataRangeContext";
import { isTempId } from "./hooks/_shared";

import type { TimeEntry, Task, Project } from "./types";
import logoUrl from "./everence-logo.png";

// ---------------------------------------------------------------------------
// ErrorBoundary — catches render errors and shows a recovery screen instead
// of leaving the user on a blank white page (issue #31).
// ---------------------------------------------------------------------------
interface EBState { error: Error | null }
class ErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary__card">
            <h2 className="error-boundary__title">Something went wrong</h2>
            <p className="error-boundary__detail">{this.state.error.message}</p>
            <button
              className="btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface IdleAlert {
  lastActiveAt: number;
  startTime: string;
}

const NAV_ITEMS: { key: Page; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <IconHome /> },
  { key: "timesheet", label: "Timesheet", icon: <IconTimesheet /> },
  { key: "calendar", label: "Calendar", icon: <IconCalendar /> },
  { key: "reports", label: "Reports", icon: <IconChart /> },
  { key: "projects", label: "Projects", icon: <IconFolder /> },
];

const App: React.FC = () => {
  const { user, authError } = useAppBootstrap();
  // Theme lives above sign-in so the loading screen renders in the right
  // colors too (it's applied via data-theme on <html>).
  const { theme, toggleTheme } = useTheme();

  if (authError) {
    return <div className="loading">Sign-in failed: {authError}</div>;
  }
  if (!user) {
    return <div className="loading">Signing in…</div>;
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <DataRangeProvider>
          <AppContent theme={theme} onToggleTheme={toggleTheme} />
        </DataRangeProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
};

const AppContent: React.FC<{ theme: Theme; onToggleTheme: () => void }> = ({ theme, onToggleTheme }) => {
  const [page, setPage] = useState<Page>("overview");
  const [idleAlert, setIdleAlert] = useState<IdleAlert | null>(null);
  const toast = useToast();
  const { from, to } = useDataRange();

  useEffect(() => {
    setPaginationWarningHandler((msg) => toast(msg, "error"));
    return () => setPaginationWarningHandler(null);
  }, [toast]);

  const { projects, addProject, editProject, archiveProject, restoreProject } = useProjects();
  const { tasks, addTask, deleteTask, restoreTask, renameTask, loadTasksForProject } = useTasks();
  const { entries, loading, isFetching, deleteEntry, editEntry, createEntry, refresh } = useTimeEntries(from, to);

  const handleNewEntry = useCallback(
    (_entry: TimeEntry) => { refresh(); },
    [refresh]
  );

  const { timer, elapsed, start, stop, stopAt, cancel, update } = useTimer(handleNewEntry);

  const deleteWithUndo = useCallback(async (id: string) => {
    const snapshot = entries.find((e) => e.id === id);
    try {
      await deleteEntry(id);
    } catch {
      return;
    }
    if (snapshot) {
      const { id: _omit, ...data } = snapshot;
      toast("Entry deleted.", "info", {
        label: "Undo",
        onAction: () => { createEntry(data).catch(() => { /* toasted by hook */ }); },
      });
    }
  }, [entries, deleteEntry, createEntry, toast]);

  const deleteTaskWithUndo = useCallback(async (task: Task) => {
    try {
      await deleteTask(task);
    } catch {
      return;
    }
    // Delete deactivates the record, so undo reactivates that same record —
    // historical entries keep pointing at it. A temp-id task was never saved
    // server-side, so recreate it instead.
    const { id: _omit, ...data } = task;
    const undo = isTempId(task.id)
      ? () => { addTask(data).catch(() => { /* toasted by hook */ }); }
      : () => { restoreTask(task).catch(() => { /* toasted by hook */ }); };
    toast("Task deleted.", "info", { label: "Undo", onAction: undo });
  }, [deleteTask, restoreTask, addTask, toast]);

  const archiveProjectWithUndo = useCallback(async (project: Project) => {
    try {
      await archiveProject(project);
    } catch {
      return;
    }
    toast("Project archived.", "info", {
      label: "Undo",
      onAction: () => { restoreProject(project).catch(() => { /* toasted by hook */ }); },
    });
  }, [archiveProject, restoreProject, toast]);

  // "Continue" on a past entry: restart the timer with the same project,
  // task, description and ratio. start() itself guards against an
  // already-running timer (with a toast), so no re-check needed here.
  const continueEntry = useCallback((entry: TimeEntry) => {
    start(entry.projectId, entry.taskId ?? null, entry.description ?? "", entry.ratio);
  }, [start]);

  const lastActivity = useActivityTracker();

  const handleIdleDetected = useCallback((lastActiveAt: number) => {
    if (timer.startTime) {
      setIdleAlert({ lastActiveAt, startTime: timer.startTime });
    }
  }, [timer.startTime]);

  const handleMaxDuration = useCallback(async () => {
    if (!timer.startTime) return;
    const cappedEnd = new Date(new Date(timer.startTime).getTime() + MAX_DURATION_MS).toISOString();
    try {
      await stopAt(cappedEnd);
      toast("Timer auto-stopped after 12 hours — edit the entry if needed.", "info");
    } catch {
      // stopAt already toasted the save error
    }
  }, [timer.startTime, stopAt, toast]);

  useTimerSafetyMonitor({
    isRunning: timer.isRunning,
    startTime: timer.startTime,
    lastActivity,
    onIdleDetected: handleIdleDetected,
    onMaxDurationReached: handleMaxDuration,
  });

  const handleIdleTrim = useCallback(async () => {
    if (!idleAlert) return;
    setIdleAlert(null);
    try {
      await stopAt(new Date(idleAlert.lastActiveAt).toISOString());
    } catch {
      // toasted by stopAt
    }
  }, [idleAlert, stopAt]);

  const handleIdleKeep = useCallback(() => {
    lastActivity.current = Date.now();
    setIdleAlert(null);
  }, [lastActivity]);

  const handleIdleDiscard = useCallback(async () => {
    setIdleAlert(null);
    // cancel() resolves once the draft row is deleted; refresh after so the
    // discarded session's "Running…" row disappears from the timesheet too.
    await cancel();
    refresh();
    toast("Session discarded.", "info");
  }, [cancel, refresh, toast]);

  const totalMinutesByProject = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((e) => {
      map.set(e.projectId, (map.get(e.projectId) || 0) + (e.durationMinutes || 0));
    });
    return map;
  }, [entries]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__logo">
          <img src={logoUrl} alt="Everence" className="sidebar__logo-img" />
        </div>
        <nav className="sidebar__nav">
          {NAV_ITEMS.map(({ key, label, icon }) => (
            <button
              key={key}
              className={`sidebar__link ${page === key ? "sidebar__link--active" : ""}`}
              onClick={() => setPage(key)}
              title={label}
              aria-current={page === key ? "page" : undefined}
            >
              <span className="sidebar__link-icon">{icon}</span>
              <span className="sidebar__link-label">{label}</span>
            </button>
          ))}
        </nav>
        {timer.isRunning && (
          <div className="sidebar__running">
            <div className="sidebar__running-dot" />
            <span className="sidebar__running-label">Timer running</span>
          </div>
        )}
        <button
          type="button"
          className="sidebar__theme-toggle"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          <span className="sidebar__link-icon">{theme === "dark" ? <IconSun /> : <IconMoon />}</span>
          <span className="sidebar__link-label">{theme === "dark" ? "Light theme" : "Dark theme"}</span>
        </button>
      </aside>

      <div className="main">
        <TimerBar
          projects={projects}
          tasks={tasks}
          isRunning={timer.isRunning}
          pendingStopAt={timer.pendingStopAt}
          elapsed={elapsed}
          currentProjectId={timer.projectId}
          currentTaskId={timer.taskId}
          description={timer.description}
          ratio={timer.ratio}
          onStart={start}
          onStop={stop}
          onRetryStop={stopAt}
          onUpdate={update}
          onAddTask={addTask}
          onLoadTasksForProject={loadTasksForProject}
        />

        <div className="main__content">
          <PageRouter
            page={page}
            loading={loading}
            rangeLoading={isFetching && !loading}
            entries={entries}
            projects={projects}
            tasks={tasks}
            totalMinutesByProject={totalMinutesByProject}
            timerBusy={timer.isRunning || !!timer.pendingStopAt}
            onDelete={deleteWithUndo}
            onEdit={editEntry}
            onCreate={createEntry}
            onContinue={continueEntry}
            onAddProject={addProject}
            onEditProject={editProject}
            onArchiveProject={archiveProjectWithUndo}
            onRestoreProject={restoreProject}
            onAddTask={addTask}
            onDeleteTask={deleteTaskWithUndo}
            onRenameTask={renameTask}
            onLoadTasksForProject={loadTasksForProject}
            onGoToProjects={() => setPage("projects")}
          />
        </div>
      </div>

      {idleAlert && (
        <IdleModal
          lastActiveAt={idleAlert.lastActiveAt}
          startTime={idleAlert.startTime}
          onTrim={handleIdleTrim}
          onKeep={handleIdleKeep}
          onDiscard={handleIdleDiscard}
        />
      )}
    </div>
  );
};

export default App;
