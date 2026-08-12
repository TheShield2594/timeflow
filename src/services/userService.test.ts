/**
 * `isPowerAppsHost()` decides where every read and write in the app goes:
 * Dataverse, or the localStorage mock. A false negative means a user's time
 * silently lands in a mock store on their own device while the UI reports
 * success — so the host probe, its retry loop and its fallbacks are worth
 * pinning down (#90).
 *
 * Each test re-imports the module: `cached` and `hostConfirmed` are module
 * state, and the whole point here is what they do on a cold start.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getContext } = vi.hoisted(() => ({ getContext: vi.fn() }));
vi.mock("@microsoft/power-apps/app", () => ({ getContext }));

type UserService = typeof import("./userService");

async function freshImport(): Promise<UserService> {
  vi.resetModules();
  return import("./userService");
}

/** Pretend the app is (or isn't) inside a host frame. jsdom's window.top is
 *  the window itself, which is what "not embedded" looks like. */
function setEmbedded(mode: "embedded" | "standalone" | "cross-origin") {
  if (mode === "cross-origin") {
    // Reading window.top across origins throws — how the real host embeds us.
    Object.defineProperty(window, "top", {
      get() { throw new DOMException("Blocked a frame", "SecurityError"); },
      configurable: true,
    });
    return;
  }
  Object.defineProperty(window, "top", {
    value: mode === "embedded" ? { name: "host-frame" } : window,
    configurable: true,
  });
}

const hostContext = {
  user: { objectId: "aad-1", userPrincipalName: "user@contoso.com", fullName: "User One" },
  app: { environmentId: "env-1" },
};

beforeEach(() => {
  setEmbedded("standalone");
  localStorage.clear();
  getContext.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("isPowerAppsHost before the probe has run", () => {
  it("assumes a host in a production build", async () => {
    vi.stubEnv("PROD", true);
    const { isPowerAppsHost } = await freshImport();
    // Nothing has confirmed anything yet; a production bundle is overwhelmingly
    // likely to be running in the host, and guessing "no host" here would
    // point early synchronous callers at the mock.
    expect(isPowerAppsHost()).toBe(true);
  });

  it("assumes no host in a dev build", async () => {
    vi.stubEnv("PROD", false);
    const { isPowerAppsHost } = await freshImport();
    expect(isPowerAppsHost()).toBe(false);
  });
});

describe("host detection in a dev build", () => {
  it("uses the local identity and reports no host, without calling getContext", async () => {
    vi.stubEnv("PROD", false);
    const { initCurrentUser, isPowerAppsHost } = await freshImport();

    const user = await initCurrentUser();

    expect(getContext).not.toHaveBeenCalled();
    expect(user.id).toMatch(/^local-/);
    expect(user.environmentId).toBe("local-dev");
    expect(isPowerAppsHost()).toBe(false);
  });

  it("keeps the same local identity across reloads", async () => {
    vi.stubEnv("PROD", false);
    const first = await (await freshImport()).initCurrentUser();
    const second = await (await freshImport()).initCurrentUser();

    expect(second.id).toBe(first.id);
  });

  it("repairs a stored identity that predates environmentId", async () => {
    vi.stubEnv("PROD", false);
    localStorage.setItem("tt_local_user", JSON.stringify({
      id: "local-old", email: "local@dev", displayName: "Local User",
    }));
    const { initCurrentUser } = await freshImport();

    const user = await initCurrentUser();

    expect(user.id).toBe("local-old");
    expect(user.environmentId).toBe("local-dev");
    expect(JSON.parse(localStorage.getItem("tt_local_user")!).environmentId).toBe("local-dev");
  });
});

describe("host detection in a production build", () => {
  it("adopts the host identity and confirms the host", async () => {
    vi.stubEnv("PROD", true);
    setEmbedded("embedded");
    getContext.mockResolvedValue(hostContext);
    const { initCurrentUser, isPowerAppsHost, getCurrentUser } = await freshImport();

    const user = await initCurrentUser();

    expect(user).toEqual({
      id: "aad-1",
      email: "user@contoso.com",
      displayName: "User One",
      environmentId: "env-1",
    });
    expect(isPowerAppsHost()).toBe(true);
    expect(getCurrentUser()).toBe(user);
  });

  it("treats a cross-origin window.top as embedded rather than standalone", async () => {
    vi.stubEnv("PROD", true);
    setEmbedded("cross-origin");
    getContext.mockResolvedValue(hostContext);
    const { initCurrentUser, isPowerAppsHost } = await freshImport();

    // The SecurityError *is* the signal: only a real cross-origin host frame
    // throws here. Reading it as "not embedded" would send every write to
    // localStorage in production.
    await expect(initCurrentUser()).resolves.toMatchObject({ id: "aad-1" });
    expect(isPowerAppsHost()).toBe(true);
  });

  it("falls back to the principal name when the host gives no object id", async () => {
    vi.stubEnv("PROD", true);
    setEmbedded("embedded");
    getContext.mockResolvedValue({
      user: { userPrincipalName: "user@contoso.com" },
      app: {},
    });
    const { initCurrentUser } = await freshImport();

    const user = await initCurrentUser();

    expect(user.id).toBe("user@contoso.com");
    expect(user.displayName).toBe("user@contoso.com");
    expect(user.environmentId).toBe("unknown-env");
  });

  it("fails closed outside the host frame instead of signing in as a local user", async () => {
    vi.stubEnv("PROD", true);
    setEmbedded("standalone");
    const { initCurrentUser, isPowerAppsHost } = await freshImport();

    // A production bundle served from anywhere but Power Apps — `vite
    // preview`, a copied dist folder. There is nobody to authenticate
    // against, and adopting the unauthenticated localStorage identity is only
    // contained by isPowerAppsHost() *also* switching the data layer to the
    // mock. Don't rely on that coupling: refuse to sign in at all.
    await expect(initCurrentUser()).rejects.toThrow(/Power Apps host/);
    expect(getContext).not.toHaveBeenCalled();
    expect(localStorage.getItem("tt_local_user")).toBeNull();
    // Nothing was confirmed, so the flag stays on its build-mode default and
    // no write is ever routed to the mock under a production build.
    expect(isPowerAppsHost()).toBe(true);
  });
});

describe("the getContext handshake retry loop", () => {
  it("retries once more after a timeout, then gives up", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PROD", true);
    setEmbedded("embedded");
    // getContext never rejects on its own — with no host to answer the
    // postMessage handshake it simply hangs, which is what the timeout is for.
    getContext.mockReturnValue(new Promise(() => {}));
    const { initCurrentUser } = await freshImport();

    const pending = initCurrentUser();
    const settled = pending.catch((err: Error) => err);

    // The first timeout fires and the second attempt starts immediately.
    await vi.advanceTimersByTimeAsync(8000);
    expect(getContext).toHaveBeenCalledTimes(2);

    // Two attempts is the budget: the second timeout ends the whole thing.
    await vi.advanceTimersByTimeAsync(8000);
    expect(getContext).toHaveBeenCalledTimes(2);

    expect(await settled).toBeInstanceOf(Error);
    expect((await settled as Error).message).toMatch(/timed out/);
  });

  it("does not give up before the timeout has actually elapsed", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PROD", true);
    setEmbedded("embedded");
    getContext.mockReturnValue(new Promise(() => {}));
    const { initCurrentUser } = await freshImport();

    void initCurrentUser().catch(() => {});
    await vi.advanceTimersByTimeAsync(7999);

    // A slow host is still a host; retrying early would just add load to a
    // handshake that's about to land.
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("succeeds on the second attempt when the first one fails", async () => {
    vi.stubEnv("PROD", true);
    setEmbedded("embedded");
    getContext
      .mockRejectedValueOnce(new Error("bridge not ready"))
      .mockResolvedValueOnce(hostContext);
    const { initCurrentUser, isPowerAppsHost } = await freshImport();

    await expect(initCurrentUser()).resolves.toMatchObject({ id: "aad-1" });
    expect(getContext).toHaveBeenCalledTimes(2);
    expect(isPowerAppsHost()).toBe(true);
  });

  it("surfaces the failure rather than degrading to the mock when the host never answers", async () => {
    vi.stubEnv("PROD", true);
    setEmbedded("embedded");
    getContext.mockRejectedValue(new Error("bridge not ready"));
    const { initCurrentUser, isPowerAppsHost } = await freshImport();

    // Embedded in a frame, so a real host is plausible — falling through to
    // localStorage here is exactly how a user's time would vanish while the
    // UI said "saved".
    await expect(initCurrentUser()).rejects.toThrow("bridge not ready");
    expect(localStorage.getItem("tt_local_user")).toBeNull();
    expect(isPowerAppsHost()).toBe(true);
  });

  it("treats a host that answers without an identity as a failure", async () => {
    vi.stubEnv("PROD", true);
    setEmbedded("embedded");
    getContext.mockResolvedValue({ user: {}, app: { environmentId: "env-1" } });
    const { initCurrentUser } = await freshImport();

    await expect(initCurrentUser()).rejects.toThrow(/no user identity/);
    expect(getContext).toHaveBeenCalledTimes(2);
  });
});

describe("getCurrentUser", () => {
  it("throws until initCurrentUser has resolved", async () => {
    vi.stubEnv("PROD", false);
    const { getCurrentUser, initCurrentUser } = await freshImport();

    expect(() => getCurrentUser()).toThrow(/not initialised/i);
    await initCurrentUser();
    expect(getCurrentUser().id).toMatch(/^local-/);
  });

  it("returns the cached user without probing again", async () => {
    vi.stubEnv("PROD", true);
    setEmbedded("embedded");
    getContext.mockResolvedValue(hostContext);
    const { initCurrentUser } = await freshImport();

    const first = await initCurrentUser();
    const second = await initCurrentUser();

    expect(second).toBe(first);
    expect(getContext).toHaveBeenCalledTimes(1);
  });
});

describe("getDataverseOrgUrl", () => {
  it("is the connector's 'current' token, so one artifact targets every environment", async () => {
    const { getDataverseOrgUrl } = await freshImport();
    expect(getDataverseOrgUrl()).toBe("current");
  });
});
