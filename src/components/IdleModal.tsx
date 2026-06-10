import React, { useEffect } from "react";
import { formatElapsed } from "../hooks";

interface Props {
  lastActiveAt: number;
  startTime: string;
  onTrim: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}

function timeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
}

export const IdleModal: React.FC<Props> = ({ lastActiveAt, startTime, onTrim, onKeep, onDiscard }) => {
  // Escape = "keep running" — the least destructive choice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onKeep();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKeep]);

  const idleSeconds = Math.floor((Date.now() - lastActiveAt) / 1000);
  const sessionSeconds = Math.floor((lastActiveAt - new Date(startTime).getTime()) / 1000);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="idle-modal-title">
      <div className="idle-modal">
        <h3 id="idle-modal-title" className="idle-modal__title">You've been idle for {formatElapsed(idleSeconds)}</h3>
        <p className="idle-modal__body">
          The timer has been running, but there's been no activity since <strong>{timeOfDay(lastActiveAt)}</strong>.
          You'd logged <strong>{formatElapsed(sessionSeconds)}</strong> of work before going idle.
        </p>
        <div className="idle-modal__actions">
          <button className="btn-primary" onClick={onTrim}>
            Trim to {timeOfDay(lastActiveAt)}
          </button>
          <button className="btn-ghost" onClick={onKeep}>
            Keep running
          </button>
          <button className="idle-modal__discard" onClick={onDiscard}>
            Discard session
          </button>
        </div>
      </div>
    </div>
  );
};
