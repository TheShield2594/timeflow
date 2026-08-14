import { useEffect, useRef } from "react";

// `a[href]`, the media/iframe/summary entries and `[contenteditable]` are here
// even though no current dialog contains one: the trap wraps at the *last*
// focusable it can see, so anything it can't see is a hole the Tab key walks
// straight through (#103).
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'audio[controls]',
  'video[controls]',
  'iframe',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Make everything outside `el` inert for as long as the dialog is open, and
 * return the undo.
 *
 * The Tab handler below is bound to the dialog element, so it only fires while
 * focus is already inside it. Clicking a modal backdrop moves focus to
 * `<body>`, and from there the next Tab used to walk into the page *behind*
 * the dialog — which was still fully interactive, since nothing was `inert` or
 * `aria-hidden` (#103). Inert-ing the rest of the document closes that hole for
 * the mouse as well as the keyboard, and does it without the trap having to
 * predict every way focus can leave.
 *
 * Walking the ancestor chain rather than inert-ing a single `#root` keeps this
 * independent of where the dialog is mounted, so it holds for a portalled
 * dialog and in tests, where React renders into a bare container on `<body>`.
 *
 * `[data-inert-exempt]` opts an element out. The toast container carries it:
 * `inert` also removes content from the accessibility tree, and a save failing
 * *while a dialog is open* is exactly the announcement a user cannot afford to
 * lose.
 */
function inertOutside(el: HTMLElement): () => void {
  const marked: HTMLElement[] = [];
  for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement?.children ?? [])) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      // Nothing to make inert, and marking them just litters the DOM for
      // whoever inspects it next (Vite's module script is a sibling of #root).
      if (sibling.matches("script, style, link, meta, template, title")) continue;
      // Already inert: either a dialog stacked above this one marked it, or the
      // app did. Either way it isn't ours to un-mark on the way out.
      if (sibling.hasAttribute("inert") || sibling.hasAttribute("data-inert-exempt")) continue;
      sibling.setAttribute("inert", "");
      marked.push(sibling);
    }
  }
  return () => marked.forEach((n) => n.removeAttribute("inert"));
}

export function useFocusTrap<T extends HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement;
    const el = ref.current;
    if (!el) return;

    const focusable = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));

    const releaseInert = inertOutside(el);

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
      releaseInert();
      triggerRef.current?.focus();
    };
  }, []);

  return ref;
}
