import type { CurrentUser } from "../types";

const LOCAL_USER_KEY = "tt_local_user";

let cached: CurrentUser | null = null;

export function isPowerAppsHost(): boolean {
  return typeof window !== "undefined" && !!window.PowerApps;
}

export async function initCurrentUser(): Promise<CurrentUser> {
  if (cached) return cached;

  const pa = typeof window !== "undefined" ? window.PowerApps : undefined;

  if (pa?.userInfo?.userId) {
    cached = {
      id: pa.userInfo.userId,
      email: pa.userInfo.email ?? "",
      displayName: pa.userInfo.displayName || pa.userInfo.email || "You",
    };
    return cached;
  }

  if (pa?.Connectors?.Office365Users?.MyProfile) {
    try {
      const me = await pa.Connectors.Office365Users.MyProfile();
      const id =
        (me.Id as string | undefined) ??
        (me.UserPrincipalName as string | undefined) ??
        (me.Mail as string | undefined);
      if (id) {
        cached = {
          id,
          email: (me.Mail as string) ?? (me.UserPrincipalName as string) ?? "",
          displayName: (me.DisplayName as string) || (me.Mail as string) || "You",
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
