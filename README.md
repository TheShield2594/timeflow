# TimeFlow — Power Apps Code App

A production-ready time tracking app built as a **Power Apps Code App** (React + TypeScript).
Tracks time against projects and tasks, stores data in Microsoft Dataverse, and includes a full reporting dashboard.

---

## Features

| Feature | Status |
|---|---|
| ▶ / ■ Timer (start / stop) | ✅ |
| Project & task tagging | ✅ |
| Timesheet view (grouped by day) | ✅ |
| Reports dashboard (daily bar chart, project %, top tasks) | ✅ |
| KPI strip (total, daily avg, sessions, projects) | ✅ |
| Projects management (create projects + tasks) | ✅ |
| Timer persists across page refresh | ✅ |
| Per-user timer & data scoping | ✅ |
| Dataverse backend wired (window.PowerApps connector) | ✅ |

---

## Local Development

### Prerequisites
- Node.js 18+
- npm or pnpm

### Run locally
```bash
npm install
npm run dev
```

The app runs with **mock data** in localStorage when `window.PowerApps` is not present.
Seed data (3 projects, tasks, 1 week of entries) is auto-generated on first run.

---

## Deploy to Power Apps

### Prerequisites
1. [Power Platform CLI](https://learn.microsoft.com/en-us/power-platform/developer/cli/introduction) installed
2. A Power Apps environment with a Dataverse database
3. Power Apps license (per-user or per-app)

### Step 1 — Authenticate
```bash
pac auth create --url https://YOUR_ORG.crm.dynamics.com
```

### Step 2 — Create Dataverse tables

In your Power Apps environment, create these tables (or use the Dataverse web UI / import a solution):

**Table: cr_projects**
| Column | Type | Notes |
|---|---|---|
| cr_name | Text | Required |
| cr_color | Text | Hex color e.g. #6366f1 |
| cr_description | Text (multiline) | Optional |
| cr_ratio | Decimal | Optional — default ratio for new entries |
| cr_isactive | Boolean | Default: true |

**Table: cr_tasks**
| Column | Type | Notes |
|---|---|---|
| cr_name | Text | Required |
| cr_projectid | Lookup → cr_projects | Required |
| cr_description | Text | Optional |
| cr_isactive | Boolean | Default: true |

**Table: cr_time_entries**
| Column | Type | Notes |
|---|---|---|
| cr_projectid | Lookup → cr_projects | Required |
| cr_taskid | Lookup → cr_tasks | Optional |
| cr_description | Text | Optional |
| cr_starttime | DateTime | Required |
| cr_endtime | DateTime | Optional (null = running) |
| cr_durationminutes | Whole Number | Optional |
| cr_ratio | Decimal | Optional |
| cr_date | Date Only | Required |
| cr_userid | Text | Required — stamps the owning user (Entra ID) |
| cr_userdisplayname | Text | Required — cached display name for reporting |

### Step 3 — (Optional) Adjust the Dataverse field mapping

`src/services/dataverseService.ts` is already wired against
`window.PowerApps.Connectors.MicrosoftDataverse` using OData-style queries and
the `@odata.bind` form for lookup writes. If your Power Apps Code App SDK
exposes a different convention (e.g., bare GUID lookup writes, or different
primary-key column naming), tweak the `mapXxx` / `xxxToDataverse` helpers in
that file — the rest of the app does not depend on those details.

User identity is resolved by `src/services/userService.ts`. It prefers
`window.PowerApps.userInfo`, falls back to the `Office365Users.MyProfile`
connector, and finally to a persistent local-dev user when neither is present.
Time entries are filtered server-side by `cr_userid` so each user only sees
their own records.

### Step 4 — Build and push
```bash
npm run build
pac code push
```

### Step 5 — Run in Power Apps
```bash
pac code run
```

Or open Power Apps Studio and the app will appear in your environment.

---

## Project Structure

```
src/
  types/
    index.ts              — TypeScript interfaces for all data models
    powerapps.d.ts        — window.PowerApps runtime type declarations
  services/
    dataverseService.ts   — Real Dataverse calls + localStorage mock fallback
    userService.ts        — Current user (PowerApps userInfo / Office365Users / local)
    csvExport.ts          — CSV export helper
  hooks/index.ts          — React hooks: useProjects, useTasks, useTimeEntries, useTimer
  components/
    TimerBar.tsx          — Sticky timer bar at the top
    TimesheetPage.tsx     — Day-grouped list of time entries
    CalendarPage.tsx      — Week calendar with drag-to-create entries
    ReportsPage.tsx       — Dashboard with charts and KPIs
    ProjectsPage.tsx      — Project/task management
  App.tsx                 — Root layout, sign-in bootstrap, page routing
  styles.css              — Full dark theme CSS (no external UI library needed)
  main.tsx                — React entry point
```

---

## Customisation Tips

- **Colors**: Edit CSS variables in `styles.css` under `:root` to change the theme.
- **Adding fields**: Add columns to your Dataverse tables and update the TypeScript types + service layer.
- **Auth**: Power Apps Code Apps use Zero-config Microsoft Entra ID auth — no extra setup needed.
- **Sharing**: Deploy to your Power Apps environment and share with users as you would any Power App.
- **Power Automate**: Add approval flows or Teams notifications by connecting Power Automate to the `cr_time_entries` table on create/update triggers.

---

## License
MIT
