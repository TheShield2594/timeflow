import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  toIsoUtc,
  mapConnectorEvent,
  mockEventsForDate,
  getCalendarEvents,
  readLoggedEventIds,
  markEventLogged,
} from "./outlookService";

vi.mock("./userService", () => ({
  isPowerAppsHost: () => false,
  getCurrentUser: () => ({
    id: "user-1", email: "u@example.com", displayName: "User One", environmentId: "env-1",
  }),
}));

beforeEach(() => {
  localStorage.clear();
});

describe("toIsoUtc", () => {
  it("pins the connector's offset-less timestamps to UTC instead of local time", () => {
    // "2026-07-28T14:00:00.0000000" is how the connector sends UTC — parsing
    // it as local time would shift every meeting by the machine's offset.
    expect(toIsoUtc("2026-07-28T14:00:00.0000000")).toBe("2026-07-28T14:00:00.000Z");
  });

  it("respects an explicit offset when present", () => {
    expect(toIsoUtc("2026-07-28T10:00:00-04:00")).toBe("2026-07-28T14:00:00.000Z");
    expect(toIsoUtc("2026-07-28T14:00:00Z")).toBe("2026-07-28T14:00:00.000Z");
  });

  it("returns null for garbage", () => {
    expect(toIsoUtc("not-a-date")).toBeNull();
  });
});

describe("mapConnectorEvent", () => {
  const base = {
    id: "ev-1",
    subject: "Design review",
    start: "2026-07-28T14:00:00.0000000",
    end: "2026-07-28T15:00:00.0000000",
    isAllDay: false,
  };

  it("maps a camelCase V3 row", () => {
    expect(mapConnectorEvent(base)).toEqual({
      id: "ev-1",
      subject: "Design review",
      startTime: "2026-07-28T14:00:00.000Z",
      endTime: "2026-07-28T15:00:00.000Z",
    });
  });

  it("maps a PascalCase row (older connector shapes)", () => {
    expect(mapConnectorEvent({
      Id: "ev-2", Subject: "Sync", Start: "2026-07-28T09:00:00Z", End: "2026-07-28T09:30:00Z",
    })).toEqual({
      id: "ev-2",
      subject: "Sync",
      startTime: "2026-07-28T09:00:00.000Z",
      endTime: "2026-07-28T09:30:00.000Z",
    });
  });

  it("prefers the WithTimeZone fields when both are present", () => {
    const mapped = mapConnectorEvent({
      ...base,
      startWithTimeZone: "2026-07-28T10:00:00-04:00",
      endWithTimeZone: "2026-07-28T11:00:00-04:00",
    });
    expect(mapped?.startTime).toBe("2026-07-28T14:00:00.000Z");
    expect(mapped?.endTime).toBe("2026-07-28T15:00:00.000Z");
  });

  it("drops cancelled and all-day rows, and rows with no usable span", () => {
    expect(mapConnectorEvent({ ...base, isCancelled: true })).toBeNull();
    expect(mapConnectorEvent({ ...base, isAllDay: true })).toBeNull();
    expect(mapConnectorEvent({ ...base, end: base.start })).toBeNull();
    expect(mapConnectorEvent({ subject: "No id or times" })).toBeNull();
  });

  it("labels a missing subject rather than dropping the meeting", () => {
    expect(mapConnectorEvent({ ...base, subject: undefined })?.subject).toBe("(No subject)");
  });
});

describe("mock events (dev mode)", () => {
  it("is deterministic for a given date", () => {
    expect(mockEventsForDate("2026-07-28")).toEqual(mockEventsForDate("2026-07-28"));
  });

  it("keeps weekends clear and puts the standup on weekdays", () => {
    expect(mockEventsForDate("2026-07-26")).toEqual([]); // Sunday
    const tuesday = mockEventsForDate("2026-07-28");
    expect(tuesday.some((e) => e.subject === "Team standup")).toBe(true);
  });

  it("getCalendarEvents serves the mock range outside the Power Apps host", async () => {
    const events = await getCalendarEvents("2026-07-27", "2026-07-31");
    expect(events.length).toBeGreaterThanOrEqual(5); // at least the daily standups
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });
});

describe("logged-event tracking", () => {
  it("round-trips through localStorage, scoped per environment + user", () => {
    expect(readLoggedEventIds().size).toBe(0);
    markEventLogged("ev-1");
    const ids = markEventLogged("ev-2");
    expect(ids.has("ev-1")).toBe(true);
    expect(ids.has("ev-2")).toBe(true);
    expect(readLoggedEventIds().has("ev-1")).toBe(true);
    expect(localStorage.getItem("tt_outlook_logged:env-1:user-1")).toContain("ev-1");
  });

  it("survives malformed stored state", () => {
    localStorage.setItem("tt_outlook_logged:env-1:user-1", "{not json");
    expect(readLoggedEventIds().size).toBe(0);
  });
});
