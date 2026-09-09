import { describe, it, expect } from "vitest";
import { paceSentence } from "./pace";

/**
 * The rail's one sentence. It is advice about a number people bill from, so
 * the boundary it draws — on pace or behind it — has to be the same boundary
 * the ring is drawing.
 */
describe("paceSentence", () => {
  it("says nothing at all without a target", () => {
    expect(paceSentence(600, 0, 2)).toBeNull();
  });

  it("counts a Tuesday as two fifths of the week elapsed", () => {
    // 40h target, Tuesday: 16h is exactly on pace, 15h59m is behind it.
    expect(paceSentence(16 * 60, 40, 1)!.text).toMatch(/^On pace\./);
    expect(paceSentence(16 * 60 - 1, 40, 1)!.text).toMatch(/^Behind pace for a Tuesday\./);
  });

  it("names the days left rather than a percentage", () => {
    expect(paceSentence(16 * 60, 40, 1)!.text).toBe("On pace. 24h left across Wednesday to Friday.");
    // On Thursday there is one working day left, and "across Friday to Friday"
    // is not something anybody says.
    expect(paceSentence(32 * 60, 40, 3)!.text).toBe("On pace. 8h left on Friday.");
  });

  it("stops giving advice once the target is met", () => {
    expect(paceSentence(40 * 60, 40, 1)).toEqual({ met: true, text: "Target met." });
    expect(paceSentence(41 * 60, 40, 1)).toEqual({ met: true, text: "Target met, 1h past it." });
  });

  it("treats the weekend as a week that has fully elapsed", () => {
    // By Saturday the plan was for all of it to be done, so anything short of
    // the target is behind — not "on pace with two days left".
    expect(paceSentence(30 * 60, 40, 5)!.text).toBe("Behind pace for a Saturday. 10h left this week.");
  });
});
