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

describe("EntryModal help tip", () => {
  it("Escape closes only the open help popover, keeping the modal (and its draft) alive", () => {
    const onClose = vi.fn();
    render(
      <EntryModal
        title="Log Time"
        initial={{ ...baseDraft, endTime: "23:00" }}
        projects={projects}
        tasks={[]}
        onSave={vi.fn()}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByLabelText("What is Ratio?"));
    expect(screen.getByRole("tooltip")).toBeTruthy();

    // Keydown targets a descendant (as in a real browser, where the focused
    // element receives it) — HelpTip's capture-phase handler must swallow it
    // before EntryModal's own window-level Escape handler closes the modal.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // With the popover gone, Escape reaches the modal again.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
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

    // First half: start-of-session (22:00 local on the 7th) through local midnight.
    expect(firstHalf.date).toBe("2026-07-07");
    expect(firstHalf.startTime).toBe("2026-07-07T12:00:00.000Z"); // 22:00 AEST (UTC+10)
    expect(firstHalf.endTime).toBe("2026-07-07T14:00:00.000Z");   // local midnight
    expect(firstHalf.durationMinutes).toBe(120);

    // Second half must be stamped on the *next* local day, and its endTime
    // must actually be the next day too (02:00 local on the 8th) — this is
    // the companion bug the toISOString() fix uncovered: without offsetting
    // endDt for split mode, endTime here would wrongly stay on the 7th.
    expect(secondHalf.date).toBe("2026-07-08");
    expect(secondHalf.startTime).toBe("2026-07-07T14:00:00.000Z"); // local midnight
    expect(secondHalf.endTime).toBe("2026-07-07T16:00:00.000Z");   // 02:00 AEST on the 8th
    expect(secondHalf.durationMinutes).toBe(120);
  });

  it("does not duplicate the already-saved first half when retrying after the second half fails", async () => {
    const onSave = vi.fn<(data: EntrySaveData) => Promise<unknown>>()
      .mockResolvedValueOnce(undefined)              // first half saves
      .mockRejectedValueOnce(new Error("offline"))   // second half fails
      .mockResolvedValue(undefined);                 // retry succeeds
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

    fireEvent.click(screen.getByText("Split at midnight"));
    fireEvent.click(screen.getByText("Save"));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));

    // The modal stays open after the failure; a retry must only re-attempt
    // the second half, not re-create the first.
    fireEvent.click(screen.getByText("Save"));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(3));

    const dates = onSave.mock.calls.map((c) => c[0].date);
    expect(dates).toEqual(["2026-07-07", "2026-07-08", "2026-07-08"]);
  });
});

describe("EntryModal unsaved-work guard", () => {
  const cleanDraft: EntryDraft = { ...baseDraft, endTime: "23:00" };

  function renderModal(onClose = vi.fn()) {
    const { container } = render(
      <EntryModal
        title="Log Time"
        initial={cleanDraft}
        projects={projects}
        tasks={[]}
        onSave={vi.fn()}
        onClose={onClose}
      />
    );
    const backdrop = container.querySelector(".cal-modal-overlay") as HTMLElement;
    const type = (text: string) =>
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: text } });
    return { onClose, backdrop, type };
  }

  it("closes on a backdrop click while the form is untouched", () => {
    const { onClose, backdrop } = renderModal();
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a backdrop click once something has been typed", () => {
    const { onClose, backdrop, type } = renderModal();
    type("Reviewing the Q3 numbers");

    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    // Not even a prompt: a brushed backdrop is not an instruction.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Description")).toHaveProperty("value", "Reviewing the Q3 numbers");
  });

  it("asks before Escape throws away a filled-in form", () => {
    const { onClose, type } = renderModal();
    type("Reviewing the Q3 numbers");

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Discard");

    fireEvent.click(screen.getByText("Discard"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns to the form with its values intact when the discard is declined", () => {
    const { onClose, type } = renderModal();
    type("Reviewing the Q3 numbers");
    fireEvent.click(screen.getByText("Cancel"));

    fireEvent.click(screen.getByText("Keep editing"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Save")).toBeTruthy();
    expect(screen.getByLabelText("Description")).toHaveProperty("value", "Reviewing the Q3 numbers");
  });

  it("treats Escape at the confirmation as backing out of the question, not the entry", () => {
    const { onClose, type } = renderModal();
    type("Reviewing the Q3 numbers");
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Save")).toBeTruthy();
  });

  it("still closes without a prompt when nothing was typed", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("counts a project change as work worth keeping, not just typed text", () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "" } });

    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
