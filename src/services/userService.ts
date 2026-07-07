import type { CurrentUser } from "../types";
import { getContext } from "@microsoft/power-apps/app";

const LOCAL_USER_KEY = "tt_local_user";

let cached: CurrentUser | null = null;

// "current" is the connector's special token meaning "the environment this
// connection belongs to." Passing it to every *WithOrganization call makes a
// single promoted artifact target dev in dev, QA in QA, and prod in prod
// without baking any URL at build time. Confirmed working via GetOrganizations()
// returning "current" as the Url, and app loading without errors.
const CONNECTOR_CURRENT = "current";

// getContext() only resolves via a postMessage handshake with the Power Apps
// host frame (see @microsoft/power-apps's DefaultPowerAppsBridge) — it never
// rejects on its own, it just hangs forever if there's no host to answer.
// So a production-mode build served outside the host (e.g. `vite preview`)
// would sit at "Signing in…" indefinitely if we trusted import.meta.env.PROD
// alone. hostConfirmed instead reflects whether the handshake actually
// succeeded (bounded by GET_CONTEXT_TIMEOUT_MS below), which is the real
// signal for whether Dataverse calls will work.
let hostConfirmed: boolean | null = null;
const GET_CONTEXT_TIMEOUT_MS = 8000;

export function isPowerAppsHost(): boolean {
  // Before the first initCurrentUser() resolves, fall back to the build-mode
  // heuristic so early synchronous callers keep today's behavior.
  return hostConfirmed ?? import.meta.env.PROD;
}

export function getDataverseOrgUrl(): string {
  return CONNECTOR_CURRENT;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("getContext() timed out")), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export async function initCurrentUser(): Promise<CurrentUser> {
  if (cached) return cached;

  if (import.meta.env.PROD) {
    try {
      const ctx = await withTimeout(getContext(), GET_CONTEXT_TIMEOUT_MS);
      const u = ctx.user;
      const id = u.objectId ?? u.userPrincipalName ?? "";
      if (id) {
        hostConfirmed = true;
        cached = {
          id,
          email: u.userPrincipalName ?? "",
          displayName: u.fullName ?? u.userPrincipalName ?? "You",
          environmentId: ctx.app.environmentId ?? "unknown-env",
        };
        return cached;
      }
      hostConfirmed = false;
    } catch {
      // No host answered (or it timed out) — fall through to local fallback
      // so the app still loads instead of hanging at "Signing in…".
      hostConfirmed = false;
    }
  } else {
    hostConfirmed = false;
  }

  // Local dev fallback — persist so user-scoped data is stable across reloads.
  let raw = localStorage.getItem(LOCAL_USER_KEY);
  if (!raw) {
    const fresh: CurrentUser = {
      id: "local-" + crypto.randomUUID(),
      email: "local@dev",
      displayName: "Local User",
      environmentId: "local-dev",
    };
    raw = JSON.stringify(fresh);
    localStorage.setItem(LOCAL_USER_KEY, raw);
  }
  cached = JSON.parse(raw) as CurrentUser;
  if (!cached.environmentId) {
    cached.environmentId = "local-dev";
    localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(cached));
  }
  return cached;
}

export function getCurrentUser(): CurrentUser {
  if (!cached) {
    throw new Error("User not initialised. Call initCurrentUser() before reading the current user.");
  }
  return cached;
}
