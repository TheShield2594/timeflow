import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useFocusTrap } from "./useFocusTrap";

afterEach(cleanup);

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
