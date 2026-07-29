import React, { useEffect, useMemo, useRef, useState } from "react";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Rendered as a leading dot — used to carry a project's colour. */
  color?: string;
  /** Pinned to the bottom and never filtered out (e.g. "+ New task…"). */
  isAction?: boolean;
}

interface Props {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  /** Shown when nothing is selected. */
  placeholder: string;
  ariaLabel: string;
  /** Extra class on the control, for per-field widths. */
  className?: string;
  id?: string;
}

/**
 * Type-ahead single-select.
 *
 * This replaces the native `<select>`s in the timer bar. Two reasons: a native
 * picker wears OS chrome that no other control in the app does, and it has no
 * type-ahead beyond first-letter matching, which stops scaling somewhere around
 * twenty projects — exactly the point where picking one is the slowest step of
 * starting a timer.
 *
 * Keyboard: ArrowDown/ArrowUp move, Enter commits, Escape closes without
 * changing the selection, Tab leaves. The input carries the combobox role and
 * points at the active option via aria-activedescendant, so focus never leaves
 * the text field and the list stays announceable.
 */
export const Combobox: React.FC<Props> = ({
  options, value, onChange, placeholder, ariaLabel, className = "", id,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const reactId = React.useId();
  const listId = `${id ?? reactId}-listbox`;

  const selected = options.find((o) => o.value === value && !o.isAction);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Actions are commands, not data — filtering them out mid-search would
    // hide "+ New task…" exactly when the search came up empty and creating
    // one is the obvious next move.
    if (!q) return options;
    return options.filter((o) => o.isAction || o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Keep the highlight on a real row as the filter narrows.
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(visible.length - 1, 0)));
  }, [visible.length]);

  // Follow the highlight when it moves past the visible slice of a long list.
  // Purely cosmetic, and jsdom has no scrollIntoView — guarded rather than
  // stubbed so the tests exercise the real component.
  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLLIElement>('[data-active="true"]');
    if (typeof active?.scrollIntoView === "function") active.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const openList = () => {
    if (open) return;
    setOpen(true);
    setQuery("");
    const idx = visible.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);
  };

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const commit = (option: ComboboxOption) => {
    onChange(option.value);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { openList(); return; }
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + delta + visible.length) % Math.max(visible.length, 1));
      return;
    }
    if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const option = visible[activeIndex];
      if (option) commit(option);
      return;
    }
    if (e.key === "Escape") {
      if (!open) return;
      // Stop here rather than letting it bubble: Escape inside an open list
      // means "close the list", not "close whatever modal I'm inside".
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "Tab") close();
  };

  return (
    <div
      ref={containerRef}
      className={`combobox ${className}`}
      onBlur={(e) => {
        // Ignore focus moving *within* the control (input ↔ list).
        if (containerRef.current?.contains(e.relatedTarget as Node | null)) return;
        close();
      }}
    >
      {selected?.color && (
        <span className="combobox__dot" style={{ background: selected.color }} aria-hidden="true" />
      )}
      <input
        ref={inputRef}
        id={id}
        type="text"
        className={`combobox__input ${selected?.color ? "combobox__input--dotted" : ""}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-activedescendant={open && visible[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : selected?.label ?? ""}
        onChange={(e) => {
          if (!open) openList();
          setQuery(e.target.value);
          setActiveIndex(0);
        }}
        onMouseDown={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      />
      <span className="combobox__caret" aria-hidden="true">▾</span>
      {open && (
        <ul className="combobox__list" id={listId} role="listbox" ref={listRef} aria-label={ariaLabel}>
          {visible.length === 0 && <li className="combobox__empty">No matches</li>}
          {visible.map((option, i) => (
            <li
              key={option.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={option.value === value}
              data-active={i === activeIndex}
              className={`combobox__option ${option.isAction ? "combobox__option--action" : ""} ${
                i === activeIndex ? "combobox__option--active" : ""
              }`}
              // Keeps focus in the input so the blur handler doesn't close the
              // list out from under the click that is selecting an option.
              onMouseDown={(e) => { e.preventDefault(); commit(option); }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {option.color && (
                <span className="combobox__dot combobox__dot--inline" style={{ background: option.color }} aria-hidden="true" />
              )}
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
