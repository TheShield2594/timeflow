import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Project, Task, TimeEntry } from "../types";
import { EntryRow } from "./EntryRow";

// The hooks barrel transitively imports the generated Dataverse SDK; this row
// only needs formatMinutes from it, so stub the rest.
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));
vi.mock("../services/userService", () => ({
  getCurrentUser: () => ({ id: "u1", email: "u1@example.com", displayName: "U", environmentId: "env-1" }),
}));

const project: Project = { id: "p1", name: "IT Meeting", color: "#3b82f6", isActive: true, createdAt: "" };
const task: Task = { id: "t1", projectId: "p1", name: "1:1", isActive: true };

const entry: TimeEntry = {
  id: "e1", projectId: "p1", taskId: "t1", description: "Brandon and Lisabeth",
  startTime: "2026-07-29T15:00:00", endTime: "2026-07-29T16:00:00",
  durationMinutes: 60, date: "2026-07-29", userId: "u1", userDisplayName: "U",
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("EntryRow", () => {
  it("renders the duration as a fixed-shape H:MM so a day's rows line up", () => {
    const { rerender } = render(<EntryRow entry={entry} project={project} />);
    expect(screen.getByText("1:00")).not.toBeNull();

    rerender(<EntryRow entry={{ ...entry, durationMinutes: 30 }} project={project} />);
    // "30m" and "1h" can't align as a column no matter how they're spaced.
    expect(screen.getByText("0:30")).not.toBeNull();
    expect(screen.queryByText("30m")).toBeNull();
  });

  it("keeps the spelled-out duration available on the title", () => {
    render(<EntryRow entry={{ ...entry, durationMinutes: 165 }} project={project} />);
    expect(screen.getByText("2:45").getAttribute("title")).toBe("2h 45m");
  });

  it("collapses project, task, ticket and ratio onto one meta line", () => {
    render(
      <EntryRow
        entry={{ ...entry, jiraTicket: "PROJ-123", ratio: 1 }}
        project={project}
        task={task}
      />
    );
    const meta = document.querySelector(".entry-row__meta")!;
    // One line of trailing-off detail, not four identical pills.
    expect(meta.textContent).toBe("IT Meeting1:1PROJ-123Ratio 1");
    expect(document.querySelectorAll(".badge").length).toBe(0);
  });

  it("renders the actions so hover/focus can reveal them, rather than dropping them", () => {
    render(
      <EntryRow entry={entry} project={project} onContinue={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />
    );
    // In the DOM and focusable — CSS handles the reveal, so keyboard users
    // still reach them.
    expect(screen.getByRole("button", { name: /Continue working on/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Edit/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Delete/ })).not.toBeNull();
  });

  it("offers no edit or delete on a still-running entry", () => {
    // The timer bar owns the running session; deleting its draft row would
    // strand the stop in a 404-retry loop.
    render(
      <EntryRow
        entry={{ ...entry, endTime: undefined, durationMinutes: undefined }}
        project={project}
        onContinue={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Running…")).not.toBeNull();
  });

  it("disables Continue when the project is archived or the timer is busy", () => {
    const archived = { ...project, isActive: false };
    const { rerender } = render(<EntryRow entry={entry} project={archived} onContinue={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Continue/ }).hasAttribute("disabled")).toBe(true);

    rerender(<EntryRow entry={entry} project={project} timerBusy onContinue={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Continue/ }).hasAttribute("disabled")).toBe(true);
  });
});

describe("EntryRow — why Continue is unavailable (#106)", () => {
  it("states the reason somewhere a screen reader can reach it", () => {
    const { rerender } = render(
      <EntryRow entry={entry} project={project} timerBusy onContinue={vi.fn()} />
    );

    const button = screen.getByLabelText(/^Continue working on/);
    expect(button.hasAttribute("disabled")).toBe(true);
    const describedBy = button.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)!.textContent).toBe("Timer already running");

    rerender(
      <EntryRow entry={entry} project={{ ...project, isActive: false }} onContinue={vi.fn()} />
    );
    const archived = screen.getByLabelText(/^Continue working on/);
    expect(
      document.getElementById(archived.getAttribute("aria-describedby")!)!.textContent
    ).toBe("Project is archived");
  });

  it("describes nothing when Continue is available", () => {
    render(<EntryRow entry={entry} project={project} onContinue={vi.fn()} />);
    const button = screen.getByLabelText(/^Continue working on/);
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("aria-describedby")).toBeNull();
  });
});
