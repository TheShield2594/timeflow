import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ToastKind = "info" | "success" | "error";

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (message: string, kind?: ToastKind) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

const TOAST_TTL_MS = 5000;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<ToastApi["push"]>((message, kind = "info") => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => dismiss(id), TOAST_TTL_MS);
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
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className={`toast toast--${toast.kind} ${shown ? "toast--shown" : ""}`} role="status">
      <span className="toast__message">{toast.message}</span>
      <button className="toast__close" onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  );
};
