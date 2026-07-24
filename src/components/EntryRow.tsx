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

/** A single time-entry row — project accent stripe, description, badges,
 *  times/duration, and (when the caller wires them up) continue/edit/delete
 *  actions. Shared by the Timesheet's day-grouped list and the Overview
 *  page's recent-entries panel. */
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
        <div className="entry-row__badges">
          {project && (
            <span
              className="badge badge--project"
              style={{ "--pc": project.color } as React.CSSProperties}
            >
              {project.name}
            </span>
          )}
          {task && (
            <span className="badge badge--task">{task.name}</span>
          )}
          {entry.jiraTicket && (
            <span className="badge badge--task">{entry.jiraTicket}</span>
          )}
          {entry.ratio !== undefined && (
            <span className="badge badge--task">Ratio: {entry.ratio}</span>
          )}
        </div>
      </div>
      <div className="entry-row__bottom">
        <span className="entry-row__times">
          {formatTime(entry.startTime)}
          {entry.endTime && <> – {formatTime(entry.endTime)}</>}
        </span>
        <span className="entry-row__duration">
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
