import { useState, useEffect } from "react";
import type { CurrentUser } from "../types";
import { initCurrentUser } from "../services/userService";

interface BootstrapResult {
  user: CurrentUser | null;
  authError: string | null;
}

export function useAppBootstrap(): BootstrapResult {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    initCurrentUser()
      .then(setUser)
      .catch((err) => setAuthError(err instanceof Error ? err.message : "Sign-in failed"));
  }, []);

  return { user, authError };
}
