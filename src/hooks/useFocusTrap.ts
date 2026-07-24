import { useEffect, useRef } from "react";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap<T extends HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement;
    const el = ref.current;
    if (!el) return;

    const focusable = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));

    // Move focus into the modal. Prefer an explicitly designated initial-focus
    // target (`[data-autofocus]`) so focus lands on the first real input — the
    // first *focusable* element is usually the header Close button, and landing
    // there means a keyboard user's opening Enter dismisses the dialog instead
    // of typing. If none is designated but React's autoFocus already moved focus
    // inside the modal, respect it; otherwise fall back to the first focusable.
    const designated = el.querySelector<HTMLElement>("[data-autofocus]");
    if (designated) designated.focus();
    else if (!el.contains(document.activeElement)) focusable()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = focusable();
      if (!els.length) { e.preventDefault(); return; }
      const firstEl = els[0];
      const lastEl = els[els.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      } else {
        if (document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    };

    el.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
  }, []);

  return ref;
}
