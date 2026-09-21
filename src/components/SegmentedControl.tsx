import React, { useRef } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/**
 * A filter that shows its own alternatives.
 *
 * Used wherever a screen has a small, fixed set of scopes — the timesheet's
 * range, Reports' period, Projects' active/archived, Team's direct reports
 * versus the whole line. A dropdown would hide the choice that matters most:
 * that there *is* another scope.
 *
 * Announced as a radio group, not as tabs. It used to say `tablist`, which
 * promises arrow keys and a tab panel it never had: a screen-reader user was
 * told to expect one pattern and handed another. A choice of exactly one
 * scope is a radio group, so it takes that pattern whole: one tab stop, the
 * arrow keys move and select, Home and End jump to the ends.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (to: number) => {
    const next = (to + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") move(index + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(options.length - 1);
    else return;
    e.preventDefault();
  };

  // Nothing selected can happen for a moment while a value is being loaded;
  // the first option keeps the group reachable by Tab until it settles.
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));

  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={i === selectedIndex ? 0 : -1}
          className={`segmented__item${option.value === value ? " segmented__item--on" : ""}`}
          onClick={() => onChange(option.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
