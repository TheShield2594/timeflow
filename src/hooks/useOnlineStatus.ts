import { useEffect, useState } from "react";

/**
 * Whether the browser thinks it has a network (issue #97).
 *
 * Nothing in the app looked at this before, so during an outage Save stayed
 * enabled and simply failed — the user learned about the outage from an error
 * toast that blamed the save. The retry classification in dataverseService now
 * treats a dropped connection as transient, which covers a blip; this covers
 * the longer case by saying so up front.
 *
 * `navigator.onLine === false` is trustworthy (no network interface / the OS
 * says offline). `true` is not — it only means *a* network exists, not that
 * Dataverse is reachable — so this is used to explain a failure, never to
 * pre-emptively block a save the user might otherwise have completed.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" || navigator.onLine !== false
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    // Re-read on mount: the events can fire between the initial state and here.
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
