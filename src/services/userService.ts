import type { CurrentUser } from "../types";
import { getContext } from "@microsoft/power-apps/app";

const LOCAL_USER_KEY = "tt_local_user";

let cached: CurrentUser | null = null;

/**
 * True when we're running inside a real Power Apps host (production build).
 * Vite dev (`npm run dev`) → false, use the localStorage mock data layer.
 * Production build served by Power Apps → true, talk to Dataverse via SDK.
 */
export function isPowerAppsHost(): boolean {
  return import.meta.env.PROD;
}

export async function initCurrentUser(): Promise<CurrentUser> {
  if (cached) return cached;

  if (isPowerAppsHost()) {
    try {
      const ctx = await getContext();
      const u = ctx.user;
      const id = u.objectId ?? u.userPrincipalName ?? "";
      if (id) {
        cached = {
          id,
          email: u.userPrincipalName ?? "",
          displayName: u.fullName ?? u.userPrincipalName ?? "You",
        };
        return cached;
      }
    } catch {
      // fall through to local fallback so the app still loads
    }
  }

  // Local dev fallback — persist so user-scoped data is stable across reloads.
  let raw = localStorage.getItem(LOCAL_USER_KEY);
  if (!raw) {
    const fresh: CurrentUser = {
      id: "local-" + crypto.randomUUID(),
      email: "local@dev",
      displayName: "Local User",
    };
    raw = JSON.stringify(fresh);
    localStorage.setItem(LOCAL_USER_KEY, raw);
  }
  cached = JSON.parse(raw) as CurrentUser;
  return cached;
}

export function getCurrentUser(): CurrentUser {
  if (!cached) {
    throw new Error("User not initialised. Call initCurrentUser() before reading the current user.");
  }
  return cached;
}
