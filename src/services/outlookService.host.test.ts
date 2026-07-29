/**
 * Power Apps host path of outlookService: the lazy SDK bootstrap, default-
 * calendar resolution, calendar-view read, and — critically — that a failed
 * bootstrap is retriable instead of a permanently cached rejection.
 * (Mock-mode behavior lives in outlookService.test.ts.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./userService", () => ({
  isPowerAppsHost: () => true,
  getCurrentUser: () => ({
    id: "user-1", email: "u@example.com", displayName: "User One", environmentId: "env-1",
  }),
}));

// Intercepts the service's dynamic import of the SDK.
const getClient = vi.fn();
vi.mock("@microsoft/power-apps/data", () => ({
  getClient: (info: unknown) => getClient(info),
}));
// ...and of the pac-generated schema (only the Dataverse source registered,
// like the repo's checked-in file, so the office365 fallback kicks in).
vi.mock("../../.power/schemas/appschemas/dataSourcesInfo", () => ({
  dataSourcesInfo: { commondataserviceforapps: { dataSourceType: "Connector", apis: {} } },
}));

import { getCalendarEvents, OutlookNotConnectedError, resetOutlookCache } from "./outlookService";

type ExecuteRequest = {
  connectorOperation: { tableName: string; operationName: string; parameters?: Record<string, unknown> };
};

function workingClient(executeAsync = vi.fn()) {
  executeAsync.mockImplementation(async (req: ExecuteRequest) => {
    if (req.connectorOperation.operationName === "CalendarGetTables_V2") {
      return { success: true, data: { value: [{ Name: "cal-1", DisplayName: "Calendar" }] } };
    }
    return {
      success: true,
      data: {
        value: [{
          id: "ev-1",
          subject: "Design review",
          start: "2026-07-28T14:00:00.0000000",
          end: "2026-07-28T15:00:00.0000000",
        }],
      },
    };
  });
  return { executeAsync };
}

beforeEach(() => {
  resetOutlookCache();
  getClient.mockReset();
});

describe("outlookService (Power Apps host)", () => {
  it("resolves the default calendar and maps the calendar view through the connector", async () => {
    const executeAsync = vi.fn();
    getClient.mockReturnValue(workingClient(executeAsync));

    const events = await getCalendarEvents("2026-07-27", "2026-08-02");
    expect(events).toEqual([{
      id: "ev-1",
      subject: "Design review",
      startTime: "2026-07-28T14:00:00.000Z",
      endTime: "2026-07-28T15:00:00.000Z",
    }]);

    // The schema had no office365 entry, so the fallback source was spliced in.
    expect((getClient.mock.calls[0][0] as Record<string, unknown>).office365).toBeTruthy();

    const view = (executeAsync.mock.calls as [ExecuteRequest][])
      .map(([req]) => req.connectorOperation)
      .find((op) => op.operationName === "GetEventsCalendarViewV3");
    expect(view?.tableName).toBe("office365");
    expect(view?.parameters?.table).toBe("cal-1");
  });

  it("surfaces a failed read as not-connected, then heals on retry instead of replaying the cached rejection", async () => {
    // First bootstrap dies (e.g. connection missing when getClient wires up).
    getClient.mockImplementationOnce(() => {
      throw new Error("no office365 connection");
    });
    await expect(getCalendarEvents("2026-07-27", "2026-08-02"))
      .rejects.toBeInstanceOf(OutlookNotConnectedError);

    // Admin fixes the connection; the next call must re-run the bootstrap.
    getClient.mockReturnValue(workingClient());
    const events = await getCalendarEvents("2026-07-27", "2026-08-02");
    expect(events).toHaveLength(1);
    expect(getClient).toHaveBeenCalledTimes(2);
  });
});
