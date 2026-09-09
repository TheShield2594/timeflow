import React, { useEffect, useMemo, useRef, useState } from "react";
import type { TimeEntry, TimerState } from "../types";
import { formatElapsed, formatMinutes } from "../hooks";
import { useData } from "../contexts/DataContext";
import { useToday } from "../hooks/useToday";
import { useEntriesOnDate } from "../hooks/useEntriesOnDate";
import { useRangeRequest } from "../contexts/DataRangeContext";
import type { WorkingHours } from "../hooks/useWorkingHours";
import {
  DATE_LOCALE, addDaysStr, minutesOfDay, weekStartStr, clockAt,
} from "../utils/dates";
import { findUntrackedGaps } from "../utils/gaps";
import { DEFAULT_PROJECT_COLOR } from "../utils/colors";
import { indexById } from "../utils/entityIndex";
import { DayBar } from "./DayBar";
import { ListCard, ListRow } from "./ListCard";
import { WeekRail } from "./WeekRail";
import { Pill } from "./Pill";
import { EntrySheet, draftForSpan, type EntryDraft, type EntrySaveData } from "./EntrySheet";

/**
 * Seconds since `startTime`, ticked here rather than higher up.
 *
 * The clock is the only thing on the screen that changes every second, so it
 * is the only thing that should re-render every second — a counter held in the
 * app shell re-reconciled every mounted page once a second for the whole
 * length of a session (#95).
 */
function useElapsed(startTime: string | null, isRunning: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning || !startTime) {
      setElapsed(0);
      return;
    }
    const startMs = new Date(startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - startMs) / 1000));
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [startTime, isRunning]);
  return elapsed;
}

/** Minutes since local midnight, re-read once a minute so the day bar's
 *  running segment and the gap search stay current without a 1Hz tick. */
function useNowMinutes(): number {
  const [now, setNow] = useState(() => minutesOfDay(new Date().toISOString()));
  useEffect(() => {
    const handle = setInterval(() => setNow(minutesOfDay(new Date().toISOString())), 30_000);
    return () => clearInterval(handle);
  }, []);
  return now;
}

/**
 * Elapsed time as words, quantised to whole minutes.
 *
 * Both halves matter for the live region (#99): "00:05:00" is read out as a
 * string of digits and colons, and anything finer than a minute would re-fire
 * the announcement every second — an announcement storm that makes the app
 * unusable rather than accessible.
 */
function spokenDuration(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m > 0 || h === 0) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  return parts.join(" ");
}

export interface TimerDraft {
  projectId: string;
  description: string;
}

interface Props {
  timer: TimerState;
  /** What the user has picked but not started yet. Held by the shell so
   *  walking to Projects and back doesn't lose the selection. */
  draft: TimerDraft;
  onDraftChange: (patch: Partial<TimerDraft>) => void;
  onStart: () => void;
  onStop: () => void;
  onRetryStop: (endIso: string) => void;
  onUpdate: (patch: { description?: string }) => void;
  /** Bumped by the shell when Start was pressed with no project chosen. */
  focusProjectNonce: number;
  targetHours: number;
  onSetTarget: (hours: number) => void;
  workingHours: WorkingHours;
  onContinue: (entry: TimeEntry) => void;
  timerBusy: boolean;
  onGoToProjects?: () => void;
  /** Keyboard hint text for the primary action, e.g. "⌘ .". */
  shortcutHint: string;
}

/**
 * The app's landing page: one clock, one action, and below the fold the day
 * and the week that clock belongs to.
 *
 * It absorbs what used to be a separate Overview page, so its range request is
 * this week rather than Overview's twelve — the rail reports one week, and
 * loading a quarter to draw seven bars was the largest read in the app.
 */
export const TimerPage: React.FC<Props> = ({
  timer, draft, onDraftChange, onStart, onStop, onRetryStop, onUpdate,
  focusProjectNonce, targetHours, onSetTarget, workingHours, onContinue,
  timerBusy, onGoToProjects, shortcutHint,
}) => {
  const { entries, projects, tasks, createEntry, loadTasksForProject, addTask } = useData();
  const entriesOnDate = useEntriesOnDate();
  const today = useToday();
  const nowMinutes = useNowMinutes();
  const running = useElapsed(timer.startTime, timer.isRunning);
  /**
   * A failed stop leaves `isRunning` false with the start time and the
   * attempted end both still held, so the clock freezes at the length the
   * entry actually had rather than resetting to zero — the hero is still
   * about that session, and the retry will save exactly this span.
   */
  const elapsed = timer.pendingStopAt && timer.startTime
    ? Math.max(0, Math.round((new Date(timer.pendingStopAt).getTime() - new Date(timer.startTime).getTime()) / 1000))
    : running;
  const [sheet, setSheet] = useState<EntryDraft | null>(null);
  const [needsProject, setNeedsProject] = useState(false);
  const projectRef = useRef<HTMLSelectElement>(null);

  const weekStart = weekStartStr(today);
  useRangeRequest("timer", weekStart, addDaysStr(weekStart, 6));

  // Start with no project picked focuses the picker and flashes the hint
  // rather than disabling the button. A greyed-out primary action reads as a
  // broken app; this reads as an instruction.
  useEffect(() => {
    if (focusProjectNonce === 0) return;
    projectRef.current?.focus();
    setNeedsProject(true);
    const handle = setTimeout(() => setNeedsProject(false), 4000);
    return () => clearTimeout(handle);
  }, [focusProjectNonce]);

  const projectById = useMemo(() => indexById(projects), [projects]);
  const taskById = useMemo(() => indexById(tasks), [tasks]);

  const todayEntries = useMemo(() => entries.filter((e) => e.date === today), [entries, today]);
  const completedToday = useMemo(
    () => todayEntries
      .filter((e) => e.id !== timer.draftEntryId && e.endTime)
      .sort((a, b) => b.startTime.localeCompare(a.startTime)),
    [todayEntries, timer.draftEntryId]
  );

  const trackedMinutes = useMemo(
    () => todayEntries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0),
    [todayEntries]
  );
  const gaps = useMemo(() => findUntrackedGaps({
    entries: todayEntries, date: today, nowMinutes, upperBoundMin: nowMinutes,
    workDayStartMin: workingHours.startMin,
    workDayEndMin: workingHours.endMin,
    gapMustExceedMinutes: workingHours.gapMustExceedMinutes,
  }), [todayEntries, today, nowMinutes, workingHours]);
  const untrackedMinutes = gaps.reduce((sum, g) => sum + (g.endMin - g.startMin), 0);

  // Monday-first minutes per weekday for the rail.
  const dailyMinutes = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i));
    return days.map((date) =>
      entries.filter((e) => e.date === date).reduce((sum, e) => sum + (e.durationMinutes || 0), 0)
    );
  }, [entries, weekStart]);
  const weekMinutes = dailyMinutes.reduce((a, b) => a + b, 0);
  const todayIndex = Math.max(0, Math.min(6, Math.round(
    (new Date(`${today}T00:00:00`).getTime() - new Date(`${weekStart}T00:00:00`).getTime()) / 86_400_000
  )));

  // The most recent thing worked on before today, offered where the timer is
  // rather than below the fold — restarting yesterday's work is the single
  // most common way a session begins.
  const resumeEntry = useMemo(() => {
    const past = entries
      .filter((e) => e.date < today && e.endTime)
      .sort((a, b) => b.startTime.localeCompare(a.startTime));
    return past[0] ?? null;
  }, [entries, today]);

  const activeProject = projectById.get(timer.isRunning ? (timer.projectId ?? "") : draft.projectId);
  const subtitleFor = (entry: TimeEntry): string => {
    const project = projectById.get(entry.projectId)?.name ?? "Unassigned";
    const task = entry.taskId ? taskById.get(entry.taskId)?.name : undefined;
    return task ? `${project} · ${task}` : project;
  };

  const openSheet = (startMin: number, endMin: number) =>
    setSheet(draftForSpan(today, startMin, endMin, draft.projectId || timer.projectId || ""));

  const dateLabel = new Date(`${today}T00:00:00`).toLocaleDateString(DATE_LOCALE, {
    weekday: "long", day: "numeric", month: "long",
  });

  const handleSheetSave = async (data: EntrySaveData) => createEntry(data);

  return (
    <>
      <div className="page__head">
        <h1 className="page__title t-large-title">Today</h1>
        <span className="t-subhead t-secondary">{dateLabel}</span>
      </div>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <div className="timer-hero">
        {timer.pendingStopAt ? (
          <div className="timer-hero__eyebrow timer-hero__eyebrow--error t-group-label">Not saved</div>
        ) : timer.isRunning ? (
          <div className="timer-hero__eyebrow t-group-label">
            <span className="timer-hero__pulse" />
            Running
          </div>
        ) : (
          <div className="timer-hero__eyebrow timer-hero__eyebrow--idle t-group-label">Not running</div>
        )}

        <div className="timer-hero__row">
          <div className="timer-hero__left">
            <div className={`timer-hero__clock t-timer${timer.isRunning || timer.pendingStopAt ? "" : " timer-hero__clock--idle"}`}>
              {formatElapsed(elapsed)}
            </div>

            {timer.pendingStopAt ? (
              /* A failed save takes over the hero instead of becoming a toast:
                 the clock is still the subject, and the one action changes. */
              <p className="timer-hero__explain t-body">
                Stopped at {clockAt(minutesOfDay(timer.pendingStopAt))}. Dataverse didn&rsquo;t answer —
                retrying keeps that end time, not the current one.
              </p>
            ) : timer.isRunning ? (
              <>
                {/* Styled as the Title 2 the mock shows, but still an input:
                    a session runs for hours, and the description is the one
                    field somebody notices they got wrong halfway through. */}
                <input
                  className="timer-hero__desc t-title2"
                  aria-label="What are you working on?"
                  placeholder="Untitled work"
                  value={timer.description}
                  onChange={(e) => onUpdate({ description: e.target.value })}
                />
                <div className="timer-hero__meta">
                  <span className="dot" style={{ "--pc": activeProject?.color || DEFAULT_PROJECT_COLOR } as React.CSSProperties} />
                  <span>{activeProject?.name ?? "No project"}</span>
                  <span aria-hidden="true">·</span>
                  <span>started {timer.startTime ? clockAt(minutesOfDay(timer.startTime)) : "—"}</span>
                </div>
              </>
            ) : (
              <div className="timer-hero__idle-row">
                <span className={`timer-hero__project${draft.projectId ? "" : " timer-hero__project--empty"}`}>
                  <span className="dot" style={{ "--pc": activeProject?.color || DEFAULT_PROJECT_COLOR } as React.CSSProperties} />
                  {activeProject?.name ?? "Pick a project"}
                  <span className="timer-hero__chev" aria-hidden="true">▾</span>
                  <select
                    ref={projectRef}
                    className="timer-hero__project-select"
                    aria-label="Project"
                    value={draft.projectId}
                    onChange={(e) => {
                      onDraftChange({ projectId: e.target.value });
                      setNeedsProject(false);
                      if (e.target.value) loadTasksForProject(e.target.value);
                    }}
                  >
                    <option value="">Pick a project</option>
                    {projects.filter((p) => p.isActive).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </span>
                <input
                  className="timer-hero__desc-input"
                  placeholder="What are you working on?"
                  aria-label="What are you working on?"
                  value={draft.description}
                  onChange={(e) => onDraftChange({ description: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="timer-hero__actions">
            <span className="timer-hero__shortcut" aria-hidden="true">{shortcutHint}</span>
            {timer.pendingStopAt ? (
              <Pill tone="primary" size="hero" onClick={() => onRetryStop(timer.pendingStopAt!)}>Retry save</Pill>
            ) : timer.isRunning ? (
              <Pill tone="primary" size="hero" onClick={onStop}>Stop</Pill>
            ) : (
              <Pill tone="primary" size="hero" onClick={onStart}>Start</Pill>
            )}
          </div>
        </div>

        {needsProject && <div className="timer-hero__hint" role="status">Pick a project first.</div>}

        {/* The only path by which a non-visual user learns the timer's state:
            the digits are a div, and the button's label is the verb. */}
        <div className="visually-hidden" role="status" aria-live="polite">
          {timer.isRunning ? `Timer running, ${spokenDuration(elapsed)} elapsed` : ""}
        </div>
      </div>

      <div className="page__rule timer-page__rule" />

      <div className="timer-page__cols">
        <div>
          {completedToday.length > 0 || timer.isRunning ? (
            <>
              <div className="timer-page__day-head">
                <span className="t-title2">{formatMinutes(trackedMinutes)} tracked</span>
                {gaps.length > 0 && (
                  <span className="t-subhead t-secondary">
                    {gaps.length} {gaps.length === 1 ? "gap" : "gaps"} · {formatMinutes(untrackedMinutes)} untracked
                  </span>
                )}
              </div>
              <DayBar
                entries={todayEntries}
                projects={projects}
                date={today}
                nowMinutes={nowMinutes}
                workingHours={workingHours}
                upperBoundMin={nowMinutes}
                runningEntryId={timer.draftEntryId}
                onFillGap={openSheet}
                onDragFill={openSheet}
              />
              <div className="timer-page__section-title t-title2">Entries</div>
              {completedToday.length > 0 ? (
                <ListCard>
                  {completedToday.map((entry) => (
                    <ListRow
                      key={entry.id}
                      color={projectById.get(entry.projectId)?.color}
                      title={entry.description || subtitleFor(entry)}
                      subtitle={entry.description ? subtitleFor(entry) : undefined}
                      value={formatMinutes(entry.durationMinutes ?? 0)}
                      meta={`${clockAt(minutesOfDay(entry.startTime))} – ${entry.endTime ? clockAt(minutesOfDay(entry.endTime)) : "…"}`}
                    />
                  ))}
                </ListCard>
              ) : (
                <p className="empty__body t-body">
                  Nothing finished yet today — the entry above is still running.
                </p>
              )}
            </>
          ) : (
            <>
              <DayBar
                entries={[]}
                projects={projects}
                date={today}
                nowMinutes={nowMinutes}
                workingHours={workingHours}
                upperBoundMin={nowMinutes}
                onDragFill={openSheet}
              />
              <div className="empty">
                <div className="empty__title t-title2">Nothing logged today</div>
                <p className="empty__body t-body">
                  {projects.length === 0
                    ? "Time is tracked against a project, and there aren't any yet. Make one for the work you do most — you can rename it later, and archiving keeps its history."
                    : "Pick a project and press Start — the bar above fills as you work. To record time you have already spent, drag across the bar."}
                </p>
                {projects.length === 0 ? (
                  <button type="button" className="empty__action" onClick={onGoToProjects}>Create a project</button>
                ) : (
                  <button
                    type="button"
                    className="empty__action"
                    onClick={() => openSheet(workingHours.startMin, Math.min(workingHours.endMin, workingHours.startMin + 60))}
                  >
                    Log past time
                  </button>
                )}
              </div>

              {resumeEntry && (
                <>
                  <div className="page__rule" style={{ margin: "32px 0 22px" }} />
                  <div className="t-group-label t-secondary" style={{ marginBottom: 10 }}>
                    {resumeEntry.date === addDaysStr(today, -1) ? "Yesterday you worked on" : "You last worked on"}
                  </div>
                  <ListCard>
                    <ListRow
                      color={projectById.get(resumeEntry.projectId)?.color}
                      title={resumeEntry.description || subtitleFor(resumeEntry)}
                      subtitle={resumeEntry.description ? subtitleFor(resumeEntry) : undefined}
                      action={
                        <Pill size="row" onClick={() => onContinue(resumeEntry)} disabled={timerBusy}>
                          Start
                        </Pill>
                      }
                    />
                  </ListCard>
                </>
              )}
            </>
          )}
        </div>

        <WeekRail
          dailyMinutes={dailyMinutes}
          weekMinutes={weekMinutes}
          targetHours={targetHours}
          todayIndex={todayIndex}
          onSetTarget={onSetTarget}
        />
      </div>

      {sheet && (
        <EntrySheet
          mode="create"
          initial={sheet}
          projects={projects}
          tasks={tasks}
          entriesOnDate={entriesOnDate}
          workingHours={workingHours}
          nowMinutes={nowMinutes}
          onSave={handleSheetSave}
          onClose={() => setSheet(null)}
          onLoadTasksForProject={loadTasksForProject}
          onAddTask={addTask}
        />
      )}
    </>
  );
};
