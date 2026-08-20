/**
 * The grid cursor (#115). Clamping is what's worth pinning: an off-by-one at
 * an edge is a cursor that silently stops moving, and nothing about the
 * rendered grid makes that visible.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useGridRovingFocus } from "./useGridRovingFocus";

const ROWS = 48;
const COLS = 7;

/** A keyboard event just real enough for the hook. */
function key(name: string) {
  return { key: name, preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
}

function setup(initial = { row: 14, col: 0 }) {
  return renderHook(() => useGridRovingFocus(ROWS, COLS, initial));
}

afterEach(cleanup);

describe("useGridRovingFocus", () => {
  it("starts on the cell it was given", () => {
    const { result } = setup();
    expect(result.current.focused).toEqual({ row: 14, col: 0 });
  });

  it("moves one cell per arrow key and claims the keystroke", () => {
    const { result } = setup();
    const e = key("ArrowDown");

    let handled = false;
    act(() => { handled = result.current.onKeyDown(e, 14, 0); });

    expect(handled).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(result.current.focused).toEqual({ row: 15, col: 0 });

    act(() => { result.current.onKeyDown(key("ArrowRight"), 15, 0); });
    expect(result.current.focused).toEqual({ row: 15, col: 1 });
  });

  it("jumps to the top and bottom of the day with Home and End", () => {
    const { result } = setup({ row: 20, col: 3 });

    act(() => { result.current.onKeyDown(key("Home"), 20, 3); });
    expect(result.current.focused).toEqual({ row: 0, col: 3 });

    act(() => { result.current.onKeyDown(key("End"), 0, 3); });
    expect(result.current.focused).toEqual({ row: ROWS - 1, col: 3 });
  });

  it("clamps at every edge instead of wrapping", () => {
    // Wrapping would carry the cursor from Monday 00:00 to Sunday 23:30,
    // which reads as the grid losing focus rather than moving it.
    const { result } = setup({ row: 0, col: 0 });

    act(() => { result.current.onKeyDown(key("ArrowUp"), 0, 0); });
    expect(result.current.focused).toEqual({ row: 0, col: 0 });

    act(() => { result.current.onKeyDown(key("ArrowLeft"), 0, 0); });
    expect(result.current.focused).toEqual({ row: 0, col: 0 });

    act(() => { result.current.onKeyDown(key("ArrowRight"), 0, COLS - 1); });
    expect(result.current.focused).toEqual({ row: 0, col: COLS - 1 });

    act(() => { result.current.onKeyDown(key("ArrowDown"), ROWS - 1, 0); });
    expect(result.current.focused).toEqual({ row: ROWS - 1, col: 0 });
  });

  it("leaves every other key alone for the caller to handle", () => {
    const { result } = setup();
    const e = key("Enter");

    let handled = true;
    act(() => { handled = result.current.onKeyDown(e, 14, 0); });

    expect(handled).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(result.current.focused).toEqual({ row: 14, col: 0 });
  });

  it("focuses the registered element it moves onto", () => {
    const { result } = setup();
    const el = document.createElement("div");
    el.tabIndex = 0;
    document.body.appendChild(el);
    act(() => { result.current.registerCell(15, 0, el); });

    // Arrow keys don't re-focus anything on their own — moving the cursor has
    // to do the DOM call too, or Tab order and the visible cursor disagree.
    act(() => { result.current.onKeyDown(key("ArrowDown"), 14, 0); });
    expect(document.activeElement).toBe(el);

    act(() => { result.current.registerCell(15, 0, null) });
    el.remove();
  });
});
