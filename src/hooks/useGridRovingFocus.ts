/**
 * Roving tabindex for the week calendar's slot grid (#115).
 *
 * An ARIA grid has exactly one tabbable cell: Tab reaches the grid, arrows
 * move within it. That means the focused cell is React state *and* a DOM
 * focus call — arrow keys don't re-focus anything on their own, so moving the
 * cursor has to do both, and the two must not disagree.
 *
 * Extracted from CalendarPage because it is the one piece of that component
 * with no dependency on entries, projects, or the calendar at all: it is a
 * cursor over a rows × cols rectangle. Keeping it here makes the clamping
 * testable, which matters because an off-by-one at an edge is a cursor that
 * silently stops moving.
 */
import { useCallback, useRef, useState } from "react";
import type React from "react";

export interface Cell { row: number; col: number }

export interface GridRovingFocus {
  /** The single tabbable cell. */
  focused: Cell;
  /** Adopt a cell the user reached some other way (a click, a drag start). */
  setFocused: (cell: Cell) => void;
  /** Register a cell's element so focus can be moved onto it imperatively. */
  registerCell: (row: number, col: number, el: HTMLDivElement | null) => void;
  /**
   * Handle an arrow/Home/End keystroke. Returns true when it moved the
   * cursor, so the caller can leave every other key to its own handling.
   */
  onKeyDown: (e: React.KeyboardEvent, row: number, col: number) => boolean;
}

export function useGridRovingFocus(rows: number, cols: number, initial: Cell): GridRovingFocus {
  const [focused, setFocused] = useState<Cell>(initial);
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const registerCell = useCallback((row: number, col: number, el: HTMLDivElement | null) => {
    if (el) cellRefs.current.set(`${row}-${col}`, el);
    else cellRefs.current.delete(`${row}-${col}`);
  }, []);

  // Clamped rather than wrapped: an arrow at the edge of the week should sit
  // still, not jump to the far side of the grid or to another day.
  const moveFocus = useCallback((row: number, col: number) => {
    const clampedRow = Math.max(0, Math.min(row, rows - 1));
    const clampedCol = Math.max(0, Math.min(col, cols - 1));
    setFocused({ row: clampedRow, col: clampedCol });
    cellRefs.current.get(`${clampedRow}-${clampedCol}`)?.focus();
  }, [rows, cols]);

  const onKeyDown = useCallback((e: React.KeyboardEvent, row: number, col: number): boolean => {
    switch (e.key) {
      case "ArrowUp": moveFocus(row - 1, col); break;
      case "ArrowDown": moveFocus(row + 1, col); break;
      case "ArrowLeft": moveFocus(row, col - 1); break;
      case "ArrowRight": moveFocus(row, col + 1); break;
      case "Home": moveFocus(0, col); break;
      case "End": moveFocus(rows - 1, col); break;
      default: return false;
    }
    e.preventDefault();
    return true;
  }, [moveFocus, rows]);

  return { focused, setFocused, registerCell, onKeyDown };
}
