import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { TeamPage } from "./TeamPage";
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

describe("TeamPage", () => {
  it("shows per-member week totals, flags missing weekdays, and rolls up projects", async () => {
    getTeamTimeEntries.mockResolvedValue([
      entry({}), // Avery, Monday, 2h on Project One
      entry({ id: "te-2", ownerId: "su-me", ownerName: "User One", userId: "su-me", date: "2026-07-28", durationMinutes: 60 }),
    ]);
    render(<TeamPage teamContext={teamContext} projects={projects} tasks={tasks} />);

    const averyRow = (await screen.findByText("Avery Example")).closest("tr")!;
    // 2h logged Monday; Tue + Wed (today) are empty and already past → 2
    // missing. "2h" shows in both the Monday cell and the Total cell.
    expect(within(averyRow).getAllByText("2h")).toHaveLength(2);
    expect(within(averyRow).getByText("2 missing days")).toBeTruthy();

    // Jordan logged nothing all week → Mon/Tue/Wed missing.
    const jordanRow = screen.getByText("Jordan Sample").closest("tr")!;
    expect(within(jordanRow).getByText("3 missing days")).toBeTruthy();

    // The manager's own row is labeled and never flagged.
    const meRow = screen.getByText("User One").closest("tr")!;
    expect(within(meRow).getByText("you")).toBeTruthy();
    expect(within(meRow).queryByText(/missing/)).toBeNull();

    // Project rollup aggregates the whole team's week.
    expect(screen.getByText("Projects this week")).toBeTruthy();
    expect(screen.getByText("Project One")).toBeTruthy();
  });

  it("keeps zero-entry reports visible instead of dropping them", async () => {
    getTeamTimeEntries.mockResolvedValue([]);
    render(<TeamPage teamContext={teamContext} projects={projects} tasks={tasks} />);
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
    render(<TeamPage teamContext={teamContext} projects={projects} tasks={tasks} />);
    await screen.findByText("Avery Example");

    expect(screen.getByText(/returned\s+none of their entries/)).toBeTruthy();
    expect(screen.getByText(/hierarchy security is off/)).toBeTruthy();
  });

  it("says nothing about it once a report's rows come back", async () => {
    getTeamTimeEntries.mockResolvedValue([entry({})]);
    render(<TeamPage teamContext={teamContext} projects={projects} tasks={tasks} />);
    await screen.findByText("Avery Example");

    expect(screen.queryByText(/hierarchy security is off/)).toBeNull();
  });

  it("surfaces load failures with a retry", async () => {
    getTeamTimeEntries.mockRejectedValueOnce(new Error("hierarchy security not enabled"));
    getTeamTimeEntries.mockResolvedValue([entry({})]);
    render(<TeamPage teamContext={teamContext} projects={projects} tasks={tasks} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("hierarchy security not enabled");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
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

  it("disables the export button until the visible week has entries", async () => {
    getTeamTimeEntries.mockResolvedValue([]);
    render(<TeamPage teamContext={teamContext} projects={projects} tasks={tasks} />);
    await screen.findByText("Avery Example");
    expect(screen.getByRole("button", { name: /Export CSV/ }).hasAttribute("disabled")).toBe(true);
    cleanup();

    getTeamTimeEntries.mockResolvedValue([entry({})]);
    render(<TeamPage teamContext={teamContext} projects={projects} tasks={tasks} />);
    await screen.findAllByText("2h");
    expect(screen.getByRole("button", { name: /Export CSV/ }).hasAttribute("disabled")).toBe(false);
  });

  it("exports every visible member's rows, labeled by owner rather than the manager's own name", async () => {
    getTeamTimeEntries.mockResolvedValue([
      entry({}), // Avery
      entry({ id: "te-2", ownerId: "su-me", ownerName: "User One", userId: "su-me", date: "2026-07-28", durationMinutes: 60 }),
    ]);
    render(<TeamPage teamContext={teamContext} projects={projects} tasks={tasks} />);
    await screen.findByText("Avery Example");

    const csv = (await captureExport()).replace("﻿", "");
    const rows = csv.trim().split("\n");
    expect(rows).toHaveLength(3); // header + Avery's row + the manager's own row
    expect(csv).toContain("Avery Example");
    expect(csv).toContain("User One");
  });

  it("remembers the chosen rounding rule as its own device preference, separate from Reports", async () => {
    getTeamTimeEntries.mockResolvedValue([entry({})]);
    render(<TeamPage teamContext={teamContext} projects={projects} tasks={tasks} />);
    await screen.findByText("Avery Example");
    fireEvent.change(screen.getByLabelText("Duration rounding applied to the CSV export"), {
      target: { value: "up15" },
    });
    expect(localStorage.getItem("tt_team_export_rounding")).toBe("up15");
    expect(localStorage.getItem("tt_export_rounding")).toBeNull();
  });
});
