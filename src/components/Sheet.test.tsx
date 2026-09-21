/**
 * How a sheet can be dismissed is a question about what the dismissal
 * commits. On the idle and 12h prompts every way out commits an outcome, so a
 * stray Esc or a mis-aimed click must not choose one on the user's behalf.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Sheet } from "./Sheet";

afterEach(cleanup);

function renderSheet(props: Partial<React.ComponentProps<typeof Sheet>> = {}) {
  const onClose = vi.fn();
  render(
    <Sheet label="Test sheet" onClose={onClose} {...props}>
      <input aria-label="Field" />
    </Sheet>
  );
  return onClose;
}

const backdrop = () => document.querySelector(".sheet-backdrop")!;

describe("Sheet dismissal", () => {
  it("closes on Esc and on the backdrop by default", () => {
    const onClose = renderSheet();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("ignores both when the sheet requires a choice, and says so to assistive tech", () => {
    const onClose = renderSheet({ requireChoice: true });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(backdrop());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("keepOnEscape holds Esc but leaves the backdrop alone", () => {
    const onClose = renderSheet({ keepOnEscape: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves an Esc a field inside already handled", () => {
    // Backing out of the new-task name is that field's Esc, not the sheet's.
    const onClose = renderSheet();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(onClose).not.toHaveBeenCalled();
  });
});
