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
  getTimeEntries, extractPagingCookie, setPaginationWarningHandler,
  createProject, createTask, createDraftTimerEntry,
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

// ---------------------------------------------------------------------------
// FetchXML pagination (#69). getTimeEntries is the only FetchXML-paged read;
// $skiptoken paging (getProjects) is covered alongside it for contrast.
// ---------------------------------------------------------------------------
const FETCH_PAGE_SIZE = 5000;

/** The inner cookie Dataverse expects echoed back, before any encoding. */
const INNER_COOKIE =
  '<cookie page="1"><ever_timeentriesid last="{AAAA-1}" first="{AAAA-2}" /></cookie>';

/** The annotation as Dataverse sends it: wrapper XML whose `pagingcookie`
 *  attribute holds the inner cookie, URL-encoded twice. */
function pagingAnnotation(inner = INNER_COOKIE, pageNumber = 2): string {
  const encoded = encodeURIComponent(encodeURIComponent(inner));
  return `<cookie pagenumber="${pageNumber}" pagingcookie="${encoded}" istracking="False" />`;
}

function entryRow(i: number): Record<string, unknown> {
  return {
    ever_timeentriesid: `e${i}`,
    _ever_project_value: "proj-1",
    ever_starttime: "2026-06-01T09:00:00Z",
    ever_date: "2026-06-01",
    ever_userid: "user-1",
  };
}

/** A FetchXML page envelope carrying `count` rows plus the paging annotation
 *  Dataverse returns on *every* page that yields rows — including the last. */
function fetchPage(count: number, annotation: string | null = pagingAnnotation()) {
  const env: Record<string, unknown> = {
    value: Array.from({ length: count }, (_, i) => ({ dynamicProperties: entryRow(i) })),
  };
  if (annotation) env["@Microsoft.Dynamics.CRM.fetchxmlpagingcookie"] = annotation;
  return { success: true, data: env };
}

/** The FetchXML argument of the nth ListRecords call (1-indexed). */
function fetchXmlArg(call: number): string {
  return sdk.ListRecordsWithOrganization.mock.calls[call - 1][10] as string;
}

describe("extractPagingCookie", () => {
  it("pulls out the inner pagingcookie and double-URL-decodes it", () => {
    expect(extractPagingCookie(pagingAnnotation())).toBe(INNER_COOKIE);
  });

  it("handles single-quoted attributes and XML entities in the annotation", () => {
    const encoded = encodeURIComponent(encodeURIComponent(INNER_COOKIE));
    expect(extractPagingCookie(`<cookie pagingcookie='${encoded}' />`)).toBe(INNER_COOKIE);
    // Percent-encoding leaves nothing XML-special in the value, but unescape
    // anyway rather than depending on that: &amp; must not become a stray "&".
    expect(extractPagingCookie(`<cookie pagingcookie="${encoded.replace(/%/g, "&amp;#")}" />`))
      .toBe(extractPagingCookie(`<cookie pagingcookie="${encoded.replace(/%/g, "&#")}" />`));
  });

  it("returns undefined for an absent, empty or undecodable cookie", () => {
    expect(extractPagingCookie(undefined)).toBeUndefined();
    expect(extractPagingCookie("<cookie istracking='False' />")).toBeUndefined();
    expect(extractPagingCookie('<cookie pagingcookie="" />')).toBeUndefined();
    // A lone "%" is not a valid percent-escape — decoding throws, and we must
    // not send a cookie Dataverse would reject.
    expect(extractPagingCookie('<cookie pagingcookie="%" />')).toBeUndefined();
  });
});

describe("FetchXML paging (#69)", () => {
  let warnings: string[];

  beforeEach(() => {
    warnings = [];
    setPaginationWarningHandler((msg) => warnings.push(msg));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setPaginationWarningHandler(null);
    vi.restoreAllMocks();
  });

  it("asks for an explicit page size so 'short page' is a meaningful test", async () => {
    sdk.ListRecordsWithOrganization.mockResolvedValue(fetchPage(3));

    await getTimeEntries({ from: "2026-06-01", to: "2026-06-30" });

    expect(fetchXmlArg(1)).toContain(`count="${FETCH_PAGE_SIZE}"`);
    expect(fetchXmlArg(1)).toContain('page="1"');
    expect(fetchXmlArg(1)).not.toContain("paging-cookie");
  });

  it("stops after a short page even though the annotation is present", async () => {
    // The old termination rule ("no annotation means done") fired a second,
    // malformed request here and warned about truncation that never happened.
    sdk.ListRecordsWithOrganization.mockResolvedValue(fetchPage(3));

    const entries = await getTimeEntries({ from: "2026-06-01", to: "2026-06-30" });

    expect(entries).toHaveLength(3);
    expect(sdk.ListRecordsWithOrganization).toHaveBeenCalledTimes(1);
    expect(warnings).toEqual([]);
  });

  it("pages on a full page, echoing the decoded inner cookie", async () => {
    sdk.ListRecordsWithOrganization
      .mockResolvedValueOnce(fetchPage(FETCH_PAGE_SIZE))
      .mockResolvedValueOnce(fetchPage(2));

    const entries = await getTimeEntries({ from: "2026-06-01", to: "2026-06-30" });

    expect(entries).toHaveLength(FETCH_PAGE_SIZE + 2);
    expect(sdk.ListRecordsWithOrganization).toHaveBeenCalledTimes(2);

    const secondFetch = fetchXmlArg(2);
    expect(secondFetch).toContain('page="2"');
    // The inner cookie, XML-escaped for the attribute — not the wrapper
    // annotation, and not the still-URL-encoded form.
    expect(secondFetch).toContain(
      'paging-cookie="&lt;cookie page=&quot;1&quot;&gt;&lt;ever_timeentriesid last=&quot;{AAAA-1}&quot; first=&quot;{AAAA-2}&quot; /&gt;&lt;/cookie&gt;"'
    );
    expect(secondFetch).not.toContain("istracking");
    expect(secondFetch).not.toContain("%25");
    expect(warnings).toEqual([]);
  });

  it("warns rather than silently truncating when a full page has no usable cookie", async () => {
    sdk.ListRecordsWithOrganization.mockResolvedValue(fetchPage(FETCH_PAGE_SIZE, null));

    const entries = await getTimeEntries({ from: "2026-06-01", to: "2026-06-30" });

    expect(entries).toHaveLength(FETCH_PAGE_SIZE);
    expect(sdk.ListRecordsWithOrganization).toHaveBeenCalledTimes(1);
    expect(warnings).toHaveLength(1);
  });

  it("warns when the page ceiling is hit with data still pending", async () => {
    sdk.ListRecordsWithOrganization.mockResolvedValue(fetchPage(FETCH_PAGE_SIZE));

    const entries = await getTimeEntries({ from: "2026-06-01", to: "2026-06-30" });

    // MAX_PAGES = 20, every page full and cookied.
    expect(sdk.ListRecordsWithOrganization).toHaveBeenCalledTimes(20);
    expect(entries).toHaveLength(20 * FETCH_PAGE_SIZE);
    expect(warnings).toHaveLength(1);
  });

  it("keeps the rows already read when a later page fails", async () => {
    sdk.ListRecordsWithOrganization
      .mockResolvedValueOnce(fetchPage(FETCH_PAGE_SIZE))
      .mockRejectedValue(httpError(400));

    const entries = await getTimeEntries({ from: "2026-06-01", to: "2026-06-30" });

    expect(entries).toHaveLength(FETCH_PAGE_SIZE);
    expect(warnings).toHaveLength(1);
  });

  it("still pages $skiptoken-style reads off @odata.nextLink", async () => {
    sdk.ListRecordsWithOrganization
      .mockResolvedValueOnce({
        success: true,
        data: {
          value: [{ dynamicProperties: { ever_projectsid: "p1", ever_name: "A", statecode: 0 } }],
          "@odata.nextLink": "https://contoso.crm.dynamics.com/api/data/v9.2/ever_projectses?$skiptoken=tok1",
        },
      })
      .mockResolvedValueOnce(page([{ ever_projectsid: "p2", ever_name: "B", statecode: 0 }]));

    const projects = await getProjects();

    expect(projects.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(sdk.ListRecordsWithOrganization.mock.calls[1][12]).toBe("tok1");
    expect(warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Dropped response bodies (#70)
// ---------------------------------------------------------------------------
describe("create with a dropped response body (#70)", () => {
  /** What the connector gives back when it drops the body entirely. */
  const emptyBody = { success: true, data: {} };

  it("keeps a created project active instead of archiving it on the spot", async () => {
    sdk.CreateRecordWithOrganization.mockResolvedValue(emptyBody);

    const project = await createProject({
      name: "New", color: "#123456", isActive: true,
    });

    // statecode is absent, so isActive must not be derived (it would be false).
    expect(project.isActive).toBe(true);
    expect(project.name).toBe("New");
    // Nor may the other mapper defaults win: with no ever_color the mapper
    // reports the default indigo, which isFilled() would happily merge over
    // the colour the user actually picked.
    expect(project.color).toBe("#123456");
    // No server id: the caller keeps its optimistic temp id.
    expect(project.id).toBe("");
  });

  it("keeps a created task active", async () => {
    sdk.CreateRecordWithOrganization.mockResolvedValue(emptyBody);

    const task = await createTask({ projectId: "proj-1", name: "T", isActive: true });

    expect(task.isActive).toBe(true);
    expect(task.id).toBe("");
  });

  it("still honours the server's values when the body does come back", async () => {
    sdk.CreateRecordWithOrganization.mockResolvedValue(ok({
      ever_projectsid: "p9", statecode: 1, ever_color: "#abcdef", createdon: "2026-01-02T03:04:05Z",
    }));

    const project = await createProject({ name: "Archived", color: "#000", isActive: true });

    // Present in the row, so these are real data and must win over the input.
    expect(project).toMatchObject({
      id: "p9", isActive: false, color: "#abcdef", createdAt: "2026-01-02T03:04:05Z",
    });
  });

  it("does not rewrite a project's colour, state or creation date when a patch loses its body", async () => {
    sdk.UpdateOnlyRecordWithOrganization.mockResolvedValue(emptyBody);

    const updated = await updateProject("p1", { name: "Renamed" });

    expect(updated.name).toBe("Renamed");
    // Untouched by the patch and unknown in the response — all three must be
    // absent, so a caller merging this over its record keeps what it had.
    // Present-but-fabricated would archive the project, repaint it the default
    // indigo, and restamp its creation date as now.
    expect("isActive" in updated).toBe(false);
    expect("color" in updated).toBe(false);
    expect("createdAt" in updated).toBe(false);
  });

  it("keeps the colour the patch itself set", async () => {
    sdk.UpdateOnlyRecordWithOrganization.mockResolvedValue(emptyBody);

    const updated = await updateProject("p1", { color: "#654321" });

    // Dropping the derived field must not drop the caller's own value with it.
    expect(updated.color).toBe("#654321");
  });

  it("recovers a draft timer id from the open-draft query when the body is dropped", async () => {
    sdk.CreateRecordWithOrganization.mockResolvedValue(emptyBody);
    sdk.ListRecordsWithOrganization.mockResolvedValue(page([{
      ever_timeentriesid: "draft-9",
      _ever_project_value: "proj-1",
      ever_starttime: "2026-06-01T09:00:00Z",
      ever_date: "2026-06-01",
    }]));

    const id = await createDraftTimerEntry({
      projectId: "proj-1", startTime: "2026-06-01T09:00:00Z", date: "2026-06-01",
    });

    expect(id).toBe("draft-9");
  });

  it("matches the read-back row despite Dataverse dropping sub-second precision", async () => {
    sdk.CreateRecordWithOrganization.mockResolvedValue(emptyBody);
    // We send toISOString() with milliseconds; the column comes back rounded
    // to the second. Comparing the strings would reject the row we just wrote
    // and leave this whole fallback dead.
    sdk.ListRecordsWithOrganization.mockResolvedValue(page([{
      ever_timeentriesid: "draft-10",
      _ever_project_value: "proj-1",
      ever_starttime: "2026-06-01T09:00:00Z",
    }]));

    const id = await createDraftTimerEntry({
      projectId: "proj-1", startTime: "2026-06-01T09:00:00.427Z", date: "2026-06-01",
    });

    expect(id).toBe("draft-10");
  });

  it("still refuses a row more than a second away from the session it started", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sdk.CreateRecordWithOrganization.mockResolvedValue(emptyBody);
    sdk.ListRecordsWithOrganization.mockResolvedValue(page([{
      ever_timeentriesid: "draft-near",
      _ever_project_value: "proj-1",
      ever_starttime: "2026-06-01T09:00:02Z",
    }]));

    const id = await createDraftTimerEntry({
      projectId: "proj-1", startTime: "2026-06-01T09:00:00.000Z", date: "2026-06-01",
    });

    expect(id).toBeNull();
    vi.restoreAllMocks();
  });

  it("reports an unknown draft id rather than adopting an older session's row", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sdk.CreateRecordWithOrganization.mockResolvedValue(emptyBody);
    // An open row exists, but it started at a different time — it belongs to a
    // previous session, and stopping it in this one's place would corrupt both.
    sdk.ListRecordsWithOrganization.mockResolvedValue(page([{
      ever_timeentriesid: "draft-old",
      _ever_project_value: "proj-1",
      ever_starttime: "2026-05-30T08:00:00Z",
    }]));

    const id = await createDraftTimerEntry({
      projectId: "proj-1", startTime: "2026-06-01T09:00:00Z", date: "2026-06-01",
    });

    expect(id).toBeNull();
    vi.restoreAllMocks();
  });

  it("reports an unknown draft id when the read-back itself fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sdk.CreateRecordWithOrganization.mockResolvedValue(emptyBody);
    sdk.ListRecordsWithOrganization.mockRejectedValue(httpError(400));

    await expect(createDraftTimerEntry({
      projectId: "proj-1", startTime: "2026-06-01T09:00:00Z", date: "2026-06-01",
    })).resolves.toBeNull();
    vi.restoreAllMocks();
  });
});
