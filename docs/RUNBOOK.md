# TimeFlow — Operations Runbook

The answer to *"prod broke, what now?"*, *"can we get deleted entries back?"* and
*"a user says their hours are missing — what do I check?"*

This app holds the company's billable-time record. Treat the Dataverse rows as
the system of record and the app as a client over them: almost every recovery
path below ends in Dataverse, not in this repo.

- **Audience:** whoever is on the hook for the app (today: one person — see
  [Bus factor](#bus-factor)).
- **Companion docs:** [README](../README.md) for what the app is and how it's
  built, [CONTRIBUTING](../CONTRIBUTING.md) for the dev workflow and how a
  release is cut, [DECISIONS](DECISIONS.md) for open calls that need an owner.

---

## 1. What "prod" is

| Piece | Where it lives | Changed by |
|---|---|---|
| App bundle (`dist/`) | The Power Apps Code App in the target environment | `npm run build && pac code push` |
| Dataverse tables + columns | The target environment's database | Manual table edits today; a managed solution once [#54](https://github.com/TheShield2594/timeflow/issues/54) lands |
| Security roles / ownership scope | The target environment | Admin, by hand (see [§6](#6-admin-setup-checklist)) |
| Connection references (Dataverse, Office 365 Outlook) | `power.config.json`, bound per environment | `pac code add-data-source`, then a push |
| User preferences (target hours, rounding, theme, focus settings) | Each user's browser `localStorage` | Not backed up; not restorable — see [§4](#4-backup-and-restore) |

`power.config.json` currently names one `environmentId` and one `appId`. There
is no dev/QA/prod split yet — that is exactly what #54 is for. Until it lands,
"promote to prod" and "deploy" are the same operation against the same
environment, and **the deploy is not reversible by re-running a pipeline** —
you have to rebuild the previous version yourself, as below.

---

## 2. Deploy

```bash
git checkout main && git pull
npm ci
npm run lint && npm run typecheck && npm test && npm run build
pac code push
```

Then record what shipped — see [Releases](../CONTRIBUTING.md#releases-and-tagging).
Every deploy gets a tag, so that "what is prod running?" has an answer that
doesn't depend on anyone's memory:

```bash
git tag -a v1.2.0 -m "Deployed to prod 2026-08-13"
git push origin v1.2.0
```

**Post-deploy smoke test** (two minutes, catches the failures that matter):

1. App loads and signs in — no "Sign-in failed" screen.
2. Start the timer on any project, refresh the page: the timer survives.
3. Stop it: the entry lands on the Timesheet with the right duration.
4. Calendar renders the week; if Outlook is wired up, the chip reads
   "Outlook on".
5. **Open every page in the sidebar once** — Timer, Timesheet, Calendar,
   Reports, Projects, and Team if you manage people. Since
   [#116](https://github.com/TheShield2594/timeflow/issues/116) the last four
   are separate JS chunks fetched on first navigation, so a page that shows a
   skeleton and never resolves means the host isn't serving those chunk URLs.
   That failure mode cannot appear on step 1, and the rollback for it is
   [§3.1](#31-app-code).
6. **No isolation banner.** If the red "This workspace is showing other
   people's time" banner appears above the page, stop and go to
   [§5.5](#55-a-user-reports-the-data-isolation-warning-banner) — that is a P0.
   Since the 2026-09 redesign it is a persistent full-width banner rather than
   a toast, so it cannot be missed and cannot be dismissed.

**After a solution import** (not needed for a code-only `pac code push`), the
smoke test is not enough: run
[the data-isolation UAT checklist](UAT-DATA-ISOLATION.md) with two real accounts
and file the filled-in copy with the deploy record. An import can carry a
security role that replaces the verified one, and every check above still passes
while the table is Organization-owned — the app's own filters hide it
([#91](https://github.com/TheShield2594/timeflow/issues/91)).

---

## 3. Rollback

A deploy has up to three independent halves, and they roll back separately.
Work down this list; most incidents only need the first.

### 3.1 App code

There is no "redeploy previous build" button. Rebuild the previous release from
its tag and push that:

```bash
git fetch --tags
git checkout v1.1.0          # the tag that was in prod before the bad deploy
npm ci                       # the lockfile is part of the release
npm run build
pac code push
```

Verify with the smoke test in §2, then note the rollback in `CHANGELOG.md` and
open an issue for the fix-forward. Leave the reverted tag in place — never
re-point a tag that has been in prod.

### 3.2 Dataverse schema

Once [#54](https://github.com/TheShield2594/timeflow/issues/54) ships, schema
rollback is: import the previous managed-solution version over the current one
in the target environment (Power Platform admin center → Solutions → Import),
then redeploy the matching `dist` per §3.1. The two must move together — an old
bundle against new columns is fine, a new bundle against missing columns is not.

**Until #54 lands there is no schema rollback.** Table and column changes are
made by hand in the maker portal and are not versioned anywhere. Two rules
follow from that:

- Never remove or rename a column that a shipped build reads. Add columns;
  don't take them away.
- Screenshot or export the table's column list before any schema change, so
  "what did it look like before?" is answerable.

### 3.3 Data

**Rollback does not restore data.** Reverting the app bundle undoes code, never
rows. Anything users wrote against the bad build stays exactly as written. If
the bad build wrote *wrong* rows (e.g. the DST duration bug in
[#87](https://github.com/TheShield2594/timeflow/issues/87)), the rows have to be
corrected — see [§4](#4-backup-and-restore) and [§5.2](#52-entries-are-missing-or-wrong).

---

## 4. Backup and restore

### What is and isn't backed up

| Data | Backed up? |
|---|---|
| `ever_timeentries`, `ever_projects`, `ever_workitems` rows | Yes — by Dataverse's environment backups, not by anything in this repo |
| Table schema, security roles | Only as part of a whole-environment backup (and, once #54 lands, as a solution artifact in source control) |
| Per-user `localStorage` preferences | **No.** Target hours, export rounding, focus settings, the Outlook overlay toggle, muted subjects and "already logged" checkmarks are per-device and unrecoverable. Losing them is cosmetic — the time entries are the record. |

### Before you need it — confirm these once, then re-confirm yearly

These are environment settings nobody on this project has verified in writing.
Check them in the Power Platform admin center and record the answers here:

- [ ] **System backup retention** for this environment (Environments → (env) →
      Backups). Retention depends on environment type and licensing — read the
      actual number off the portal rather than assuming, and write it down:
      it is the hard limit on how far back any recovery can reach.
- [ ] **Auditing enabled on `ever_timeentries`** (Settings → Audit settings,
      and per-table in the maker portal). Without it, a deleted row leaves no
      trace of who deleted it or what it contained, and §5.2 has nothing to
      read. Turning this on is the single highest-value item in this document.
- [ ] **Who can take a manual backup** and who can restore (restore is an
      admin-level operation).

### Restoring

Dataverse restore is **environment-level and destructive**: it restores the
whole environment to a point in time, overwriting everything written since.
There is no "restore one table" and no "restore one user's rows".

So for anything short of total loss, do **not** restore over prod. Instead:

1. Restore the backup into a **new/sandbox environment** (admin center →
   Backups → Restore → target a different environment).
2. Export the rows you need from there (Advanced Find / export to Excel, or a
   Dataverse query).
3. Re-import them into prod as new rows.

Restoring over prod is reserved for the case where prod's data is wholesale
wrong and the loss window is acceptable — and it needs the data owner's
explicit sign-off, because every entry logged since the backup point is gone.

### What the app itself deletes

Deleting a task or archiving a project **deactivates** the record
(`statecode` = Inactive) — the row survives and Undo/Restore brings it back, so
those are never a restore case. **Time entries are the only records the app
hard-deletes.** A hard-deleted time entry is gone from the table immediately;
the in-app Undo works only while the toast is on screen, because it re-creates
the row from what the browser still had in memory.

---

## 5. First-line support

**Contact:** the app owner (Brandon / @TheShield2594) is first line, second line
and escalation today. There is no rota and no shared inbox. Users should be told
one contact route — pick it, put it here, and put it in the app's help text.

There is **no production telemetry**
([#111](https://github.com/TheShield2594/timeflow/issues/111)): errors surface
as a toast to the affected user and a message in *their* browser console, and
reach nobody else. So the first question in every triage is *"can you open the
browser console (F12) and read me what's red?"* — that is currently the only
diagnostic channel that exists.

### 5.1 "The app won't load / sign-in failed"

1. Reproduce in a fresh tab. Note the exact banner text — "Sign-in failed: …"
   comes from `useAppBootstrap`, a blank page does not.
2. Check the environment is up (admin center → Environments → state).
3. Check the user has a Power Apps licence and the app is shared with them.
4. Check the DLP policy hasn't changed — Office 365 Outlook and Microsoft
   Dataverse must sit in the same data group, or the platform blocks the app
   from running with both connectors (§6).
5. If a deploy went out in the last hour, roll back per §3.1 first and diagnose
   after.

### 5.2 "Entries are missing or wrong"

Work outside-in — most reports are a filter, not a data loss:

1. **Date range.** Timesheet, Reports and Calendar each read a range. Ask what
   range is selected; "All time" is the check that settles it.
2. **Project filter / search box** on the Timesheet.
3. **The day the entry landed on.** An entry that crosses midnight is stored
   against the day it *starts*, so a 23:30→00:30 session shows on the earlier
   day.
4. **Is it in Dataverse at all?** Maker portal → Tables → `ever_timeentries` →
   Data, or Advanced Find filtered by owner and date. This is the line between
   "the app isn't showing it" (a bug — file it) and "the row is gone" (a data
   incident — continue).
5. **If the row is gone:** check the audit history for the record (if auditing
   is on — see §4). Time entries are hard-deleted by design, so a deletion is
   plausible and recoverable only via §4's sandbox-restore path. Get the user's
   estimate of the affected date range before you start; it determines which
   backup you need.
6. **If the row is there but the numbers are wrong:** capture `ever_starttime`,
   `ever_endtime` and `ever_durationminutes` for the row. Duration
   disagreeing with the timestamps is the signature of the DST class of bug
   ([#87](https://github.com/TheShield2594/timeflow/issues/87)) — check whether
   the date was a DST transition day before assuming it's new.

### 5.3 "My timer ran all night" / "the 12h auto-stop didn't fire"

Expected behaviour, and worth knowing before you go looking for a bug: the 12h
auto-stop is a **client-side** check that only runs while a tab has the app
open. Close the tab on a running timer and nothing stops it server-side; the
running entry is reconciled from the server draft at the next app launch. Fix
the entry by editing its end time on the Timesheet.

### 5.4 "Outlook meetings aren't showing"

The Calendar chip tells you which layer failed:

- **"Outlook not connected"** — the connector isn't wired up in this
  environment, or the DLP policy blocks it, or the user declined the consent
  prompt. Walk §6's Outlook block.
- **"Outlook on" but a specific meeting is absent** — all-day events are never
  shown (no time span to lay out), meetings crossing midnight are clamped to
  their start day, and a *muted subject* hides an entire recurring series.
  Muting is per-device; the Calendar shows a count of what's hidden and can
  unmute.

### 5.5 "A user reports the data isolation warning banner"

**This is a P0. Treat it as a possible cross-user data exposure.**

The banner — full-width, red, above every page, and not dismissible — means
`hasForeignUserEntries()` found a row belonging to someone other than the
signed-in user in a personal-page read, which the server-side `eq-userid`
filter should make impossible. It used to be a toast, which told the one
person who could not act on it and then vanished; it now stays up for the rest
of the session and carries a **Copy details for IT** button, so the report you
receive should already have the detail in it.

1. Get a screenshot and the browser console output. If telemetry is configured
   (README § Production telemetry) the same event is in the sink as
   `data_isolation_personal`, with the row counts — check there first, and check
   whether other users have reported it too.
2. Verify `ever_timeentries` ownership is **User or Team**, not Organization
   (maker portal → Tables → `ever_timeentries` → Settings → Advanced options).
   Organization ownership is the failure that produces this.
3. Verify the security role grants **User**-scope (Basic) privileges on
   `ever_timeentries`, not Organization scope.
4. Until it's understood, assume every user can read every user's entries and
   decide with the data owner whether to keep the app available.
5. Once fixed, re-run [the data-isolation UAT checklist](UAT-DATA-ISOLATION.md)
   in full before telling anyone it's resolved — row 6 is the only check that
   tests the boundary rather than the app's own filtering.

A `data_isolation_team` event in the sink is **not** this incident: it fires when
a Team read returned a row owned by someone who isn't a direct report, which
indirect reports do legitimately at hierarchy depth > 1. Compare
`unexpectedOwners` against `directReports` — a couple is the hierarchy, a large
share of `rowsReturned` is the misconfiguration above.

### 5.6 "A manager can't see their reports' time"

Almost always an admin setting, not code — see §6. Which setting depends on
what the manager actually sees, because the page rests on **two independent
lookups** and either can fail alone:

- the **Manager field** (`systemuser.parentsystemuserid`) decides whether the
  Team page exists at all and whose names are in the table. Reading it needs
  nothing but org-level Read on the User table.
- **hierarchy security** decides whether those people's time entries come back.
  Nothing about the Manager field implies it is on.

So start by asking which of these the manager is looking at:

**No Team nav item at all.** The Manager field on *the report's* profile is
unset, or the manager's role can't read the User table.

1. The field lives on the report, not on the manager: to see Avery's time, open
   **Avery's** profile and set Manager to yourself. Setting it on your own
   profile makes you your own report, which the app now ignores — before it
   did, that produced a Team page whose only member was you.
2. **The M365/Entra org chart does not sync into this field.** Every new hire
   needs it set by hand, or their manager silently loses visibility with no
   error anywhere — see
   [#131](https://github.com/TheShield2594/timeflow/issues/131) and the joiner
   checklist in [§7](#7-joiners-movers-and-leavers).
3. If no manager in the environment has the nav item, suspect the privilege
   instead: without org-level Read on `systemuser` the app can't run the probe.
   That failure reports as `team_probe_failed` in the telemetry sink and as a
   `[telemetry]` line in the browser console.

**The Team page lists the right people, and every one of them is empty.** The
Manager fields are fine — those names came from Dataverse. The entry read is
what's returning nothing, and the app says so on the page ("returned none of
their entries for this week") and as `team_no_report_rows` in the sink. In
order of likelihood:

1. **Hierarchy security is off**, or somebody **excluded `ever_timeentries`**
   from its table list (every table is included by default, so this takes a
   deliberate uncheck). §6's Manager Team view block has the exact screen. This
   is the one to check first: with hierarchy security off,
   `eq-useroruserhierarchy` is a legal query that returns the caller's own rows
   and nothing else — no error, no warning.
2. **Depth.** Depth 1 covers direct reports only. A manager of managers sees
   their own reports and stops there until it's raised.
3. **Business units.** Manager hierarchy only grants access when the report is
   in the manager's own business unit or one beneath it. A report moved into a
   sibling business unit disappears from their manager's Team page while the
   Manager field still says they report to them.
4. **The reports genuinely logged nothing.** Confirm before escalating: have
   one report open their own Timesheet for that week. Their own pages read with
   `eq-userid` and don't touch hierarchy security at all, so an entry visible
   there and absent from Team is the misconfiguration; an empty week on both is
   just an empty week.

To settle 1–3 without waiting for a user to retry, run this as the manager
(maker portal → the environment → any Web API client signed in as them):

```
GET {org}/api/data/v9.2/ever_timeentrieses?fetchXml=
  <fetch><entity name="ever_timeentries">
    <attribute name="ever_timeentriesid" /><attribute name="ownerid" />
    <filter><condition attribute="ownerid" operator="eq-useroruserhierarchy" /></filter>
  </entity></fetch>
```

Rows owned by nobody but the caller is the server's own answer, with the app
taken out of the picture.

---

## 6. Admin setup checklist

Environment-side setup the app degrades gracefully around: each feature stays
hidden or shows a hint until its steps are done, so none of this blocks
deploying a build. *(Migrated from `Brandon To Do.md`; tracked in
[#130](https://github.com/TheShield2594/timeflow/issues/130).)*

### Outlook calendar overlay

The connection reference and the data source are **already committed** —
`power.config.json` carries `shared_office365` and
`.power/schemas/appschemas/dataSourcesInfo.ts` has the `office365` entry with
both operations. Do not redo those steps. What remains per environment:

- [ ] **DLP policy** (admin center → Policies → Data policies): Office 365
      Outlook must be in the same data group as Microsoft Dataverse. Different
      groups = the platform refuses to run the app. This is the most common
      "worked in dev, blocked in prod" failure.
- [ ] **Per-user consent**: each user gets a one-time prompt for the Office 365
      Outlook connection on their first launch after this ships. Tell users it
      is expected; a declined prompt shows as "Outlook not connected" for that
      user only.
- [ ] Verify: Calendar shows the "Outlook on" chip and this week's meetings as
      dashed ghost blocks.

### Manager Team view

- [ ] **Set Manager on each Power Apps user profile** (admin center →
      Environments → (env) → Settings → Users → open the report → Manager).
      This field — `systemuser.parentsystemuserid` — is the only thing the app
      reads, and nothing populates it automatically. Setting it once here
      covers today's people; [§7](#7-joiners-movers-and-leavers) is what keeps
      it true for everyone who joins after.
- [ ] **Enable Hierarchy security** ((env) → Settings → Users + permissions →
      Hierarchy security): Enable Hierarchy Modeling **On**, type **Manager
      hierarchy**, depth **1** (raise it if managers-of-managers should see
      deeper). **Leave the table list alone.**

      The table list is an **exclusion** list: [every table is enabled for
      hierarchy security by
      default](https://learn.microsoft.com/en-us/power-platform/admin/hierarchy-security),
      and you clear checkboxes to take tables *out*. `ever_timeentries` is
      therefore covered the moment modeling is on — there is nothing to add.
      (This document said the opposite until 2026-08-26. Whoever followed it
      would have unchecked ~1,000 tables to "include" one, which is the snag
      below.)

      Do not trim the list down to `ever_timeentries` for tidiness. Two reasons:
      it is a change per table, which fails (see the snag); and it buys nothing,
      because hierarchy security is an ownership-based grant and
      `ever_projects` / `ever_workitems` are Organization-owned on purpose (see
      row security below) — an Organization-owned row has no owner, so there is
      no manager chain to walk whether the table is listed or not.

      Worth knowing for [#129](https://github.com/TheShield2594/timeflow/issues/129)
      (the open decision about rebuilding `ever_workitems` User-owned): because
      everything is included by default, that table becomes hierarchy-readable
      the day its ownership changes, with no security change to notice. If that
      lands, decide there and then whether managers should read their reports'
      tasks — and if not, this is the screen where you exclude it.

      **Snag: `0x80060888`, "the current change set contains too many
      operations".** Hit twice in PROD on 2026-08-26, and this is what cleared
      it: reload the page, leave every checkbox alone (restore the list to
      all-checked if an earlier attempt trimmed it), and save only modeling On +
      Manager hierarchy + depth. The save writes an operation per table it
      touches, so any bulk change to the list blows the platform's
      1,000-operation limit and nothing saves at all — including the model
      settings you actually wanted. Settings-only, it saves, and managers see
      their reports' time on the next load.

      If a settings-only save ever fails anyway, try the classic page (Settings
      → Security → Hierarchy Security) before opening a support ticket with the
      error code and session id — the 1,000 limit is platform-side and not
      raisable from the environment.
- [ ] **Org-level Read on the User (`systemuser`) table** in the role users run
      under; most baseline roles have it. Without it the app can't detect
      "do I have reports" and the Team page stays hidden for everyone.
- [ ] Verify: a manager sees the Team nav item and their report's week; a
      non-manager doesn't. (Local dev preview:
      `localStorage.setItem("tt_mock_team", "1")`.)

### Row security (do this before any real data lands, and after every import)

- [ ] `ever_timeentries` ownership is **User or Team**; role grants Basic
      (user-scope) Create/Read/Write/Delete.
- [ ] `ever_projects` and `ever_workitems` are Organization-owned with Basic
      privileges — shared data, deliberately.
- [ ] **[Two-account UAT sign-off](UAT-DATA-ISOLATION.md)** filled in and filed
      with the deploy record: A cannot see B's entries in any view or export, no
      isolation toast, Team shows only direct reports, and an unfiltered
      connector call from devtools returns only the caller's own rows
      ([#91](https://github.com/TheShield2594/timeflow/issues/91)). This is the
      release gate — the three settings above are what you'd *expect* to be
      true; the checklist is what proves it.

### Telemetry

- [ ] Set `VITE_APPINSIGHTS_CONNECTION_STRING` (or `VITE_TELEMETRY_ENDPOINT`) in
      the build environment, so error-boundary catches, the isolation canaries
      and truncated loads reach someone other than the affected user — see
      README § Production telemetry
      ([#111](https://github.com/TheShield2594/timeflow/issues/111)). Unset, the
      app still works and still logs to the console; nobody on the project hears
      about anything.
- [ ] Verify: one event lands in the sink. Easiest deliberate trigger is a
      truncated load — narrow `MAX_PAGES` locally, or check for
      `pagination_truncated` after a very wide date range on a busy environment.

### Working hours

Nothing to configure centrally — each person sets their own from the sidebar
("Working hours · 08:00–18:00"), stored in that browser's `localStorage`. Two
things to have ready when people ask:

- It travels with the browser, not the account: a new machine starts at the
  08:00–18:00 default. Code Apps have no per-user settings table.
- It decides which stretches of a day are *offered* as untracked gaps, and it
  is also the window the day bar is drawn across — so a 06:00 start widens the
  bar on the timer screen as well as the gaps under it. It changes no stored
  entry, no total, and nothing in an export.

---

## 7. Joiners, movers and leavers

§6 is the one-time setup for the app. This is the recurring, per-person list —
the thing that has to happen every time somebody joins the environment, changes
manager, or leaves.

### When someone joins

- [ ] **Set their Manager** on the Power Apps user profile (admin center →
      Environments → (env) → Settings → Users → open the user → Manager).

      This is the whole reason this section exists. The M365 / Entra org chart
      **does not sync into `systemuser.parentsystemuserid`**, and Dataverse
      never populates it on its own
      ([#131](https://github.com/TheShield2594/timeflow/issues/131)). Until
      somebody sets it by hand:

      - their manager's Team view silently omits them,
      - nothing raises an error — the page renders normally with one fewer
        person on it,
      - and a manager reviewing their reports' week has no way to notice
        unless they count.

      The failure is quiet and it **under-reports**, which is the wrong
      direction for a billable-time record.

- [ ] If the new joiner *is* a manager, set Manager on each of their reports
      too — the field lives on the report, not on the manager.
- [ ] Confirm they hold the security role from §6 (row security) and, if they
      manage people, that hierarchy depth still covers them.
- [ ] Tell them about the one-time Office 365 Outlook consent prompt on first
      launch, if the overlay is wired up in this environment.

### When someone changes manager

- [ ] Update Manager on **their** profile. Nothing else moves: their existing
      time entries stay theirs, and the old manager loses visibility of the
      week from the moment the field changes. Historical reports are unaffected
      — Team reads by hierarchy at query time, so it shows the *current* shape
      of the org, not the one in force when the time was logged.

### When someone leaves

- [ ] Disable the user in the environment rather than deleting them. Deleting a
      `systemuser` orphans the ownership on their time entries, and those rows
      are the billable record.
- [ ] Reassign their reports' Manager field, or those people fall out of every
      Team view at once.

### Reconciling against Entra, because the checklist will be missed

A checklist is only as good as the person following it, and this one fails
silently. Run a periodic comparison so the gap surfaces as a report somebody
reads instead of as a manager's quiet under-count:

1. Pull Dataverse's view of the hierarchy — every enabled user and their
   manager:

   ```
   GET {org}/api/data/v9.2/systemusers
       ?$select=systemuserid,fullname,internalemailaddress,_parentsystemuserid_value
       &$filter=isdisabled eq false and islicensed eq true
   ```

2. Pull Entra's view of the same people (`GET /users/{id}/manager` in Graph, or
   the `Manager` column of an Entra user export).

3. Report the rows where they disagree — Dataverse blank but Entra set is the
   common case and the one that costs visibility; the two set to *different*
   people is rarer and worse.

Cheapest implementation is a scheduled Power Automate flow that emails the diff
weekly to whoever owns the environment; a manual quarterly export and
spreadsheet comparison is enough to start, and is strictly better than nothing.
Anything that turns "nobody noticed" into "somebody got a list" is the win here.

**Not in scope: changing what the app reads.** `parentsystemuserid` is what
Dataverse hierarchy security itself filters on, so reading anything else would
mean the nav gating and the server-side filter disagree — a manager could see a
Team nav item that returns nothing, or worse, believe a list is complete when
the security filter trimmed it.

---

## Bus factor

One person knows all of the above. Everything in this document exists so that a
second person could run the app on a bad day without that first person — which
means it is only true if it is kept true. Update this file in the same PR as any
change to the deploy, rollback, schema or security-role story.

---

## Known gaps in this runbook

Honest list, so nobody discovers these mid-incident:

- **Telemetry exists but may not be wired up** — `src/services/telemetry.ts`
  routes error-boundary catches, both isolation canaries, truncated loads and a
  failed bootstrap task load to a sink
  ([#111](https://github.com/TheShield2594/timeflow/issues/111)), but with
  neither environment variable set it is console-only and first line is back to
  depending on the user reading their own console. Confirm §6 § Telemetry is
  ticked for this environment.
- **No schema rollback** until [#54](https://github.com/TheShield2594/timeflow/issues/54).
- **Backup retention and auditing are unverified** — the checkboxes in §4 have
  never been filled in.
- **No tested restore.** The sandbox-restore path in §4 is the documented
  procedure, not a rehearsed one. It should be rehearsed once, before it is
  needed for real.
- **Support contact is a person, not a channel.**
- **The Entra reconciliation in §7 is a procedure, not a running job.** Until
  somebody schedules it, the only thing standing between a new hire and a
  manager's silently short Team view is whoever remembers the joiner checklist
  ([#131](https://github.com/TheShield2594/timeflow/issues/131)).
