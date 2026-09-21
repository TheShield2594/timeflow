# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Everence staff, mostly IT and development. They log time against org-wide
projects and tasks while they work. The usual pattern is a running timer that
they start, stop, and file. Afterwards they fill untracked gaps from the day
bar, the Timesheet or the Calendar. Some entries carry a Jira ticket and a
billing ratio. Both are optional and entered per entry; the project's own
values are not copied in (the entry sheet says so).

Managers are a secondary audience. The Team page shows them their line's week:
per-member totals, missing weekdays, a project rollup, and a CSV export. The nav
item appears only for users who have direct reports in Dataverse.

The company is US-based. Dates are month-first and the clock is 12-hour (docs/DECISIONS.md,
#152).

## Product Purpose

TimeFlow is the company's record of billable time. It is a Power Apps Code App
over Microsoft Dataverse. Success is a record that is complete and correct and
costs the user as little effort as possible.

A wrong number is worse than a missing feature. Most failures here are silent
and arithmetic: a UTC date that lands an entry on tomorrow, a DST day that is an
hour off, or a gap search window that tells someone their day is complete when
it isn't.

## Positioning

TimeFlow is not a general time tracker. It is built around one question: is
today's record complete and correct? The timer describes what you did. It never
prescribes what you should do. Gaps are detected against each person's own
working hours and offered as one click to fill. Stopping the timer opens a sheet
to confirm and file the entry, and names new tasks after the work is done. It
lives inside the Microsoft tenant: Entra sign-in, Dataverse row security, and
Outlook meetings shown as ghost blocks.

## Operating Context

- Desktop browser, inside the Power Apps host (or `npm run dev` on
  localStorage mock data). Mobile is explicitly out of scope (docs/DECISIONS.md).
- The Timer screen is the landing page. Nav has five items, six for managers:
  Timer, Timesheet, Calendar, Reports, Projects, and Team.
- The global shortcut Ctrl/Cmd + . starts and stops the timer from anywhere. The
  calendar supports Shift + arrow keys as the keyboard alternative to dragging.
- Outlook calendar overlay: meetings appear as muted blocks, and a meeting can
  be logged in two clicks. The overlay depends on DLP and user consent.
- CSV export uses billing-style rounding and includes the Jira ticket and ratio.
  It feeds billing work outside the app.
- A running timer is safeguarded by idle detection and a 12h auto-stop. Both are
  client-side only. When the tab closes, nothing stops the timer.

## Capabilities and Constraints

- Stack: React 18 + TypeScript + Vite, plain CSS in `src/styles.css`, no UI
  library. Deployed with `pac code push`. Vite assets over 4KB break in the host,
  so the inline limit is 32KB.
- Data: `ever_projects`, `ever_workitems` (tasks) and `ever_timeentries` in
  Dataverse. Reads are filtered server-side (`eq-userid`,
  `eq-useroruserhierarchy`), and client-side filtering is never the security
  boundary.
- Tasks are shared per project on purpose, so nothing confidential goes in a
  task name. Entry descriptions are per-user.
- Archiving a project or deleting a task deactivates the record. Only time
  entries are hard-deleted. Deletes come with Undo.
- Preferences live in `localStorage`, scoped per environment and user, so they
  are per-device and not backed up. They are the weekly target, working hours,
  minimum gap, export rounding and the Outlook toggle. The theme is
  device-level.
- Removed on purpose in the 2026-09 redesign, so bringing any back is a decision
  rather than an oversight: the Overview page, Focus mode/Pomodoro, the activity
  heatmap, the day-streak KPI, KPI strips, ratio and ticket in the timer bar,
  and inline task creation before starting. Reasons are in README.md.
- Open: the licence (D-2). The repo carries MIT, but the app is private and
  Everence-branded.

## Brand Commitments

- Name: **TimeFlow**, an internal Everence app. Assets: `src/everence-logo.png`
  and `src/everence-mark.png`.
- The Everence green brand palette (`--ev-*`) is kept, but only as the
  **project** palette.
- Voice: plain and specific. The app says what happened and what to do next, in
  a sentence rather than a KPI. It never gamifies compliance.
- The 2026-09 redesign handoff (`docs/design/2026-09-redesign-handoff.md`) is
  the binding visual authority, and its deviations are recorded at the bottom of
  that file. Some of its rules are enforced by `src/styles.contrast.test.ts`.

## Evidence on Hand

- Real data exists only in Dataverse environments. Local dev starts with an
  empty workspace and no seed data. Mock Outlook meetings are deterministic.
- Docs: README.md, CLAUDE.md, CONTRIBUTING.md, CHANGELOG.md,
  docs/DECISIONS.md, docs/RUNBOOK.md, docs/UAT-DATA-ISOLATION.md,
  docs/design/2026-09-redesign-handoff.md, and
  docs/reviews/2026-08-12-multi-agent-review.md.
- There are no user research findings, usage metrics or testimonials. Don't
  invent adoption numbers or quotes.

## Product Principles

1. **The record comes first.** Correct, complete time matters more than any new
   feature. A surface that could show a wrong total or hide a gap is broken, even
   if it looks finished.
2. **Describe, don't prescribe.** The app reflects the work back. It does not
   run a second clock, nag, or gamify.
3. **Close the gap in one gesture.** Missing time is surfaced where it is seen
   and filled from there: the day bar, a Timesheet row, the calendar, or a
   meeting.
4. **Earn every element.** The 2026-09 redesign removed more than it added.
   Anything new has to justify itself against that.
5. **Tell the truth about failure.** Offline, failed saves, auto-stops and
   isolation warnings are stated plainly and come with the action that fixes
   them.

## Accessibility & Inclusion

Target WCAG 2.1 AA. The two text colours per theme must reach 4.5:1 on every
surface, and this is enforced in tests. Every drag interaction has a keyboard
equivalent. Information that matters must not live only in `title=`
attributes. Durations, times and counts use tabular figures. Light and dark
themes are both first-class.
