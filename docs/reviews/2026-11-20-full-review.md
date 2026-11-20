# TimeFlow — full review, 2026-11-20

**Commit reviewed:** `ba32135` (v1.0.0) · lint, typecheck, 84% coverage test
run and build all pass · `npm audit --omit=dev` reports nothing.

Three passes: a read of the data layer (services, hooks, utils, contexts), a
read of the UI layer (components, `styles.css`, UI hooks), and the app itself
driven in Chromium on mock data at 1366 and 1024 wide, both themes.

Each finding carries how far it was taken:

- **Reproduced** — done in the running app, result read back from storage or
  the screen.
- **Read** — confirmed in the code by a second reader; not run.
- **Reported** — one reader's finding from the code, not independently
  confirmed. Treat as a lead.

Nothing here has an issue number yet. Per CONTRIBUTING, file the ones worth
doing as issues and cite those in commits, not the section numbers below.

---

## Verdict

The foundations hold up. The things the August review worried about —
server-side row filtering, CSV formula escaping, FetchXML/OData interpolation,
paging past 5,000 rows, DST-safe durations, local date keys — were all
re-checked and are sound.

What is wrong is at the seams between features that are each correct alone.
Five defects change or lose a billable number without telling anyone, and one
breaks the product's headline gesture on its landing page. All six pass the
existing test suite, mostly because the tests drive components with synthetic
events and never run two features against each other.

---

## 1. Fix first — wrong numbers, lost time, a dead control

### 1.1 "Split at midnight" while editing deletes the first half — Reproduced

`EntrySheet.tsx:288-308` saves a split as two `onSave` calls. In create mode
those are two creates. In edit and stop mode every caller maps `onSave` to
`editEntry(sameId)` (`App.tsx:306`, `TimesheetPage.tsx:363`,
`CalendarPage.tsx:740-746`), so the second call overwrites the first.

Repro: edit an 8:00 PM–10:00 PM entry, set the end to 2:00 AM, choose *Split at
midnight*, Save. Expected two entries totalling 6h. Stored: one entry,
12:00 AM–2:00 AM on the next day, 2h. Four hours are gone and the toast says
Saved.

The stop sheet takes the same path, so a timer stopped after midnight offers
the same prompt. Tests cover create mode only.

### 1.2 "Fill it" inside the Timesheet's edit sheet duplicates the entry — Reproduced

`TimesheetPage.tsx:353-370` swaps the sheet's state to a create draft without a
`key`, and `EntrySheet` seeds its form once on mount. The form keeps the old
entry's project, description and times; the mode silently becomes *create*.

Repro: open a 9:00–11:00 entry, press the sheet's *Fill it*, Save. Stored: a
second, identical 9:00–11:00 entry. The Calendar already keys its sheet
(`CalendarPage.tsx:826`); the Timesheet needs the same.

### 1.3 Moving a short entry on the calendar rounds it up to 15 minutes — Reproduced

`useCalendarDrag.ts:323` floors a move's duration at `MIN_RESIZE_DURATION_MIN`.
That floor is right for a resize and wrong for a move, which is supposed to
preserve the length (#87 says so in the comment beside it).

Repro: a 4-minute entry, focus it, Shift + ↓. Stored afterwards: 15 minutes.
Drag-move and day-nudge share the function.

### 1.4 The timer shortcut and the stop path can write duplicate entries — Reproduced / Read

Two faces of one missing guard.

- **Held chord — Reproduced.** `App.tsx:188-199` has no `e.repeat` check.
  Holding Ctrl + . with a project picked alternates start and stop on every
  auto-repeat. Twelve repeats left six 0-minute entries.
- **Stop during a stop — Read.** `useTimer.ts:265` (`stopAt`) has no in-flight
  latch, and the hero shows *Retry save* as soon as `pendingStopAt` is set, not
  only after a failure. If the draft row never got an id (the create failed at
  Start, which is swallowed as non-critical at `:179`), Stop followed by Retry
  or Ctrl + . during the save issues two `createTimeEntry` calls: two identical
  billable entries. With a draft id the repeat is a harmless second PATCH.

One in-flight ref in `stopAt`, plus `if (e.repeat) return`, closes both.

### 1.5 Clicking a gap on the Timer's day bar does nothing — Reproduced

The Timer page's day bar is where "close the gap in one gesture" is supposed to
happen. `DayBar.tsx:47-52` captures the pointer on the track on pointerdown,
and the gap buttons (`:89-99`) don't stop that event, so in Chromium the click
never reaches the button. Mouse click: no sheet. Focus + Enter on the same
button: sheet opens.

The component tests pass because `fireEvent.click` bypasses pointer capture.
The Calendar's equivalent buttons do stop the pointerdown.

### 1.6 The Calendar ignores the user's working hours — Read

`CalendarPage.tsx:625` and `:949` call `findUntrackedGaps` without
`workDayStartMin`, `workDayEndMin` or the minimum-gap setting, so it falls back
to 08:00–18:00 and 15 minutes. Timer and Timesheet pass the user's values. For
anyone not on the default shift the Calendar shows different gaps from the
other two pages — the exact failure the 2026-09-09 working-hours decision was
made to end.

---

## 2. Fix next — wrong behaviour people will hit

| # | Finding | Where | Status |
|---|---|---|---|
| 2.1 | **A timer that runs past midnight is stored as one entry on the start date.** The same span typed by hand is split. Sunday 10 PM–Monday 2 AM puts Monday's two hours in last week's totals, Reports and the Team rollup. | `useTimer.ts:293` | Read |
| 2.2 | **The running row's duration subtracts minutes-of-day** — the pattern CLAUDE.md forbids. Shows 0m for a timer started before midnight; an hour off on DST days. Display only. | `TimesheetPage.tsx:315` | Read |
| 2.3 | **Reports never waits for its range.** On *Quarter* the prior period reaches past the 90-day baseline; until the fetch lands (or forever, if it fails) the delta is computed from whatever is in memory, and *Export CSV* writes a partial file with no marker. Timesheet reads `rangeLoading`; Reports doesn't. | `ReportsPage.tsx:49-68` | Read |
| 2.4 | **A sub-minute timer is saved as a 0m entry.** Start, stop, Esc: "Saved 0m to …". Either drop it or ask. | `useTimer.ts:276` | Reproduced |
| 2.5 | **Outlook ghost and gap text collide.** The ghost is drawn above the gap on purpose, but its background is transparent, so "+ 2h untracked" shows through "Project sync". The ghost's time line also wraps and pushes *Log / Hide* out of a one-hour block. An opaque base under the hatch and `nowrap` on the time fix both. | `styles.css:1056-1064` | Reproduced |
| 2.6 | **Tasks past the fifth can't be reached.** The list slices to five and "N more tasks" is plain text — those tasks can't be seen, renamed or removed. | `ProjectsPage.tsx:313, 355` | Read |
| 2.7 | **Stacked sheets share Esc; Ctrl + . works behind any sheet.** Esc on the idle prompt closes an edit sheet underneath it; the shortcut starts or stops the timer behind a must-choose prompt. | `Sheet.tsx:50-60`, `App.tsx:187` | Reported |
| 2.8 | **Idle "Trim" isn't clamped to the start.** A timer started in tab A can raise the idle prompt in a stale tab B, where Trim stops it at a time before it began: a 0m entry with end < start. | `useIdleGuard.ts:111` | Reported |
| 2.9 | **An orphaned draft can come back as a 12h entry.** If the draft create lands but its response is lost, Stop writes a second row; on the next clean load the open draft is restored as a timer started days ago and the safety net saves 720 minutes. The auto-stop sheet does announce it. | `useTimer.ts:93-151` | Reported |
| 2.10 | **Project sheet: no in-flight guard, no dirty protection.** Double-click Save may create two projects; Esc or a backdrop click discards typed work, unlike the entry sheet. Settings sheet dismisses the same way. | `ProjectsPage.tsx:162-185, 406` | Reported |
| 2.11 | **The new-task field commits on blur.** Type a name, click Cancel: the org-wide task is created anyway. | `EntrySheet.tsx:443` | Reported |
| 2.12 | **Not-found is detected by `msg.includes("404")`.** Any error text containing those digits (a correlation id, a timestamp) reads as not-found: a failed delete looks successful, a failed stop PATCH falls through to a create. Connector error shape not confirmed. | `dataverseService.ts:118, 1155` | Reported |
| 2.13 | **Shared tasks go stale.** Tasks load once; a teammate's new task is invisible until reload, and nothing checks for duplicate names — the fragmentation the shared-task decision exists to prevent. | `useTasks.ts` | Reported |
| 2.14 | **CSV hours don't sum to CSV minutes.** Hours are rounded per row to two decimals: 3 × 50 min reads 2.49h against 150 min. | `csvExport.ts:101` | Reported |

---

## 3. Accessibility and design system

- **Dropdown hides its value from screen readers.** `Dropdown.tsx:189` puts
  `aria-label` on the trigger, which replaces its content: "Project" is
  announced, the selected project isn't. *(Reported)*
- **Calendar entry titles are project-tinted text** (`styles.css:1039-1044`).
  The lighter project colours come out near 2.8:1 in light mode. This is a
  third text colour the contrast test can't see. *(Reported; ratios not
  re-measured)*
- **Ratio and Jira Ticket are labelled only by placeholder**, in `--decor`
  (about 2.7:1). DESIGN.md permits decor placeholders, so the spec conflicts
  with itself here; a placeholder that is the only label is text.
- **The Timesheet search placeholder is cut off** — "Search descriptions,
  tasks, ti". Widen the field or shorten the copy. *(Reproduced)*
- **"Hours in the loaded range"** on Projects is an implementation detail shown
  to users. Say the window: "Last 90 days". *(Reproduced)*
- **Calendar is blank between 769 and 860px.** CSS hides the grid at ≤860px;
  the list renders only below 769px. Mobile is out of scope, but a narrow
  desktop window is not. *(Reported)*
- **Off-system values.** Font sizes of 14px and 16px outside the ten steps
  (`styles.css:308, 585, 726, 935, 1175, 1204`); margins of 22, 26, 30, 34;
  inline spacing in four components. Low, but a lint for `font-size:` outside
  `.t-*` would stop it growing.
- **Small targets.** Day-bar gap buttons are 18px tall; calendar *Log / Hide*
  and gap labels are text-sized.
- **`--accent` on things you can't act on** — chart bars, the ring, the
  now-line. Either the rule or the code should change; only Team's use is
  argued in a comment.
- **No max-width on the main column**, so list rows stretch across an
  ultrawide monitor with the title at one edge and the duration at the other.

---

## 4. Worth adding

Ordered by value against effort. Each was checked against the README's
*Deliberately not here* table; none re-adds something removed on purpose.

1. **Show the running timer everywhere.** Off the Timer page nothing says a
   timer is running — not the sidebar, not the tab title. A dot and elapsed
   time on the Timer nav item is the smallest version. The tab title is worth
   doing only if the Power Apps host doesn't frame the app; check in Dev.
2. **Continue / duplicate on every entry row.** `continueEntry` exists but is
   offered only as one "Yesterday you worked on" row while today is empty.
   Today's rows on the Timer page aren't clickable at all.
3. **Recent project · task pairs in the timer picker.** The list is flat and
   org-wide. Recents respect "name tasks after the work" because the task
   already exists.
4. **Undo for moves and edits.** Delete, archive and discard have Undo; a
   calendar drag commits silently.
5. **Say when entries overlap.** Overlaps are legal and silent; a seeded day
   read 14h 15m with no comment. One line in the entry sheet, no blocking.
6. **A few more shortcuts.** Only Ctrl + . and the calendar's Shift + arrows
   exist. New entry, previous / next week, Today, and a `?` list of them.
7. **"Same as yesterday" for a missed weekday.** Today a missed day offers only
   an empty *Fill it*.
8. **Reports: custom range and a project filter.** Timesheet has both.
9. **Retry on sign-in failure** (`App.tsx:67`), and say why Save is disabled
   when a project or time is missing.
10. **Team CSV: an owner-id column**, so two people with one display name can
    be told apart.

### Integrations

- **Jira links.** Tickets are stored as text. One configured base URL would
  make every ticket a link.
- **Server-side safety net for abandoned timers.** Idle detection and the 12h
  stop are client-side only, so a closed tab leaves an open draft (2.9). A
  scheduled Power Automate flow closing drafts older than 12h would remove the
  whole class.
- **Dataverse-side bounds** on `ever_timeentries` (end ≥ start, a duration
  ceiling) so a client bug can't store an impossible entry.
- **Missing-time reminders by Teams or email** are possible with the same
  flow, but run against "describe, don't prescribe" — a decision for
  DECISIONS.md, not a gap.

---

## 5. Housekeeping

- **Add one browser test to CI.** 1.5 and 2.5 exist because jsdom has no
  layout and no pointer capture. A single Playwright smoke run — start, stop,
  fill a gap by mouse, split an overnight edit — would have caught three of
  section 1.
- **`@microsoft/power-apps` is at 1.3.1; 1.6.0 is out.** Everything else is
  within a minor of current, bar the majors already tracked (#161, React 19).
- **Coverage holes on preference code:** `useWeeklyTarget` 0%,
  `useWorkingHours` 52%, `telemetry` 57%. The working-hours inverted-window
  guard is called "the guard that matters" in DECISIONS and is half-tested.
- **D-2 (licence) has an owner and no target date**, which by the file's own
  rule means it isn't tracked.
- **Three open issues** (#7, #156, #161), all build-side; none conflicts with
  anything above.
