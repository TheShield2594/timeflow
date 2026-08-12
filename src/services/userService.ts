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
// alone; it is turned away up front instead (see initCurrentUser).
// hostConfirmed reflects whether the handshake actually succeeded, which is
// the real signal for whether Dataverse calls will work.
let hostConfirmed: boolean | null = null;
const GET_CONTEXT_TIMEOUT_MS = 8000;
const GET_CONTEXT_ATTEMPTS = 2;

/**
 * Whether Dataverse calls will actually reach a host — i.e. whether every
 * read and write in the app goes to Dataverse or to the localStorage mock.
 * `dataverseService`, `teamService` and `outlookService` all branch on this.
 *
 * Note the coupling this flag carries: it switches the *data layer* and, via
 * initCurrentUser below, is set on the same path that decides whether the
 * app runs on a real host identity or the local dev one. They must stay
 * together — a build that trusted the local identity while writing to
 * Dataverse would stamp real rows with an unauthenticated user, and one that
 * trusted a host identity while writing to the mock would drop real work
 * into localStorage. Anything that moves this flag has to move both.
 */
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

// The bridge's handshake posts a message to window.parent — that's only
// meaningful if this app is actually embedded in a host frame. If we're not
// embedded (window.self === window.top), no host could ever answer, so
// there's no point waiting: a production build says so immediately instead
// of hanging at "Signing in…" for the full timeout. If we ARE embedded, a
// real host is plausible, so a slow/failed handshake is treated as "still
// connecting" (bounded retries) rather than "definitely no host" — silently
// falling back to the localStorage mock in that case would let writes look
// like they saved while never reaching Dataverse.
function isEmbeddedInHostFrame(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin frame access throws — exactly how the Power Apps host
    // embeds this app, so treat that as "embedded", not "standalone".
    return true;
  }
}

export async function initCurrentUser(): Promise<CurrentUser> {
  if (cached) return cached;

  if (import.meta.env.PROD && !isEmbeddedInHostFrame()) {
    // A production build reached outside the host frame — `vite preview`, or
    // the bundle served from anywhere that isn't Power Apps. There is no one
    // to authenticate against, so fail closed rather than adopting the
    // unauthenticated localStorage identity: that identity is only safe
    // because isPowerAppsHost() also points the data layer at the mock, and
    // relying on that coupling to contain a production sign-in is exactly
    // the kind of thing a later refactor breaks silently.
    throw new Error("This build has to run inside the Power Apps host.");
  }

  if (import.meta.env.PROD) {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= GET_CONTEXT_ATTEMPTS; attempt++) {
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
        lastErr = new Error("Power Apps host returned no user identity");
      } catch (err) {
        lastErr = err;
      }
    }
    // Embedded in a host frame (so a real host is plausible) but the
    // handshake never completed — surface the failure via authError instead
    // of silently degrading to the localStorage mock, which would risk
    // masking real writes as lost.
    throw lastErr instanceof Error ? lastErr : new Error("Failed to connect to the Power Apps host");
  }

  hostConfirmed = false;

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
