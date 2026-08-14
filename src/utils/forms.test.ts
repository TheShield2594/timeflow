import { describe, it, expect } from "vitest";
import { isDirtyDraft } from "./forms";

describe("isDirtyDraft", () => {
  const pristine = { name: "", description: "", ratio: "" };

  it("is clean against an equal-valued but distinct object", () => {
    // The case that matters: parents rebuild `initial` every render, so an
    // identity check would report every form dirty from the first frame.
    expect(isDirtyDraft({ ...pristine }, pristine)).toBe(false);
  });

  it("is dirty as soon as one field diverges", () => {
    expect(isDirtyDraft({ ...pristine, name: "Migration" }, pristine)).toBe(true);
  });

  it("notices a field being cleared, not just filled", () => {
    const filled = { name: "Migration", description: "", ratio: "" };
    expect(isDirtyDraft({ ...filled, name: "" }, filled)).toBe(true);
  });
});
