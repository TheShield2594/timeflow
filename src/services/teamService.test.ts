import { describe, it, expect, vi, beforeEach } from "vitest";

// Host-mode toggle read by the userService mock below.
let powerAppsHost = false;

vi.mock("./userService", () => ({
  isPowerAppsHost: () => powerAppsHost,
  getDataverseOrgUrl: () => "current",
  getCurrentUser: () => ({
    id: "aad-object-id", email: "u@example.com", displayName: "User One", environmentId: "env-1",
  }),
}));

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
  powerAppsHost = false;
});

describe("teamService (dev mock)", () => {
  it("reports no team unless tt_mock_team is set", async () => {
    expect((await getTeamContext()).reports).toEqual([]);
    resetTeamCache();
    localStorage.setItem("tt_mock_team", "1");
    const ctx = await getTeamContext();
    expect(ctx.reports.length).toBe(2);
    expect(ctx.myUserId).toBe("aad-object-id");
  });

  it("serves deterministic mock team entries with owner attribution", async () => {
    localStorage.setItem("tt_mock_team", "1");
    const entries = await getTeamTimeEntries("2026-07-27", "2026-08-02");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toEqual(await getTeamTimeEntries("2026-07-27", "2026-08-02"));
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
      .mockResolvedValueOnce(envelope([{ systemuserid: "su-me", fullname: "User One" }]))
      .mockResolvedValueOnce(envelope([
        { systemuserid: "su-r1", fullname: "Avery Example" },
        { systemuserid: "su-r2", fullname: "Jordan Sample" },
      ]));
    const ctx = await getTeamContext();
    expect(ctx.myUserId).toBe("su-me");
    expect(ctx.reports).toEqual([
      { id: "su-r1", name: "Avery Example" },
      { id: "su-r2", name: "Jordan Sample" },
    ]);
    // First call resolves me by Entra object id; second filters on the
    // Manager (parentsystemuserid) lookup.
    expect(String(listRecords.mock.calls[0])).toContain("azureactivedirectoryobjectid eq aad-object-id");
    expect(String(listRecords.mock.calls[1])).toContain("_parentsystemuserid_value eq su-me");
    // Cached: a second call issues no further reads.
    await getTeamContext();
    expect(listRecords).toHaveBeenCalledTimes(2);
  });

  it("hides the team (instead of throwing) when the probe fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    listRecords.mockRejectedValue(new Error("no read privilege on systemuser"));
    const ctx = await getTeamContext();
    expect(ctx).toEqual({ myUserId: null, reports: [] });
    warnSpy.mockRestore();
  });

  it("reads team entries with the server-resolved hierarchy operator, never a user-id list", async () => {
    listRecords.mockResolvedValueOnce(envelope([
      {
        ever_timeentriesid: "te-1",
        ever_starttime: "2026-07-27T13:00:00Z",
        ever_endtime: "2026-07-27T15:00:00Z",
        ever_durationminutes: 120,
        ever_date: "2026-07-27",
        _ownerid_value: "su-r1",
        "_ownerid_value@OData.Community.Display.V1.FormattedValue": "Avery Example",
      },
    ]));
    const entries = await getTeamTimeEntries("2026-07-27", "2026-08-02");
    const fetchXml = String(listRecords.mock.calls[0]);
    expect(fetchXml).toContain('operator="eq-useroruserhierarchy"');
    expect(fetchXml).toContain('value="2026-07-27"');
    expect(fetchXml).toContain('value="2026-08-02"');
    expect(entries).toHaveLength(1);
    expect(entries[0].ownerId).toBe("su-r1");
    expect(entries[0].ownerName).toBe("Avery Example");
    expect(entries[0].durationMinutes).toBe(120);
  });
});
