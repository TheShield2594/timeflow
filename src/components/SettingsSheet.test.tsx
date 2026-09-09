/**
 * Working hours are a correctness setting rather than a preference — they are
 * the window the app searches before telling somebody their day is complete —
 * so the thing worth pinning down is that the sheet round-trips what it was
 * given instead of quietly resetting it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SettingsSheet } from "./SettingsSheet";
import { DEFAULT_WORKING_HOURS, normalizeWorkingHours } from "../hooks/useWorkingHours";
import { MINUTES_PER_DAY } from "../utils/dates";

vi.mock("@microsoft/power-apps/app", () => ({ getContext: vi.fn() }));
vi.mock("../services/userService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/userService")>()),
  getCurrentUser: () => ({ id: "user-1", email: "u@example.com", displayName: "U", environmentId: "env-1" }),
}));
vi.mock("../generated", () => ({ MicrosoftDataverseService: {} }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderSheet(over: Partial<React.ComponentProps<typeof SettingsSheet>> = {}) {
  const onChange = vi.fn();
  const view = render(
    <SettingsSheet
      workingHours={DEFAULT_WORKING_HOURS}
      onChange={onChange}
      onClose={vi.fn()}
      {...over}
    />
  );
  return { ...view, onChange };
}

describe("SettingsSheet", () => {
  it("shows the stored window on the 24-hour clock the fields take", () => {
    renderSheet({ workingHours: { ...DEFAULT_WORKING_HOURS, startMin: 6 * 60, endMin: 17 * 60 + 30 } });
    expect((screen.getByLabelText("Day starts") as HTMLInputElement).value).toBe("06:00");
    expect((screen.getByLabelText("Day ends") as HTMLInputElement).value).toBe("17:30");
  });

  it("round-trips a day that runs to midnight instead of resetting it", () => {
    // A day ending at 24:00 has no <input type="time"> representation: the
    // element sanitizes it away, the empty field reads back as 0, and saving
    // silently reset the window to the 18:00 default. normalizeWorkingHours
    // holds it at 23:59 so the field can show it and hand it back unchanged.
    const stored = normalizeWorkingHours({ startMin: 6 * 60, endMin: MINUTES_PER_DAY });
    const { onChange } = renderSheet({ workingHours: stored });

    const end = screen.getByLabelText("Day ends") as HTMLInputElement;
    expect(end.value).toBe("23:59");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ startMin: 6 * 60, endMin: MINUTES_PER_DAY - 1 });
  });

  it("refuses a day that ends before it starts, and says what it will keep", () => {
    renderSheet({ workingHours: { ...DEFAULT_WORKING_HOURS, startMin: 9 * 60, endMin: 17 * 60 } });
    fireEvent.change(screen.getByLabelText("Day ends"), { target: { value: "08:00" } });
    expect(screen.getByText(/The day has to end after it starts/)).toBeTruthy();
  });
});
