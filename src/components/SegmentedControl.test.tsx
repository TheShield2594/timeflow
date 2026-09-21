/**
 * The control announces itself as a radio group, so it has to behave like one:
 * a single tab stop, and the arrow keys move the selection.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SegmentedControl } from "./SegmentedControl";

afterEach(cleanup);

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
] as const;

function renderControl(value: "a" | "b" | "c" = "a") {
  const onChange = vi.fn();
  render(<SegmentedControl ariaLabel="Scope" options={[...OPTIONS]} value={value} onChange={onChange} />);
  return onChange;
}

describe("SegmentedControl", () => {
  it("is one tab stop, on the selected option", () => {
    renderControl("b");
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    expect(screen.getByRole("radio", { name: "Beta" }).getAttribute("aria-checked")).toBe("true");
  });

  it("moves and selects with the arrow keys, wrapping at the ends", () => {
    const onChange = renderControl("c");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Gamma" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("a");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Gamma" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("b");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Gamma" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("a");
  });
});
