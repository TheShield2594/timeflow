import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast, type ToastAction, type ToastKind } from "./ToastContext";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Pushes one toast per click, so a test can drive the provider like a user. */
const Pusher: React.FC<{ message: string; kind?: ToastKind; action?: ToastAction }> = ({ message, kind, action }) => {
  const push = useToast();
  return <button onClick={() => push(message, kind, action)}>push</button>;
};

function renderWithToasts(children: React.ReactNode) {
  return render(<ToastProvider>{children}</ToastProvider>);
}

const politeRegion = () => screen.getByRole("status");
const assertiveRegion = () => screen.getByRole("alert");

describe("toast live regions", () => {
  // The bug this guards: a live region inserted into the DOM with its text
  // already inside is widely not announced. Both regions have to pre-exist.
  it("mounts both regions before there is anything to announce", () => {
    renderWithToasts(null);
    expect(politeRegion()).toBeTruthy();
    expect(assertiveRegion()).toBeTruthy();
    expect(politeRegion().textContent).toBe("");
    expect(assertiveRegion().textContent).toBe("");
  });

  it("announces failures assertively and everything else politely", () => {
    renderWithToasts(
      <>
        <Pusher message="Saved 45m to Alpha." kind="success" />
        <Pusher message="Failed to save entry." kind="error" />
      </>
    );
    const [saved, failed] = screen.getAllByRole("button", { name: "push" });

    fireEvent.click(saved);
    expect(politeRegion().textContent).toContain("Saved 45m to Alpha.");
    expect(assertiveRegion().textContent).toBe("");

    // A failed save queued politely behind whatever the user was doing was the
    // whole complaint — it belongs in the assertive region.
    fireEvent.click(failed);
    expect(assertiveRegion().textContent).toContain("Failed to save entry.");
    expect(politeRegion().textContent).not.toContain("Failed to save entry.");
  });

  // One at a time, replaced by the next. A stack of toasts is a queue of
  // things the user is being told while they are trying to do something else.
  it("replaces the standing toast rather than stacking a second one under it", () => {
    renderWithToasts(
      <>
        <Pusher message="Saved 45m to Alpha." kind="success" />
        <Pusher message="Entry deleted." kind="success" />
      </>
    );
    const [saved, deleted] = screen.getAllByRole("button", { name: "push" });
    fireEvent.click(saved);
    fireEvent.click(deleted);

    expect(screen.queryByText("Saved 45m to Alpha.")).toBeNull();
    expect(screen.getByText("Entry deleted.")).toBeTruthy();
  });

  it("keeps the regions mounted after the last toast is gone", () => {
    vi.useFakeTimers();
    renderWithToasts(<Pusher message="Entry deleted." />);
    fireEvent.click(screen.getByRole("button", { name: "push" }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(politeRegion()).toBeTruthy();
    expect(politeRegion().textContent).toBe("");
  });
});

describe("toast dismissal", () => {
  it("dismisses a plain toast after its TTL", () => {
    vi.useFakeTimers();
    renderWithToasts(<Pusher message="Session discarded." />);
    fireEvent.click(screen.getByRole("button", { name: "push" }));
    expect(screen.getByText("Session discarded.")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText("Session discarded.")).toBeNull();
  });

  it("holds the countdown while the pointer is over the toast, then resumes where it left off", () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    renderWithToasts(<Pusher message="Entry deleted." action={{ label: "Undo", onAction }} />);
    fireEvent.click(screen.getByRole("button", { name: "push" }));
    const toast = screen.getByText("Entry deleted.").closest(".toast")!;

    // 8s action TTL; 4s in, reach for Undo.
    act(() => { vi.advanceTimersByTime(4000); });
    fireEvent.mouseEnter(toast);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText("Entry deleted.")).toBeTruthy();

    // Leaving resumes the remaining 4s rather than restarting the full 8s.
    fireEvent.mouseLeave(toast);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText("Entry deleted.")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText("Entry deleted.")).toBeNull();
  });

  it("holds the countdown while a control inside the toast has keyboard focus", () => {
    vi.useFakeTimers();
    renderWithToasts(<Pusher message="Project archived." action={{ label: "Undo", onAction: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: "push" }));

    fireEvent.focus(screen.getByRole("button", { name: "Undo" }));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText("Project archived.")).toBeTruthy();
  });

  it("clears its timer on unmount rather than setting state on a dead toast", () => {
    vi.useFakeTimers();
    const { unmount } = renderWithToasts(<Pusher message="Task deleted." />);
    fireEvent.click(screen.getByRole("button", { name: "push" }));
    unmount();
    // Would surface as an act()/setState-after-unmount warning if the timer
    // outlived the component.
    expect(() => act(() => { vi.advanceTimersByTime(60_000); })).not.toThrow();
  });
});

describe("toast action", () => {
  // Exactly the kind of guard that regresses silently, which is why it has a
  // test now: a double-click on Undo used to be able to re-create an entry
  // twice before React removed the toast.
  it("runs the action at most once, however fast the button is clicked", () => {
    const onAction = vi.fn();
    renderWithToasts(<Pusher message="Entry deleted." action={{ label: "Undo", onAction }} />);
    fireEvent.click(screen.getByRole("button", { name: "push" }));

    const undo = screen.getByRole("button", { name: "Undo" });
    fireEvent.click(undo);
    fireEvent.click(undo);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("dismisses the toast once the action has run", () => {
    renderWithToasts(<Pusher message="Entry deleted." action={{ label: "Undo", onAction: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: "push" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByText("Entry deleted.")).toBeNull();
  });
});
