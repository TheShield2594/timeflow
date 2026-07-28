/**
 * Power Apps host path (isPowerAppsHost() === true), where the dev-mock
 * shortcuts are bypassed and the generated SDK is actually called. Covers the
 * update-only semantics (#72) and the read/bootstrap retry behavior (#75) that
 * the dev-mock tests in dataverseService.test.ts can't reach.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sdk = vi.hoisted(() => ({
  ListRecordsWithOrganization: vi.fn(),
  UpdateOnlyRecordWithOrganization: vi.fn(),
  UpdateRecordWithOrganization: vi.fn(),
  CreateRecordWithOrganization: vi.fn(),
  DeleteRecordWithOrganization: vi.fn(),
}));

const ORG = "https://contoso.crm.dynamics.com";

vi.mock("./userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
  isPowerAppsHost: () => true,
  getDataverseOrgUrl: () => ORG,
}));
vi.mock("../generated", () => ({ MicrosoftDataverseService: sdk }));

const {
  updateTimeEntry, updateTask, updateProject, deactivateTask,
  getProjects, getOpenTimerEntry, isNotFoundError,
} = await import("./dataverseService");

const ok = (row: Record<string, unknown> = {}) => ({ success: true, data: { dynamicProperties: row } });
const page = (rows: Record<string, unknown>[]) => ({
  success: true,
  data: { value: rows.map((r) => ({ dynamicProperties: r })) },
});
const httpError = (status: number) => Object.assign(new Error(`request failed: ${status}`), { status });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("updates use update-only (If-Match) rather than upsert", () => {
  it("updateTimeEntry sends If-Match so a deleted draft 404s instead of being recreated", async () => {
    sdk.UpdateOnlyRecordWithOrganization.mockResolvedValue(ok({ ever_timeentriesid: "e1" }));

    await updateTimeEntry("e1", { description: "Did stuff" });

    expect(sdk.UpdateRecordWithOrganization).not.toHaveBeenCalled();
    expect(sdk.UpdateOnlyRecordWithOrganization).toHaveBeenCalledWith(
      "return=representation",
      "application/json",
      "*", // If-Match: the row must already exist
      ORG,
      "ever_timeentrieses",
      "e1",
      expect.objectContaining({ ever_description: "Did stuff" }),
    );
  });

  it("surfaces the 404 from a concurrently deleted row to isNotFoundError callers", async () => {
    sdk.UpdateOnlyRecordWithOrganization.mockRejectedValue(httpError(404));

    const err = await updateTimeEntry("gone", { description: "x" }).catch((e) => e);

    expect(isNotFoundError(err)).toBe(true);
    // A 404 is not transient — no retry storm on a row that will never exist.
    expect(sdk.UpdateOnlyRecordWithOrganization).toHaveBeenCalledTimes(1);
  });

  it("surfaces an envelope-shaped failure without retrying a non-transient error", async () => {
    // The SDK reports some failures as { success: false } rather than throwing.
    sdk.UpdateOnlyRecordWithOrganization.mockResolvedValue({ success: false, data: {}, error: httpError(400) });

    await expect(updateTimeEntry("e1", { description: "x" })).rejects.toThrow(/400/);
    expect(sdk.UpdateOnlyRecordWithOrganization).toHaveBeenCalledTimes(1);
  });

  it("retries an envelope-shaped throttling failure, then gives up", async () => {
    vi.useFakeTimers();
    sdk.UpdateOnlyRecordWithOrganization.mockResolvedValue({ success: false, data: {}, error: httpError(503) });

    const pending = updateTimeEntry("e1", { description: "x" });
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(sdk.UpdateOnlyRecordWithOrganization).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["updateTask", () => updateTask("t1", { name: "Renamed" }), "ever_workitemses"],
    ["updateProject", () => updateProject("p1", { name: "Renamed" }), "ever_projectses"],
    ["deactivateTask", () => deactivateTask("t1"), "ever_workitemses"],
  ])("%s goes through the update-only operation", async (_label, call, entitySet) => {
    sdk.UpdateOnlyRecordWithOrganization.mockResolvedValue(ok({}));

    await call();

    expect(sdk.UpdateRecordWithOrganization).not.toHaveBeenCalled();
    expect(sdk.UpdateOnlyRecordWithOrganization).toHaveBeenCalledWith(
      "return=representation", "application/json", "*", ORG, entitySet, expect.any(String), expect.any(Object),
    );
  });
});

describe("reads retry transient failures", () => {
  it("retries a throttled page instead of failing the whole load", async () => {
    vi.useFakeTimers();
    sdk.ListRecordsWithOrganization
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce(page([{ ever_projectsid: "p1", ever_name: "Alpha", statecode: 0 }]));

    const pending = getProjects();
    await vi.advanceTimersByTimeAsync(2000);
    const projects = await pending;

    expect(sdk.ListRecordsWithOrganization).toHaveBeenCalledTimes(2);
    expect(projects.map((p) => p.id)).toEqual(["p1"]);
  });

  it("retries an unsuccessful result envelope carrying a transient error, then gives up", async () => {
    vi.useFakeTimers();
    sdk.ListRecordsWithOrganization.mockResolvedValue({ success: false, data: {}, error: httpError(503) });

    const pending = getProjects();
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(sdk.ListRecordsWithOrganization).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-transient read failure", async () => {
    sdk.ListRecordsWithOrganization.mockRejectedValue(httpError(400));

    await expect(getProjects()).rejects.toThrow();
    expect(sdk.ListRecordsWithOrganization).toHaveBeenCalledTimes(1);
  });
});

describe("getOpenTimerEntry distinguishes 'none' from 'could not check'", () => {
  it("returns null only when the query succeeds with no open row", async () => {
    sdk.ListRecordsWithOrganization.mockResolvedValue(page([]));

    await expect(getOpenTimerEntry()).resolves.toBeNull();
  });

  it("returns the open draft when there is one", async () => {
    sdk.ListRecordsWithOrganization.mockResolvedValue(page([{
      ever_timeentriesid: "draft-1",
      _ever_project_value: "proj-1",
      ever_starttime: "2026-06-01T09:00:00Z",
      ever_date: "2026-06-01",
      ever_userid: "user-1",
    }]));

    const open = await getOpenTimerEntry();

    expect(open).toMatchObject({ id: "draft-1", projectId: "proj-1", startTime: "2026-06-01T09:00:00Z" });
    expect(open?.endTime).toBeUndefined();
  });

  it("retries throttling, and rejects rather than reporting 'no open draft'", async () => {
    vi.useFakeTimers();
    sdk.ListRecordsWithOrganization.mockRejectedValue(httpError(429));

    const pending = getOpenTimerEntry();
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(sdk.ListRecordsWithOrganization).toHaveBeenCalledTimes(3);
  });

  it("recovers when a retry succeeds", async () => {
    vi.useFakeTimers();
    sdk.ListRecordsWithOrganization
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(page([{ ever_timeentriesid: "draft-2", _ever_project_value: "proj-2", ever_starttime: "2026-06-01T09:00:00Z" }]));

    const pending = getOpenTimerEntry();
    await vi.advanceTimersByTimeAsync(2000);

    expect((await pending)?.id).toBe("draft-2");
  });
});
