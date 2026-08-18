import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, cleanup } from "@testing-library/react";
import { useOnlineStatus } from "./useOnlineStatus";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useOnlineStatus", () => {
  it("starts from navigator.onLine", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    expect(renderHook(() => useOnlineStatus()).result.current).toBe(false);
  });

  it("follows the offline and online events", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    onLine.mockReturnValue(false);
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(result.current).toBe(false);

    onLine.mockReturnValue(true);
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(result.current).toBe(true);
  });

  // Anything other than an explicit `false` counts as online: a host that
  // doesn't implement the property must not leave the app permanently claiming
  // an outage.
  it("treats an unimplemented navigator.onLine as online", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(undefined as unknown as boolean);

    expect(renderHook(() => useOnlineStatus()).result.current).toBe(true);
  });
});
