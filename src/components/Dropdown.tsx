import React, { forwardRef, useEffect, useId, useRef, useState } from "react";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** A leading dot in the project's own colour. Colour is data: only pass this
   *  for a value whose colour *means* something (a project), never as decoration. */
  color?: string;
}

interface DropdownProps<T extends string> {
  options: DropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the control for the reader — there is no visible <label> element. */
  ariaLabel: string;
  /** Shown, in the secondary colour, when `value` matches no option. */
  placeholder?: string;
  /** `inline` is a filter that sits in a line of text (Sort ·, Rounding ·);
   *  `chip` is a standalone control the size of the thing beside it. */
  variant?: "inline" | "chip";
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
  /** Open downward, or upward when the trigger sits near the bottom (the
   *  floating action bar). */
  direction?: "down" | "up";
  className?: string;
}

/**
 * The app's one dropdown.
 *
 * `SegmentedControl` is still the right control wherever the alternatives are
 * worth showing at rest; this is for the cases where they aren't — a sort key,
 * an export-rounding rule, a project picked from a list too long to lay flat.
 * It is a button and a listbox, not a native <select>, so the open menu can
 * carry a project's colour dot and earn the same material as a sheet. Keyboard
 * and click-outside behave the way a <select> would.
 */
function DropdownInner<T extends string>(
  {
    options,
    value,
    onChange,
    ariaLabel,
    placeholder,
    variant = "inline",
    align = "start",
    direction = "down",
    className = "",
  }: DropdownProps<T>,
  ref: React.ForwardedRef<HTMLButtonElement>,
) {
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex < 0 ? 0 : selectedIndex);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ query: "", at: 0 });
  const baseId = useId();

  // Merge the forwarded ref (TimerPage focuses the trigger on a nonce) with the
  // one we keep for returning focus after a selection.
  const setTriggerRef = (node: HTMLButtonElement | null) => {
    triggerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node;
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Opening lands on the current selection, not the top of the list.
  useEffect(() => {
    if (open) setActiveIndex(selectedIndex < 0 ? 0 : selectedIndex);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const openAt = (index: number) => {
    setOpen(true);
    setActiveIndex(index);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) openAt(selectedIndex < 0 ? 0 : selectedIndex);
        else setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        if (!open) openAt(selectedIndex < 0 ? options.length - 1 : selectedIndex);
        else setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      case "Home":
        if (open) { event.preventDefault(); setActiveIndex(0); }
        return;
      case "End":
        if (open) { event.preventDefault(); setActiveIndex(options.length - 1); }
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) commit(activeIndex);
        else setOpen(true);
        return;
      case "Escape":
        if (open) { event.preventDefault(); setOpen(false); }
        return;
      case "Tab":
        if (open) setOpen(false);
        return;
      default:
        break;
    }

    // Type-ahead: jump the highlight to the next label starting with what was
    // typed, the way a native select does.
    if (event.key.length === 1 && /\S/.test(event.key)) {
      const now = Date.now();
      const state = typeahead.current;
      state.query = now - state.at > 600 ? event.key : state.query + event.key;
      state.at = now;
      const query = state.query.toLowerCase();
      const from = open ? activeIndex : Math.max(selectedIndex, 0);
      for (let step = 1; step <= options.length; step++) {
        const index = (from + step) % options.length;
        if (options[index].label.toLowerCase().startsWith(query)) {
          if (open) setActiveIndex(index);
          else openAt(index);
          break;
        }
      }
    }
  };

  return (
    <div
      ref={wrapperRef}
      className={`dropdown${className ? ` ${className}` : ""}`}
      data-open={open}
    >
      <button
        ref={setTriggerRef}
        type="button"
        className={`dropdown__trigger dropdown__trigger--${variant}${selected ? "" : " dropdown__trigger--empty"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-activedescendant={open ? `${baseId}-opt-${activeIndex}` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
      >
        {selected?.color !== undefined && (
          <span className="dot" style={{ "--pc": selected.color } as React.CSSProperties} />
        )}
        <span className="dropdown__value">{selected ? selected.label : placeholder ?? ""}</span>
        <svg
          className="dropdown__chev"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          className={`dropdown__menu dropdown__menu--${direction} dropdown__menu--${align}`}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${baseId}-opt-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`dropdown__option${index === activeIndex ? " dropdown__option--active" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(index)}
            >
              {option.color !== undefined && (
                <span className="dot" style={{ "--pc": option.color } as React.CSSProperties} />
              )}
              <span className="dropdown__option-label">{option.label}</span>
              {option.value === value && (
                <svg
                  className="dropdown__check"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// forwardRef drops the generic, so re-assert it: the exported Dropdown stays
// generic over the option value type while still forwarding a button ref.
export const Dropdown = forwardRef(DropdownInner) as <T extends string>(
  props: DropdownProps<T> & { ref?: React.ForwardedRef<HTMLButtonElement> },
) => React.ReactElement;
