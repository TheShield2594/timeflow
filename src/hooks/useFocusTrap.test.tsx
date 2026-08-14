import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useFocusTrap } from "./useFocusTrap";

const strays: HTMLElement[] = [];
afterEach(() => {
  cleanup();
  strays.splice(0).forEach((el) => el.remove());
});

/** A sibling of the dialog's tree, standing in for the page behind it. */
function appendOutside(attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("div");
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  el.innerHTML = "<button>Behind the modal</button>";
  document.body.appendChild(el);
  strays.push(el);
  return el;
}

type InitialFocus = "designated" | "autofocus" | "none";

const Dialog: React.FC<{ initialFocus: InitialFocus }> = ({ initialFocus }) => {
  const ref = useFocusTrap<HTMLDivElement>();
  return (
    <div ref={ref} role="dialog">
      {/* The header Close button precedes the body inputs, mirroring EntryModal. */}
      <button aria-label="Close">x</button>
      <input
        aria-label="Description"
        {...(initialFocus === "designated" ? { "data-autofocus": true } : {})}
        {...(initialFocus === "autofocus" ? { autoFocus: true } : {})}
      />
    </div>
  );
};

describe("useFocusTrap initial focus", () => {
  it("focuses the [data-autofocus] target rather than the first focusable (the Close button)", () => {
    render(<Dialog initialFocus="designated" />);
    expect(document.activeElement).toBe(screen.getByLabelText("Description"));
  });

  it("respects React autoFocus already inside the modal (does not steal focus to the Close button)", () => {
    render(<Dialog initialFocus="autofocus" />);
    expect(document.activeElement).toBe(screen.getByLabelText("Description"));
  });

  it("falls back to the first focusable element when nothing is designated", () => {
    render(<Dialog initialFocus="none" />);
    expect(document.activeElement).toBe(screen.getByLabelText("Close"));
  });
});

describe("useFocusTrap inert backdrop", () => {
  // The Tab handler is bound to the dialog, so it only fires while focus is
  // already inside. A backdrop click drops focus to <body>, and the page
  // behind used to be fully interactive from there — for the mouse too.
  it("makes the rest of the document inert while the dialog is open", () => {
    const behind = appendOutside();
    render(<Dialog initialFocus="designated" />);
    expect(behind.hasAttribute("inert")).toBe(true);
  });

  it("releases the inert markers when the dialog closes", () => {
    const behind = appendOutside();
    const { unmount } = render(<Dialog initialFocus="designated" />);
    unmount();
    expect(behind.hasAttribute("inert")).toBe(false);
  });

  it("leaves an element inert that was already inert before the dialog opened", () => {
    const behind = appendOutside({ inert: "" });
    const { unmount } = render(<Dialog initialFocus="designated" />);
    unmount();
    expect(behind.hasAttribute("inert")).toBe(true);
  });

  // inert also strips content from the accessibility tree, so the toast
  // regions opt out — a save failing behind an open dialog still has to be
  // announced.
  it("exempts [data-inert-exempt] regions so toasts can still announce", () => {
    const toasts = appendOutside({ "data-inert-exempt": "" });
    render(<Dialog initialFocus="designated" />);
    expect(toasts.hasAttribute("inert")).toBe(false);
  });
});

const LinkDialog: React.FC = () => {
  const ref = useFocusTrap<HTMLDivElement>();
  return (
    <div ref={ref} role="dialog">
      <button data-autofocus>First</button>
      <a href="#docs">Docs</a>
    </div>
  );
};

describe("useFocusTrap focusable selector", () => {
  // A focusable the selector can't see isn't just skipped — it's where the
  // wrap-around stops happening, and Tab walks out of the dialog.
  it("counts a trailing link, so Tab wraps rather than leaving the dialog", () => {
    render(<LinkDialog />);
    const link = screen.getByRole("link", { name: "Docs" });
    link.focus();
    fireEvent.keyDown(link, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
  });
});
