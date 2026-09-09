# Data-isolation UAT sign-off

**Run this against every environment after every solution import, before any
real time data lands in it.** Not once at setup — every import, because an
import can carry a security role that replaces the one you verified last time.

The app's isolation is enforced by **Dataverse**, not by the app. Reads filter
server-side (`eq-userid` for the personal pages, `eq-useroruserhierarchy` for
the Team page), and those filters fail closed — a non-manager who calls the team
read from the console gets only their own rows back. But **any authenticated
user can call the Dataverse connector directly from devtools with no filter at
all**, and the only thing that stops them is the security role's ownership
scope. So the primary control against a company-wide privacy incident is one
setting on one dropdown, and this checklist is how anyone other than the person
who set it knows it is still right.

Related: [#91](https://github.com/TheShield2594/timeflow/issues/91) (this
checklist), [#54](https://github.com/TheShield2594/timeflow/issues/54)
(packaging the tables and role into a solution),
[README § Dataverse Security Configuration](../README.md#dataverse-security-configuration),
[RUNBOOK § 5.5](RUNBOOK.md#55-a-user-reports-the-data-isolation-warning-banner)
(what to do when it fails in production).

## What you need

- **Two real accounts** in the target environment, both licensed for the app,
  both with the security role assigned. Call them **A** and **B**. One account
  cannot test isolation: with a single user, an Organization-scoped table looks
  exactly like a User-scoped one.
- A few time entries logged by **each** of them — an entry for today and one for
  an earlier day in the same week. An empty table passes every check below for
  the wrong reason.
- For row 7, an account that manages someone and an account that manages nobody.

## The checklist

Copy this into the deploy record (see
[Releases](../CONTRIBUTING.md#releases-and-tagging)) and fill it in. An unticked
row is a blocker, not a note.

Environment: ______________  Solution version: ______________
Run by: ______________  Date: ______________

| # | Check | Signed off |
|---|---|---|
| 1 | Signed in as **A**: Timesheet shows only A's entries — no row named for B, on any day in the range | ☐ |
| 2 | As **A**: Calendar, Timer and Reports agree with the Timesheet. Reports' total for the week equals the sum of A's own entries only | ☐ |
| 3 | As **A**: the CSV export contains only A's rows (open it — the User column is the one to read) | ☐ |
| 4 | Repeat 1–3 signed in as **B** | ☐ |
| 5 | **No isolation banner** — the red "This workspace is showing other people's time" strip never appears above the page, for either user, at any point | ☐ |
| 6 | A direct unfiltered connector call from devtools returns only the caller's own rows (script below) | ☐ |
| 7 | Team page: present for a manager and lists **only their direct reports** (plus themselves); absent entirely from the nav for a non-manager | ☐ |
| 8 | Projects and tasks are visible to both A and B — these are Organization-scoped **by design**, and a failure here is the opposite failure: shared data that stopped being shared | ☐ |
| 9 | Nothing in the browser console for either user mentions `[security]`, `data_isolation`, or `pagination_truncated` | ☐ |

### Row 6 — the unfiltered read

This is the one check that tests the actual security boundary rather than the
app's behaviour. Everything above it passes even with the table left
Organization-owned, because the app's own filters are doing the work.

Signed in as **A**, open devtools on the running app and read the time-entry
table with no filter of any kind:

```js
// Paste in the app's own console so it uses A's authenticated connection.
const { MicrosoftDataverseService } = await import("./generated");
const res = await MicrosoftDataverseService.ListRecordsWithOrganization(
  "https://YOUR_ORG.crm.dynamics.com",
  "ever_timeentrieses",
  undefined, "application/json",
  undefined, undefined, undefined,
  undefined,  // no $filter — this is the point
  undefined, undefined, undefined, undefined, undefined,
);
const rows = (res.data?.value ?? []).map((r) => r.dynamicProperties ?? r);
console.log(rows.length, new Set(rows.map((r) => r._ownerid_value)));
```

**Pass:** the owner set has exactly one id — A's own.
**Fail:** more than one id, or a row count larger than A's own entries. Stop.
Do not load real data into this environment. Go to
[RUNBOOK § 5.5](RUNBOOK.md#55-a-user-reports-the-data-isolation-warning-banner) and
fix the ownership scope before continuing.

A manager account will legitimately see their reports' rows here — hierarchy
security applies to a direct connector call too. Run row 6 as a **non-manager**,
or expect exactly the manager's own subtree.

## If any row fails

1. Stop. Treat it as a possible cross-user exposure, not a bug to file.
2. Verify `ever_timeentries` ownership is **User or Team**, not Organization
   (maker portal → Tables → `ever_timeentries` → Settings → Advanced options).
   Organization ownership is the failure that produces almost all of these.
3. Verify the security role grants **User**-scope (Basic) Create/Read/Write/
   Delete on `ever_timeentries` — not Organization scope.
4. Re-import nothing and change nothing else until rows 1–7 pass.
5. If real data was already in the environment, decide with the data owner
   whether the app stays available while it's fixed.

## What the app checks by itself

Defense in depth, not a substitute for the above — each of these is a *symptom*
detector that runs after the boundary has already failed:

- `hasForeignUserEntries()` on the personal read path, surfaced as the "Data
  isolation warning" banner and reported to telemetry as
  `data_isolation_personal` (`useTimeEntries`).
- `findUnexpectedOwners()` on the Team read path, reported as
  `data_isolation_team` (`useTeam`). This one warns rather than alarms:
  indirect reports trip it legitimately at hierarchy depth > 1.
- Both need [telemetry](../README.md#production-telemetry) configured to reach
  anyone but the affected user.
