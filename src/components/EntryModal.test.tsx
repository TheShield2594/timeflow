import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EntryModal, type EntryDraft, type EntrySaveData } from "./EntryModal";
import type { Project } from "../types";

vi.mock("../hooks/useFocusTrap", () => ({ useFocusTrap: () => ({ current: null }) }));
// EntryModal only needs formatMinutes/parseRatioInput from the hooks barrel,
// which transitively pulls in the generated Dataverse SDK; stub it out so
// tests don't need a Power Apps host (see CalendarPage.test.tsx for precedent).
vi.mock("../services/userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
}));
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const projects: Project[] = [
  { id: "proj-1", name: "Project One", color: "#719500", isActive: true, createdAt: "" },
];

const baseDraft: EntryDraft = {
  date: "2026-07-07",
  startTime: "22:00",
  endTime: "02:00", // before start-of-day -> overnight conflict
  description: "",
  projectId: "proj-1",
  taskId: "",
  jiraTicket: "",
  ratio: "",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EntryModal overnight split — UTC+ timezone", () => {
  // Sydney is UTC+10 in July (no DST), the exact case the bug report
  // describes: local midnight converts to the *previous* UTC day.
  beforeAll(() => { vi.stubEnv("TZ", "Australia/Sydney"); });
  afterAll(() => { vi.unstubAllEnvs(); });

  it("stamps the second half of a split entry with the next calendar day", async () => {
    const onSave = vi.fn<(data: EntrySaveData) => Promise<unknown>>().mockResolvedValue(undefined);
    render(
      <EntryModal
        title="Log Time"
        initial={baseDraft}
        projects={projects}
        tasks={[]}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    // Overnight conflict is auto-detected; choose the split option.
    fireEvent.click(screen.getByText("Split at midnight"));
    fireEvent.click(screen.getByText("Save"));

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));

    const [firstHalf, secondHalf] = onSave.mock.calls.map((c) => c[0]);
    expect(firstHalf.date).toBe("2026-07-07");
    expect(secondHalf.date).toBe("2026-07-08");
  });
});
