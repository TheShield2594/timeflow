import { describe, it, expect, vi, beforeEach } from "vitest";

// Host-mode toggle read by the userService mock below.
let powerAppsHost = false;

// Real GUIDs: both ids are interpolated into an unquoted OData GUID
// comparison, which the service now validates before sending (#108).
const MY_OBJECT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const MY_USER_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const REPORT_1_ID = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
const REPORT_2_ID = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";

// The signed-in user's id, overridable per test.
let signedInId: string = MY_OBJECT_ID;

vi.mock("./userService", () => ({
  isPowerAppsHost: () => powerAppsHost,
  getDataverseOrgUrl: () => "current",
  getCurrentUser: () => ({
    id: signedInId, email: "u@example.com", displayName: "User One", environmentId: "env-1",
  }),
}));

const telemetrySpy = vi.fn();
vi.mock("./telemetry", () => ({ reportTelemetry: (e: unknown) => telemetrySpy(e) }));

const listRecords = vi.fn();
vi.mock("../generated", () => ({
  MicrosoftDataverseService: {
    ListRecordsWithOrganization: (...args: unknown[]) => listRecords(...args),
  },
}));

import { getTeamContext, getTeamTimeEntries, resetTeamCache } from "./teamService";

function envelope(rows: Record<string, unknown>[]) {
  return { success: true, data: { value: rows.map((r) => ({ dynamicProperties: r })) } };
}

beforeEach(() => {
  localStorage.clear();
  resetTeamCache();
  listRecords.mockReset();
  telemetrySpy.mockReset();
  powerAppsHost = false;
  signedInId = MY_OBJECT_ID;
});

describe("teamService (dev mock)", () => {
  it("reports no team unless tt_mock_team is set", async () => {
    expect((await getTeamContext()).reports).toEqual([]);
    resetTeamCache();
    localStorage.setItem("tt_mock_team", "1");
    const ctx = await getTeamContext();
    expect(ctx.reports.length).toBe(2);
    expect(ctx.myUserId).toBe(MY_OBJECT_ID);
  });

  it("serves deterministic mock team entries with owner attribution", async () => {
    localStorage.setItem("tt_mock_team", "1");
    const entries = (await getTeamTimeEntries("2026-07-27", "2026-08-02")).items;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toEqual((await getTeamTimeEntries("2026-07-27", "2026-08-02")).items);
    expect(entries.every((e) => e.ownerId && e.ownerName)).toBe(true);
    // Weekend days stay clear.
    expect(entries.some((e) => e.date === "2026-08-01" || e.date === "2026-08-02")).toBe(false);
  });
});

describe("teamService (Power Apps host)", () => {
  beforeEach(() => {
    powerAppsHost = true;
  });

  it("probes systemusers for direct reports via the manager lookup", async () => {
    listRecords
      .mockResolvedValueOnce(envelope([{ systemuserid: MY_USER_ID, fullname: "User One" }]))
      .mockResolvedValueOnce(envelope([
        { systemuserid: REPORT_1_ID, fullname: "Avery Example" },
        { systemuserid: REPORT_2_ID, fullname: "Jordan Sample" },
      ]));
    const ctx = await getTeamContext();
    expect(ctx.myUserId).toBe(MY_USER_ID);
    expect(ctx.reports).toEqual([
      { id: REPORT_1_ID, name: "Avery Example" },
      { id: REPORT_2_ID, name: "Jordan Sample" },
    ]);
    // First call resolves me by Entra object id; second filters on the
    // Manager (parentsystemuserid) lookup.
    expect(String(listRecords.mock.calls[0])).toContain(`azureactivedirectoryobjectid eq ${MY_OBJECT_ID}`);
    expect(String(listRecords.mock.calls[1])).toContain(`_parentsystemuserid_value eq ${MY_USER_ID}`);
    // Cached: a second call issues no further reads.
    await getTeamContext();
    expect(listRecords).toHaveBeenCalledTimes(2);
  });

  it("sends no filter at all when the signed-in id isn't a GUID", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    signedInId = "alice@contoso.com";

    // A principal name is not a valid unquoted OData literal, so the query
    // could only ever fail. It never leaves the client (#108).
    expect(await getTeamContext()).toEqual({ myUserId: null, reports: [] });
    expect(listRecords).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does not pass a systemuserid through to the manager filter unchecked", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A row that came back with something other than a GUID in the id column
    // stops here rather than being interpolated into the next filter.
    listRecords.mockResolvedValueOnce(envelope([{ systemuserid: "' or 1 eq 1", fullname: "X" }]));

    expect(await getTeamContext()).toEqual({ myUserId: null, reports: [] });
    expect(listRecords).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("hides the team (instead of throwing) when the probe fails, and says so out loud", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    listRecords.mockRejectedValue(new Error("no read privilege on systemuser"));
    const ctx = await getTeamContext();
    expect(ctx).toEqual({ myUserId: null, reports: [] });
    // The nav item is simply absent when this happens — there is no other
    // symptom for an admin to go on, so the failure has to leave the browser.
    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "team_probe_failed", severity: "warning" })
    );
    warnSpy.mockRestore();
  });

  // The Manager field belongs on the report's profile. Set on your own, it
  // makes you your own report — a Team page whose only member is you.
  it("does not count the caller as their own direct report", async () => {
    listRecords
      .mockResolvedValueOnce(envelope([{ systemuserid: MY_USER_ID, fullname: "User One" }]))
      .mockResolvedValueOnce(envelope([
        { systemuserid: MY_USER_ID, fullname: "User One" },
        { systemuserid: REPORT_1_ID, fullname: "Avery Example" },
      ]));

    const ctx = await getTeamContext();

    expect(ctx.myUserId).toBe(MY_USER_ID);
    expect(ctx.reports).toEqual([{ id: REPORT_1_ID, name: "Avery Example" }]);
  });

  it("reads team entries with the server-resolved hierarchy operator, never a user-id list", async () => {
    listRecords.mockResolvedValueOnce(envelope([
      {
        ever_timeentriesid: "te-1",
        ever_starttime: "2026-07-27T13:00:00Z",
        ever_endtime: "2026-07-27T15:00:00Z",
        ever_durationminutes: 120,
        ever_date: "2026-07-27",
        _ownerid_value: REPORT_1_ID,
        "_ownerid_value@OData.Community.Display.V1.FormattedValue": "Avery Example",
      },
    ]));
    const entries = (await getTeamTimeEntries("2026-07-27", "2026-08-02")).items;
    const fetchXml = String(listRecords.mock.calls[0]);
    expect(fetchXml).toContain('operator="eq-useroruserhierarchy"');
    expect(fetchXml).toContain('value="2026-07-27"');
    expect(fetchXml).toContain('value="2026-08-02"');
    expect(entries).toHaveLength(1);
    expect(entries[0].ownerId).toBe(REPORT_1_ID);
    expect(entries[0].ownerName).toBe("Avery Example");
    expect(entries[0].durationMinutes).toBe(120);
  });

  it("pages the team read the same way the personal reads page (#115)", async () => {
    // This file used to carry its own single-page listRecords: no count, no
    // page attribute, no paging cookie, no retry, no ceiling. The tell that
    // it now shares dataverseService's plumbing is on the wire.
    listRecords.mockResolvedValueOnce(envelope([]));

    await getTeamTimeEntries("2026-07-27", "2026-08-02");

    const fetchXml = String(listRecords.mock.calls[0]);
    expect(fetchXml).toMatch(/<fetch count="\d+" page="1"/);
  });

  it("reports a truncated team read instead of silently returning a short week", async () => {
    // A full page with no usable paging cookie: the old code returned these
    // 5,000 rows as if they were the whole week, with no warning at all.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fullPage = Array.from({ length: 5000 }, (_, i) => ({
      ever_timeentriesid: `te-${i}`,
      ever_date: "2026-07-27",
      _ownerid_value: REPORT_1_ID,
    }));
    listRecords.mockResolvedValue(envelope(fullPage));

    const { items, truncated } = await getTeamTimeEntries("2026-07-27", "2026-08-02");

    expect(items).toHaveLength(5000);
    expect(truncated).not.toBeNull();
    expect(truncated?.entitySet).toBe("ever_timeentrieses");
    errorSpy.mockRestore();
  });
});
