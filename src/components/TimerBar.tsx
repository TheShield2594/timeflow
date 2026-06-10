import React, { useEffect, useRef, useState } from "react";
import type { Project, Task } from "../types";
import { formatElapsed, parseRatioInput } from "../hooks";
import { IconCheck, IconPlay, IconStop, IconX } from "./Icons";

const NEW_TASK_OPTION = "__new_task__";

interface Props {
  projects: Project[];
  tasks: Task[];
  isRunning: boolean;
  elapsed: number;
  currentProjectId: string | null;
  currentTaskId: string | null;
  description: string;
  ratio?: number;
  onStart: (projectId: string, taskId: string | null, description: string, ratio?: number) => void;
  onStop: () => void;
  onUpdate: (patch: { description?: string; taskId?: string | null; ratio?: number }) => void;
  onAddTask: (data: Omit<Task, "id">) => Promise<Task>;
}


export const TimerBar: React.FC<Props> = ({
  projects, tasks, isRunning, elapsed,
  currentProjectId, currentTaskId, description, ratio,
  onStart, onStop, onUpdate, onAddTask,
}) => {
  const [selectedProject, setSelectedProject] = useState(currentProjectId || "");
  const [selectedTask, setSelectedTask] = useState(currentTaskId || "");
  const [desc, setDesc] = useState(description);
  const [ratioInput, setRatioInput] = useState(ratio !== undefined ? String(ratio) : "");
  const [newTaskName, setNewTaskName] = useState("");
  const [addingNewTask, setAddingNewTask] = useState(false);
  const [savingTask, setSavingTask] = useState(false);

  const projectTasks = tasks.filter((t) => t.projectId === (isRunning ? currentProjectId : selectedProject));
  const activeProject = projects.find((p) => p.id === (isRunning ? currentProjectId : selectedProject));

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
    } finally {
      setSavingTask(false);
    }
  };

  // Ctrl/Cmd + . toggles the timer. Start uses whatever's selected in the bar;
  // if no project is picked, focus the project selector instead of failing silently.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "." || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
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
  }, [isRunning, selectedProject, selectedTask, desc, ratioInput, onStart, onStop]);

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
          disabled={false}
        />

        {/* Ratio input */}
        <input
          className="timer-bar__ratio"
          type="number"
          step="1"
          min="0"
          placeholder="Ratio"
          value={isRunning ? (ratio !== undefined ? String(ratio) : "") : ratioInput}
          onChange={(e) => {
            if (isRunning) onUpdate({ ratio: parseRatio(e.target.value) });
            else setRatioInput(e.target.value);
          }}
        />

        {/* Project selector */}
        <div className="timer-bar__selectors">
          {!isRunning ? (
            <>
              <select
                className="timer-bar__select"
                value={selectedProject}
                onChange={(e) => {
                  setSelectedProject(e.target.value);
                  setSelectedTask("");
                  setAddingNewTask(false);
                  setNewTaskName("");
                }}
              >
                <option value="">Select project…</option>
                {projects.map((p) => (
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
          <button
            className={`timer-bar__btn btn-icon ${isRunning ? "timer-bar__btn--stop" : "timer-bar__btn--start"}`}
            onClick={isRunning ? onStop : handleStart}
            disabled={!isRunning && !selectedProject}
            title={isRunning ? "Stop timer (Ctrl/Cmd + .)" : "Start timer (Ctrl/Cmd + .)"}
          >
            {isRunning ? <><IconStop /> Stop</> : <><IconPlay /> Start</>}
          </button>
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
