import React, { useCallback, useMemo, useRef, useState } from "react";
import { PageRouter, Page } from "./components/PageRouter";
import { IdleSheet } from "./components/IdleSheet";
import { AutoStopSheet } from "./components/AutoStopSheet";
import { EntrySheet, draftForEntry, draftForSpan, type EntryDraft } from "./components/EntrySheet";
import { SettingsSheet } from "./components/SettingsSheet";
import { formatMinutes, useTimer } from "./hooks";
import { useTeamContext } from "./hooks/useTeam";
import { useIdleGuard } from "./hooks/useIdleGuard";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useTheme, Theme } from "./hooks/useTheme";
import { useWeeklyTarget } from "./hooks/useWeeklyTarget";
import { useWorkingHours } from "./hooks/useWorkingHours";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import { DataRangeProvider } from "./contexts/DataRangeContext";
import { DataProvider, useData } from "./contexts/DataContext";
import { minutesOfDay, clockAt } from "./utils/dates";

import type { TimeEntry } from "./types";
import type { TimerDraft } from "./components/TimerPage";
import markUrl from "./everence-mark.png";

/**
 * Five items, six for managers. Text, not icons: there is no icon set in this
 * app on purpose — nothing to draw, nothing to keep consistent, and five words
 * read calmer than five glyphs somebody has to learn.
 *
 * Overview is gone; its content is the lower half of the timer screen.
 */
const NAV_ITEMS: { key: Page; label: string }[] = [
  { key: "timer", label: "Timer" },
  { key: "timesheet", label: "Timesheet" },
  { key: "calendar", label: "Calendar" },
  { key: "reports", label: "Reports" },
  { key: "projects", label: "Projects" },
];

// Shown after Reports, only when the signed-in user has direct reports.
const TEAM_NAV_ITEM: { key: Page; label: string } = { key: "team", label: "Team" };

/**
 * `navigator.platform` is deprecated and reports "" in some hardened
 * configurations, which once offered a Mac user "Ctrl+." — a shortcut they
 * don't have. userAgentData carries the same answer and is the supported
 * route; platform stays as the fallback.
 */
function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent;
  return /Mac|iPhone|iPod|iPad/.test(platform);
}
const IS_MAC = detectMac();
const SHORTCUT_HINT = IS_MAC ? "⌘ ." : "Ctrl + .";

const App: React.FC = () => {
  const { user, authError } = useAppBootstrap();
  // Theme lives above sign-in so the loading screen renders in the right
  // colours too (it's applied via data-theme on <html>).
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
        {/* Above AppContent on purpose: the page selection and the timer live
            *inside* it, and neither should be able to re-render the data
            layer underneath them (#115). */}
        <DataProvider>
          <AppContent theme={theme} onToggleTheme={toggleTheme} userName={user.displayName} />
        </DataProvider>
      </DataRangeProvider>
    </ToastProvider>
  );
};

const AppContent: React.FC<{ theme: Theme; onToggleTheme: () => void; userName: string }> = ({
  theme, onToggleTheme, userName,
}) => {
  const [page, setPage] = useState<Page>("timer");
  const toast = useToast();
  const online = useOnlineStatus();

  const {
    projects, tasks, entries, addTask, loadTasksForProject, refreshEntries,
    editEntry, deleteEntry, createEntry, isolationBreach,
  } = useData();
  const { teamContext } = useTeamContext();
  const isManager = (teamContext?.reports.length ?? 0) > 0;

  const { targetHours, setTargetHours } = useWeeklyTarget();
  const { workingHours, setWorkingHours } = useWorkingHours();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const navItems = useMemo(() => {
    if (!isManager) return NAV_ITEMS;
    const items = [...NAV_ITEMS];
    const afterReports = items.findIndex((i) => i.key === "reports") + 1;
    items.splice(afterReports || items.length, 0, TEAM_NAV_ITEM);
    return items;
  }, [isManager]);

  // What has been picked but not started. Held here rather than on the timer
  // screen so walking over to Projects to make one, and coming back, doesn't
  // lose the selection.
  const [draft, setDraft] = useState<TimerDraft>({ projectId: "", description: "" });
  const onDraftChange = useCallback((patch: Partial<TimerDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);
  const [focusProjectNonce, setFocusProjectNonce] = useState(0);

  /**
   * The entry a stop has just written, awaiting confirmation in the stop sheet.
   *
   * The stop itself still saves, exactly as it did before: the draft row is
   * already in Dataverse, and a sheet that held the hours in memory until
   * somebody pressed Save would lose them to a closed tab. So the sheet sits
   * over a saved entry — Save commits the edits made in it, Discard deletes it
   * and offers undo.
   */
  const [stopSheetEntry, setStopSheetEntry] = useState<TimeEntry | null>(null);
  const [entrySheet, setEntrySheet] = useState<{ mode: "create" | "edit"; draft: EntryDraft; id?: string } | null>(null);

  // Set by the stop paths that already explain themselves (the 12h safety
  // net), so the stop sheet doesn't open on top of a more specific one.
  const saveToastSuppressed = useRef(false);

  const handleNewEntry = useCallback((entry: TimeEntry) => {
    refreshEntries();
    if (saveToastSuppressed.current) {
      saveToastSuppressed.current = false;
      return;
    }
    // Replaces the bare success toast: a confirmation nobody could act on,
    // for an entry that on most screens wasn't even visible.
    setStopSheetEntry(entry);
  }, [refreshEntries]);

  // Neither of these ticks: nothing in AppContent re-renders on the second,
  // so a running timer no longer re-reconciles the whole page tree underneath
  // it (#95). The clock lives on the timer screen, next to the digits.
  const { timer, start, stop, stopAt, cancel, restore, update } = useTimer(handleNewEntry);

  const handleStart = useCallback(() => {
    if (!draft.projectId) {
      // Start is never disabled. With nothing picked it takes you to the
      // picker instead of doing nothing.
      setPage("timer");
      setFocusProjectNonce((n) => n + 1);
      return;
    }
    start(draft.projectId, null, draft.description);
  }, [draft, start]);

  // "Continue" on a past entry: restart the timer with the same project, task,
  // description and billing fields. start() guards against an already-running
  // timer itself, so no re-check is needed here.
  const continueEntry = useCallback((entry: TimeEntry) => {
    start(entry.projectId, entry.taskId ?? null, entry.description ?? "", entry.ratio, entry.jiraTicket);
  }, [start]);

  const idleGuard = useIdleGuard({
    timer, stopAt, cancel, restore, refresh: refreshEntries, toast, saveToastSuppressed,
  });

  /**
   * Ctrl/Cmd + . toggles the timer from anywhere in the app.
   *
   * It lives in the shell rather than on the timer screen because the timer
   * is the shell's: the shortcut has to work while you're reading Reports,
   * which is exactly when you'd reach for it.
   */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Shift isn't checked: on some international layouts "." is only
      // reachable via Shift, so rejecting it there made the shortcut dead.
      if (e.key !== "." || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      e.preventDefault();
      // A failed stop retries with the *original* stop timestamp, exactly
      // like the Retry button — never with "now", which would silently grow
      // the entry.
      if (timer.pendingStopAt) { stopAt(timer.pendingStopAt).catch(() => { /* toasted */ }); return; }
      if (timer.isRunning) { stop().catch(() => { /* toasted */ }); return; }
      handleStart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timer.isRunning, timer.pendingStopAt, stop, stopAt, handleStart]);

  const goToProjects = useCallback(() => setPage("projects"), []);
  const nowMinutes = minutesOfDay(new Date().toISOString());

  const stopSheetProject = projects.find((p) => p.id === stopSheetEntry?.projectId);
  const autoStopProject = projects.find((p) => p.id === idleGuard.autoStopped?.projectId);

  const closeStopSheet = useCallback((entry: TimeEntry) => {
    setStopSheetEntry(null);
    const duration = entry.durationMinutes !== undefined ? ` ${formatMinutes(entry.durationMinutes)}` : "";
    const project = projects.find((p) => p.id === entry.projectId);
    toast(`Saved${duration}${project ? ` to ${project.name}` : ""}.`, "success");
  }, [projects, toast]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          {/* The mark only. The full logo's charcoal wordmark does not survive
              dark mode, so the word is set in the app's own typeface. */}
          <img src={markUrl} alt="" className="sidebar__mark" />
          <span className="sidebar__wordmark">Timeflow</span>
        </div>
        <nav className="sidebar__nav">
          {navItems.map(({ key, label }) => (
            <button
              key={key}
              className={`sidebar__link ${page === key ? "sidebar__link--active" : ""}`}
              onClick={() => setPage(key)}
              aria-current={page === key ? "page" : undefined}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar__foot">
          <div className="sidebar__foot-sep" />
          <div className="sidebar__user-name">{userName}</div>
          <button type="button" className="sidebar__setting" onClick={onToggleTheme}>
            Appearance · {theme === "dark" ? "Dark" : "Light"}
          </button>
          <button type="button" className="sidebar__setting" onClick={() => setSettingsOpen(true)}>
            Working hours · {clockAt(workingHours.startMin)}–{clockAt(workingHours.endMin)}
          </button>
        </div>
      </aside>

      <div className="main">
        {/* Says the outage out loud instead of letting it surface as a failed
            save the user blames on the app (#97). Nothing is disabled: a save
            attempted while this is up still goes through the retry path, and
            `navigator.onLine === true` is no promise that Dataverse is up
            either.

            Rendered unconditionally with only its text conditional —
            assistive technology only announces a live region that was already
            in the accessibility tree when its content changed (#100). */}
        <div className="banner-offline" role="status" data-offline={!online}>
          {!online && (
            <>
              <span className="banner-offline__dot" />
              Offline. The timer keeps running — saves resume when the connection is back.
            </>
          )}
        </div>

        <div className="main__scroll">
          {isolationBreach && <IsolationAlarm />}
          <PageRouter
            page={page}
            timerBusy={timer.isRunning || !!timer.pendingStopAt}
            onContinue={continueEntry}
            onGoToProjects={goToProjects}
            teamContext={teamContext}
            workingHours={workingHours}
            timerScreen={{
              timer, draft, onDraftChange,
              onStart: handleStart,
              onStop: () => { stop().catch(() => { /* toasted + retryable in the hero */ }); },
              onRetryStop: (endIso) => { stopAt(endIso).catch(() => { /* toasted */ }); },
              onUpdate: update,
              focusProjectNonce,
              targetHours,
              onSetTarget: setTargetHours,
              shortcutHint: SHORTCUT_HINT,
            }}
          />
        </div>
      </div>

      {/* ── Sheets ─────────────────────────────────────────────────────── */}
      {stopSheetEntry && (
        <EntrySheet
          mode="stop"
          initial={draftForEntry(stopSheetEntry)}
          entryId={stopSheetEntry.id}
          projects={projects}
          tasks={tasks}
          dayEntries={entries.filter((e) => e.date === stopSheetEntry.date)}
          workingHours={workingHours}
          nowMinutes={nowMinutes}
          onSave={(data) => editEntry(stopSheetEntry.id, data)}
          onSaved={() => closeStopSheet(stopSheetEntry)}
          onDelete={() => { deleteEntry(stopSheetEntry.id); setStopSheetEntry(null); }}
          onClose={() => closeStopSheet(stopSheetEntry)}
          onLoadTasksForProject={loadTasksForProject}
          onAddTask={addTask}
          onFillGap={(startMin, endMin) => {
            setStopSheetEntry(null);
            setEntrySheet({
              mode: "create",
              draft: draftForSpan(stopSheetEntry.date, startMin, endMin, stopSheetProject?.id ?? ""),
            });
          }}
        />
      )}

      {entrySheet && (
        <EntrySheet
          mode={entrySheet.mode}
          initial={entrySheet.draft}
          entryId={entrySheet.id}
          projects={projects}
          tasks={tasks}
          dayEntries={entries.filter((e) => e.date === entrySheet.draft.date)}
          workingHours={workingHours}
          nowMinutes={nowMinutes}
          onSave={(data) => (entrySheet.id ? editEntry(entrySheet.id, data) : createEntry(data))}
          onClose={() => setEntrySheet(null)}
          onLoadTasksForProject={loadTasksForProject}
          onAddTask={addTask}
        />
      )}

      {idleGuard.idleAlert && (
        <IdleSheet
          lastActiveAt={idleGuard.idleAlert.lastActiveAt}
          startTime={idleGuard.idleAlert.startTime}
          onTrim={idleGuard.onTrim}
          onKeep={idleGuard.onKeep}
          onDiscard={idleGuard.onDiscard}
        />
      )}

      {/* The idle prompt wins if both are up: idle means the clock was ticking
          against an empty chair, and that conflict has to be resolved first. */}
      {!idleGuard.idleAlert && idleGuard.autoStopped && (
        <AutoStopSheet
          projectName={autoStopProject?.name}
          onFix={() => {
            const entry = idleGuard.autoStopped!;
            idleGuard.dismissAutoStop();
            setEntrySheet({ mode: "edit", draft: draftForEntry(entry), id: entry.id });
          }}
          onAccept={idleGuard.dismissAutoStop}
        />
      )}

      {settingsOpen && (
        <SettingsSheet
          workingHours={workingHours}
          onChange={setWorkingHours}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
};

/**
 * The only full-width alarm in the app, and the only banner that never goes
 * away on its own.
 *
 * It was a toast: a message that reached the one person who could not act on
 * it and then vanished. Nothing on these screens can be trusted while this is
 * up, which is not something to say for four seconds in a corner.
 */
const IsolationAlarm: React.FC = () => {
  const toast = useToast();
  const [explained, setExplained] = useState(false);
  const details =
    "Timeflow read time entries belonging to other users. Dataverse row-level security for " +
    "ever_timeentries is misconfigured — see the README's \"Dataverse Security Configuration\" " +
    "section. The app filters reads server-side with eq-userid; client-side filtering is not " +
    "the security boundary.";

  return (
    <div className="banner-alarm" role="alert">
      <h2 className="banner-alarm__title t-title2">This workspace is showing other people&rsquo;s time</h2>
      <p className="banner-alarm__body t-body">
        Entries owned by another user came back in your read. Your own data is intact, but nothing on
        these screens can be trusted until an administrator checks the table&rsquo;s ownership scope.
      </p>
      {explained && <p className="banner-alarm__body t-subhead">{details}</p>}
      <div className="banner-alarm__actions">
        <button
          type="button"
          className="pill pill--primary banner-alarm__solid"
          onClick={() => {
            navigator.clipboard?.writeText(details)
              .then(() => toast("Details copied.", "success"))
              .catch(() => setExplained(true));
          }}
        >
          Copy details for IT
        </button>
        <button type="button" className="pill pill--quiet" onClick={() => setExplained((v) => !v)}>
          What this means
        </button>
      </div>
    </div>
  );
};

export default App;
