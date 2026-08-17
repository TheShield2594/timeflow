import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

const telemetrySpy = vi.fn();
vi.mock("../services/telemetry", () => ({ reportTelemetry: (e: unknown) => telemetrySpy(e) }));

const Boom: React.FC<{ throws?: boolean }> = ({ throws = true }) => {
  if (throws) throw new Error("Cannot read properties of undefined (reading 'map')");
  return <p>page content</p>;
};

beforeEach(() => {
  // React logs caught render errors itself; the boundary's own reporting is
  // what these tests are about.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  telemetrySpy.mockClear();
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary scope="app">
        <Boom throws={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText("page content")).toBeTruthy();
  });

  it("reports the crash with its scope instead of only logging it (#111)", () => {
    render(
      <ErrorBoundary scope="reports">
        <Boom />
      </ErrorBoundary>
    );

    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "error_boundary",
        severity: "error",
        message: expect.stringContaining("Cannot read properties"),
        props: expect.objectContaining({ scope: "reports" }),
      })
    );
  });

  // The raw message used to BE the message shown to the user: accurate, and
  // meaningless to the person reading it.
  it("leads with a plain sentence and keeps the raw text available for support", () => {
    render(
      <ErrorBoundary scope="app">
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText(/couldn’t finish loading/)).toBeTruthy();
    expect(screen.getByText(/Cannot read properties of undefined/)).toBeTruthy();
    expect(screen.getByText(/Technical detail/)).toBeTruthy();
  });

  it("offers Try again only for a page-scoped crash", () => {
    const { unmount } = render(
      <ErrorBoundary scope="app">
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    unmount();

    render(
      <ErrorBoundary scope="reports" resetKey="reports">
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  // What makes the per-page boundary usable: a crash on Reports shouldn't cost
  // a reload to escape, since the sidebar and the running timer are still fine.
  it("clears the caught error when resetKey changes", () => {
    const { rerender } = render(
      <ErrorBoundary scope="reports" resetKey="reports">
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText(/couldn’t be displayed/)).toBeTruthy();

    rerender(
      <ErrorBoundary scope="timesheet" resetKey="timesheet">
        <Boom throws={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText("page content")).toBeTruthy();
  });

  it("retries in place when Try again is pressed", () => {
    let throws = true;
    const Flaky: React.FC = () => {
      if (throws) throw new Error("transient render failure");
      return <p>page content</p>;
    };

    render(
      <ErrorBoundary scope="reports" resetKey="reports">
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByText(/couldn’t be displayed/)).toBeTruthy();

    throws = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("page content")).toBeTruthy();
  });
});
