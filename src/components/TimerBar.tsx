import React, { useEffect, useRef, useState } from "react";
import type { Project, Task } from "../types";
import { formatElapsed, parseRatioInput } from "../hooks";
import { HelpTip } from "./HelpTip";
import { IconCheck, IconPlay, IconStop, IconX } from "./Icons";

const NEW_TASK_OPTION = "__new_task__";

// The hover `title` alone is invisible on touch and to keyboard-only/screen-
// reader users, so the shortcut also gets a persistent on-screen hint.
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/.test(navigator.platform);
const SHORTCUT_HINT = IS_MAC ? "⌘." : "Ctrl+.";

interface Props {
  projects: Project[];
  tasks: Task[];
  isRunning: boolean;
  /** ISO timestamp when stop failed — enables retry flow (#32). */
  pendingStopAt?: string;
  elapsed: number;
  currentProjectId: string | null;
  currentTaskId: string | null;
  description: string;
  ratio?: number;
  onStart: (projectId: string, taskId: string | null, description: string, ratio?: number) => void;
  onStop: () => void;
  onRetryStop?: (endIso: string) => void;
  onUpdate: (patch: { description?: string; taskId?: string | null; ratio?: number }) => void;
  onAddTask: (data: Omit<Task, "id">) => Promise<Task>;
  onLoadTasksForProject: (projectId: string) => void;
}


export const TimerBar: React.FC<Props> = ({
  projects, tasks, isRunning, pendingStopAt, elapsed,
  currentProjectId, currentTaskId, description, ratio,
  onStart, onStop, onRetryStop, onUpdate, onAddTask, onLoadTasksForProject,
}) => {
  const [selectedProject, setSelectedProject] = useState(currentProjectId || "");
  const [selectedTask, setSelectedTask] = useState(currentTaskId || "");
  const [desc, setDesc] = useState(description);
  const [ratioInput, setRatioInput] = useState(ratio !== undefined ? String(ratio) : "");
  const [newTaskName, setNewTaskName] = useState("");
  const [addingNewTask, setAddingNewTask] = useState(false);
  const [savingTask, setSavingTask] = useState(false);

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
  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      setDesc("");
      setRatioInput("");
      setSelectedTask("");
    }
    wasRunning.current = isRunning;
  }, [isRunning]);

  const parseRatio = parseRatioInput;

  const handleStart = () => {
    if (!selectedProject) return;
    onStart(selectedProject, selectedTask || null, desc, parseRatio(ratioInput));
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
      if (selectedProject) {
        handleStart();
      } else {
        const sel = document.querySelector<HTMLSelectElement>(".timer-bar__select");
        sel?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isRunning, pendingStopAt, selectedProject, selectedTask, desc, ratioInput, onStart, onStop, onRetryStop]);

  return (
    <div className="timer-bar">
      <div className="timer-bar__inner">
        {/* Description input */}
        <input
          className="timer-bar__desc"
          placeholder="What are you working on?"
          value={isRunning ? description : desc}
          onChange={(e) => {
            if (isRunning) onUpdate({ description: e.target.value });
            else setDesc(e.target.value);
          }}
        />

        {/* Ratio input */}
        <div className="timer-bar__ratio-group">
          <input
            className="timer-bar__ratio"
            type="number"
            step="1"
            min="0"
            placeholder="Ratio"
            aria-label="Billing ratio — identifies which account this entry's time is billed to"
            value={isRunning ? (ratio !== undefined ? String(ratio) : "") : ratioInput}
            onChange={(e) => {
              if (isRunning) onUpdate({ ratio: parseRatio(e.target.value) });
              else setRatioInput(e.target.value);
            }}
          />
          <HelpTip label="What is Ratio?" text="Billing ratio — tells billing which account/rate this entry's time is billed to. Leave blank if not applicable." />
        </div>

        {/* Project selector */}
        <div className="timer-bar__selectors">
          {!isRunning ? (
            <>
              <select
                className="timer-bar__select"
                value={selectedProject}
                onChange={(e) => {
                  const pid = e.target.value;
                  setSelectedProject(pid);
                  setSelectedTask("");
                  setAddingNewTask(false);
                  setNewTaskName("");
                  if (pid) onLoadTasksForProject(pid);
                }}
              >
                <option value="">Select project…</option>
                {/* Archived projects resolve names elsewhere but can't take new time. */}
                {projects.filter((p) => p.isActive).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {selectedProject && !addingNewTask && (
                <select
                  className="timer-bar__select"
                  value={selectedTask}
                  onChange={(e) => {
                    if (e.target.value === NEW_TASK_OPTION) {
                      setAddingNewTask(true);
                      setNewTaskName("");
                    } else {
                      setSelectedTask(e.target.value);
                    }
                  }}
                >
                  <option value="">No task</option>
                  {projectTasks.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                  <option value={NEW_TASK_OPTION}>+ New task…</option>
                </select>
              )}
              {selectedProject && addingNewTask && (
                <div className="timer-bar__new-task">
                  <input
                    className="timer-bar__new-task-input"
                    placeholder="New task name"
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
                style={{ background: activeProject?.color || "#6366f1" }}
              />
              {activeProject?.name}
            </div>
          )}
        </div>

        {/* Elapsed + button */}
        <div className="timer-bar__controls">
          {isRunning && (
            <span className="timer-bar__elapsed">{formatElapsed(elapsed)}</span>
          )}
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
              disabled={!isRunning && !selectedProject}
              title={isRunning ? "Stop timer (Ctrl/Cmd + .)" : "Start timer (Ctrl/Cmd + .)"}
              aria-label={isRunning ? "Stop timer" : "Start timer"}
            >
              {isRunning ? <><IconStop /> Stop</> : <><IconPlay /> Start</>}
              <kbd className="timer-bar__shortcut-hint" aria-hidden="true">{SHORTCUT_HINT}</kbd>
            </button>
          )}
        </div>
      </div>

      {isRunning && (
        <div className="timer-bar__pulse-bar">
          <div className="timer-bar__pulse-inner" />
        </div>
      )}
    </div>
  );
};
