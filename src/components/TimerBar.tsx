import React, { useEffect, useRef, useState } from "react";
import type { Project, Task } from "../types";
import type { FocusPhase, FocusSettings } from "../hooks/useFocusMode";
import { formatElapsed, parseRatioInput } from "../hooks";
import { HelpTip } from "./HelpTip";
import { Combobox } from "./Combobox";
import { IconCheck, IconPencil, IconPlay, IconStop, IconX } from "./Icons";
import { DEFAULT_PROJECT_COLOR } from "../utils/colors";

const NEW_TASK_OPTION = "__new_task__";

// The hover `title` alone is invisible on touch and to keyboard-only/screen-
// reader users, so the shortcut also gets a persistent on-screen hint.
//
// `navigator.platform` is deprecated and reports "" in some hardened/privacy
// configurations, which silently offered a Mac user "Ctrl+." — a shortcut that
// isn't the one they have. userAgentData carries the same answer and is the
// supported route; platform stays as the fallback for browsers without it.
function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent;
  return /Mac|iPhone|iPod|iPad/.test(platform);
}
const IS_MAC = detectMac();
const SHORTCUT_HINT = IS_MAC ? "⌘." : "Ctrl+.";
const SHORTCUT_SPOKEN = IS_MAC ? "Command period" : "Control period";

/**
 * Seconds remaining until `endsAt`, re-rendering only this subtree once a
 * second. `endsAt` is an instant rather than a countdown so the tick can live
 * here: a counter held higher up re-rendered every page in the app once a
 * second for the whole length of a session (#95).
 */
function useCountdown(endsAt: number | null): number {
  const [remaining, setRemaining] = useState(() =>
    endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
  );
  useEffect(() => {
    if (endsAt === null) {
      setRemaining(0);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [endsAt]);
  return remaining;
}

/** Seconds since `startTime`, ticked here for the same reason. */
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

export interface FocusControlState {
  enabled: boolean;
  phase: FocusPhase;
  endsAt: number | null;
  settings: FocusSettings;
  sessionsToday: number;
  onToggle: () => void;
  onUpdateSettings: (patch: Partial<FocusSettings>) => void;
}

interface Props {
  projects: Project[];
  tasks: Task[];
  isRunning: boolean;
  /** ISO timestamp when stop failed — enables retry flow (#32). */
  pendingStopAt?: string;
  /** ISO instant the running session began; the elapsed clock derives from it. */
  startTime: string | null;
  currentProjectId: string | null;
  currentTaskId: string | null;
  description: string;
  ratio?: number;
  jiraTicket?: string;
  focus?: FocusControlState;
  onStart: (
    projectId: string,
    taskId: string | null,
    description: string,
    ratio?: number,
    jiraTicket?: string,
  ) => void;
  onStop: () => void;
  onRetryStop?: (endIso: string) => void;
  onUpdate: (patch: { description?: string; taskId?: string | null; ratio?: number; jiraTicket?: string }) => void;
  onAddTask: (data: Omit<Task, "id">) => Promise<Task>;
  onLoadTasksForProject: (projectId: string) => void;
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

function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Focus (Pomodoro) chip: toggles the mode, counts down the current focus
 *  block or break, and hides an interval editor behind a pencil. */
const FocusControl: React.FC<{ focus: FocusControlState }> = ({ focus }) => {
  const { enabled, phase, endsAt, settings, sessionsToday, onToggle, onUpdateSettings } = focus;
  const remainingSeconds = useCountdown(endsAt);
  const [editing, setEditing] = useState(false);
  const [focusInput, setFocusInput] = useState("");
  const [breakInput, setBreakInput] = useState("");
  const chipRef = useRef<HTMLButtonElement>(null);

  const commit = () => {
    onUpdateSettings({
      focusMinutes: Number(focusInput) || settings.focusMinutes,
      breakMinutes: Number(breakInput) || settings.breakMinutes,
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="focus-editor">
        <input
          className="focus-editor__input"
          type="number" min="1" max="180"
          value={focusInput}
          onChange={(e) => setFocusInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label="Focus minutes"
          autoFocus
        />
        <span className="focus-editor__sep">/</span>
        <input
          className="focus-editor__input"
          type="number" min="1" max="180"
          value={breakInput}
          onChange={(e) => setBreakInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label="Break minutes"
        />
        <button className="focus-editor__ok" onClick={commit} title="Save focus intervals" aria-label="Save focus intervals"><IconCheck size={13} /></button>
        <button className="focus-editor__cancel" onClick={() => setEditing(false)} title="Cancel" aria-label="Cancel"><IconX size={13} /></button>
      </span>
    );
  }

  const label = !enabled ? "Focus off"
    : phase === "focus" ? `Focus ${mmss(remainingSeconds)}`
    : phase === "break" ? `Break ${mmss(remainingSeconds)}`
    : "Focus on";
  // What focus mode is, and the caveat that its prompts stop with the tab, used
  // to be a `title` on the chip and nowhere else — invisible to a keyboard or
  // screen-reader user, who has no way to hover it (#106). The chip's own
  // accessible name carries what it does when clicked; the explanation moves to
  // the tip beside it, which the chip also reveals on hover (#84) — "Focus off"
  // says nothing about what turning it on would do, and hover is where people
  // look before they find a "?".
  //
  // It explains the cadence *and* how to drive it: the mode is inert until the
  // timer runs, which is the part nobody guesses from the chip alone.
  const summary =
    `Paces tracked work: ${settings.focusMinutes} minutes of focus, then a ${settings.breakMinutes} minute break, ` +
    `prompted as each one ends. Turn it on here, then start the timer — a block measures tracked time, so it ` +
    `only counts while the timer runs. Taking a break stops and saves the entry, so break time is never logged ` +
    `as work. The pencil changes both intervals. ` +
    `${sessionsToday} focus ${sessionsToday === 1 ? "block" : "blocks"} completed today. ` +
    `Prompts only fire while this tab is open.`;

  return (
    <span className="focus-control">
      <button
        ref={chipRef}
        className={`focus-chip ${enabled ? "focus-chip--on" : ""} ${phase === "break" ? "focus-chip--break" : ""}`}
        onClick={onToggle}
        aria-label={`${label} — click to turn focus mode ${enabled ? "off" : "on"}`}
      >
        {label}
      </button>
      <HelpTip label="What is focus mode?" text={summary} hoverAnchorRef={chipRef} />
      {enabled && (
        <button
          className="focus-chip__edit"
          onClick={() => {
            setFocusInput(String(settings.focusMinutes));
            setBreakInput(String(settings.breakMinutes));
            setEditing(true);
          }}
          title={`Edit intervals (${settings.focusMinutes}m / ${settings.breakMinutes}m)`}
          aria-label="Edit focus intervals"
        >
          <IconPencil size={11} />
        </button>
      )}
    </span>
  );
};


export const TimerBar: React.FC<Props> = ({
  projects, tasks, isRunning, pendingStopAt, startTime,
  currentProjectId, currentTaskId, description, ratio, jiraTicket, focus,
  onStart, onStop, onRetryStop, onUpdate, onAddTask, onLoadTasksForProject,
}) => {
  const elapsed = useElapsed(startTime, isRunning);
  const [selectedProject, setSelectedProject] = useState(currentProjectId || "");
  const [selectedTask, setSelectedTask] = useState(currentTaskId || "");
  const [desc, setDesc] = useState(description);
  const [ratioInput, setRatioInput] = useState(ratio !== undefined ? String(ratio) : "");
  const [ticketInput, setTicketInput] = useState(jiraTicket ?? "");
  const [newTaskName, setNewTaskName] = useState("");
  const [addingNewTask, setAddingNewTask] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  // Ratio and Ticket are optional on the large majority of entries; folding
  // them behind a disclosure keeps the required Project field from being the
  // narrowest thing in the bar.
  const [extrasOpen, setExtrasOpen] = useState(false);
  // Set when Start is pressed with no project chosen. Inline and transient
  // rather than a toast: the thing to fix is two inches away, so the message
  // belongs next to it.
  const [needsProject, setNeedsProject] = useState(false);
  const projectFieldRef = useRef<HTMLDivElement>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (hintTimerRef.current !== null) clearTimeout(hintTimerRef.current);
  }, []);

  // Inactive tasks stay in `tasks` for display-name resolution elsewhere,
  // but new work can't be tagged with them.
  const projectTasks = tasks.filter((t) => t.isActive && t.projectId === (isRunning ? currentProjectId : selectedProject));
  const activeProject = projects.find((p) => p.id === (isRunning ? currentProjectId : selectedProject));

  // Selections can go stale while the bar sits idle: the chosen project can
  // be archived (or the task deleted) from the Projects page, and Start would
  // then tag new time against an inactive record. Reset them when that
  // happens — the archived record stays in props for display-name resolution.
  useEffect(() => {
    if (isRunning) return;
    if (selectedProject && !projects.some((p) => p.id === selectedProject && p.isActive)) {
      setSelectedProject("");
      setSelectedTask("");
    } else if (selectedTask && !tasks.some((t) => t.id === selectedTask && t.isActive)) {
      setSelectedTask("");
    }
  }, [isRunning, projects, tasks, selectedProject, selectedTask]);

  // When a session ends, clear the per-session fields so the bar doesn't
  // resurrect stale pre-start text. The project stays selected — starting
  // another session on the same project is the common case.
  const wasRunning = useRef(isRunning);
  const [hasStopped, setHasStopped] = useState(false);
  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      setDesc("");
      setRatioInput("");
      setTicketInput("");
      setSelectedTask("");
      setExtrasOpen(false);
      setHasStopped(true);
    }
    wasRunning.current = isRunning;
  }, [isRunning]);

  const parseRatio = parseRatioInput;

  // Start is the app's primary action and stays live even with nothing
  // selected — a greyed-out primary button reads as a broken app, and the
  // keyboard path (Ctrl+.) already treated "no project" as "go pick one"
  // rather than as a dead end. Clicking does the same thing.
  const handleStart = () => {
    if (!selectedProject) {
      projectFieldRef.current?.querySelector("input")?.focus();
      setNeedsProject(true);
      if (hintTimerRef.current !== null) clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => setNeedsProject(false), 4000);
      return;
    }
    setNeedsProject(false);
    onStart(selectedProject, selectedTask || null, desc, parseRatio(ratioInput), ticketInput.trim() || undefined);
  };

  const handleCreateTask = async () => {
    const name = newTaskName.trim();
    const projectId = isRunning ? currentProjectId : selectedProject;
    if (!name || !projectId) return;
    setSavingTask(true);
    try {
      const task = await onAddTask({ projectId, name, isActive: true });
      if (isRunning) {
        onUpdate({ taskId: task.id });
      } else {
        setSelectedTask(task.id);
      }
      setAddingNewTask(false);
      setNewTaskName("");
    } catch {
      // The data hooks already toast the failure; keep the form open for retry.
    } finally {
      setSavingTask(false);
    }
  };

  // Ctrl/Cmd + . toggles the timer. Start uses whatever's selected in the bar;
  // if no project is picked, focus the project selector instead of failing silently.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Shift isn't checked: on some international layouts "." is only
      // reachable via Shift, so rejecting it there made the shortcut dead.
      if (e.key !== "." || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      e.preventDefault();
      // A failed stop retries with the original stop timestamp, exactly like
      // the Retry button — not with "now", which would silently grow the entry.
      if (pendingStopAt) {
        onRetryStop?.(pendingStopAt);
        return;
      }
      if (isRunning) {
        onStop();
        return;
      }
      // Start with no project picked focuses the selector and flashes the
      // hint — handleStart owns that branch now, so both paths agree.
      handleStart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // handleStart is re-created every render; every input it reads is listed
  // here instead, so the shortcut always starts with the current form values
  // without re-binding the listener on each keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, pendingStopAt, selectedProject, selectedTask, desc, ratioInput, ticketInput, onStart, onStop, onRetryStop]);

  // Collapsed, the disclosure still has to show what's set — otherwise a
  // ratio typed before Start would vanish behind a "+" the moment it closed.
  const shownRatio = isRunning ? (ratio !== undefined ? String(ratio) : "") : ratioInput;
  const shownTicket = isRunning ? (jiraTicket ?? "") : ticketInput;
  const extrasSummary = [
    shownRatio.trim() ? `Ratio ${shownRatio.trim()}` : null,
    shownTicket.trim() || null,
  ].filter(Boolean).join(" · ") || null;

  // Reading order follows what the action actually requires: the one field
  // that gates Start comes first and widest, and the optional ones fold away
  // behind a disclosure. Before this, the required Project select was the
  // narrowest control on the bar and the last one you reached.
  return (
    <div className={`timer-bar ${isRunning ? "timer-bar--running" : ""}`}>
      <div className="timer-bar__inner">
        {/* Project + task */}
        <div className="timer-bar__selectors">
          {!isRunning ? (
            <>
              <div ref={projectFieldRef} className="timer-bar__project-field">
                <Combobox
                  className="combobox--project"
                  ariaLabel="Project"
                  placeholder="Select project…"
                  value={selectedProject}
                  // Archived projects resolve names elsewhere but can't take new time.
                  options={projects.filter((p) => p.isActive).map((p) => ({
                    value: p.id, label: p.name, color: p.color,
                  }))}
                  onChange={(pid) => {
                    setSelectedProject(pid);
                    setSelectedTask("");
                    setAddingNewTask(false);
                    setNewTaskName("");
                    setNeedsProject(false);
                    if (pid) onLoadTasksForProject(pid);
                  }}
                />
              </div>
              {selectedProject && !addingNewTask && (
                <Combobox
                  className="combobox--task"
                  ariaLabel="Task"
                  placeholder="No task"
                  value={selectedTask}
                  options={[
                    ...projectTasks.map((t) => ({ value: t.id, label: t.name })),
                    { value: NEW_TASK_OPTION, label: "+ New task…", isAction: true },
                  ]}
                  onChange={(v) => {
                    if (v === NEW_TASK_OPTION) {
                      setAddingNewTask(true);
                      setNewTaskName("");
                    } else {
                      setSelectedTask(v);
                    }
                  }}
                />
              )}
              {selectedProject && addingNewTask && (
                <div className="timer-bar__new-task">
                  <input
                    className="timer-bar__new-task-input"
                    placeholder="New task name"
                    aria-label="New task name"
                    value={newTaskName}
                    onChange={(e) => setNewTaskName(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter") await handleCreateTask();
                      if (e.key === "Escape") { setAddingNewTask(false); setNewTaskName(""); }
                    }}
                    autoFocus
                  />
                  <button
                    className="timer-bar__new-task-ok"
                    onClick={handleCreateTask}
                    disabled={!newTaskName.trim() || savingTask}
                    title="Create task"
                    aria-label="Create task"
                  >
                    <IconCheck />
                  </button>
                  <button
                    className="timer-bar__new-task-cancel"
                    onClick={() => { setAddingNewTask(false); setNewTaskName(""); }}
                    title="Cancel"
                    aria-label="Cancel"
                  >
                    <IconX />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="timer-bar__active-project">
              <span
                className="timer-bar__dot"
                style={{ background: activeProject?.color || DEFAULT_PROJECT_COLOR }}
              />
              {activeProject?.name}
            </div>
          )}
        </div>

        {/* Description — takes the slack, since it's free text with no natural width */}
        <input
          className="timer-bar__desc"
          placeholder="What are you working on?"
          aria-label="What are you working on?"
          value={isRunning ? description : desc}
          onChange={(e) => {
            if (isRunning) onUpdate({ description: e.target.value });
            else setDesc(e.target.value);
          }}
        />

        {/* Ratio + ticket, folded away until asked for */}
        <button
          type="button"
          className={`timer-bar__extras-toggle ${extrasSummary ? "timer-bar__extras-toggle--set" : ""}`}
          onClick={() => setExtrasOpen((v) => !v)}
          aria-expanded={extrasOpen}
          aria-controls="timer-bar-extras"
          title="Billing ratio and ticket reference (optional)"
        >
          {extrasSummary ?? "+ Ratio · Ticket"}
        </button>

        <div className="timer-bar__controls">
          {focus && <FocusControl focus={focus} />}
          {pendingStopAt ? (
            <button
              className="timer-bar__btn btn-icon timer-bar__btn--stop"
              onClick={() => onRetryStop?.(pendingStopAt)}
              title="Retry saving entry"
              aria-label="Retry saving entry"
            >
              <IconStop /> Retry
            </button>
          ) : (
            <button
              className={`timer-bar__btn btn-icon ${isRunning ? "timer-bar__btn--stop" : "timer-bar__btn--start"}`}
              onClick={isRunning ? onStop : handleStart}
              title={isRunning ? "Stop timer (Ctrl/Cmd + .)" : "Start timer (Ctrl/Cmd + .)"}
              // The shortcut is folded into the accessible name rather than
              // left in the aria-hidden <kbd>, which no screen reader ever
              // reached. The elapsed time deliberately isn't here — an
              // aria-label replaces the element's content, so naming the
              // button after the clock would re-announce on every tick;
              // the live region below carries it instead (#99).
              aria-label={
                (isRunning ? "Stop timer" : "Start timer") + `, keyboard shortcut ${SHORTCUT_SPOKEN}`
              }
            >
              {isRunning ? <><IconStop /> Stop</> : <><IconPlay /> Start</>}
              {/* Elapsed time belongs to the running button, not beside it —
                  as a separate span it competed with the Focus chip for the
                  same corner of the bar. */}
              {isRunning && <span className="timer-bar__elapsed">{formatElapsed(elapsed)}</span>}
              <kbd className="timer-bar__shortcut-hint" aria-hidden="true">{SHORTCUT_HINT}</kbd>
            </button>
          )}
        </div>
      </div>

      {extrasOpen && (
        <div className="timer-bar__extras" id="timer-bar-extras">
          <label className="timer-bar__extras-label" htmlFor="timer-ratio">Ratio</label>
          <input
            id="timer-ratio"
            className="timer-bar__ratio"
            type="number"
            step="1"
            min="0"
            placeholder="e.g. 1"
            aria-label="Billing ratio — identifies which account this entry's time is billed to"
            value={isRunning ? (ratio !== undefined ? String(ratio) : "") : ratioInput}
            onChange={(e) => {
              if (isRunning) onUpdate({ ratio: parseRatio(e.target.value) });
              else setRatioInput(e.target.value);
            }}
          />
          <HelpTip label="What is Ratio?" text="Billing ratio — the account/rate code this entry's time is billed to. It's a label, not a multiplier: reports never multiply your hours by it. Leave blank if not applicable." />
          <label className="timer-bar__extras-label" htmlFor="timer-ticket">Ticket</label>
          <input
            id="timer-ticket"
            className="timer-bar__ticket"
            placeholder="e.g. PROJ-123"
            aria-label="Ticket reference for this entry"
            value={isRunning ? (jiraTicket ?? "") : ticketInput}
            onChange={(e) => {
              if (isRunning) onUpdate({ jiraTicket: e.target.value });
              else setTicketInput(e.target.value);
            }}
          />
        </div>
      )}

      {/* role="status" so the same nudge reaches a screen reader, which never
          sees the focus ring the sighted path relies on. */}
      {needsProject && (
        <div className="timer-bar__hint" role="status">Pick a project first</div>
      )}

      {/* The only path by which a non-visual user learns the timer's state.
          The digits themselves live inside the Stop button, whose aria-label
          replaces its content, and the sidebar's "Timer running" is static
          text — so before this there was no elapsed time and no start/stop
          announcement at all (#99, WCAG 4.1.3).

          Rendered unconditionally so the region is in the accessibility tree
          before any text lands in it, for the same reason the toast regions
          are (see ToastContext). It stays empty until the first stop, so a
          reload doesn't open with "Timer stopped". */}
      <div className="visually-hidden" role="status" aria-live="polite">
        {isRunning
          ? `Timer running, ${spokenDuration(elapsed)} elapsed`
          : hasStopped ? "Timer stopped" : ""}
      </div>

      {isRunning && (
        <div className="timer-bar__pulse-bar">
          <div className="timer-bar__pulse-inner" />
        </div>
      )}
    </div>
  );
};
