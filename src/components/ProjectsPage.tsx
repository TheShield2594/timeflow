import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Project, Task, TimeEntry } from "../types";
import { formatMinutes, parseRatioInput } from "../hooks";
import { useToday } from "../hooks/useToday";
import { addDaysStr } from "../utils/dates";
import { isDirtyDraft } from "../utils/forms";
import { HelpTip } from "./HelpTip";
import { Sparkline } from "./Sparkline";
import { IconArchive, IconCheck, IconPencil, IconPlus, IconUndo, IconX } from "./Icons";

function isValidHex(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

/** Window the card totals are scoped to. The loaded entry range is a moving
 *  window (see DataRangeContext), so an unlabelled "total" silently meant
 *  "however much history happens to be loaded" — this fixes it to a span the
 *  label can actually name. */
const TOTAL_WINDOW_DAYS = 30;
const SPARK_DAYS = 7;

interface ProjectActivity {
  windowMinutes: number;
  lastTracked: string | null;
  spark: number[];
}

const NO_ACTIVITY: ProjectActivity = { windowMinutes: 0, lastTracked: null, spark: Array(SPARK_DAYS).fill(0) };

/** "today" / "yesterday" / "3d ago" / "5w ago" — a card footer has room for a
 *  relative age, not a date. */
function relativeDay(dateStr: string, today: string): string {
  // A future-dated entry (they're allowed) still reads as current work.
  if (dateStr >= today) return "today";
  if (dateStr === addDaysStr(today, -1)) return "yesterday";
  const days = Math.round(
    (new Date(today + "T00:00:00").getTime() - new Date(dateStr + "T00:00:00").getTime()) / 86400000
  );
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

interface Props {
  projects: Project[];
  tasks: Task[];
  entries: TimeEntry[];
  onAddProject: (data: Omit<Project, "id" | "createdAt">) => Promise<Project>;
  onEditProject: (id: string, data: Partial<Project>) => Promise<Project>;
  onArchiveProject: (project: Project) => void;
  onRestoreProject: (project: Project) => Promise<void>;
  onAddTask: (data: Omit<Task, "id">) => Promise<Task>;
  onDeleteTask: (task: Task) => void;
  onRenameTask: (task: Task, newName: string) => Promise<void>;
  onLoadTasksForProject: (projectId: string) => void;
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

/** Edit/Archive live behind one ⋯ menu — as two differently-styled
 *  micro-buttons in the card corner they competed with the project name for
 *  attention and neither won. */
const CardMenu: React.FC<{ project: Project; onEdit: () => void; onArchive: () => void }> = ({
  project, onEdit, onArchive,
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pending = project.id.startsWith("temp-");

  return (
    <div className="card-menu" ref={wrapRef}>
      <button
        type="button"
        className="card-menu__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${project.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div className="card-menu__list" role="menu">
          <button
            type="button"
            role="menuitem"
            className="card-menu__item"
            onClick={() => { setOpen(false); onEdit(); }}
          >
            <IconPencil size={13} /> Edit
          </button>
          <button
            type="button"
            role="menuitem"
            className="card-menu__item card-menu__item--danger"
            disabled={pending}
            title={pending ? "Project is saving…" : "Removes it from pickers, keeps its history"}
            onClick={() => { setOpen(false); onArchive(); }}
          >
            <IconArchive size={13} /> Archive
          </button>
        </div>
      )}
    </div>
  );
};

export const ProjectsPage: React.FC<Props> = ({
  projects, tasks, entries, onAddProject, onEditProject,
  onArchiveProject, onRestoreProject, onAddTask, onDeleteTask, onRenameTask, onLoadTasksForProject,
}) => {
  const [draft, setDraft] = useState<FormDraft | null>(null);
  // The draft as the form opened, so Cancel can tell a half-filled project
  // from an untouched one (#104).
  const [pristine, setPristine] = useState<FormDraft | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingTaskFor, setAddingTaskFor] = useState<string | null>(null);
  const [newTaskName, setNewTaskName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [renamingTask, setRenamingTask] = useState<{ id: string; name: string } | null>(null);
  const today = useToday();

  // One pass over the entries for every per-card number: the window total,
  // when the project was last tracked, and the footer sparkline.
  const activity = useMemo(() => {
    const windowStart = addDaysStr(today, -(TOTAL_WINDOW_DAYS - 1));
    const sparkStart = addDaysStr(today, -(SPARK_DAYS - 1));
    const map = new Map<string, ProjectActivity>();
    entries.forEach((e) => {
      const cur = map.get(e.projectId) ?? {
        windowMinutes: 0, lastTracked: null, spark: Array(SPARK_DAYS).fill(0) as number[],
      };
      const minutes = e.durationMinutes || 0;
      if (e.date >= windowStart && e.date <= today) cur.windowMinutes += minutes;
      if (!cur.lastTracked || e.date > cur.lastTracked) cur.lastTracked = e.date;
      if (e.date >= sparkStart && e.date <= today) {
        const idx = Math.round(
          (new Date(e.date + "T00:00:00").getTime() - new Date(sparkStart + "T00:00:00").getTime()) / 86400000
        );
        if (idx >= 0 && idx < SPARK_DAYS) cur.spark[idx] += minutes;
      }
      map.set(e.projectId, cur);
    });
    return map;
  }, [entries, today]);

  // Most recently worked first, so the projects in play sit at the top
  // instead of wherever creation order happened to put them.
  const activeProjects = useMemo(
    () => projects
      .filter((p) => p.isActive)
      .sort((a, b) => {
        const la = activity.get(a.id)?.lastTracked ?? "";
        const lb = activity.get(b.id)?.lastTracked ?? "";
        if (la !== lb) return lb.localeCompare(la);
        return a.name.localeCompare(b.name);
      }),
    [projects, activity]
  );
  const archivedProjects = useMemo(() => projects.filter((p) => !p.isActive), [projects]);

  const commitRename = async (task: Task) => {
    if (!renamingTask) return;
    const name = renamingTask.name.trim();
    if (!name || name === task.name) { setRenamingTask(null); return; }
    try {
      await onRenameTask(task, name);
      setRenamingTask(null);
    } catch {
      // The hook already toasts the failure; keep the input open for retry.
    }
  };

  // Tasks are otherwise only fetched lazily (timer bar project picker, entry
  // modal) — without this, a project's chips render empty on a fresh mount
  // even though the tasks are still saved, which reads as data loss.
  useEffect(() => {
    projects.forEach((p) => {
      if (!p.id.startsWith("temp-")) onLoadTasksForProject(p.id);
    });
  }, [projects, onLoadTasksForProject]);

  const openForm = (d: FormDraft) => {
    setDraft(d);
    setPristine(d);
    setConfirmingCancel(false);
  };
  const closeForm = () => {
    setDraft(null);
    setPristine(null);
    setConfirmingCancel(false);
  };

  const startNew = () => openForm({ ...EMPTY_DRAFT });
  const startEdit = (p: Project) => openForm({
    editingId: p.id,
    name: p.name,
    description: p.description ?? "",
    color: p.color,
    hexInput: p.color,
    ratio: p.ratio !== undefined ? String(p.ratio) : "",
    jiraTicket: p.jiraTicket ?? "",
  });

  // Cancel on an untouched form just closes it — a confirm there is the
  // annoying half of this pattern, and the form is opened by accident far more
  // often than it's filled in.
  const handleCancel = () => {
    if (draft && pristine && isDirtyDraft(draft, pristine)) setConfirmingCancel(true);
    else closeForm();
  };

  const handleSave = async () => {
    if (!draft || !draft.name.trim() || saving) return;
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      color: draft.color,
      ratio: parseRatioInput(draft.ratio),
      jiraTicket: draft.jiraTicket.trim() || undefined,
      isActive: true,
    };
    setSaving(true);
    try {
      if (draft.editingId) {
        await onEditProject(draft.editingId, payload);
      } else {
        await onAddProject(payload);
      }
      closeForm();
    } catch {
      // The data hooks already toast the failure; keep the form open for retry.
    } finally {
      setSaving(false);
    }
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
            maxLength={100}
            autoFocus
          />
          <input
            className="form-input"
            placeholder="Description (optional)"
            value={draft.description}
            onChange={(e) => setDraft((d) => d && ({ ...d, description: e.target.value }))}
            maxLength={500}
          />
          <div className="form-input-group">
            <input
              className="form-input"
              type="number"
              step="1"
              min="0"
              placeholder="Ratio (optional, e.g. 2)"
              aria-label="Default billing ratio — identifies which account this project's time is billed to"
              value={draft.ratio}
              onChange={(e) => setDraft((d) => d && ({ ...d, ratio: e.target.value }))}
            />
            <HelpTip label="What is Ratio?" text="Default billing ratio for this project — the account/rate code new entries are billed to, unless overridden per entry. It's a label, not a multiplier: reports never multiply your hours by it. Leave blank if not applicable." />
          </div>
          <input
            className="form-input"
            placeholder="Jira ticket (optional, e.g. PROJ-123)"
            value={draft.jiraTicket}
            onChange={(e) => setDraft((d) => d && ({ ...d, jiraTicket: e.target.value }))}
            maxLength={50}
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
            {confirmingCancel ? (
              <>
                <p className="new-project-form__confirm" role="alert">Discard this project?</p>
                <button className="btn-primary" onClick={() => setConfirmingCancel(false)} autoFocus>
                  Keep editing
                </button>
                <button className="btn-ghost" onClick={closeForm}>Discard</button>
              </>
            ) : (
              <>
                <button className="btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : draft.editingId ? "Save Changes" : "Create"}
                </button>
                <button className="btn-ghost" onClick={handleCancel} disabled={saving}>Cancel</button>
              </>
            )}
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
        {activeProjects.map((project) => {
          const projectTasks = tasks.filter((t) => t.projectId === project.id && t.isActive);
          const stats = activity.get(project.id) ?? NO_ACTIVITY;

          return (
            <div key={project.id} className="project-card">
              <div className="project-card__stripe" style={{ background: project.color }} />
              <div className="project-card__body">
                <div className="project-card__top">
                  <span className="project-card__dot" style={{ background: project.color }} aria-hidden="true" />
                  <div className="project-card__heading">
                    <div className="project-card__name">{project.name}</div>
                    {project.description && (
                      <div className="project-card__desc">{project.description}</div>
                    )}
                    {/* Ticket then ratio, worded as the timesheet row words
                        them — the same two facts shouldn't read differently
                        depending on which screen you're looking at. */}
                    <div className="project-card__attrs">
                      {project.jiraTicket && (
                        <span className="chip-ticket" title={`Jira ticket ${project.jiraTicket}`}>
                          {project.jiraTicket}
                        </span>
                      )}
                      {project.ratio !== undefined && (
                        <span className="chip-ratio" title={`Default billing ratio for new entries`}>
                          Ratio {project.ratio}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="project-card__total-group">
                    <div className="project-card__total num-card">{formatMinutes(stats.windowMinutes)}</div>
                    <div className="project-card__total-label">last {TOTAL_WINDOW_DAYS} days</div>
                  </div>
                  <CardMenu
                    project={project}
                    onEdit={() => startEdit(project)}
                    onArchive={() => onArchiveProject(project)}
                  />
                </div>

                <div className="project-card__tasks">
                  {projectTasks.map((t) => (
                    renamingTask?.id === t.id ? (
                      <div key={t.id} className="inline-task-form">
                        <input
                          className="inline-task-form__input"
                          value={renamingTask.name}
                          onChange={(e) => setRenamingTask({ id: t.id, name: e.target.value })}
                          maxLength={100}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(t);
                            if (e.key === "Escape") setRenamingTask(null);
                          }}
                          aria-label={`Rename task ${t.name}`}
                          autoFocus
                        />
                        <button className="inline-task-form__ok" onClick={() => commitRename(t)} aria-label="Save task name"><IconCheck size={14} /></button>
                        <button className="inline-task-form__cancel" onClick={() => setRenamingTask(null)} aria-label="Cancel rename"><IconX size={14} /></button>
                      </div>
                    ) : (
                      <span key={t.id} className="task-chip">
                        <button
                          className="task-chip__name"
                          onClick={() => setRenamingTask({ id: t.id, name: t.name })}
                          title="Rename task"
                        >
                          {t.name}
                        </button>
                        {/* Revealed on hover/focus only — a permanent × on every
                            chip put delete one slip away, dozens of times over. */}
                        <button
                          className="task-chip__delete"
                          onClick={() => onDeleteTask(t)}
                          title="Delete task"
                          aria-label={`Delete task ${t.name}`}
                        >
                          <IconX size={11} />
                        </button>
                      </span>
                    )
                  ))}
                  {addingTaskFor === project.id ? (
                    <div className="inline-task-form">
                      <input
                        className="inline-task-form__input"
                        placeholder="Task name"
                        value={newTaskName}
                        onChange={(e) => setNewTaskName(e.target.value)}
                        maxLength={100}
                        onKeyDown={(e) => e.key === "Enter" && handleAddTask(project.id)}
                        autoFocus
                      />
                      <button className="inline-task-form__ok" onClick={() => handleAddTask(project.id)} aria-label="Add task"><IconCheck size={14} /></button>
                      <button className="inline-task-form__cancel" onClick={() => setAddingTaskFor(null)} aria-label="Cancel"><IconX size={14} /></button>
                    </div>
                  ) : (
                    <button
                      className="task-chip task-chip--add"
                      onClick={() => { setAddingTaskFor(project.id); setNewTaskName(""); }}
                      disabled={project.id.startsWith("temp-")}
                      title={project.id.startsWith("temp-") ? "Project is saving…" : undefined}
                    >
                      <IconPlus size={11} /> Task
                    </button>
                  )}
                </div>

                <div className="project-card__footer">
                  <span className="project-card__last">
                    {stats.lastTracked
                      ? `Last tracked ${relativeDay(stats.lastTracked, today)}`
                      : "Never tracked"}
                  </span>
                  <Sparkline
                    values={stats.spark}
                    color={project.color}
                    label={`Last ${SPARK_DAYS} days: ${formatMinutes(stats.spark.reduce((s, v) => s + v, 0))}`}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {archivedProjects.length > 0 && (
        <div className="archived-projects">
          <button
            className="archived-projects__toggle"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
          >
            <IconArchive size={13} /> Archived ({archivedProjects.length})
            <span className="archived-projects__chevron">{showArchived ? "▾" : "▸"}</span>
          </button>
          {showArchived && (
            <div className="project-cards project-cards--archived">
              {archivedProjects.map((project) => (
                <div key={project.id} className="project-card project-card--archived">
                  <div className="project-card__stripe" style={{ background: project.color }} />
                  <div className="project-card__body">
                    <div className="project-card__top">
                      <span className="project-card__dot" style={{ background: project.color }} aria-hidden="true" />
                      <div className="project-card__heading">
                        <div className="project-card__name">{project.name}</div>
                        {project.description && (
                          <div className="project-card__desc">{project.description}</div>
                        )}
                      </div>
                      <div className="project-card__total-group">
                        <div className="project-card__total num-card">
                          {formatMinutes((activity.get(project.id) ?? NO_ACTIVITY).windowMinutes)}
                        </div>
                        <div className="project-card__total-label">last {TOTAL_WINDOW_DAYS} days</div>
                      </div>
                      <button
                        className="project-card__restore"
                        onClick={() => { onRestoreProject(project).catch(() => { /* toasted by hook */ }); }}
                        title="Restore project to the active list"
                        aria-label={`Restore project ${project.name}`}
                      >
                        <IconUndo size={12} /> Restore
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
