import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { IconX } from "../components/Icons";

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
// a realistic window to react.
const ACTION_TOAST_TTL_MS = 8000;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<ToastApi["push"]>((message, kind = "info", action) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, kind, action }]);
    setTimeout(() => dismiss(id), action ? ACTION_TOAST_TTL_MS : TOAST_TTL_MS);
  }, [dismiss]);

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

const ToastContainer: React.FC<{ toasts: Toast[]; onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: Toast; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  // Mount-in animation via CSS class toggle on next frame
  const [shown, setShown] = useState(false);
  // Single-shot guard: a fast double-click must not run the action (e.g. an
  // undo re-create) twice before React removes the toast.
  const actionFired = useRef(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
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
    <div className={`toast toast--${toast.kind} ${shown ? "toast--shown" : ""}`} role="status">
      <span className="toast__message">{toast.message}</span>
      {toast.action && (
        <button className="toast__action" onClick={handleAction}>
          {toast.action.label}
        </button>
      )}
      <button className="toast__close" onClick={onDismiss} aria-label="Dismiss"><IconX size={14} /></button>
    </div>
  );
};
