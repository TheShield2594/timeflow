import React from "react";
import type { TimeEntry, Project, Task } from "../types";
import { formatMinutes } from "../hooks";
import { IconPencil, IconPlay, IconX } from "./Icons";

interface Props {
  entry: TimeEntry;
  project?: Project;
  task?: Task;
  timerBusy?: boolean;
  onContinue?: (entry: TimeEntry) => void;
  onEdit?: (entry: TimeEntry) => void;
  onDelete?: (id: string) => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
}

/** A single time-entry row — project accent stripe, description, work/ticket/
 *  ratio chips, times/duration, and (when the caller wires them up)
 *  continue/edit/delete actions. Shared by the Timesheet's day-grouped list
 *  and the Overview page's recent-entries panel. */
export const EntryRow: React.FC<Props> = ({ entry, project, task, timerBusy, onContinue, onEdit, onDelete }) => (
  <div className="entry-row">
    <div
      className="entry-row__accent"
      style={{ background: project?.color || "#6366f1" }}
    />
    <div className="entry-row__body">
      <div className="entry-row__top">
        <span className="entry-row__desc">
          {entry.description || <em className="entry-row__no-desc">No description</em>}
        </span>
        {/* Four different kinds of data used to render as four identical
            pills, so "PTO · Vacation" read as two unrelated tags rather than
            project ▸ task. One composite chip carries the work identity (the
            project's colour is the only cue it needs); the ticket and the
            billing ratio get their own quieter forms. */}
        <div className="entry-row__meta">
          {(project || task) && (
            <span
              className="chip-work"
              style={{ "--pc": project?.color } as React.CSSProperties}
            >
              {project && <span className="chip-work__dot" aria-hidden="true" />}
              {project && <span className="chip-work__project">{project.name}</span>}
              {project && task && <span className="chip-work__sep" aria-hidden="true">▸</span>}
              {task && <span className="chip-work__task">{task.name}</span>}
            </span>
          )}
          {entry.jiraTicket && (
            <span className="chip-ticket" title={`Jira ticket ${entry.jiraTicket}`}>
              {entry.jiraTicket}
            </span>
          )}
          {entry.ratio !== undefined && (
            <span className="chip-ratio" title={`Billing ratio ${entry.ratio}`}>
              <span aria-hidden="true">r{entry.ratio}</span>
              <span className="sr-only">Billing ratio {entry.ratio}</span>
            </span>
          )}
        </div>
      </div>
      <div className="entry-row__bottom">
        <span className="entry-row__times num-row">
          {formatTime(entry.startTime)}
          {entry.endTime && <> – {formatTime(entry.endTime)}</>}
        </span>
        <span className="entry-row__duration num-row">
          {entry.endTime
            ? formatMinutes(entry.durationMinutes ?? 0)
            : <span className="entry-row__running">Running…</span>
          }
        </span>
      </div>
    </div>
    {/* Running sessions are owned by the timer bar — only completed entries
        can be edited or deleted here. (Deleting the running draft row would
        strand the timer's stop in a 404-retry loop.) */}
    {entry.endTime && (
      <>
        {onContinue && (
          <button
            className="entry-row__continue"
            onClick={() => onContinue(entry)}
            disabled={timerBusy || !project?.isActive}
            title={
              timerBusy ? "Timer already running"
                : !project?.isActive ? "Project is archived"
                : "Continue — start the timer with this entry's project, task and description"
            }
            aria-label={`Continue working on ${entry.description || project?.name || "this entry"}`}
          >
            <IconPlay size={12} /> Continue
          </button>
        )}
        {onEdit && (
          <button
            className="entry-row__edit"
            onClick={() => onEdit(entry)}
            title="Edit entry"
            aria-label={`Edit ${entry.description || project?.name || "this entry"}`}
          >
            <IconPencil />
          </button>
        )}
        {onDelete && (
          <button
            className="entry-row__delete"
            onClick={() => onDelete(entry.id)}
            title="Delete entry"
            aria-label={`Delete ${entry.description || project?.name || "this entry"}`}
          >
            <IconX />
          </button>
        )}
      </>
    )}
  </div>
);
