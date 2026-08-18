/**
 * The sink itself (#111). The value of these tests is the guarantees callers
 * lean on: it never throws, it never floods, and it never carries anything the
 * caller didn't hand it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  reportTelemetry,
  isTelemetryConfigured,
  __setTelemetryTransportForTests,
  type TelemetryEvent,
} from "./telemetry";

vi.mock("./userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "u@example.com", displayName: "User One", environmentId: "env-1" }),
}));

const sent: { event: TelemetryEvent; context: Record<string, string> }[] = [];

beforeEach(() => {
  sent.length = 0;
  __setTelemetryTransportForTests((event, context) => { sent.push({ event, context }); });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  __setTelemetryTransportForTests(undefined);
  vi.restoreAllMocks();
});

const event = (over: Partial<TelemetryEvent> = {}): TelemetryEvent => ({
  name: "error_boundary",
  severity: "error",
  message: "Cannot read properties of undefined",
  ...over,
});

describe("reportTelemetry", () => {
  it("sends the event with the session's user and environment attached", () => {
    reportTelemetry(event({ props: { scope: "reports" } }));

    expect(sent).toHaveLength(1);
    expect(sent[0].event.name).toBe("error_boundary");
    expect(sent[0].context).toEqual({ userId: "user-1", environmentId: "env-1" });
  });

  it("logs to the console whether or not a sink is configured", () => {
    __setTelemetryTransportForTests(null);
    reportTelemetry(event());

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("error_boundary"),
      expect.anything()
    );
  });

  // A render crash re-fires on every attempted render and the isolation canary
  // re-fires on every refresh: without this, one bug is thousands of requests.
  it("sends an identical event once per session", () => {
    reportTelemetry(event());
    reportTelemetry(event());
    reportTelemetry(event({ message: "a different failure" }));

    expect(sent.map((s) => s.event.message)).toEqual([
      "Cannot read properties of undefined",
      "a different failure",
    ]);
  });

  it("stops sending past the per-session cap", () => {
    for (let i = 0; i < 40; i++) reportTelemetry(event({ message: `failure ${i}` }));

    expect(sent).toHaveLength(25);
  });

  it("never throws when the transport does", () => {
    __setTelemetryTransportForTests(() => { throw new Error("sink is down"); });

    expect(() => reportTelemetry(event())).not.toThrow();
  });

  it("reports isTelemetryConfigured as false with no sink", () => {
    __setTelemetryTransportForTests(null);
    expect(isTelemetryConfigured()).toBe(false);
  });
});
