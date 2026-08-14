import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FocusModal } from "./FocusModal";

afterEach(cleanup);

describe("FocusModal Escape", () => {
  // The interruption is the point of this dialog, so it has no ✕ — but a
  // dialog with no way out at all breaks the expectation every other dialog
  // in the app sets. Escape takes the non-committal branch, as in IdleModal.
  it("keeps going rather than committing to a break", () => {
    const onTakeBreak = vi.fn();
    const onKeepGoing = vi.fn();
    render(
      <FocusModal kind="break" sessionsToday={2} breakMinutes={5}
        onTakeBreak={onTakeBreak} onKeepGoing={onKeepGoing} />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onKeepGoing).toHaveBeenCalledTimes(1);
    expect(onTakeBreak).not.toHaveBeenCalled();
  });

  it("dismisses the break-over prompt rather than starting the next block", () => {
    const onContinue = vi.fn();
    const onDismiss = vi.fn();
    render(<FocusModal kind="resume" canContinue onContinue={onContinue} onDismiss={onDismiss} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });
});

describe("FocusModal backdrop", () => {
  it("swallows a backdrop mousedown so the click cannot drop focus out of the trap", () => {
    render(
      <FocusModal kind="break" sessionsToday={1} breakMinutes={5}
        onTakeBreak={vi.fn()} onKeepGoing={vi.fn()} />
    );
    const backdrop = document.querySelector(".modal-backdrop")!;

    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    backdrop.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves mousedown inside the dialog alone", () => {
    render(
      <FocusModal kind="break" sessionsToday={1} breakMinutes={5}
        onTakeBreak={vi.fn()} onKeepGoing={vi.fn()} />
    );

    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    screen.getByRole("button", { name: "Keep going" }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
