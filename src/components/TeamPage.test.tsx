import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, within, fireEvent } from "@testing-library/react";
import { TeamPage } from "./TeamPage";
import { renderWithData } from "../test/dataHarness";
import type { TeamEntry } from "../services/teamService";
import type { Task } from "../types";

// The SDK's app entrypoint has an extensionless internal import that Node's
// ESM resolver can't follow, which is why userService used to be replaced
// wholesale here. Stubbing just that one module lets the real userService
// load, so the mock below can spread it.
vi.mock("@microsoft/power-apps/app", () => ({ getContext: vi.fn() }));
vi.mock("../services/userService", async (importOriginal) => ({
  // Spread the real module: replacing it wholesale left isPowerAppsHost
  // undefined, and the resulting TypeError was swallowed into a hook
  // error state that the assertions never looked at (#114).
  ...(await importOriginal<typeof import("../services/userService")>()),
  getCurrentUser: () => ({ id: "aad-object-id", email: "u@example.com", displayName: "User One", environmentId: "env-1" }),
}));
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const getTeamTimeEntries = vi.fn<(from: string, to: string) => Promise<TeamEntry[]>>();
vi.mock("../services/teamService", () => ({
  // The service returns `{ items, truncated }` (#115); these tests care about
  // the rows, so the wrapper supplies the envelope and each test keeps
  // returning a plain array.
  getTeamTimeEntries: async (from: string, to: string) => ({
    items: await getTeamTimeEntries(from, to),
    truncated: null,
  }),
}));

beforeEach(() => {
  // Pin "today" to Wednesday 2026-07-29 so the displayed week (Jul 27–Aug 2)
  // and the missing-day math are deterministic. shouldAdvanceTime keeps
  // waitFor/findBy working under the fake clock.
  vi.useFakeTimers({ now: new Date("2026-07-29T12:00:00"), shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const teamContext = {
  myUserId: "su-me",
  reports: [
    { id: "su-r1", name: "Avery Example" },
    { id: "su-r2", name: "Jordan Sample" },
  ],
};

function entry(overrides: Partial<TeamEntry>): TeamEntry {
  return {
    id: "te-1",
    projectId: "p1",
    startTime: "2026-07-27T13:00:00Z",
    endTime: "2026-07-27T15:00:00Z",
    durationMinutes: 120,
    date: "2026-07-27",
    userId: "su-r1",
    userDisplayName: "Avery Example",
    ownerId: "su-r1",
    ownerName: "Avery Example",
    ...overrides,
  };
}

const projects = [
  { id: "p1", name: "Project One", color: "#719500", isActive: true, createdAt: "" },
];
const tasks: Task[] = [];

/** The page reads projects and tasks from the data context now — only the
 *  team rows come from the hierarchy-scoped service read. */
const renderTeam = () =>
  renderWithData(<TeamPage teamContext={teamContext} />, { projects, tasks });

describe("TeamPage", () => {
  it("shows per-member week totals, flags missing weekdays, and rolls up projects", async () => {
    getTeamTimeEntries.mockResolvedValue([
      entry({}), // Avery, Monday, 2h on Project One
      entry({ id: "te-2", ownerId: "su-me", ownerName: "User One", userId: "su-me", date: "2026-07-28", durationMinutes: 60 }),
    ]);
    renderTeam();

    // Direct reports only, by default — the manager's own row is in the whole
    // line, not in the list of people they manage.
    const averyRow = (await screen.findByText("Avery Example")).closest<HTMLElement>(".team__row")!;
    expect(within(averyRow).getByText("2h")).toBeTruthy();
    // 2h logged Monday; Tue + Wed (today) are empty and already past → 2 missing.
    expect(within(averyRow).getByText("2 missing")).toBeTruthy();

    // Jordan logged nothing all week → Mon/Tue/Wed missing.
    const jordanRow = screen.getByText("Jordan Sample").closest<HTMLElement>(".team__row")!;
    expect(within(jordanRow).getByText("3 missing")).toBeTruthy();

    // The manager's own row appears on the whole line, labelled, never flagged.
    fireEvent.click(screen.getByRole("tab", { name: /Whole line/ }));
    const meRow = screen.getByText("User One (you)").closest<HTMLElement>(".team__row")!;
    expect(within(meRow).queryByText(/missing/)).toBeNull();
  });

  it("keeps zero-entry reports visible instead of dropping them", async () => {
    getTeamTimeEntries.mockResolvedValue([]);
    renderTeam();
    expect(await screen.findByText("Avery Example")).toBeTruthy();
    expect(screen.getByText("Jordan Sample")).toBeTruthy();
  });

  // A table of zeroes reads as "my team logged nothing" whether the team logged
  // nothing or the server never handed their rows over. Only one of those is
  // the manager's problem to solve.
  it("names the misconfiguration when reports resolve but none of their rows do", async () => {
    getTeamTimeEntries.mockResolvedValue([
      entry({ id: "te-mine", ownerId: "su-me", ownerName: "User One", userId: "su-me" }),
    ]);
    renderTeam();
    await screen.findByText("Avery Example");

    expect(screen.getByText(/none of their rows came back/)).toBeTruthy();
  });

  it("says nothing about it once a report's rows come back", async () => {
    getTeamTimeEntries.mockResolvedValue([entry({})]);
    renderTeam();
    await screen.findByText("Avery Example");

    expect(screen.queryByText(/none of their rows came back/)).toBeNull();
  });

  it("surfaces load failures with a retry", async () => {
    getTeamTimeEntries.mockRejectedValueOnce(new Error("hierarchy security not enabled"));
    getTeamTimeEntries.mockResolvedValue([entry({})]);
    renderTeam();
    expect(await screen.findByText(/hierarchy security not enabled/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findAllByText("2h")).length).toBeGreaterThan(0);
  });
});

describe("TeamPage export controls", () => {
  /** Capture the exported CSV's text, same approach as csvExport.test.ts. */
  async function captureExport(): Promise<string> {
    let captured: Blob | undefined;
    const createObjectURL = vi.fn((blob: Blob) => { captured = blob; return "blob:mock"; });
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    if (!captured) return "";
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(captured!);
    });
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(buffer);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disables the export while the visible people have nothing logged", async () => {
    // Rows exist for every direct report whether or not they logged anything,
    // so "there are rows on screen" is not the same as "there is something to
    // export".
    getTeamTimeEntries.mockResolvedValue([]);
    renderTeam();
    await screen.findByText("Avery Example");
    expect(screen.getByRole("button", { name: /Export CSV/ }).hasAttribute("disabled")).toBe(true);
    cleanup();

    getTeamTimeEntries.mockResolvedValue([entry({})]);
    renderTeam();
    await screen.findAllByText("2h");
    expect(screen.getByRole("button", { name: /Export CSV/ }).hasAttribute("disabled")).toBe(false);
  });

  // The export follows the toggle. A CSV that carried the whole hierarchy
  // while the screen showed "Direct" is a manager sending out time they did
  // not mean to send.
  it("exports the rows behind the visible people, labeled by owner", async () => {
    getTeamTimeEntries.mockResolvedValue([
      entry({}), // Avery — a direct report
      entry({ id: "te-2", ownerId: "su-me", ownerName: "User One", userId: "su-me", date: "2026-07-28", durationMinutes: 60 }),
    ]);
    renderTeam();
    await screen.findByText("Avery Example");

    // Direct reports only: the manager's own row isn't on screen, so it isn't
    // in the file either.
    let csv = (await captureExport()).replace("\uFEFF", "");
    expect(csv.trim().split("\n")).toHaveLength(2); // header + Avery
    expect(csv).toContain("Avery Example");
    expect(csv).not.toContain("User One");

    // Whole line puts the manager back on screen, and back in the export.
    fireEvent.click(screen.getByRole("tab", { name: /Whole line/ }));
    csv = (await captureExport()).replace("\uFEFF", "");
    expect(csv.trim().split("\n")).toHaveLength(3);
    expect(csv).toContain("User One");
  });

  it("remembers the chosen rounding rule as its own device preference, separate from Reports", async () => {
    getTeamTimeEntries.mockResolvedValue([entry({})]);
    renderTeam();
    await screen.findByText("Avery Example");
    fireEvent.change(screen.getByLabelText("Rounding applied to exported durations"), {
      target: { value: "up15" },
    });
    expect(localStorage.getItem("tt_team_export_rounding")).toBe("up15");
    expect(localStorage.getItem("tt_export_rounding")).toBeNull();
  });
});
