import React, { useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface BreakPromptProps {
  kind: "break";
  sessionsToday: number;
  breakMinutes: number;
  onTakeBreak: () => void;
  onKeepGoing: () => void;
}

interface ResumePromptProps {
  kind: "resume";
  canContinue: boolean;
  onContinue: () => void;
  onDismiss: () => void;
}

type Props = BreakPromptProps | ResumePromptProps;

/**
 * Focus-mode boundary prompts (see useFocusMode): "block complete" while the
 * timer is still running, and "break's over" once the break countdown ends.
 * Modeled on IdleModal — a small blocking dialog, since the whole point of
 * the cadence is to interrupt.
 */
export const FocusModal: React.FC<Props> = (props) => {
  const modalRef = useFocusTrap<HTMLDivElement>();
  // Escape = the non-committal option, exactly as IdleModal binds it to "Keep
  // running". The interruption is the point of this dialog, so neither branch
  // gets a ✕ — but a dialog with *no* way out at all breaks the expectation
  // every other dialog in the app sets (#103).
  const onEscape = props.kind === "break" ? props.onKeepGoing : props.onDismiss;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);

  return (
    <div
      className="modal-backdrop"
      // Backdrop clicks don't dismiss this dialog, so without this they would
      // just blur the focused control down to <body> — outside the trap (#103).
      onMouseDown={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
    >
      <div className="cal-modal focus-modal" ref={modalRef} role="dialog" aria-modal="true"
        aria-label={props.kind === "break" ? "Focus block complete" : "Break finished"}>
        {props.kind === "break" ? (
          <>
            <div className="cal-modal__header">
              <h3 className="cal-modal__title">Focus block complete</h3>
            </div>
            <div className="cal-modal__body">
              <p className="focus-modal__msg">
                That&rsquo;s {props.sessionsToday} focus {props.sessionsToday === 1 ? "block" : "blocks"} today.
                Taking a break stops the timer and saves your entry; the timer bar counts the break down.
              </p>
            </div>
            <div className="cal-modal__footer">
              <button className="btn-primary" data-autofocus onClick={props.onTakeBreak}>
                Take a {props.breakMinutes}-min break
              </button>
              <button className="btn-ghost" onClick={props.onKeepGoing}>Keep going</button>
            </div>
          </>
        ) : (
          <>
            <div className="cal-modal__header">
              <h3 className="cal-modal__title">Break&rsquo;s over</h3>
            </div>
            <div className="cal-modal__body">
              <p className="focus-modal__msg">
                {props.canContinue
                  ? "Ready for the next focus block? Continue restarts the timer on what you were working on."
                  : "Ready for the next focus block? Start the timer when you are."}
              </p>
            </div>
            <div className="cal-modal__footer">
              {props.canContinue && (
                <button className="btn-primary" data-autofocus onClick={props.onContinue}>
                  Start next focus block
                </button>
              )}
              <button className="btn-ghost" onClick={props.onDismiss}>
                {props.canContinue ? "Not now" : "OK"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
