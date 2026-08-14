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

### Performance

- A running timer no longer re-renders every page once a second — the elapsed
  and focus clocks tick inside the timer bar, page components are memoized, and
  calendar drags only re-render when the pointer crosses a slot
  ([#95](https://github.com/TheShield2594/timeflow/issues/95)).

### Security

- Cleared 15 npm advisories in dev tooling and added Dependabot so new ones
  don't pile up ([#107](https://github.com/TheShield2594/timeflow/issues/107)).

### Documentation

- Added an [operations runbook](docs/RUNBOOK.md): deploy, rollback, Dataverse
  backup/restore, first-line support triage, and the environment admin
  checklist ([#112](https://github.com/TheShield2594/timeflow/issues/112)).
- Added this changelog, [CONTRIBUTING](CONTRIBUTING.md) and a release/tagging
  process.
- Added [`docs/DECISIONS.md`](docs/DECISIONS.md) for settled and open decisions.
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
