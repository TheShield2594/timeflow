import React, { useState, useMemo, useCallback, useEffect } from "react";
import { TimerBar } from "./components/TimerBar";
import { TimesheetPage } from "./components/TimesheetPage";
import { ReportsPage } from "./components/ReportsPage";
import { ProjectsPage } from "./components/ProjectsPage";
import { CalendarPage } from "./components/CalendarPage";
import { IdleModal } from "./components/IdleModal";
import { useProjects, useTasks, useTimeEntries, useTimer } from "./hooks";
import { useActivityTracker, useTimerSafetyMonitor, MAX_DURATION_MS } from "./hooks/useTimerSafety";
import { initCurrentUser } from "./services/userService";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import logoUrl from "./everence-logo.png";

import type { TimeEntry, CurrentUser } from "./types";

type Page = "timesheet" | "calendar" | "reports" | "projects";

// How far back we initially load entries from Dataverse. Each page can request
// the loaded window to widen via ensureRangeLoaded.
const INITIAL_DAYS_LOADED = 90;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

interface IdleAlert {
  lastActiveAt: number;
  startTime: string;
}

const App: React.FC = () => {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    initCurrentUser()
      .then(setUser)
      .catch((err) => setAuthError(err instanceof Error ? err.message : "Sign-in failed"));
  }, []);

  if (authError) {
    return <div className="loading">Sign-in failed: {authError}</div>;
  }
  if (!user) {
    return <div className="loading">Signing in…</div>;
  }

  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
};

const AppContent: React.FC = () => {
  const [page, setPage] = useState<Page>("timesheet");
  const [idleAlert, setIdleAlert] = useState<IdleAlert | null>(null);
  const toast = useToast();

  const [loadedRange, setLoadedRange] = useState(() => ({
    from: isoDaysAgo(INITIAL_DAYS_LOADED - 1),
    to: todayIso(),
  }));

  // Pages call this when their UI needs data outside the currently loaded
  // window (e.g. Reports filter changed to "Last 90 days", Calendar navigated
  // backwards). We only ever widen; we don't shrink the cache.
  const ensureRangeLoaded = useCallback((from: string, to: string) => {
    setLoadedRange((prev) => {
      const nextFrom = from < prev.from ? from : prev.from;
      const nextTo = to > prev.to ? to : prev.to;
      if (nextFrom === prev.from && nextTo === prev.to) return prev;
      return { from: nextFrom, to: nextTo };
    });
  }, []);

  const { projects, addProject } = useProjects();
  const { tasks, addTask } = useTasks();
  const { entries, loading, deleteEntry, editEntry, createEntry, refresh } = useTimeEntries(loadedRange.from, loadedRange.to);

  const handleNewEntry = useCallback(
    (_entry: TimeEntry) => { refresh(); },
    [refresh]
  );

  const { timer, elapsed, start, stop, stopAt, cancel, update } = useTimer(handleNewEntry);

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
      // stopAt already toasted the save error; nothing else to do.
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
    // Treat dismissal as activity so we don't re-prompt instantly.
    lastActivity.current = Date.now();
    setIdleAlert(null);
  }, [lastActivity]);

  const handleIdleDiscard = useCallback(() => {
    cancel();
    setIdleAlert(null);
    toast("Session discarded.", "info");
  }, [cancel, toast]);

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
            <TimesheetPage
              entries={entries}
              projects={projects}
              tasks={tasks}
              onDelete={deleteEntry}
              onEdit={editEntry}
              onEnsureRangeLoaded={ensureRangeLoaded}
            />
          ) : page === "calendar" ? (
            <CalendarPage
              entries={entries}
              projects={projects}
              tasks={tasks}
              onCreateEntry={createEntry}
              onEdit={editEntry}
              onDelete={deleteEntry}
              onEnsureRangeLoaded={ensureRangeLoaded}
            />
          ) : page === "reports" ? (
            <ReportsPage
              entries={entries}
              projects={projects}
              tasks={tasks}
              onEnsureRangeLoaded={ensureRangeLoaded}
            />
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
