import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type ToastKind = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  onAction: () => void;
}

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

interface ToastApi {
  push: (message: string, kind?: ToastKind, action?: ToastAction) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

const TOAST_TTL_MS = 5000;
// Toasts carrying an action (e.g. Undo) stick around longer so the user has
// a realistic window to react. Even 8s is tight for someone reading with a
// screen reader before deciding, which is why the countdown pauses on hover
// and focus (WCAG 2.2.1) rather than being lengthened further for everyone.
const ACTION_TOAST_TTL_MS = 8000;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * One toast at a time, replaced by the next.
   *
   * No timer is armed here: each toast owns its own dismissal countdown so it
   * can be paused, and so unmounting the toast clears it instead of leaving a
   * setState-after-unmount pending.
   *
   * A stack of toasts is a queue of things the user is being told while they
   * are trying to do something else. Anything they must actually act on is
   * not a toast at all — it's the failed-save hero or the isolation banner —
   * so replacing rather than stacking loses nothing but the pile.
   */
  const push = useCallback<ToastApi["push"]>((message, kind = "info", action) => {
    setToasts([{ id: crypto.randomUUID(), message, kind, action }]);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastCtx.Provider>
  );
};

export function useToast(): ToastApi["push"] {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx.push;
}

/**
 * Both regions are rendered unconditionally, even with nothing in them.
 *
 * Assistive technology only announces a live region that was already in the
 * accessibility tree when its content changed; a region inserted *together
 * with* its text is widely not announced at all — the classic toast bug across
 * NVDA, JAWS and VoiceOver. The container used to return `null` while empty,
 * so every toast created its own region and arrived silently (#100).
 *
 * `data-inert-exempt` keeps the regions out of the `inert` blanket a modal
 * throws over the rest of the document (see useFocusTrap): a save failing
 * behind an open dialog still has to be announced.
 */
const ToastContainer: React.FC<{ toasts: Toast[]; onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => {
  // Failures get an assertive region. `role="status"` is polite, so a failed
  // save queued behind whatever the user was already doing — or was dropped.
  const polite = toasts.filter((t) => t.kind !== "error");
  const assertive = toasts.filter((t) => t.kind === "error");
  const items = (list: Toast[]) =>
    list.map((t) => <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />);

  return (
    <div className="toast-container" data-inert-exempt>
      <div className="toast-region" role="status" aria-live="polite">{items(polite)}</div>
      <div className="toast-region" role="alert" aria-live="assertive">{items(assertive)}</div>
    </div>
  );
};

const ToastItem: React.FC<{ toast: Toast; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  // Mount-in animation via CSS class toggle on next frame
  const [shown, setShown] = useState(false);
  // Hover or keyboard focus holds the toast open — the Undo window is short,
  // and reaching for Undo should not be what makes it disappear (WCAG 2.2.1).
  const [held, setHeld] = useState(false);
  // Single-shot guard: a fast double-click must not run the action (e.g. an
  // undo re-create) twice before React removes the toast.
  const actionFired = useRef(false);

  // Read through refs so re-renders (and the inline onDismiss closure the
  // container hands us) never restart the countdown.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const remainingRef = useRef(toast.action ? ACTION_TOAST_TTL_MS : TOAST_TTL_MS);
  const resumedAtRef = useRef(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (held) {
      // Bank what was left, so releasing resumes rather than restarting.
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - resumedAtRef.current));
      return;
    }
    resumedAtRef.current = Date.now();
    const id = setTimeout(() => dismissRef.current(), remainingRef.current);
    return () => clearTimeout(id);
  }, [held]);

  const handleAction = () => {
    if (actionFired.current) return;
    actionFired.current = true;
    try {
      toast.action!.onAction();
    } finally {
      onDismiss();
    }
  };

  return (
    <div
      className={`toast toast--${toast.kind} ${shown ? "toast--shown" : ""}`}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      {/* Three shapes, one row: a dot for the ones reporting an outcome, the
          message, and the action if there is one. No close button — a toast
          that needs dismissing is a toast that should have been something
          else. */}
      {toast.kind !== "info" && (
        <span className={`toast__dot${toast.kind === "error" ? " toast__dot--warn" : ""}`} />
      )}
      <span className="toast__message">{toast.message}</span>
      {toast.action && (
        <button className="toast__action" onClick={handleAction}>
          {toast.action.label}
        </button>
      )}
    </div>
  );
};
