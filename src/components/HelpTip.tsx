import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconHelp } from "./Icons";

interface Props {
  /** Explanation shown in the popover. */
  text: string;
  /** Accessible name for the trigger button, e.g. "What is Ratio?". */
  label: string;
}

const POPOVER_WIDTH = 240;

/** Click-to-reveal "?" icon — for form fields whose meaning isn't obvious
 *  from the label alone. Rendered via a portal (not a hover title) so it's
 *  reachable on touch and doesn't get clipped by an ancestor's overflow. */
export const HelpTip: React.FC<Props> = ({ text, label }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, caretLeft: POPOVER_WIDTH / 2 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    // Center the bubble on the trigger, clamped to the viewport — and to the
    // host dialog when the tip lives inside one, so it never spills over the
    // modal's edge onto the dimmed backdrop.
    const host = btnRef.current.closest('[role="dialog"]')?.getBoundingClientRect();
    const minLeft = host ? Math.max(8, host.left + 8) : 8;
    const maxLeft = Math.min(host ? host.right : window.innerWidth, window.innerWidth) - POPOVER_WIDTH - 12;
    const centered = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
    const left = Math.max(minLeft, Math.min(centered, maxLeft));
    setPos({
      top: rect.bottom + 8,
      left,
      // Caret follows the trigger, kept clear of the bubble's rounded corners.
      caretLeft: Math.max(12, Math.min(rect.left + rect.width / 2 - left, POPOVER_WIDTH - 12)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Capture phase + stopPropagation so Escape closes just this popover.
    // Without it, a host dialog's own window-level Escape handler (e.g.
    // EntryModal) fires too and tears down the whole form underneath us.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    // mousedown, not click — so this fires before the click that opened it
    // (from a different trigger) could otherwise immediately reopen it.
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Tabbing away from the trigger doesn't fire a mousedown, so without this
    // the popover stays open — orphaned — once keyboard focus has moved on.
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onOutside);
    window.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onOutside);
      window.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="help-tip__btn"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <IconHelp size={13} />
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          className="help-tip__popover"
          role="tooltip"
          style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
        >
          <span className="help-tip__caret" style={{ left: pos.caretLeft }} aria-hidden="true" />
          {text}
        </div>,
        document.body
      )}
    </>
  );
};
