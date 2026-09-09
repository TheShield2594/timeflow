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
export const Sheet: React.FC<Props> = ({ label, onClose, busy, keepOnBackdropClick, narrow, children }) => {
  const ref = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <div className="sheet-backdrop" onClick={() => { if (!busy && !keepOnBackdropClick) onClose(); }}>
      <div
        className={`sheet${narrow ? " sheet--narrow" : ""}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};
