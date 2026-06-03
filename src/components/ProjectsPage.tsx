import React, { useState } from "react";
import type { Project, Task } from "../types";
import { formatMinutes, parseRatioInput } from "../hooks";

interface Props {
  projects: Project[];
  tasks: Task[];
  totalMinutesByProject: Map<string, number>;
  onAddProject: (data: Omit<Project, "id" | "createdAt">) => Promise<Project>;
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

export const ProjectsPage: React.FC<Props> = ({
  projects, tasks, totalMinutesByProject, onAddProject, onAddTask,
}) => {
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [newProjectColor, setNewProjectColor] = useState(PALETTE[0]);
  const [newProjectRatio, setNewProjectRatio] = useState("");
  const [newProjectJira, setNewProjectJira] = useState("");
  const [addingTaskFor, setAddingTaskFor] = useState<string | null>(null);
  const [newTaskName, setNewTaskName] = useState("");

  const handleAddProject = async () => {
    if (!newProjectName.trim()) return;
    await onAddProject({
      name: newProjectName.trim(),
      description: newProjectDesc.trim(),
      color: newProjectColor,
      ratio: parseRatioInput(newProjectRatio),
      jiraTicket: newProjectJira.trim() || undefined,
      isActive: true,
    });
    setNewProjectName(""); setNewProjectDesc(""); setNewProjectColor(PALETTE[0]); setNewProjectRatio(""); setNewProjectJira(""); setShowNewProject(false);
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
        <button className="btn-primary" onClick={() => setShowNewProject(true)}>
          + New Project
        </button>
      </div>

      {showNewProject && (
        <div className="new-project-form">
          <h3 className="new-project-form__title">New Project</h3>
          <input
            className="form-input"
            placeholder="Project name"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            autoFocus
          />
          <input
            className="form-input"
            placeholder="Description (optional)"
            value={newProjectDesc}
            onChange={(e) => setNewProjectDesc(e.target.value)}
          />
          <input
            className="form-input"
            type="number"
            step="1"
            min="0"
            placeholder="Ratio (optional, e.g. 2)"
            value={newProjectRatio}
            onChange={(e) => setNewProjectRatio(e.target.value)}
          />
          <input
            className="form-input"
            placeholder="Jira ticket (optional, e.g. PROJ-123)"
            value={newProjectJira}
            onChange={(e) => setNewProjectJira(e.target.value)}
          />
          <div className="color-picker">
            <span className="color-picker__label">Color</span>
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`color-picker__swatch ${newProjectColor === c ? "color-picker__swatch--active" : ""}`}
                style={{ background: c }}
                onClick={() => setNewProjectColor(c)}
              />
            ))}
          </div>
          <div className="new-project-form__actions">
            <button className="btn-primary" onClick={handleAddProject}>Create</button>
            <button className="btn-ghost" onClick={() => setShowNewProject(false)}>Cancel</button>
          </div>
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
                  <div className="project-card__total">{formatMinutes(totalMins)}</div>
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
                      <button className="inline-task-form__ok" onClick={() => handleAddTask(project.id)}>✓</button>
                      <button className="inline-task-form__cancel" onClick={() => setAddingTaskFor(null)}>×</button>
                    </div>
                  ) : (
                    <button className="task-chip task-chip--add" onClick={() => { setAddingTaskFor(project.id); setNewTaskName(""); }}>
                      + Task
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
