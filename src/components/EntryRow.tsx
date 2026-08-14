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
  return new Date(iso).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
}

/** H:MM. A fixed shape is what makes the duration column scannable —
 *  formatMinutes' "1h 30m" / "45m" / "2h" can't line up no matter how the
 *  numerals are spaced, because the strings differ in structure. The friendly
 *  form stays on the title for anyone who wants it spelled out. */
function durationColumn(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * A single time-entry row. Shared by the Timesheet's day-grouped list and the
 * Overview page's recent-entries panel.
 *
 * One grid: the accent stripe, then what it was, when, how long, and what you
 * can do to it.
 * The two-line stack this replaced put a ~900px void between the description
 * and the badges, hid the duration underneath the buttons where it couldn't be
 * scanned down the page, and kept three buttons permanently visible on every
 * row — twenty rows meaning sixty buttons, which made "Continue" the loudest
 * repeated element on the page despite being a rare action.
 */
export const EntryRow: React.FC<Props> = ({ entry, project, task, timerBusy, onContinue, onEdit, onDelete }) => {
  // Why Continue is unavailable. It used to live only in `title`, which a
  // keyboard user can't reach and which a disabled control shows unreliably —
  // so the button just sat there greyed out with no stated reason (#106).
  const continueBlockedBy =
    timerBusy ? "Timer already running"
      : !project?.isActive ? "Project is archived"
        : null;
  const blockedId = `continue-blocked-${entry.id}`;

  return (
  <div className="entry-row">
    <div
      className="entry-row__accent"
      style={{ background: project?.color || "#6366f1" }}
    />
    <div className="entry-row__main">
      <span className="entry-row__desc">
        {entry.description || <em className="entry-row__no-desc">No description</em>}
      </span>
      {/* Project, task, ticket and ratio on one line. As four identical pills
          they read as four equally important tags; here the project leads
          with its colour and the rest trail off as quieter detail. */}
      <span className="entry-row__meta">
        {project && (
          <span className="entry-row__project">
            <span className="entry-row__dot" style={{ background: project.color }} aria-hidden="true" />
            {project.name}
          </span>
        )}
        {task && <span className="entry-row__task">{task.name}</span>}
        {entry.jiraTicket && <span className="entry-row__ticket">{entry.jiraTicket}</span>}
        {entry.ratio !== undefined && <span className="entry-row__ratio">Ratio {entry.ratio}</span>}
      </span>
    </div>

    <span className="entry-row__times">
      {formatTime(entry.startTime)}
      {entry.endTime && <> – {formatTime(entry.endTime)}</>}
    </span>

    <span className="entry-row__duration">
      {entry.endTime
        ? <span title={formatMinutes(entry.durationMinutes ?? 0)}>{durationColumn(entry.durationMinutes ?? 0)}</span>
        : <span className="entry-row__running">Running…</span>
      }
    </span>

    {/* Running sessions are owned by the timer bar — only completed entries
        can be edited or deleted here. (Deleting the running draft row would
        strand the timer's stop in a 404-retry loop.) */}
    <span className="entry-row__actions">
      {entry.endTime && (
        <>
          {onContinue && (
            <>
              <button
                type="button"
                className="entry-row__action entry-row__continue"
                onClick={() => onContinue(entry)}
                disabled={!!continueBlockedBy}
                title={continueBlockedBy ?? "Continue — start the timer with this entry's project, task and description"}
                aria-label={`Continue working on ${entry.description || project?.name || "this entry"}`}
                aria-describedby={continueBlockedBy ? blockedId : undefined}
              >
                <IconPlay size={12} />
              </button>
              {continueBlockedBy && (
                <span id={blockedId} className="visually-hidden">{continueBlockedBy}</span>
              )}
            </>
          )}
          {onEdit && (
            <button
              type="button"
              className="entry-row__action entry-row__edit"
              onClick={() => onEdit(entry)}
              title="Edit entry"
              aria-label={`Edit ${entry.description || project?.name || "this entry"}`}
            >
              <IconPencil size={13} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="entry-row__action entry-row__delete"
              onClick={() => onDelete(entry.id)}
              title="Delete entry"
              aria-label={`Delete ${entry.description || project?.name || "this entry"}`}
            >
              <IconX size={13} />
            </button>
          )}
        </>
      )}
    </span>
  </div>
  );
};
