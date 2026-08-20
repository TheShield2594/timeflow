/**
 * Regenerate `src/generated/` and `.power/schemas/` from the Dataverse tables
 * this app reads (#116).
 *
 * Before this existed, regeneration was a side effect of running
 * `pac code add-data-source` by hand — an undocumented ritual that only
 * someone who already knew the table list, the connector's internal name and
 * the environment's connection id could perform. A Dataverse schema change is
 * rare enough that nobody remembers it and important enough that getting it
 * wrong ships a mapper that reads a column that no longer exists.
 *
 * The connection id is read out of power.config.json rather than passed in,
 * because it is per-environment: hard-coding one here would regenerate against
 * whichever environment the author happened to be pointed at.
 *
 * Requires the Power Platform CLI on PATH and an authenticated `pac auth`
 * profile for the target environment. Run it, then commit the diff under
 * `src/generated/` and `.power/schemas/` — both are checked in on purpose (#7)
 * so a clone builds without `pac`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DATAVERSE_API = "shared_commondataserviceforapps";
const OUTLOOK_API = "shared_office365";

/** The three tables in the README's schema section, by logical name. */
const TABLES = ["ever_projects", "ever_workitems", "ever_timeentries"];

function connectionIdFor(api) {
  const config = JSON.parse(readFileSync("power.config.json", "utf8"));
  const found = Object.entries(config.connectionReferences ?? {}).find(
    ([, ref]) => typeof ref.id === "string" && ref.id.endsWith(`/${api}`)
  );
  return found?.[0];
}

function pac(args) {
  console.warn(`> pac ${args.join(" ")}`);
  const result = spawnSync("pac", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error?.code === "ENOENT") {
    throw new Error(
      "The Power Platform CLI (`pac`) is not on PATH. Install it and run `pac auth create` " +
      "for the target environment first — see docs/RUNBOOK.md §6."
    );
  }
  if (result.status !== 0) throw new Error(`pac ${args.join(" ")} exited ${result.status}`);
}

const dataverseConnection = connectionIdFor(DATAVERSE_API);
if (!dataverseConnection) {
  throw new Error(`No ${DATAVERSE_API} connection reference in power.config.json.`);
}

for (const table of TABLES) {
  pac(["code", "add-data-source", "-a", DATAVERSE_API, "-c", dataverseConnection, "-t", table]);
}

// Outlook is optional — the app degrades to a "not connected" hint without it
// (see src/services/outlookService.ts), so a missing reference is not an error.
const outlookConnection = connectionIdFor(OUTLOOK_API);
if (outlookConnection) {
  pac(["code", "add-data-source", "-a", OUTLOOK_API, "-c", outlookConnection]);
} else {
  console.warn(`No ${OUTLOOK_API} connection reference; skipping the Outlook data source.`);
}

console.warn("Done. Review and commit the diff under src/generated/ and .power/schemas/.");
