import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useFocusTrap } from "./useFocusTrap";

afterEach(cleanup);

const Dialog: React.FC<{ withDesignated: boolean }> = ({ withDesignated }) => {
  const ref = useFocusTrap<HTMLDivElement>();
  return (
    <div ref={ref} role="dialog">
      {/* The header Close button precedes the body inputs, mirroring EntryModal. */}
      <button aria-label="Close">x</button>
      <input aria-label="Description" {...(withDesignated ? { "data-autofocus": true } : {})} />
    </div>
  );
};

describe("useFocusTrap initial focus", () => {
  it("focuses the [data-autofocus] target rather than the first focusable (the Close button)", () => {
    render(<Dialog withDesignated />);
    expect(document.activeElement).toBe(screen.getByLabelText("Description"));
  });

  it("falls back to the first focusable element when nothing is designated", () => {
    render(<Dialog withDesignated={false} />);
    expect(document.activeElement).toBe(screen.getByLabelText("Close"));
  });
});
