# Changelog

Notable changes to TimeFlow. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is semver
against user-visible behaviour, as described in
[CONTRIBUTING](CONTRIBUTING.md#releases-and-tagging).

> **No tag has been cut yet.** `package.json` has read `1.0.0` since the repo
> was created, and there are no git tags and no GitHub releases, so there is
> currently no way to say which build is in production. The next deploy should
> tag its commit `v1.0.0` and record it below; every deploy after that gets its
> own tag. See [#112](https://github.com/TheShield2594/timeflow/issues/112).

---

## Unreleased — to ship as 1.0.0

### Added

- Timer with keyboard shortcut, persistence across refresh, and multi-tab sync.
- Timesheet: day-grouped entries, search, project filter, manual entry, delete
  with undo.
- Week calendar: 24-hour grid with overlap layout, drag to create, resize and
  reschedule (Shift+arrows by keyboard), the running session drawn live, and
  untracked gaps surfaced as one-click log targets.
- Overview landing page: today strip, weekly target ring, activity heatmap,
  quick-start buttons for recent work.
- Reports dashboard: daily/weekly bar chart, project breakdown, top tasks, KPI
  strip, project × period matrix, all-time range.
- Projects and tasks management with archive/restore and delete-with-undo.
- CSV export with billing-style rounding, Jira ticket and ratio columns.
- Manager **Team** view built on Dataverse hierarchy security, with its own CSV
  export.
- Outlook meeting overlay with log-from-meeting, three-state visibility and
  per-subject muting.
- Focus mode (Pomodoro) layered on the timer, with a daily block count.
- Idle detection and a 12-hour auto-stop safety net (client-side — see the
  README).
- Light and dark themes; reduced-motion support.
- Dataverse backend via the `@microsoft/power-apps` SDK, with a localStorage
  mock for local development.
- Production telemetry: error-boundary catches, both data-isolation canaries,
  truncated Dataverse loads and a failed bootstrap task load now reach a sink
  (Application Insights or any JSON webhook) instead of dying in the affected
  user's console. Optional — unconfigured, the app behaves exactly as before
  ([#111](https://github.com/TheShield2594/timeflow/issues/111)).
- An offline banner. Nothing is disabled: a save attempted during an outage
  still goes through the retry path
  ([#97](https://github.com/TheShield2594/timeflow/issues/97)).

### Fixed

Findings from the [2026-08-12 application review](docs/reviews/2026-08-12-multi-agent-review.md):

- Calendar drag/resize/nudge no longer corrupts durations on DST days — they
  are derived from instants, not clock readings
  ([#87](https://github.com/TheShield2594/timeflow/issues/87)).
- A zero-duration entry no longer marks the rest of the day as tracked
  ([#92](https://github.com/TheShield2594/timeflow/issues/92)).
- Backgrounding the tab no longer counts as idle time
  ([#98](https://github.com/TheShield2594/timeflow/issues/98)).
- Every record id interpolated into an OData `$filter` is validated
  ([#108](https://github.com/TheShield2594/timeflow/issues/108)).
- Projects and tasks are indexed by id instead of scanned per row
  ([#96](https://github.com/TheShield2594/timeflow/issues/96)).
- Reports matrix columns now add up to the totals printed under them, and rows
  to the totals beside them, instead of each cell rounding on its own
  ([#93](https://github.com/TheShield2594/timeflow/issues/93)).
- The By Project breakdown sums to 100%, not 99%
  ([#113](https://github.com/TheShield2594/timeflow/issues/113)).
- A double-click on Start no longer strands an open draft row that comes back
  as a phantom running timer on the next reload
  ([#94](https://github.com/TheShield2594/timeflow/issues/94)).
- Escape or a stray backdrop click no longer throws away a filled-in entry or
  project form without asking
  ([#104](https://github.com/TheShield2594/timeflow/issues/104)).
- "Discard session" on the idle prompt is undoable — the toast offers Restore,
  which re-opens the session on its original start time
  ([#105](https://github.com/TheShield2594/timeflow/issues/105)).
- Dropped connections, 502s and 504s are retried. Only 429 and 503 counted as
  transient before, so the most common real-world failure — a connection that
  drops, carrying no status code at all — was thrown through on the first
  attempt. Creates are deliberately excluded from the new class: a POST that
  landed and lost its response would be written twice, and a duplicated time
  entry is a wrong number on an invoice
  ([#97](https://github.com/TheShield2594/timeflow/issues/97)).
- A render crash on one page no longer blanks the whole app, including the
  running timer. The error boundary moved above `useAppBootstrap` and `useTheme`
  (which could previously throw straight past it to a white screen), each page
  got its own, and the screen leads with a plain sentence instead of a raw
  exception message ([#111](https://github.com/TheShield2594/timeflow/issues/111)).
- A failed bootstrap task load says so. It was swallowed to `console.error`,
  leaving task names blank across the timesheet, calendar, reports and CSV
  export with no signal at all
  ([#111](https://github.com/TheShield2594/timeflow/issues/111)).

### Accessibility

- `--text-faint` now meets WCAG AA on every surface in both themes. It carried
  the calendar's hour labels, the Project × Period column headers, "No matches"
  and "No data for this period" at 2.46:1; decoration keeps the old value under
  a separate `--text-decor`
  ([#88](https://github.com/TheShield2594/timeflow/issues/88)).
- The Project × Period matrix is a navigable table — scoped headers, the project
  name as a row header, a caption, and each cell's exact duration in its
  accessible name instead of a hover-only `title`. The same round moved the
  calendar's keyboard-reschedule instructions, the CSV rounding note, the
  focus-mode summary, what Archive does and why Continue is disabled onto
  affordances a keyboard can reach
  ([#106](https://github.com/TheShield2594/timeflow/issues/106)).
- `--warn` is a real token, defined per theme. Five rules referenced it as
  `var(--warn, #b45309)` while nothing defined it, so all five resolved to the
  literal in both themes — 3.25:1 on the dark surface, and carried by exactly
  the text a manager scans for ("3 missing days"). The inline fallbacks are gone
  so the next missing definition fails visibly
  ([#101](https://github.com/TheShield2594/timeflow/issues/101)).
- Token hygiene in the same round: dropped `--accent`/`--accent-hover`, which
  were defined and referenced nowhere while the real accent lived elsewhere;
  stopped re-hardcoding `--sidebar-active-text`; gave `.entry-row__task` and
  `.timesheet__load-more` the CSS rules their markup had always assumed; and
  replaced seven scattered default-project-colour literals (six of them an
  indigo that isn't in the Everence palette) with one `DEFAULT_PROJECT_COLOR`
  — a neutral that clears 3:1 in both themes, so a project with no colour set
  reads as exactly that
  ([#101](https://github.com/TheShield2594/timeflow/issues/101)).

### Performance

- A running timer no longer re-renders every page once a second — the elapsed
  and focus clocks tick inside the timer bar, page components are memoized, and
  calendar drags only re-render when the pointer crosses a slot
  ([#95](https://github.com/TheShield2594/timeflow/issues/95)).

### Security

- Cleared 15 npm advisories in dev tooling and added Dependabot so new ones
  don't pile up ([#107](https://github.com/TheShield2594/timeflow/issues/107)).
- The Team read has an isolation assertion of its own. `hasForeignUserEntries()`
  only ever covered the personal path; `findUnexpectedOwners()` now flags any
  owner who is neither the caller nor a direct report. It logs rather than
  blocks, and warns rather than alarms, because indirect reports trip it
  legitimately at hierarchy depth > 1
  ([#91](https://github.com/TheShield2594/timeflow/issues/91)).

### Documentation

- Added an [operations runbook](docs/RUNBOOK.md): deploy, rollback, Dataverse
  backup/restore, first-line support triage, and the environment admin
  checklist ([#112](https://github.com/TheShield2594/timeflow/issues/112)).
- Added this changelog, [CONTRIBUTING](CONTRIBUTING.md) and a release/tagging
  process.
- Added [`docs/DECISIONS.md`](docs/DECISIONS.md) for settled and open decisions.
- Added a [data-isolation UAT sign-off checklist](docs/UAT-DATA-ISOLATION.md),
  including the unfiltered devtools read that tests the Dataverse boundary
  itself rather than the app's own filtering, and made the README's role table a
  release gate re-verified after every solution import rather than a one-time
  setup note ([#91](https://github.com/TheShield2594/timeflow/issues/91)).
- Reconstructed what could be recovered of the
  [July design-review register](docs/reviews/design-review-register.md), and
  adopted `P0`/`P1`/`P2` issue labels so commits and the tracker share one
  vocabulary ([#109](https://github.com/TheShield2594/timeflow/issues/109)).
- Retired `Brandon To Do.md`; its live items are now
  [#129](https://github.com/TheShield2594/timeflow/issues/129),
  [#130](https://github.com/TheShield2594/timeflow/issues/130) and
  [#131](https://github.com/TheShield2594/timeflow/issues/131)
  ([#110](https://github.com/TheShield2594/timeflow/issues/110)).
- Corrected README drift: the project-structure tree, missing features in the
  feature table, the client-side caveat on the 12-hour auto-stop, the hardcoded
  working-hours window, and the security model described in
  `dataverseService.ts`'s header comment.
