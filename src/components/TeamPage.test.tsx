import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { TeamPage } from "./TeamPage";
import type { TeamEntry } from "../services/teamService";

vi.mock("../services/userService", () => ({
  getCurrentUser: () => ({ id: "aad-object-id", email: "u@example.com", displayName: "User One", environmentId: "env-1" }),
}));
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const getTeamTimeEntries = vi.fn<(from: string, to: string) => Promise<TeamEntry[]>>();
vi.mock("../services/teamService", () => ({
  getTeamTimeEntries: (from: string, to: string) => getTeamTimeEntries(from, to),
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

describe("TeamPage", () => {
  it("shows per-member week totals, flags missing weekdays, and rolls up projects", async () => {
    getTeamTimeEntries.mockResolvedValue([
      entry({}), // Avery, Monday, 2h on Project One
      entry({ id: "te-2", ownerId: "su-me", ownerName: "User One", userId: "su-me", date: "2026-07-28", durationMinutes: 60 }),
    ]);
    render(<TeamPage teamContext={teamContext} projects={projects} />);

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
    render(<TeamPage teamContext={teamContext} projects={projects} />);
    expect(await screen.findByText("Avery Example")).toBeTruthy();
    expect(screen.getByText("Jordan Sample")).toBeTruthy();
  });

  it("surfaces load failures with a retry", async () => {
    getTeamTimeEntries.mockRejectedValueOnce(new Error("hierarchy security not enabled"));
    getTeamTimeEntries.mockResolvedValue([entry({})]);
    render(<TeamPage teamContext={teamContext} projects={projects} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("hierarchy security not enabled");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect((await screen.findAllByText("2h")).length).toBeGreaterThan(0);
  });
});
