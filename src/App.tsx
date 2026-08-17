import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { TimerBar } from "./components/TimerBar";
import { IdleModal } from "./components/IdleModal";
import { FocusModal } from "./components/FocusModal";
import { useFocusMode } from "./hooks/useFocusMode";
import { PageRouter, Page } from "./components/PageRouter";
import { IconHome, IconTimesheet, IconCalendar, IconChart, IconFolder, IconMoon, IconSun, IconUsers } from "./components/Icons";
import { formatMinutes, useProjects, useTasks, useTimeEntries, useTimer } from "./hooks";
import { useTeamContext } from "./hooks/useTeam";
import { useIdleGuard } from "./hooks/useIdleGuard";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useTheme, Theme } from "./hooks/useTheme";
import { setPaginationWarningHandler } from "./services/dataverseService";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import { DataRangeProvider, useDataRange } from "./contexts/DataRangeContext";

import type { TimeEntry, Task, Project } from "./types";
import logoUrl from "./everence-logo.png";

const NAV_ITEMS: { key: Page; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <IconHome /> },
  { key: "timesheet", label: "Timesheet", icon: <IconTimesheet /> },
  { key: "calendar", label: "Calendar", icon: <IconCalendar /> },
  { key: "reports", label: "Reports", icon: <IconChart /> },
  { key: "projects", label: "Projects", icon: <IconFolder /> },
];

// Shown after Reports, only when the signed-in user has direct reports.
const TEAM_NAV_ITEM: { key: Page; label: string; icon: React.ReactNode } =
  { key: "team", label: "Team", icon: <IconUsers /> };

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

  // The error boundary lives in main.tsx now, above this component — see the
  // note there.
  return (
    <ToastProvider>
      <DataRangeProvider>
        <AppContent theme={theme} onToggleTheme={toggleTheme} />
      </DataRangeProvider>
    </ToastProvider>
  );
};

const AppContent: React.FC<{ theme: Theme; onToggleTheme: () => void }> = ({ theme, onToggleTheme }) => {
  const [page, setPage] = useState<Page>("overview");
  const toast = useToast();
  const { from, to } = useDataRange();
  const online = useOnlineStatus();

  useEffect(() => {
    setPaginationWarningHandler((msg) => toast(msg, "error"));
    return () => setPaginationWarningHandler(null);
  }, [toast]);

  const { projects, addProject, editProject, archiveProject, restoreProject } = useProjects();
  const { tasks, addTask, deleteTask, restoreTask, renameTask, loadTasksForProject } = useTasks();
  const { entries, loading, isFetching, deleteEntry, editEntry, createEntry, refresh } = useTimeEntries(from, to);
  const { teamContext } = useTeamContext();
  const isManager = (teamContext?.reports.length ?? 0) > 0;

  const navItems = useMemo(() => {
    if (!isManager) return NAV_ITEMS;
    const items = [...NAV_ITEMS];
    const afterReports = items.findIndex((i) => i.key === "reports") + 1;
    items.splice(afterReports || items.length, 0, TEAM_NAV_ITEM);
    return items;
  }, [isManager]);

  // Last completed entry, so the focus-mode "start next block" prompt can
  // restart the timer on what the user was just doing.
  const lastEntryRef = useRef<TimeEntry | null>(null);

  // Set by the stop paths that already explain themselves (the 12h safety net),
  // so the generic save confirmation below doesn't stack a second toast on top
  // of a more specific one.
  const saveToastSuppressed = useRef(false);

  const handleNewEntry = useCallback(
    (entry: TimeEntry) => {
      lastEntryRef.current = entry;
      refresh();
      // Every failure path toasts, but a *successful* stop used to produce
      // nothing at all — the bar just reset, and on Overview or Reports the
      // new entry isn't even on screen. Sighted and non-sighted users alike
      // had no confirmation that the hours were recorded (#99).
      if (saveToastSuppressed.current) {
        saveToastSuppressed.current = false;
        return;
      }
      // Both parts are optional on TimeEntry, and a confirmation is still worth
      // showing without them — the point is that the save landed.
      const duration = entry.durationMinutes !== undefined ? ` ${formatMinutes(entry.durationMinutes)}` : "";
      const project = projects.find((p) => p.id === entry.projectId);
      toast(`Saved${duration}${project ? ` to ${project.name}` : ""}.`, "success");
    },
    [refresh, projects, toast]
  );

  // Neither of these ticks: nothing in AppContent re-renders on the second,
  // so a running timer no longer re-reconciles the whole page tree underneath
  // it (#95). The clocks live in TimerBar, next to the digits they update.
  const { timer, start, stop, stopAt, cancel, restore, update } = useTimer(handleNewEntry);
  const focusMode = useFocusMode(timer.isRunning, timer.startTime);

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
    // Delete deactivates the record, so undo reactivates that same record and
    // historical entries keep pointing at it. Only saved tasks get this far —
    // deleteTask refuses a task whose id is still pending — so there's no
    // recreate-instead case to handle.
    toast("Task deleted.", "info", {
      label: "Undo",
      onAction: () => { restoreTask(task).catch(() => { /* toasted by hook */ }); },
    });
  }, [deleteTask, restoreTask, toast]);

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
    start(entry.projectId, entry.taskId ?? null, entry.description ?? "", entry.ratio, entry.jiraTicket);
  }, [start]);

  // Focus mode: "take a break" starts the break countdown and stops (saves)
  // the running entry. A failed save falls into the existing pendingStopAt
  // retry flow; the break proceeds regardless — the user is stepping away.
  const handleTakeBreak = useCallback(() => {
    focusMode.beginBreak();
    stop().catch(() => { /* toasted + retryable via the timer bar */ });
  }, [focusMode, stop]);

  const handleResumeFocus = useCallback(() => {
    const last = lastEntryRef.current;
    focusMode.dismissResume();
    if (last) continueEntry(last);
  }, [focusMode, continueEntry]);

  // Stable identity so the memoized pages below aren't handed a fresh prop on
  // every AppContent render.
  const goToProjects = useCallback(() => setPage("projects"), []);

  const idleGuard = useIdleGuard({
    timer, stopAt, cancel, restore, refresh, toast, saveToastSuppressed,
  });

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__logo">
          <img src={logoUrl} alt="Everence" className="sidebar__logo-img" />
        </div>
        <nav className="sidebar__nav">
          {navItems.map(({ key, label, icon }) => (
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
        {/* Says the outage out loud instead of letting it surface as a failed
            save the user blames on the app (#97). Nothing is disabled: a save
            attempted while this is up still goes through the retry path, and
            `navigator.onLine === true` is no promise that Dataverse is up
            either.

            The region is rendered unconditionally and only its text is
            conditional — assistive technology only announces a live region that
            was already in the accessibility tree when its content changed, the
            same rule the toast container documents (#100). */}
        <div className="offline-banner" role="status" data-offline={!online}>
          {!online && (
            <>
              You appear to be offline. The timer keeps running locally, but
              saves won&rsquo;t reach Dataverse until the connection is back.
            </>
          )}
        </div>
        <TimerBar
          projects={projects}
          tasks={tasks}
          isRunning={timer.isRunning}
          pendingStopAt={timer.pendingStopAt}
          startTime={timer.startTime}
          currentProjectId={timer.projectId}
          currentTaskId={timer.taskId}
          description={timer.description}
          ratio={timer.ratio}
          jiraTicket={timer.jiraTicket}
          focus={{
            enabled: focusMode.enabled,
            phase: focusMode.phase,
            endsAt: focusMode.endsAt,
            settings: focusMode.settings,
            sessionsToday: focusMode.sessionsToday,
            onToggle: focusMode.toggleEnabled,
            onUpdateSettings: focusMode.updateSettings,
          }}
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
            onGoToProjects={goToProjects}
            teamContext={teamContext}
          />
        </div>
      </div>

      {idleGuard.idleAlert && (
        <IdleModal
          lastActiveAt={idleGuard.idleAlert.lastActiveAt}
          startTime={idleGuard.idleAlert.startTime}
          onTrim={idleGuard.onTrim}
          onKeep={idleGuard.onKeep}
          onDiscard={idleGuard.onDiscard}
        />
      )}

      {/* Focus-mode boundary prompts. The idle modal wins if both are up —
          idle means the block's countdown was ticking against an empty
          chair, so that conflict needs resolving first. */}
      {!idleGuard.idleAlert && focusMode.phase === "prompt-break" && (
        <FocusModal
          kind="break"
          sessionsToday={focusMode.sessionsToday}
          breakMinutes={focusMode.settings.breakMinutes}
          onTakeBreak={handleTakeBreak}
          onKeepGoing={focusMode.keepGoing}
        />
      )}
      {!idleGuard.idleAlert && focusMode.phase === "prompt-resume" && (
        <FocusModal
          kind="resume"
          canContinue={!!lastEntryRef.current && !timer.isRunning && !timer.pendingStopAt}
          onContinue={handleResumeFocus}
          onDismiss={focusMode.dismissResume}
        />
      )}
    </div>
  );
};

export default App;
