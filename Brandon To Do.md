# Brandon To Do

Admin/portal-side setup for the features shipped on the app side. The code
degrades gracefully until each of these is done (hints/hidden pages instead of
errors), so nothing here blocks deploying the build — features light up as you
complete their steps.

---

## 1. Outlook calendar overlay (Calendar page)

The app-side code is done. To make real meetings appear:

- [ ] **Create/find an Office 365 Outlook connection** in the environment:
      `pac connection list` (or make one at make.powerapps.com → Connections →
      New connection → Office 365 Outlook).
- [ ] **Add the data source to the app** (from the repo, authenticated with `pac`):
      ```bash
      pac code add-data-source -a shared_office365 -c <connectionId>
      ```
      Commit the regenerated `.power/schemas/appschemas/dataSourcesInfo` and
      `power.config.json` changes.
- [ ] **Check the environment's DLP policy** (Power Platform admin center →
      Policies → Data policies): **Office 365 Outlook** must be in the same
      data group (usually "Business") as **Microsoft Dataverse**. If they're
      in different groups the app will be blocked from using both.
- [ ] `npm run build && pac code push`.
- [ ] Launch the app once — approve the one-time connection consent prompt.
      Every user gets the same prompt on their first launch after this ships.
- [ ] Verify: Calendar page shows the "Outlook: on" chip and this week's
      meetings as dashed ghost blocks. If you see "Outlook: not connected",
      re-check the three steps above (connection, data source, DLP).

## 2. Manager team view (issue #61)

The app shows a **Team** page only to users who have direct reports in
Dataverse. Two pieces of admin setup:

- [ ] **Set managers on the Power Apps user profiles**: Power Platform admin
      center → Environments → (env) → Settings → Users → open each report's
      user → set **Manager**. This is the field the app reads
      (`systemuser.parentsystemuserid`) — setting it right here is the whole
      step, nothing else feeds it.
      *(FYI only: the M365/Entra org-chart manager does not sync into this
      field on its own, so people added later also need their Manager set on
      the profile — one field per new hire.)*
- [ ] **Turn on Hierarchy security** for the environment: (env) → Settings →
      Users + permissions → Hierarchy security →
      - Enable Hierarchy Modeling: **On**
      - Hierarchy type: **Manager hierarchy**
      - Depth: **1** (managers see direct reports only; raise it if
        managers-of-managers should see deeper)
      - Under "Select the tables for hierarchy security", **include
        `ever_timeentries`** (tables default to excluded).
- [ ] **Confirm managers can read user records**: the security role users run
      under needs org-level **Read** on the **User** (`systemuser`) table —
      most baseline roles already have this. Without it the app can't detect
      "do I have reports" and the Team page stays hidden for everyone.
- [ ] Verify: sign in as someone with a report → the **Team** sidebar item
      appears and shows the report's week. Sign in as a non-manager → no Team
      item. (In local dev you can preview the page with
      `localStorage.setItem("tt_mock_team", "1")` in the browser console.)

The personal pages' data-isolation guarantees are unchanged — the Team page
uses Dataverse's own `eq-useroruserhierarchy` filter, so the server only ever
returns rows hierarchy security says the manager may read.

## 3. Focus mode (Pomodoro)

- [ ] Nothing — no admin setup. It's a per-user toggle in the timer bar.
      One limitation to be aware of when people ask: break/focus prompts only
      fire while the app tab is open (a Code App has no OS-level presence,
      which is why Clockify does this via a browser extension).

## 4. Personal (per-user) tasks — decision needed

`ever_workitems` was created **Organization-owned**, and Dataverse does not
allow changing ownership type after creation — an org-owned table only offers
None/Organization privilege depth in the security role editor, so "set tasks
to User scope in the role" won't be available as an option. Two real routes:

- **Option A — rebuild the table (real row security):** create a new
  User-owned work-items table, migrate rows, repoint the `ever_workitem`
  lookup on `ever_timeentries`, then give the role Basic (user-scope)
  privileges on it. Dataverse then filters server-side automatically.
  Heavier lift; consider bundling it with the managed-solution work in
  issue #54 so it only has to be done once.
- **Option B — app-side filter (UX-only, no migration):** add an owner column
  + personal/shared flag to `ever_workitems` and have the app show "mine +
  shared" in pickers. Not security (anyone could still query others' tasks
  via the API), but time entries — the sensitive data — are already locked
  down. Cheap and reversible.

Tell Claude which option and it can be built next session (Option B is app
code + two columns; Option A is mostly your portal work plus a small code
change to the new entity-set name).

## Reference

- Issue #54 (managed solution for Dev → QA → Prod) would fold most of the
  table/role steps above into a one-import artifact — worth doing once this
  round settles.
- README sections: "Outlook calendar overlay" and "Dataverse Security
  Configuration" have the full context for 1 and 2.
