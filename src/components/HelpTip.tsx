import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconHelp } from "./Icons";

interface Props {
  /** Explanation shown in the popover. */
  text: string;
  /** Accessible name for the trigger button, e.g. "What is Ratio?". */
  label: string;
  /**
   * A neighbouring control the tip also explains — hovering it reveals the
   * same popover, positioned under that control rather than under the "?".
   * For a control whose own name can't carry the explanation, like the focus
   * chip (#84): hover is where people look for it first, and the "?" stays
   * the route for touch and keyboard.
   */
  hoverAnchorRef?: React.RefObject<HTMLElement | null>;
}

const POPOVER_WIDTH = 240;

/** Click-to-reveal "?" icon — for form fields whose meaning isn't obvious
 *  from the label alone. Rendered via a portal (not a hover title) so it's
 *  reachable on touch and doesn't get clipped by an ancestor's overflow. */
export const HelpTip: React.FC<Props> = ({ text, label, hoverAnchorRef }) => {
  // Two independent reasons to be open, because they close differently: a
  // click pins the bubble until it's dismissed, a hover only lasts as long as
  // the pointer does. Collapsing them into one flag made moving the pointer
  // off the chip close a popover the user had deliberately clicked open.
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState<"trigger" | "anchor" | null>(null);
  const open = pinned || hovered !== null;
  const [pos, setPos] = useState({ top: 0, left: 0, caretLeft: POPOVER_WIDTH / 2 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  const close = useCallback(() => {
    setPinned(false);
    setHovered(null);
  }, []);

  // The bubble hangs off whatever opened it, so the caret points at the thing
  // the user actually pointed at.
  const anchorEl = hovered === "anchor" ? hoverAnchorRef?.current ?? null : btnRef.current;

  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    // Center the bubble on the trigger, clamped to the viewport — and to the
    // host dialog when the tip lives inside one, so it never spills over the
    // modal's edge onto the dimmed backdrop.
    const host = anchorEl.closest('[role="dialog"]')?.getBoundingClientRect();
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
  }, [open, anchorEl]);

  // Hover on the neighbouring control. Bound here rather than via props
  // because that control belongs to the caller's markup, not this component's.
  useEffect(() => {
    const anchor = hoverAnchorRef?.current;
    if (!anchor) return;
    const enter = () => setHovered("anchor");
    // Only the hover half is dropped: a bubble the user clicked open stays.
    const leave = () => setHovered((h) => (h === "anchor" ? null : h));
    anchor.addEventListener("mouseenter", enter);
    anchor.addEventListener("mouseleave", leave);
    return () => {
      anchor.removeEventListener("mouseenter", enter);
      anchor.removeEventListener("mouseleave", leave);
    };
  }, [hoverAnchorRef]);

  useEffect(() => {
    if (!open) return;
    // Capture phase + stopPropagation so Escape closes just this popover.
    // Without it, a host dialog's own window-level Escape handler (e.g.
    // EntryModal) fires too and tears down the whole form underneath us.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    const inside = (target: Node) =>
      btnRef.current?.contains(target) ||
      popoverRef.current?.contains(target) ||
      hoverAnchorRef?.current?.contains(target);
    // mousedown, not click — so this fires before the click that opened it
    // (from a different trigger) could otherwise immediately reopen it.
    const onOutside = (e: MouseEvent) => {
      if (inside(e.target as Node)) return;
      close();
    };
    // Tabbing away from the trigger doesn't fire a mousedown, so without this
    // the popover stays open — orphaned — once keyboard focus has moved on.
    const onFocusIn = (e: FocusEvent) => {
      if (inside(e.target as Node)) return;
      close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onOutside);
    window.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onOutside);
      window.removeEventListener("focusin", onFocusIn);
    };
  }, [open, close, hoverAnchorRef]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="help-tip__btn"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        onClick={(e) => { e.stopPropagation(); setPinned((p) => !p); setHovered(null); }}
        onMouseEnter={() => setHovered("trigger")}
        onMouseLeave={() => setHovered((h) => (h === "trigger" ? null : h))}
      >
        <IconHelp size={16} />
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
