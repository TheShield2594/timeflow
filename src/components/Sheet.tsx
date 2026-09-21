import React, { useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface Props {
  /** The dialog's accessible name. */
  label: string;
  onClose: () => void;
  /** Backdrop clicks and Esc are ignored while true — a save in flight must
   *  not be able to lose its own sheet. */
  busy?: boolean;
  /**
   * Make the backdrop inert without disabling Esc or the footer's own way out.
   *
   * A backdrop click is the one dismissal nobody ever aims: it is what a
   * mis-aimed click at the sheet's edge lands on. On a sheet with typed work
   * in it, the right answer is to do nothing rather than to throw the work
   * away — or to ask a question the user never meant to raise (#104).
   */
  keepOnBackdropClick?: boolean;
  /**
   * Make Esc inert as well. For a sheet whose dismissal would report
   * something that isn't true, such as the stop sheet saying "Saved" over
   * corrections it's about to drop.
   */
  keepOnEscape?: boolean;
  /**
   * The sheet asks a question and only its own answers close it: Esc and the
   * backdrop both do nothing. For the prompts where every way out commits an
   * outcome (keep idle time, accept a 12h entry), so the outcome has to be
   * chosen rather than fallen into.
   */
  requireChoice?: boolean;
  narrow?: boolean;
  children: React.ReactNode;
}

/**
 * The app's one dismissible surface.
 *
 * A sheet is the only content container that earns a material, because it is
 * the only one that floats over something else. Esc and backdrop-click both
 * dismiss — there is no close button, because a sheet whose footer already
 * carries Discard or Cancel does not need a third way out in the corner.
 */
export const Sheet: React.FC<Props> = ({
  label, onClose, busy, keepOnBackdropClick, keepOnEscape, requireChoice, narrow, children,
}) => {
  const ref = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A field inside the sheet that uses Esc for itself (backing out of a
      // new task name) marks the event handled; that Esc is not meant for
      // the sheet.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (!busy && !keepOnEscape && !requireChoice) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy, keepOnEscape, requireChoice]);

  return (
    <div className="sheet-backdrop" onClick={() => { if (!busy && !keepOnBackdropClick && !requireChoice) onClose(); }}>
      <div
        className={`sheet${narrow ? " sheet--narrow" : ""}`}
        ref={ref}
        role={requireChoice ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};
