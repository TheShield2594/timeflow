# TimeFlow — Full Application Review

**Date:** 2026-08-12 · **Commit reviewed:** `3068b4f` · **Branch:** `claude/multi-agent-app-review-d6izc8`

Six independent reviews were run against the codebase, each from a different
discipline: Project Management, Architecture, UI/UX, Security, Mobile, and
Web Development. This document consolidates them, resolves where they agree,
and gives a single prioritized plan of action.

> **Scope decision (2026-08-12):** mobile and touch support are **not a target**
> at this time. The mobile findings are preserved in [Appendix A](#appendix-a--deferred-mobile-findings)
> but are excluded from the priorities and the plan below. Three findings that
> the mobile reviewer raised are *not* mobile-specific and remain in scope —
> they are marked where they appear.

---

## Verdict

The app is in better shape than most codebases of this size. The checks all pass
for real (`lint`, `typecheck`, `359 tests`, `build`), `strict` is on, there is
one `as any` in production code and no `@ts-ignore`, the layering is genuinely
respected, empty states are designed rather than blank, and the two things most
likely to be wrong in an app like this — cross-user authorization and CSV formula
injection — are both implemented correctly.

With mobile out of scope, what holds it back is two things:

1. **A data-integrity bug that mis-bills time on DST days.** The calendar treats
   minutes-of-day as if it were a duration. Twice a year that is wrong, and the
   wrong number is what gets stored and exported.
2. **The project cannot be promoted to another environment.** The deploy config
   is hard-bound to one dev environment and the security-critical Dataverse
   setup is a manual checklist with no verification gate.

Everything else is meaningful but not release-blocking.

---

## Findings by reviewer

| Reviewer | P0 | P1 | P2 | Headline |
|---|---|---|---|---|
| Project Manager | 2 | 5 | 8 | Product is complete; the *project* isn't. Bus factor 1, no promotion path. |
| Architect | 2 | 7 | 9 | Layering is real and respected. One god component, one perf anti-pattern. |
| UI/UX | 2 | 9 | ~20 | Strong craft; contrast and live-region gaps are the real failures. |
| Security | 0 crit | 4 med | 6 low | No criticals. Team-view authz and CSV escaping both done right. |
| Web Developer | 1 | 2 | 11 | Found the DST billing bug. All four CI checks verified passing. |
| ~~Mobile~~ | — | — | — | *Deferred — see Appendix A.* |

---

## Where reviewers independently agreed

Findings that surfaced from more than one direction, which raises confidence:

| Finding | Found by |
|---|---|
| The whole page tree re-renders 1×/second while the timer runs (~720 element diffs/sec on Calendar) | Architect, Mobile |
| `useTimer.start()` guards on the render snapshot instead of `timerRef.current`, breaking the invariant the rest of the file states explicitly | Architect, Web Dev |
| `teamService` does its own single-page fetch with no pagination and no retry, unlike the personal path | Architect, PM |
| `retryWithBackoff` only treats 429/503 as transient — a dropped connection is never retried | Architect, Mobile |
| Load-bearing information lives only in `title=` attributes (unreachable by keyboard and screen reader) | UI/UX, Mobile |

---

## P0 — fix before a production rollout

### 1. Calendar drag/resize/nudge corrupts durations on DST days
`src/components/CalendarPage.tsx:115-119, 916-928, 1050-1060, 1080-1088`

Every calendar write path derives `durationMinutes` by subtracting two
minutes-of-day values, then stores wall-clock timestamps. On a 23- or 25-hour
day the two representations disagree and the entry is saved with a duration
that contradicts its own timestamps.

Reproduced in `America/New_York`:

- **Fall back, 2026-11-01.** Resize an entry to 01:00→03:00. Stored duration:
  **120 minutes.** Real elapsed: **180.** The timesheet, the reports matrix and
  the CSV export all under-report by an hour.
- **Spring forward, 2026-03-08.** Drop a 60-minute block on 02:00 — an hour that
  does not exist. Both endpoints resolve to 03:00, so the entry is saved with
  `startTime === endTime`, jumps an hour from where it was dropped, and still
  claims a 60-minute duration.

CI never catches this because tests run in UTC — only `src/utils/dates.test.ts`
opts into a DST zone via `vi.stubEnv("TZ", ...)`.

**Fix:** build both `Date` instants first, then subtract — the pattern
`src/components/EntryModal.tsx:136-139` already uses correctly. Set `test.env.TZ`
to a DST-observing zone in `vitest.config.ts` and add a fall-back-day case.

### 2. `--text-faint` fails WCAG AA and carries informative text in 54 rules
`src/styles.css:122` (light: **2.46:1**), `:2105` (dark: 3.86:1)

Not just decoration. It colors the calendar's hour labels, every column header in
the Reports matrix, "No matches" in the Combobox, "No data for this period",
per-day totals, and the percentage column in the By Project report.

**Fix:** split the token by role — a compliant `--text-faint` (≈`#5f6d5c`) for
informative text, and keep the current value as `--text-decor` for placeholders
and separators.

### 3. Keyboard reschedule destroys focus
`src/components/CalendarPage.tsx:1232-1253`, `:1096-1108`

Shift+Arrow is the accessible alternative to drag — but entries render inside the
gridcell they start in, chosen by `Math.floor(startMin / 30)`. A nudge across a
30-minute boundary re-parents the block, React unmounts the focused node, and
focus drops to `<body>`. Every second press on the time axis, every press on the
day axis. This defeats the very feature built to satisfy WCAG 2.1.1.

### 4. `power.config.json` is hard-bound to one dev environment
`power.config.json:3, 6, 13, 22`

The *runtime* data layer promotes cleanly via the connector's `"current"` token —
that part is good engineering. The *deploy artifact* does not: `pac code push`
targets the committed `appId`/`environmentId`, and the two connection-reference
GUIDs won't exist in QA or prod. `README.md:310-314` gives no instruction to
change any of it. A QA push today would either fail or overwrite the dev app.

### 5. Security-critical Dataverse config is a manual checklist with no gate
`README.md:79-166`, issue #54

If `ever_timeentries` is not set to **User** ownership, every user can read every
other user's time entries. The app has good mitigations (server-resolved
`eq-userid` FetchXML filtering, plus a `hasForeignUserEntries()` runtime canary)
but no pre-deploy check, no solution artifact, and no UAT script. The primary
control against a company-wide privacy incident is one person remembering one
dropdown.

### 6. `userService.ts` host detection is untested
`src/services/userService.ts` (124 lines, 0 tests)

`isPowerAppsHost()` decides whether every write in the app goes to Dataverse or to
localStorage. The iframe heuristic, the 2×8s `getContext` retry, and the
`hostConfirmed ?? import.meta.env.PROD` fallback are all subtle and all untested.
A false negative means **users' time silently vanishes into localStorage while the
UI reports success.**

---

## P1 — high value, near-term

**Correctness**

- A zero-duration entry marks the rest of the day as tracked (`src/utils/gaps.ts:41-42`,
  duplicated verbatim in `src/components/TodayStrip.tsx:45-46`). The `<=` meant to catch
  midnight-spanning entries also catches `end === start`. Reachable by starting and
  stopping the timer within the same minute. Untracked-gap detection then goes silent
  for the rest of the day. Same root cause as P0-1.
- Reports matrix column totals don't equal the sum of the cells above them
  (`src/components/ReportsPage.tsx:313, 317, 326, 329`) — each cell rounds independently.
  Three projects at 50 minutes shows `0.8 + 0.8 + 0.8` under a total of `2.5`. Reports
  uses `toFixed(1)`, the CSV uses `toFixed(2)` — two surfaces people reconcile against
  each other, formatted by two different rules.
- `useTimer.start()` reads the render snapshot rather than `timerRef.current`
  (`src/hooks/useTimer.ts:175`), breaking the invariant `stopAt` and `cancel`
  deliberately follow. Risk is a double-start leaving an orphaned draft row that
  resurfaces as a phantom running timer.
- Project breakdown percentages sum to 99% (`src/utils/reportAggregations.ts:166`) —
  independent rounding again; needs largest-remainder allocation.

**Performance**

- The entire page tree re-renders once per second while the timer runs. `useTimer`
  is called in `AppContent` (`src/App.tsx:138`), nothing between there and the leaves is
  memoized, and the Calendar rebuilds ~720 elements per second to update one span of
  text. *(Raised independently by the Architect and the Mobile reviewer — this is a
  desktop problem, not a mobile one.)*
- Linear `projects.find()` / `tasks.find()` inside render loops, including inside the
  timesheet's search filter (`src/components/TimesheetPage.tsx:98-99`) — with 5,000
  entries that is ~10⁶ comparisons per keystroke.

**Resilience** *(both raised by the Mobile reviewer but not mobile-specific)*

- `retryWithBackoff` only classifies 429 and 503 as transient
  (`src/services/dataverseService.ts:66-70`). A dropped connection is a network-layer
  failure with no status code, so it is thrown on the first attempt — zero retry for the
  most common real-world failure. Corroborated by the Architect.
- The idle prompt fires spuriously whenever the tab is backgrounded
  (`src/hooks/useTimerSafety.ts:55-67`). `lastActivity` freezes when you switch tabs or
  apps; on return the check runs and offers to **trim the entry back to when you last
  touched the keyboard** — for a session you were working through. Fix by bumping
  `lastActivity` on `visibilitychange → visible`.

**Accessibility**

- The running timer is unannounced — the elapsed count sits inside a button whose
  `aria-label` overrides it (`src/components/TimerBar.tsx:417-429`).
- Toasts likely never announce: the live-region container returns `null` when empty,
  so the `role="status"` node is created *with* its text already inside
  (`src/contexts/ToastContext.tsx:56-64`). Error toasts are also polite, not assertive.
- `--warn` is referenced five times and never defined; the literal fallback is 3.25:1
  in dark mode, on the Team page's missing-day badges.
- White on `--ev-green` is 3.5:1 — the app's primary button in its resting state
  (hover is 5.1:1, which is backwards).
- The focus trap escapes on backdrop click (`src/hooks/useFocusTrap.ts:39`).
- Escape or a backdrop brush silently discards a filled-in entry form.
- "Discard session" deletes potentially hours of tracked time with no confirm and no
  undo — alone among this app's destructive actions.
- The Reports matrix has no `scope`, no row headers and no caption.
- Load-bearing information lives only in `title=` attributes — exact matrix cell values,
  why Continue is disabled, what Archive does, the drag/nudge instructions. `title` is
  unreachable by keyboard and is overridden by `aria-label` where both are present.
  `HelpTip` already exists and is the right pattern to reuse.

**Security (medium)**

- 15 npm advisories (2 critical, 5 high) — **all dev-only**; no production runtime
  dependency is affected. `vitest`, `vite`, `esbuild` are the notable ones.
- Unvalidated GUID interpolation into OData `$filter` at `src/services/teamService.ts:190,196`
  and `src/services/dataverseService.ts:580`. Not exploitable today; one refactor away
  from being so.
- A production build opened outside the Power Apps host falls back to an unauthenticated
  localStorage identity. Contained today only because the same flag also switches the
  data layer to mock — an undocumented coupling.
- App query filters are not the security boundary; isolation rests entirely on Dataverse
  role configuration, and only the personal path has a runtime assertion.

**Project**

- The design-review register the commits cite (`P1-07`, `P2-15`) exists nowhere in the
  repo or the tracker — it lives only in a chat session link.
- `Brandon To Do.md` is a second, untracked backlog containing an open schema-migration
  decision with no owner and no date.
- No CD, no prod telemetry, no rollback/backup/support runbook. The isolation canary
  fires a toast at the affected user and logs to their console — nobody on the project
  ever learns.
- Bus factor is 1.

---

## Recommended plan

**Phase 0 — before any production rollout**

1. Fix the DST duration bug (P0-1) and the zero-duration gap bug, and set `TZ` in
   `vitest.config.ts` so the class stays fixed.
2. Do issue #54 (managed solution) and fix environment promotion. This collapses two
   P0 risks into one importable artifact. Relabel #54 from `enhancement` — it is the
   release blocker.
3. Write a UAT sign-off checklist: two accounts, verify A cannot see B's entries, the
   isolation toast never fires, Team shows only direct reports.
4. Add minimal prod telemetry, even just routing the ErrorBoundary and the isolation
   canary to App Insights.
5. Test `userService.ts` host detection.

**Phase 1 — next two weeks**

6. Accessibility batch: `--text-faint` split, `--warn` definition, primary-button
   contrast, the toast live region, the timer announcement, focus restoration after
   Shift+Arrow, focus-trap `inert`, and promoting `title`-only content to `HelpTip`.
7. Performance batch: move `elapsed` out of `AppContent`, memoize the page components,
   build id→entity Maps once instead of scanning per row.
8. Resilience: broaden `retryWithBackoff` to network errors and 502/504; bump
   `lastActivity` on `visibilitychange` so the idle prompt stops firing on tab switch.
9. Reconstruct the design-review register into GitHub issues and adopt P0/P1/P2 labels
   so commits and the tracker speak the same language. Migrate `Brandon To Do.md`.
10. `npm audit fix`, then plan the `vite`/`vitest` majors. Add Dependabot.
11. Document rollback, backup and support. Tag a release so "what's in prod" has an answer.

**Phase 2 — next month**

12. Decompose `CalendarPage.tsx` (1,725 lines) along its six natural seams — the three
    drag hooks first, since they are self-contained and currently untestable.
13. Introduce an entries/projects/tasks context; `PageRouter` currently takes 19
    pass-through props.
14. Delta-fetch on range widening — "All time" currently refetches the user's entire
    history and discards the 90-day result it already had.
15. Fix the doc drift: the stale Project Structure tree, the Overview page's absence
    from the feature table, the client-only caveat on the 12h auto-stop, and the
    security comment at `dataverseService.ts:20-21` that contradicts the README.
16. Write end-user documentation. "Ratio" is explained only in three in-app tooltips.

---

## What was checked and found clean

Worth recording, because these are the things most likely to be wrong:

- **Team-view authorization is enforced server-side.** `eq-useroruserhierarchy`
  (`src/services/teamService.ts:246`) is resolved by Dataverse against the caller's own
  token. A non-manager calling it from the console gets only their own rows. It fails
  closed. The nav gating is client-side, but it gates rendering, not data.
- **CSV formula injection is correctly neutralized.** `escapeCSV`
  (`src/services/csvExport.ts:8-21`) prefixes `'` to the full dangerous set before
  quoting, and the end-to-end path is closed: an external meeting organizer's malicious
  Outlook subject is still escaped by the time it reaches a manager's Team export.
- **No XSS surface.** Zero `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`
  or `javascript:` anywhere in `src/`.
- **No secrets committed.** `.env.example` declares nothing; no `VITE_*` variable is read
  anywhere, so nothing sensitive is in the bundle. Full history scan clean.
- **CI is exemplary.** Actions pinned to commit SHAs, `pull_request` not
  `pull_request_target`, permissions narrowed, `persist-credentials: false`, no secrets
  referenced.
- **The timer's offline story is genuinely well built.** localStorage mirror with
  throw-safe writes, a server draft reconciled on next load, and a failed stop that parks
  in `pendingStopAt` and replays the *original* timestamp rather than "now".
- **Optimistic updates** are consistently implemented with snapshot-and-rollback across
  all three entity hooks, and the dropped-response-body handling correctly refuses to
  adopt an empty id or let a default `statecode` archive a just-created project.
- **Reduced-motion support is complete** — durations killed *and* infinite animations
  stopped, which most implementations only half-do.
- **Empty states are designed, not blank.** Several are context-aware: the Reports empty
  state scans loaded entries for the narrowest range that *does* have data and offers it
  as a one-click button.
- **All 22 features claimed in the README are real.** No stub, no half-wired feature.
  If anything the README under-claims — the Overview page, untracked-gap detection, the
  weekly target ring and Team CSV export aren't in the feature table at all.

---

## Appendix A — deferred mobile findings

Mobile and touch support are **not a target** as of 2026-08-12. These findings are
recorded here so the analysis isn't lost if that changes. None are on the plan above.

Note that the app currently ships a *partial* mobile implementation — four breakpoints
and a purpose-built `.cal-mobile-list` day view at ≤768px. It is reachable from the
Power Apps mobile player and from any narrow browser window, and in its current state
it is broken. Worth a deliberate decision: either remove the mobile-specific code so
the app degrades predictably, or accept it as-is knowing the state below.

**Blockers, if mobile were in scope**

- **The mobile calendar day list is hard-clipped.** `styles.css:1095, 1819, 1820` — the
  only scroller lives inside the element hidden at ≤768px, and `.cal-mobile-list` has no
  `overflow` of its own inside `.calendar { overflow: hidden }`. At 375×812, past ~7 rows
  the remaining entries and the `+ Add entry` button are unreachable.
- **All 12 input rules are under 16px**, so iOS zooms on focus into a
  `height: 100dvh; overflow: hidden` shell that cannot be panned back.
- **Task deletion has no touch path.** `styles.css:1067-1078` is hover/focus-only with no
  `@media (hover: none)` fallback.

**High priority, if mobile were in scope**

- No touch reschedule path at all — `CalendarPage.tsx:983` returns early for
  `pointerType === "touch"`, and Shift+Arrow has no touch equivalent.
- ~22 controls below the 44pt/48dp minimum; worst is three 26px actions 2px apart with
  Delete adjacent to Edit.
- Two date navigators wired to different state, so the week header and day list disagree
  (`CalendarPage.tsx:513` vs `:1418`).
- Timer bar selectors are `flex: none` at 368px minimum inside a 347px box — clipped, not
  scrollable (`styles.css:423`).
- Timesheet rows leave ~5px for the description at 375px; at 320px the page pans sideways
  (`styles.css:607-613`).
- The 336-cell desktop grid still renders at ≤768px where it is `display: none` — ~700
  DOM nodes built to be hidden.
- Combobox commits on synthesized `onMouseDown`, producing the classic "first tap does
  nothing" failure on the required field for starting a timer (`Combobox.tsx:152, 173`).
- Chart, matrix and heatmap values are hover-only.
- Modal drafts live in component state only and are lost when iOS evicts the webview;
  the overnight-split guard is a `useRef`, so an eviction mid-split can double-count.
- No `viewport-fit=cover`, no `env(safe-area-inset-*)`, no `theme-color`.
- No `inputMode` / `autoCapitalize` / `enterKeyHint` anywhere.
- The `⌘.` shortcut chip renders on iPhones, consuming space in the primary control to
  advertise a keystroke the device cannot produce.
