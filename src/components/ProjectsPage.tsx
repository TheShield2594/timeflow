import React, { useMemo, useRef, useState } from "react";
import type { Task } from "../types";
import { formatMinutes, parseRatioInput } from "../hooks";
import { useData } from "../contexts/DataContext";
import { DEFAULT_PROJECT_COLOR } from "../utils/colors";
import { ListCard } from "./ListCard";
import { SegmentedControl } from "./SegmentedControl";
import { FloatingActionBar } from "./FloatingActionBar";
import { Sheet } from "./Sheet";
import { Pill } from "./Pill";

/**
 * The colours a project can be painted in — the Everence palette, and nothing
 * else. A project's colour is the only thing that identifies it on a bar, a
 * dot or a calendar block, so the picker excludes hues already taken: two
 * projects sharing one makes every one of those marks ambiguous.
 */
const PALETTE = [
  "#719500", // green
  "#358450", // grass
  "#225433", // forest
  "#B5BF00", // lime
  "#0080BD", // blue
  "#4DC5E2", // robin
  "#00739F", // royal
  "#003346", // navy
  "#CC4F00", // pumpkin
  "#F3AE00", // lemon
  "#4B5457", // charcoal
];

const PAGE_SIZE = 5;
const TASKS_SHOWN = 5;

type Scope = "active" | "archived";
type Sort = "hours" | "name" | "tasks";

const SORT_LABEL: Record<Sort, string> = { hours: "Hours", name: "Name", tasks: "Tasks" };

interface FormDraft {
  editingId: string | null;
  name: string;
  description: string;
  color: string;
  ratio: string;
  jiraTicket: string;
}

function emptyDraft(taken: Set<string>): FormDraft {
  const free = PALETTE.find((c) => !taken.has(c.toLowerCase())) ?? DEFAULT_PROJECT_COLOR;
  return { editingId: null, name: "", description: "", color: free, ratio: "", jiraTicket: "" };
}

/**
 * One list, with the open project's tasks drawn underneath its own row.
 *
 * The old page was a grid of cards, each with a header, a task strip, a
 * sparkline and a footer — a card inside a card inside a panel, repeated
 * twelve times. A project is a row with a number on it; its tasks belong
 * under it, not in a box of their own.
 */
export const ProjectsPage: React.FC = () => {
  const {
    projects, tasks, entries,
    addProject, editProject, archiveProject, restoreProject,
    addTask, deleteTask, loadTasksForProject,
  } = useData();

  const [scope, setScope] = useState<Scope>("active");
  const [sort, setSort] = useState<Sort>("hours");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [draft, setDraft] = useState<FormDraft | null>(null);
  const [newTaskFor, setNewTaskFor] = useState<string | null>(null);
  const [newTaskName, setNewTaskName] = useState("");
  /**
   * Which project owns the task field, mirrored in a ref.
   *
   * State drives the render; this answers "is the field still unclaimed?"
   * synchronously, from inside a promise that may settle long after the user
   * moved on. The two have to move together — a guard that restored the name
   * without the project would put one project's name in another's field — so
   * every open and close goes through `openTaskField`.
   */
  const taskFieldOwner = useRef<string | null>(null);
  const openTaskField = (projectId: string | null, name = "") => {
    taskFieldOwner.current = projectId;
    setNewTaskFor(projectId);
    setNewTaskName(name);
  };

  const takenColors = useMemo(
    () => new Set(projects.filter((p) => p.isActive).map((p) => (p.color || "").toLowerCase())),
    [projects]
  );

  const minutesByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      map.set(entry.projectId, (map.get(entry.projectId) ?? 0) + (entry.durationMinutes || 0));
    }
    return map;
  }, [entries]);

  const minutesByTask = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      if (entry.taskId) map.set(entry.taskId, (map.get(entry.taskId) ?? 0) + (entry.durationMinutes || 0));
    }
    return map;
  }, [entries]);

  const tasksByProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.isActive) continue;
      if (!map.has(task.projectId)) map.set(task.projectId, []);
      map.get(task.projectId)!.push(task);
    }
    return map;
  }, [tasks]);

  const activeCount = projects.filter((p) => p.isActive).length;
  const archivedCount = projects.length - activeCount;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects
      .filter((p) => (scope === "active" ? p.isActive : !p.isActive))
      .filter((p) => {
        if (!q) return true;
        if (p.name.toLowerCase().includes(q)) return true;
        return (tasksByProject.get(p.id) ?? []).some((t) => t.name.toLowerCase().includes(q));
      })
      .map((p) => ({
        project: p,
        minutes: minutesByProject.get(p.id) ?? 0,
        taskCount: (tasksByProject.get(p.id) ?? []).length,
      }))
      .sort((a, b) => {
        if (sort === "name") return a.project.name.localeCompare(b.project.name);
        if (sort === "tasks") return b.taskCount - a.taskCount;
        return b.minutes - a.minutes;
      });
  }, [projects, scope, search, sort, minutesByProject, tasksByProject]);

  const peak = Math.max(...rows.map((r) => r.minutes), 1);
  const shown = rows.slice(0, visible);
  const hidden = rows.length - shown.length;
  const totalTasks = tasks.filter((t) => t.isActive).length;

  const toggle = (projectId: string) => {
    setExpandedId((current) => {
      if (current === projectId) return null;
      loadTasksForProject(projectId);
      return projectId;
    });
  };

  const saveDraft = async () => {
    if (!draft || !draft.name.trim()) return;
    // Editing must not resurrect an archived project. The Edit button is on
    // every expanded row, archived ones included, so a payload that hardcoded
    // `isActive: true` turned "fix a typo in the name" into "un-archive it" —
    // and the row then vanished out of the list the user was looking at.
    // Archiving and restoring are their own explicit actions.
    const existing = draft.editingId ? projects.find((p) => p.id === draft.editingId) : undefined;
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      color: draft.color,
      ratio: parseRatioInput(draft.ratio),
      jiraTicket: draft.jiraTicket.trim() || undefined,
      isActive: existing ? existing.isActive : true,
    };
    try {
      if (draft.editingId) await editProject(draft.editingId, payload);
      else await addProject(payload);
      setDraft(null);
    } catch {
      // The data hooks already toast the failure; keep the sheet open to retry.
    }
  };

  const createTask = async (projectId: string) => {
    const name = newTaskName.trim();
    if (!name) { openTaskField(null); return; }
    // Cleared *before* the await, not after. The field commits on Enter and
    // again on blur, and pressing Enter then clicking away sent the same name
    // twice while the first request was still in flight — two task records for
    // one typed name.
    openTaskField(null);
    try {
      await addTask({ projectId, name, isActive: true });
    } catch {
      // Toasted upstream — and the field comes back with what was typed in it.
      // The duplicate came from the double-submit path, which the clear above
      // still closes; a write that *failed* left nothing to duplicate, so
      // there is no trade to make here (#153).
      //
      // Only while nothing else has claimed the field, though. This can settle
      // long after the user gave up and started typing a different task, and
      // the name in front of them outranks the one that didn't save.
      if (taskFieldOwner.current === null) openTaskField(projectId, name);
    }
  };

  return (
    <>
      <div className="page__head">
        <h1 className="page__title t-large-title">Projects</h1>
        <span className="t-subhead t-secondary">{activeCount} active · {totalTasks} tasks</span>
      </div>

      <div className="page__toolbar">
        <SegmentedControl
          ariaLabel="Project scope"
          value={scope}
          onChange={(next) => { setScope(next); setVisible(PAGE_SIZE); setExpandedId(null); }}
          options={[
            { value: "active", label: `Active ${activeCount}` },
            { value: "archived", label: `Archived ${archivedCount}` },
          ]}
        />
        <div className="page__toolbar-right">
          <input
            className="search"
            placeholder="Search projects and tasks"
            aria-label="Search projects and tasks"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setVisible(PAGE_SIZE); }}
          />
          <label className="t-subhead t-secondary">
            Sort ·{" "}
            <select
              className="field-row__select"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              aria-label="Sort projects"
            >
              {(Object.keys(SORT_LABEL) as Sort[]).map((key) => (
                <option key={key} value={key}>{SORT_LABEL[key]}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty__title t-title2">
            {scope === "archived" ? "Nothing archived" : search ? "No project matches that" : "Time is tracked against a project"}
          </div>
          <p className="empty__body t-body">
            {scope === "archived"
              ? "Archiving a project keeps its history in reports and exports while taking it out of the way."
              : search
                ? "Try a shorter search, or check the archived list."
                : "Make one for the work you do most. You can rename it later, and archiving keeps its history."}
          </p>
          {scope === "active" && !search && (
            <button type="button" className="empty__action" onClick={() => setDraft(emptyDraft(takenColors))}>
              Create a project
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="t-group-label t-secondary" style={{ margin: "8px 0 10px" }}>
            Hours in the loaded range
          </div>
          <ListCard>
            {shown.map(({ project, minutes, taskCount }) => {
              const expanded = expandedId === project.id;
              const projectTasks = (tasksByProject.get(project.id) ?? [])
                .slice()
                .sort((a, b) => (minutesByTask.get(b.id) ?? 0) - (minutesByTask.get(a.id) ?? 0));
              return (
                <React.Fragment key={project.id}>
                  <button
                    type="button"
                    className="projects__row"
                    onClick={() => toggle(project.id)}
                    aria-expanded={expanded}
                  >
                    <span className="dot dot--lg" style={{ "--pc": project.color || DEFAULT_PROJECT_COLOR } as React.CSSProperties} />
                    <span style={{ minWidth: 0 }}>
                      <span className="projects__name">
                        {project.name}
                        <span className="projects__chev" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
                      </span>
                      <span className="projects__sub">
                        {taskCount} {taskCount === 1 ? "task" : "tasks"} ·{" "}
                        {project.ratio !== undefined ? `Ratio ${project.ratio}` : "no billing account"}
                      </span>
                    </span>
                    <span className="projects__bar">
                      <span
                        className="projects__bar-fill"
                        style={{
                          width: `${(minutes / peak) * 100}%`,
                          "--pc": project.color || DEFAULT_PROJECT_COLOR,
                        } as React.CSSProperties}
                      />
                    </span>
                    <span className="projects__hours">{formatMinutes(minutes)}</span>
                  </button>

                  {expanded && (
                    <div className="projects__tasks">
                      {projectTasks.slice(0, TASKS_SHOWN).map((task) => (
                        <div key={task.id} className="projects__task">
                          <span className="projects__task-name">{task.name}</span>
                          <span className="projects__task-hours">{formatMinutes(minutesByTask.get(task.id) ?? 0)}</span>
                          {/* Deleting a task deactivates the record — the name
                              still has to resolve on every historical entry
                              that used it. */}
                          <button
                            type="button"
                            className="projects__task-remove"
                            onClick={() => deleteTask(task)}
                            aria-label={`Delete ${task.name}`}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                      {newTaskFor === project.id ? (
                        <div className="projects__task">
                          <input
                            className="input input--wide"
                            placeholder="New task name"
                            aria-label="New task name"
                            value={newTaskName}
                            onChange={(e) => setNewTaskName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") createTask(project.id);
                              if (e.key === "Escape") openTaskField(null);
                            }}
                            onBlur={() => createTask(project.id)}
                            autoFocus
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="projects__task-add"
                          onClick={() => openTaskField(project.id)}
                        >
                          New task
                        </button>
                      )}
                      {projectTasks.length > TASKS_SHOWN && (
                        <div className="projects__task-more">
                          {projectTasks.length - TASKS_SHOWN} more tasks
                        </div>
                      )}
                      <div className="projects__task-more" style={{ display: "flex", gap: 16 }}>
                        <button
                          type="button"
                          className="field-row__action is-inline"
                          onClick={() => setDraft({
                            editingId: project.id,
                            name: project.name,
                            description: project.description ?? "",
                            color: project.color || DEFAULT_PROJECT_COLOR,
                            ratio: project.ratio !== undefined ? String(project.ratio) : "",
                            jiraTicket: project.jiraTicket ?? "",
                          })}
                        >
                          Edit project
                        </button>
                        {project.isActive ? (
                          <button type="button" className="field-row__action is-inline" onClick={() => archiveProject(project)}>
                            Archive
                          </button>
                        ) : (
                          <button type="button" className="field-row__action is-inline" onClick={() => restoreProject(project)}>
                            Restore
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </ListCard>
          {hidden > 0 && (
            <button type="button" className="projects__more" onClick={() => setVisible((n) => n + PAGE_SIZE)}>
              Show {hidden} more
            </button>
          )}
        </>
      )}

      <FloatingActionBar
        hint={`Archiving keeps a project's history in reports and exports. ${archivedCount} archived.`}
      >
        <Pill tone="primary" onClick={() => setDraft(emptyDraft(takenColors))}>New project</Pill>
      </FloatingActionBar>

      {draft && (
        <Sheet label={draft.editingId ? "Edit project" : "New project"} onClose={() => setDraft(null)} narrow>
          <h2 className="t-title1">{draft.editingId ? "Edit project" : "New project"}</h2>

          <div className="sheet__section field-list">
            <div className="field-row">
              <label className="field-row__label" htmlFor="project-name">Name</label>
              <span className="field-row__value">
                <input
                  id="project-name" className="field-row__input"
                  value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  maxLength={100} autoFocus data-autofocus
                />
              </span>
            </div>
            <div className="field-row">
              <label className="field-row__label" htmlFor="project-desc">Description</label>
              <span className="field-row__value">
                <input
                  id="project-desc" className="field-row__input" placeholder="Optional"
                  value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  maxLength={500}
                />
              </span>
            </div>
            <div className="field-row">
              <label className="field-row__label" htmlFor="project-ratio">Billed to</label>
              <span className="field-row__value">
                <input
                  id="project-ratio" className="field-row__input" type="number" step="1" min="0"
                  style={{ maxWidth: 110 }} placeholder="Ratio"
                  /* A billing account identifier, never a multiplier (#71). */
                  aria-label="Ratio — the billing account this project's time is billed to"
                  value={draft.ratio} onChange={(e) => setDraft({ ...draft, ratio: e.target.value })}
                />
                <span className="field-row__sep" aria-hidden="true">·</span>
                <input
                  className="field-row__input" style={{ maxWidth: 140 }} placeholder="Ticket"
                  aria-label="Default ticket reference"
                  value={draft.jiraTicket} onChange={(e) => setDraft({ ...draft, jiraTicket: e.target.value })}
                  maxLength={50}
                />
              </span>
            </div>
          </div>

          <div className="sheet__section">
            <div className="t-group-label t-secondary" style={{ marginBottom: 10 }}>Colour</div>
            <div className="swatches">
              {PALETTE.map((colour) => {
                const taken = takenColors.has(colour.toLowerCase()) && colour !== draft.color;
                return (
                  <button
                    key={colour}
                    type="button"
                    className={`swatch${draft.color === colour ? " swatch--on" : ""}`}
                    style={{ "--pc": colour } as React.CSSProperties}
                    disabled={taken}
                    onClick={() => setDraft({ ...draft, color: colour })}
                    aria-label={taken ? `${colour}, already used by another project` : colour}
                    aria-pressed={draft.color === colour}
                  />
                );
              })}
            </div>
            <p className="sheet__note">
              A colour identifies this project on every bar, dot and calendar block, so the ones
              already in use are unavailable.
            </p>
          </div>

          <div className="sheet__foot">
            <div className="sheet__foot-right">
              <Pill tone="quiet" onClick={() => setDraft(null)}>Cancel</Pill>
              <Pill tone="primary" onClick={saveDraft} disabled={!draft.name.trim()}>Save</Pill>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
};
