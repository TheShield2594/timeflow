import React, { useState } from "react";
import type { Project, Task } from "../types";
import { formatElapsed } from "../hooks";

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
}


export const TimerBar: React.FC<Props> = ({
  projects, tasks, isRunning, elapsed,
  currentProjectId, currentTaskId, description, ratio,
  onStart, onStop, onUpdate,
}) => {
  const [selectedProject, setSelectedProject] = useState(currentProjectId || "");
  const [selectedTask, setSelectedTask] = useState(currentTaskId || "");
  const [desc, setDesc] = useState(description);
  const [ratioInput, setRatioInput] = useState(ratio !== undefined ? String(ratio) : "");

  const projectTasks = tasks.filter((t) => t.projectId === (isRunning ? currentProjectId : selectedProject));
  const activeProject = projects.find((p) => p.id === (isRunning ? currentProjectId : selectedProject));

  const parseRatio = (v: string): number | undefined => {
    if (v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const handleStart = () => {
    if (!selectedProject) return;
    onStart(selectedProject, selectedTask || null, desc, parseRatio(ratioInput));
  };

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
          step="any"
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
                onChange={(e) => { setSelectedProject(e.target.value); setSelectedTask(""); }}
              >
                <option value="">Select project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {selectedProject && (
                <select
                  className="timer-bar__select"
                  value={selectedTask}
                  onChange={(e) => setSelectedTask(e.target.value)}
                >
                  <option value="">No task</option>
                  {projectTasks.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
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
            className={`timer-bar__btn ${isRunning ? "timer-bar__btn--stop" : "timer-bar__btn--start"}`}
            onClick={isRunning ? onStop : handleStart}
            disabled={!isRunning && !selectedProject}
          >
            {isRunning ? "■ Stop" : "▶ Start"}
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
