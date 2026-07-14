import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useTheme } from "./useTheme";

function mockMatchMedia(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-color-scheme: dark") ? prefersDark : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  mockMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useTheme", () => {
  it("uses a valid stored theme over the OS preference", () => {
    localStorage.setItem("tt_theme", "dark");
    mockMatchMedia(false);

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignores an invalid stored value and falls back to the OS preference", () => {
    localStorage.setItem("tt_theme", "hotdog");
    mockMatchMedia(true);

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows the OS preference on first run (nothing stored)", () => {
    mockMatchMedia(true);
    expect(renderHook(() => useTheme()).result.current.theme).toBe("dark");
    cleanup();

    mockMatchMedia(false);
    expect(renderHook(() => useTheme()).result.current.theme).toBe("light");
  });

  it("defaults to light when matchMedia is unavailable", () => {
    // @ts-expect-error simulate an environment without matchMedia
    window.matchMedia = undefined;
    expect(renderHook(() => useTheme()).result.current.theme).toBe("light");
  });

  it("toggleTheme flips the document attribute and persists the choice", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => { result.current.toggleTheme(); });

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("tt_theme")).toBe("dark");

    act(() => { result.current.toggleTheme(); });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("tt_theme")).toBe("light");
  });
});
