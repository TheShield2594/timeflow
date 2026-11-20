/**
 * The day bar is two controls in one strip: a track you drag across to log a
 * span, and gap segments you click to fill. They share pointer events, and
 * the track winning that contest left the gap buttons dead to a mouse while
 * every `fireEvent.click` test stayed green — so this asserts on the pointer
 * path, not the click.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DayBarTrack } from "./DayBar";
import type { BarSpan } from "../utils/dayBar";

const spans: BarSpan[] = [
  { key: "e", startMin: 8 * 60, endMin: 9 * 60, kind: "entry", color: "#719500", label: "Entry" } as BarSpan,
  { key: "g", startMin: 9 * 60, endMin: 11 * 60, kind: "gap", label: "2h untracked" } as BarSpan,
];

// jsdom has no pointer capture; the spy stands in for the thing a real
// browser does that reroutes the click.
const capture = vi.fn();
beforeEach(() => { HTMLElement.prototype.setPointerCapture = capture; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderTrack() {
  const onFillGap = vi.fn();
  const onDragFill = vi.fn();
  render(<DayBarTrack spans={spans} windowStart={8 * 60} windowEnd={18 * 60} onFillGap={onFillGap} onDragFill={onDragFill} />);
  return { onFillGap, onDragFill };
}

describe("DayBarTrack", () => {
  it("doesn't let the track capture a press that lands on a gap", () => {
    const { onFillGap } = renderTrack();
    const gap = screen.getByRole("button", { name: /Log the untracked time/ });

    fireEvent.pointerDown(gap, { button: 0, pointerId: 1 });
    // Captured, the click that follows goes to the track and the gap never
    // hears it.
    expect(capture).not.toHaveBeenCalled();

    fireEvent.click(gap);
    expect(onFillGap).toHaveBeenCalledWith(9 * 60, 11 * 60);
  });

  it("still starts a drag from a press on the track itself", () => {
    renderTrack();
    const track = screen.getByRole("button", { name: /Log the untracked time/ }).parentElement!;
    fireEvent.pointerDown(track, { button: 0, pointerId: 1 });
    expect(capture).toHaveBeenCalledWith(1);
  });
});
