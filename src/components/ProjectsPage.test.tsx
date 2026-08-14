import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ProjectsPage } from "./ProjectsPage";
import type { Project } from "../types";

// The hooks barrel transitively pulls in the generated Dataverse SDK; stub it
// out so this test doesn't need a Power Apps host (same shape as
// EntryModal.test.tsx).
vi.mock("../services/userService", () => ({
  getCurrentUser: () => ({ id: "user-1", email: "user1@example.com", displayName: "User One", environmentId: "env-1" }),
}));
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

const projects: Project[] = [
  { id: "proj-1", name: "Project One", color: "#719500", isActive: true, createdAt: "" },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  render(
    <ProjectsPage
      projects={projects}
      tasks={[]}
      entries={[]}
      onAddProject={vi.fn()}
      onEditProject={vi.fn()}
      onArchiveProject={vi.fn()}
      onRestoreProject={vi.fn()}
      onAddTask={vi.fn()}
      onDeleteTask={vi.fn()}
      onRenameTask={vi.fn()}
      onLoadTasksForProject={vi.fn()}
    />
  );
}

describe("ProjectsPage new-project form", () => {
  it("cancels an untouched form without asking", () => {
    renderPage();
    fireEvent.click(screen.getByText("New Project"));

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByPlaceholderText("Project name")).toBeNull();
  });

  it("asks before Cancel throws away a half-filled form (#104)", () => {
    renderPage();
    fireEvent.click(screen.getByText("New Project"));
    fireEvent.change(screen.getByPlaceholderText("Project name"), { target: { value: "Migration" } });

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByRole("alert").textContent).toContain("Discard");
    // The form is still there behind the question.
    expect(screen.getByPlaceholderText("Project name")).toHaveProperty("value", "Migration");

    fireEvent.click(screen.getByText("Discard"));
    expect(screen.queryByPlaceholderText("Project name")).toBeNull();
  });

  it("keeps the typed name when the discard is declined", () => {
    renderPage();
    fireEvent.click(screen.getByText("New Project"));
    fireEvent.change(screen.getByPlaceholderText("Project name"), { target: { value: "Migration" } });
    fireEvent.click(screen.getByText("Cancel"));

    fireEvent.click(screen.getByText("Keep editing"));
    expect(screen.getByPlaceholderText("Project name")).toHaveProperty("value", "Migration");
    expect(screen.getByText("Create")).toBeTruthy();
  });

  it("treats an edit form as untouched until a field actually changes", () => {
    renderPage();
    // The card menu is the only way into the edit form.
    fireEvent.click(screen.getByLabelText("Actions for Project One"));
    fireEvent.click(screen.getByText("Edit"));
    expect(screen.getByPlaceholderText("Project name")).toHaveProperty("value", "Project One");

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByPlaceholderText("Project name")).toBeNull();
  });
});
