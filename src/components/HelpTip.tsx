import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 12);
    setPos({ top: rect.bottom + 6, left: Math.max(8, left) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // mousedown, not click — so this fires before the click that opened it
    // (from a different trigger) could otherwise immediately reopen it.
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onOutside);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onOutside);
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
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <IconHelp size={13} />
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          className="help-tip__popover"
          role="tooltip"
          style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
};
