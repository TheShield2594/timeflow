import React, { useState } from "react";
import type { Project, Task } from "../types";
import { formatMinutes, parseRatioInput } from "../hooks";
import { IconCheck, IconPlus, IconX } from "./Icons";

function isValidHex(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

interface Props {
  projects: Project[];
  tasks: Task[];
  totalMinutesByProject: Map<string, number>;
  onAddProject: (data: Omit<Project, "id" | "createdAt">) => Promise<Project>;
  onEditProject: (id: string, data: Partial<Project>) => Promise<Project>;
  onAddTask: (data: Omit<Task, "id">) => Promise<Task>;
}

const PALETTE = [
  "#719500", // green (primary)
  "#358450", // grass
  "#225433", // forest
  "#B5BF00", // lime
  "#0080BD", // blue
  "#4DC5E2", // robin
  "#00739f", // royal
  "#003346", // navy
  "#CC4F00", // pumpkin
  "#F3AE00", // lemon
];

interface FormDraft {
  editingId: string | null;
  name: string;
  description: string;
  color: string;
  hexInput: string;
  ratio: string;
  jiraTicket: string;
}

const EMPTY_DRAFT: FormDraft = {
  editingId: null,
  name: "",
  description: "",
  color: PALETTE[0],
  hexInput: PALETTE[0],
  ratio: "",
  jiraTicket: "",
};

export const ProjectsPage: React.FC<Props> = ({
  projects, tasks, totalMinutesByProject, onAddProject, onEditProject, onAddTask,
}) => {
  const [draft, setDraft] = useState<FormDraft | null>(null);
  const [addingTaskFor, setAddingTaskFor] = useState<string | null>(null);
  const [newTaskName, setNewTaskName] = useState("");

  const startNew = () => setDraft({ ...EMPTY_DRAFT });
  const startEdit = (p: Project) => setDraft({
    editingId: p.id,
    name: p.name,
    description: p.description ?? "",
    color: p.color,
    hexInput: p.color,
    ratio: p.ratio !== undefined ? String(p.ratio) : "",
    jiraTicket: p.jiraTicket ?? "",
  });

  const handleSave = async () => {
    if (!draft || !draft.name.trim()) return;
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      color: draft.color,
      ratio: parseRatioInput(draft.ratio),
      jiraTicket: draft.jiraTicket.trim() || undefined,
      isActive: true,
    };
    if (draft.editingId) {
      await onEditProject(draft.editingId, payload);
    } else {
      await onAddProject(payload);
    }
    setDraft(null);
  };

  const handleAddTask = async (projectId: string) => {
    if (!newTaskName.trim()) return;
    await onAddTask({ projectId, name: newTaskName.trim(), isActive: true });
    setNewTaskName(""); setAddingTaskFor(null);
  };

  return (
    <div className="projects-page">
      <div className="projects-page__header">
        <h2 className="projects-page__title">Projects</h2>
        <button className="btn-primary btn-icon" onClick={startNew}>
          <IconPlus /> New Project
        </button>
      </div>

      {draft && (
        <div className="new-project-form">
          <h3 className="new-project-form__title">
            {draft.editingId ? "Edit Project" : "New Project"}
          </h3>
          <input
            className="form-input"
            placeholder="Project name"
            value={draft.name}
            onChange={(e) => setDraft((d) => d && ({ ...d, name: e.target.value }))}
            autoFocus
          />
          <input
            className="form-input"
            placeholder="Description (optional)"
            value={draft.description}
            onChange={(e) => setDraft((d) => d && ({ ...d, description: e.target.value }))}
          />
          <input
            className="form-input"
            type="number"
            step="1"
            min="0"
            placeholder="Ratio (optional, e.g. 2)"
            value={draft.ratio}
            onChange={(e) => setDraft((d) => d && ({ ...d, ratio: e.target.value }))}
          />
          <input
            className="form-input"
            placeholder="Jira ticket (optional, e.g. PROJ-123)"
            value={draft.jiraTicket}
            onChange={(e) => setDraft((d) => d && ({ ...d, jiraTicket: e.target.value }))}
          />
          <div className="color-picker">
            <span className="color-picker__label">Color</span>
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`color-picker__swatch ${draft.color === c ? "color-picker__swatch--active" : ""}`}
                style={{ background: c }}
                onClick={() => setDraft((d) => d && ({ ...d, color: c, hexInput: c }))}
                aria-label={`Color ${c}`}
              />
            ))}
            <div className="color-picker__hex-row">
              <div
                className="color-picker__hex-preview"
                style={{ background: isValidHex(draft.hexInput) ? draft.hexInput : draft.color }}
                aria-hidden="true"
              />
              <input
                className={`color-picker__hex-input${!isValidHex(draft.hexInput) ? " color-picker__hex-input--invalid" : ""}`}
                placeholder="#______"
                maxLength={7}
                value={draft.hexInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  const normalised = raw.startsWith("#") ? raw : `#${raw}`;
                  setDraft((d) => {
                    if (!d) return d;
                    const next = { ...d, hexInput: normalised };
                    if (isValidHex(normalised)) next.color = normalised;
                    return next;
                  });
                }}
                aria-label="Custom hex color"
              />
            </div>
          </div>
          <div className="new-project-form__actions">
            <button className="btn-primary" onClick={handleSave}>
              {draft.editingId ? "Save Changes" : "Create"}
            </button>
            <button className="btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}

      {projects.length === 0 && !draft && (
        <div className="projects-page__empty">
          <IconPlus size={44} className="projects-page__empty-icon" />
          <p>Create your first project to start tracking time.</p>
          <button className="btn-primary btn-icon" onClick={startNew}>
            <IconPlus /> New Project
          </button>
        </div>
      )}

      <div className="project-cards">
        {projects.map((project) => {
          const projectTasks = tasks.filter((t) => t.projectId === project.id);
          const totalMins = totalMinutesByProject.get(project.id) || 0;

          return (
            <div key={project.id} className="project-card">
              <div className="project-card__stripe" style={{ background: project.color }} />
              <div className="project-card__body">
                <div className="project-card__top">
                  <div>
                    <div className="project-card__name">{project.name}</div>
                    {project.description && (
                      <div className="project-card__desc">{project.description}</div>
                    )}
                    {project.ratio !== undefined && (
                      <div className="project-card__ratio">Ratio: {project.ratio}</div>
                    )}
                    {project.jiraTicket && (
                      <div className="project-card__jira">Jira: {project.jiraTicket}</div>
                    )}
                  </div>
                  <div className="project-card__top-right">
                    <div className="project-card__total">{formatMinutes(totalMins)}</div>
                    <button
                      className="project-card__edit"
                      onClick={() => startEdit(project)}
                      title="Edit project"
                    >
                      Edit
                    </button>
                  </div>
                </div>

                <div className="project-card__tasks">
                  {projectTasks.map((t) => (
                    <span key={t.id} className="task-chip">{t.name}</span>
                  ))}
                  {addingTaskFor === project.id ? (
                    <div className="inline-task-form">
                      <input
                        className="inline-task-form__input"
                        placeholder="Task name"
                        value={newTaskName}
                        onChange={(e) => setNewTaskName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddTask(project.id)}
                        autoFocus
                      />
                      <button className="inline-task-form__ok" onClick={() => handleAddTask(project.id)} aria-label="Add task"><IconCheck size={14} /></button>
                      <button className="inline-task-form__cancel" onClick={() => setAddingTaskFor(null)} aria-label="Cancel"><IconX size={14} /></button>
                    </div>
                  ) : (
                    <button className="task-chip task-chip--add" onClick={() => { setAddingTaskFor(project.id); setNewTaskName(""); }}>
                      <IconPlus size={11} /> Task
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
