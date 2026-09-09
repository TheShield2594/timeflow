import React from "react";
import { DEFAULT_PROJECT_COLOR } from "../utils/colors";

interface CardProps {
  children: React.ReactNode;
  tight?: boolean;
  className?: string;
}

/** A grouped list on its own surface. One level of surface, never two. */
export const ListCard: React.FC<CardProps> = ({ children, tight, className = "" }) => (
  <div className={`list-card${tight ? " list-card--tight" : ""}${className ? ` ${className}` : ""}`}>
    {children}
  </div>
);

interface RowProps {
  /** Project colour for the leading dot. Omit for a row with no project. */
  color?: string;
  /** Replaces the dot entirely — an untracked gap's hatched square, say. */
  mark?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** The number, right-aligned. */
  value?: React.ReactNode;
  /** Under the number, at footnote size — usually `HH:MM – HH:MM`. */
  meta?: React.ReactNode;
  /** A control instead of a number: the resume row's Start pill, a Fill it. */
  action?: React.ReactNode;
  valueAccent?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}

/**
 * The time entry's list rendering.
 *
 * The description is the title, not the project: it is what the user typed
 * and what they scan the list for. The project and task are the second line,
 * because they are how the entry is filed rather than what it was.
 */
export const ListRow: React.FC<RowProps> = ({
  color, mark, title, subtitle, value, meta, action, valueAccent, onClick, ariaLabel,
}) => {
  const body = (
    <>
      {mark ?? <span className="dot" style={{ "--pc": color || DEFAULT_PROJECT_COLOR } as React.CSSProperties} />}
      <span className="list-row__main">
        <span className="list-row__title">{title}</span>
        {subtitle !== undefined && <span className="list-row__sub">{subtitle}</span>}
      </span>
      {action ?? (
        <span className="list-row__right">
          <span className={`list-row__value${valueAccent ? " list-row__value--accent" : ""}`}>{value}</span>
          {meta !== undefined && <span className="list-row__time">{meta}</span>}
        </span>
      )}
    </>
  );

  if (!onClick) return <div className="list-row">{body}</div>;
  return (
    <button type="button" className="list-row" onClick={onClick} aria-label={ariaLabel}>
      {body}
    </button>
  );
};
