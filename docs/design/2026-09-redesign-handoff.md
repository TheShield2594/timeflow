<!--
  Checked in verbatim, and on purpose.

  This is the brief the 2026-09 redesign was built from, and it is the only
  written record of *why* each screen is the shape it is — which tokens are
  load-bearing, what was removed and what removing it was for. It arrived as a
  handoff bundle alongside four `.dc.html` prototypes; those are visual
  references rather than code and are not vendored here (they need a viewer
  runtime of their own), but the reasoning is, because the last time a
  register like this lived only in a chat session it became unrecoverable —
  see docs/reviews/design-review-register.md.

  Where the implementation deviates, the deviation is recorded at the bottom of
  this file rather than by editing the brief.
-->

# Handoff: TimeFlow — Apple-first-party redesign

## Overview

A full visual and structural redesign of **TimeFlow**, the Everence Power Apps Code App (React + TypeScript + Dataverse) at `github.com/TheShield2594/timeflow`.

The brief was to rebuild it as if it were an Apple first-party app: content-first, one unmistakable primary action per screen, a real type hierarchy, an 8pt grid, one accent colour, depth from translucency rather than shadow, data shown as shapes before numbers, and empty states that teach. It is **not** a copy of any Apple app's layout, and it uses no Apple fonts or icons — everything here is shippable in the existing stack.

The redesign also **removes** several features (see *Scope: removals*). That is deliberate and is part of the work.

---

## About the design files

The four `.dc.html` files in this bundle are **design references written in HTML**. They are prototypes that show intended look, structure, spacing and copy. They are **not production code and must not be copied into the app**.

The task is to **recreate these designs inside the existing codebase** — React 18 + TypeScript, Vite, plain CSS in `src/styles.css`, no UI library — using its established patterns: CSS custom properties on `:root` and `:root[data-theme="dark"]`, BEM-ish class names, one component per file in `src/components/`, hooks in `src/hooks/`.

To view a design file, open it directly in a browser (it needs `support.js`, included). Files 2–4 open in a pannable canvas; scroll and zoom to move between artboards.

| File | Contents |
|---|---|
| `Timeflow Design Direction.dc.html` | The system: type scale, spacing, colour tokens (light + dark), depth rules, the time-entry component in four forms, chart primitives, empty-state pattern |
| `Timeflow Timer Screen.dc.html` | Artboards 01–04: timer running (light + dark), timer idle, stop sheet |
| `Timeflow Core Screens.dc.html` | Artboards 05–09: Timesheet, Calendar, Reports, Projects, Team |
| `Timeflow States.dc.html` | Artboards 10–17: entry sheet, idle prompt, 12h auto-stop, offline + failed save, isolation warning, loading, toasts, empty states |
| `everence-mark.png` | The Everence emblem, cropped from `src/everence-logo.png` in the repo |

## Fidelity

**High-fidelity.** Colours, type sizes, weights, letter-spacing, spacing values, radii and copy are all final and should be reproduced exactly. Every value in this README was measured from the design files.

The artboards are drawn at a fixed **1280 × 840** app window with a **232px** sidebar. That is a reference size, not a constraint — the real app must reflow. Where an artboard shows "Show 7 more", that is a real pagination control, not a mock artefact.

---

## Scope: removals

These come out. They are the reason the redesign is smaller than the current app, and leaving them in defeats it.

| Remove | Files | Why |
|---|---|---|
| **Focus mode (Pomodoro)** | `useFocusMode.ts`, `FocusModal.tsx`, `FocusControl` in `TimerBar.tsx`, focus props through `App.tsx`, focus localStorage keys | A second, prescriptive clock competing with the descriptive one. Its prompts die with the tab, so it promises something a Code App cannot deliver. |
| **Activity heatmap** | `ActivityHeatmap.tsx` and its use in Overview | Twelve weeks of 3px squares is not a readable shape, and it answers a question nobody asks. |
| **Day-streak KPI** | streak block in `OverviewPage.tsx` | Gamifies compliance in a billing app. |
| **The three-card KPI strip** | `reports__kpis` in `OverviewPage.tsx`; the four-KPI strip in `ReportsPage.tsx` | Today, This week and the target ring said the same thing three ways. Replaced by one ring + one sentence (timer screen) and one headline + delta + average line (Reports). |
| **Overview as a page** | `OverviewPage.tsx`, the `overview` route in `PageRouter.tsx`, its nav item in `App.tsx` | Its content is now the lower half of the timer screen. Nav goes from 6 items to 5 (6 for managers). |
| **Ratio + Ticket fields in the timer bar** | `timer-bar__extras` in `TimerBar.tsx` | Optional on most entries. They move to the stop sheet and entry sheet, inherited from the project. |
| **Inline "+ New task…" before starting** | `NEW_TASK_OPTION` path in `TimerBar.tsx` | Naming work before doing it produces bad names. Task creation moves to the stop sheet. |
| **`Sparkline.tsx`** | used only by the old project cards | Superseded by the proportion bar on the Projects list. |

Everything else in the repo stays: the Dataverse service layer, hierarchy security, telemetry, gap detection, undo, CSV export, multi-tab sync, the 12h auto-stop, idle detection.

## Scope: additions

Four, ranked. None adds a nav item or a level of depth.

1. **Drag-to-fill on the day bar.** Gap detection already exists in `src/utils/gaps.ts`. Make the day bar itself the input surface: dragging across a grey segment opens the entry sheet prefilled with that span.
2. **Stop sheet.** Stopping opens a sheet showing the entry landing in the day, with an inline nudge if it left an untracked gap. Replaces the bare success toast.
3. **Configurable working hours.** `gaps.ts` hardcodes 08:00–18:00 and a 15-minute floor, so anyone on a non-standard shift gets silently wrong gaps. Store per user in `localStorage` alongside the weekly target; expose in the sidebar's user area. This is a correctness fix.
4. **"Yesterday you worked on"** on the idle timer screen — the top quick-start surfaced where the timer is, not below the fold.

---

## Design tokens

Define these on `:root` and `:root[data-theme="dark"]` in `src/styles.css`, replacing the current text/surface tokens. Keep the `--ev-*` brand palette block as-is; it becomes the **project** palette only.

`src/styles.contrast.test.ts` asserts that every text token clears **4.5:1 on all four surfaces**, and that the decor token is never given a `font-size`. The scale below is built to that rule — do not add a low-contrast "tertiary text" colour.

### Light

| Token | Value | Role |
|---|---|---|
| `--canvas` | `#FBFBF8` | Window background |
| `--surface` | `#FFFFFF` | Grouped list cards |
| `--material` | `rgba(255,255,255,.72)` + `backdrop-filter: blur(24px) saturate(1.6)` | Floating action bars, sheets |
| `--separator` | `rgba(20,22,16,.09)` | Hairlines, inset to text origin |
| `--label` | `#1B1D17` | Primary text |
| `--label-secondary` | `#676B60` | 5.2:1 — all secondary text |
| `--decor` | `#9BA093` | **Non-text only**: dots, bar tracks, empty-bar fills |
| `--dim-display` | `#8A9083` | 3.2:1 — the idle clock at 96px only, ≥28px |
| `--accent` | `#5A7800` | 5.1:1 on white. Everence green, darkened |
| `--accent-tint` | `accent @ 12%` | Selected nav, secondary pills |
| `--danger` | `#A33E00` | Destructive text and the isolation alarm |
| `--warn` | `#8A5A00` | Untracked-gap hatching, missing-day flags |

### Dark

| Token | Value |
|---|---|
| `--canvas` | `#0F110E` |
| `--surface` | `#191C17` |
| `--material` | `rgba(30,34,28,.72)` + same blur |
| `--separator` | `rgba(239,242,234,.11)` |
| `--label` | `#EFF2EA` |
| `--label-secondary` | `#A2A89A` (7.4:1) |
| `--decor` | `#767C6E` (non-text only) |
| `--accent` | `#A9CB4B` — note the accent **inverts its role**: in dark it is the lightest thing on screen, and text on an accent button goes dark (`#12150F`) |
| `--accent-tint` | `accent @ 16%` |
| `--danger` | `#F0925F` |
| `--warn` | `#F0B34A` |

### Project palette

Project colour is **data**, not chrome. It appears on that project's dots, bars and blocks and nowhere else. Colours used in the mocks, all from the existing `--ev-*` block:

| Project | Light | Dark |
|---|---|---|
| Timeflow | `#00739F` | `#5FB2D6` |
| Member Services | `#A33E00` | `#F0925F` |
| Advisor Tools | `#225433` | `#79C99A` |
| Platform Ops | `#4B5457` | `#9AA6A8` |
| Claims Portal | `#7A5500` | `#F7C95C` |

Keep `DEFAULT_PROJECT_COLOR = "#788774"` from `src/utils/colors.ts` for colourless projects. **No two active projects may share a hue** — the picker should exclude colours already in use.

### Typography

One family: **Instrument Sans** (Google Fonts, weights 400–700), self-hosted into `src/assets/fonts/` alongside the existing fonts. `font-variant-numeric: tabular-nums` on **every** duration, time and count in the app — this is the single most important typographic rule here.

| Step | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|
| Timer | 96 / 92 | 400 | −0.038em | The running clock. Once per screen. |
| Display | 56 / 58 | 600 | −0.03em | Reports and Team headline totals |
| Large title | 34 / 40 | 600 | −0.025em | Screen name |
| Title 1 | 28 / 34 | 600 | −0.02em | The one number a section reports |
| Title 2 | 22 / 28 | 600 | −0.015em | Section heading inside a screen |
| Headline | 17 / 22 | 600 | — | Row title |
| Body | 17 / 24 | 400 | — | Prose, empty states |
| Subhead | 15 / 20 | 400 | — | Row second line, always secondary |
| Footnote | 13 / 18 | 400 | — | Timestamps, metadata |
| Group label | 12 / 16 | 600 | +0.07em, uppercase | Day headers. The only uppercase in the app. |

### Spacing, radii, targets

8pt grid; **4** is the only half-step. `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`.
Radii: **6** control · **8** calendar block · **10–14** list card · **16–18** sheet · **999** pill.
Minimum hit target **44 × 44** including on desktop. Separators inset to the text origin (`margin-left` = dot width + gap, e.g. 23px for a 9px dot at 14px gap).

### Depth

No `box-shadow` on content. A container earns a surface only by floating, scrolling independently, or being dismissible. Elevation comes from a **material** — 72% background plus `backdrop-filter: blur(24px) saturate(1.6)` — with a single 1px hairline, no shadow. Never a card inside a card inside a panel.

---

## The time-entry component

One record, four renderings. They must never disagree.

**A — List row** (Timesheet, recents, search). Grid `auto minmax(0,1fr) auto`, gap 14px, padding 10–14px vertical.
Left: 9px project dot. Middle: description as Headline, `project · task` as Subhead. Right, right-aligned: duration as Headline, `HH:MM – HH:MM` as Footnote. Description is the title because that is what the user typed and scans for.

**B — Day bar** (timer screen, stop sheet, entry sheet, Team). A 16–18px flex track, radius half the height, 2px gaps, background `--separator @ 60%`. Each entry is a `flex: <minutes>` segment in its project colour; untracked gaps are `--decor`-tinted segments in the same bar; the running segment is `linear-gradient(90deg, <project> 0%, <project> 62%, <project @ 42%> 100%)` so "still growing" reads without animation. Axis labels below at Footnote size.

**C — Calendar block.** Radius 8, background project colour at 11%, `border-left: 2.5px solid <project>`, padding 7–8px / 9–10px, title at 13/17 600 in a darkened project colour, meta at 12px. Outlook meetings are hatched `repeating-linear-gradient(135deg, …)` with a dashed left edge. Title must be `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` — blocks are pixel-height-derived from duration and a wrapped title overflows.

**D — Running.** The only place a duration is shown to the second and the only place display type is used.

---

## Screens

### 1. Timer (replaces Overview; the app's landing page)

*Artboards 01–03.*

Layout: sidebar 232px, main padding `40px 48px 48px`.
Header row: Large title "Today", right-aligned date at Subhead.
**Hero** (margin-top 40): a `Running` eyebrow — 7px accent dot with a 2.4s `scale/opacity` pulse plus 12px 600 +0.08em uppercase accent text — then the 96px clock, then description at Title 2, then `<dot> Project · started HH:MM` at 17px secondary. Right-aligned on the same baseline: the `⌘ .` hint at Footnote, then the **Stop** pill (52px tall, 40px horizontal padding, accent, white label, 18/600).
Then a full-width separator, then a two-column grid `minmax(0,1fr) 300px`, gap 56.
Left column: day-bar header (`5h 41m tracked` at Title 2 / `3 gaps · 1h 48m untracked` at 14px secondary), the day bar, then "Entries" at Title 2 and a list card of completed rows.
Right rail: `THIS WEEK` group label, a 118px ring (r=58, stroke 14, `stroke-linecap: round`, rotated −90°, `stroke-dasharray` = progress) beside the total at Title 1 and `of 40h · 71%` at Subhead; one sentence of pace prose; then seven weekday bars, today at 40% opacity.

**Idle variant:** eyebrow reads `Not running` in secondary; the clock reads `0:00:00` in `--dim-display`; below it an inline project chip (44px, white, 1px inset ring, dot + name + chevron) and a `What are you working on?` placeholder; the pill reads **Start**. Day bar becomes a single hatched track. Below: the teaching empty state, then `YESTERDAY YOU WORKED ON` with one resume row carrying its own 34px accent-tint **Start** pill.

### 2. Timesheet

*Artboard 05.* Large title + `12h 31m this week`. Toolbar: a segmented control (`This week / Last week / Month / Custom` — 30px tall, 2px padding on a `rgba(20,22,16,.06)` track, selected item white with a 1px 2px shadow) and a search field.
Groups per day: a sticky header row with the day at Group-label size and the day total at 14/600, then a list card. **Untracked gaps render as rows inside the group** — a 9px hatched amber square, `1h 36m untracked · 11:24 – 13:00` at Subhead, and a 30px accent-tint **Fill it** pill. The running entry is the first row of today's group with a `RUNNING` chip (20px, accent tint, 11/700 +0.06em) and its duration in accent.
Floating bar: "Export the visible range as CSV" · **Log time**.

### 3. Calendar

*Artboard 06.* Title is the week range. Right: week total and `‹ Today ›`.
Day header grid `52px repeat(7, minmax(0,1fr))`: weekday at Group-label size, day total at 15/600; today's column header carries a 2px accent bottom border and an accent label. Other columns get a 1px separator.
Grid body: 480px tall, one hour = 48px, `repeating-linear-gradient(to bottom, rgba(20,22,16,.055) 0 1px, transparent 1px 48px)` for hour lines, 4px horizontal padding per column. Blocks are absolutely positioned: `top = (startMinutes − 480) × 0.8`, `height = durationMinutes × 0.8`. Weekend columns at 55% opacity.
Floating bar teaches the gesture — "Drag anywhere on the grid to log time. Drag an edge to change it." — plus an Outlook swatch legend. No button: direct manipulation is the primary action.

### 4. Reports

*Artboard 07.* **Defaults to Last week**, not This week — a report on an unfinished week is a chart of a half-day.
Range label at Group-label size, then the total at Display size beside the delta (`+3h 10m on the week before`) at 17px secondary.
Daily bars: a `position: relative; height: 180px` wrapper containing the 7-column bar grid **and** the average annotation. The dashed average line and its label are absolutely positioned inside *that* box so `bottom:` resolves against the same 180px the bar percentages scale against — do not position them against a wrapper that also includes the label row.
Bar heights are `value / max`. The label row sits outside the box.
Below a separator, a `minmax(0,1.25fr) minmax(0,1fr)` grid: "Where it went" (ranked 10px proportion bars per project, `hours · %` right-aligned) and "Top tasks" (a simple list card).
Floating bar: rounding mode · **Export CSV**.

### 5. Projects

*Artboard 08.* Title + `12 active · 84 tasks`. Toolbar: `Active 12 / Archived 2` segmented, search, `Sort · Hours ▾`.
List card rows: grid `auto minmax(0,1fr) 132px auto`, gap 16, padding 16px. 11px project dot; name at Headline with a `▾` when expanded, `N tasks · Account N` at Subhead; an 8px proportion bar; hours at Headline right-aligned with `min-width: 76px`.
The expanded project's tasks render **inline beneath its own row**, indented `margin-left: 27px`, at 15px with lighter separators, ending in an accent **New task** row and a `N more tasks` count. One project expanded at a time.
Paginate at five rows with a centred accent **Show 7 more**.

### 6. Team (managers only)

*Artboard 09.* Title, week range, `‹ This week ›`. Team total at Display size + `logged by 18 people so far this week`.
Toolbar: `Direct 18 / Whole line 34` segmented — this is `eq-userid`-style direct reports vs. the `eq-useroruserhierarchy` subtree, surfaced as a filter rather than a second page — plus search and sort.
Grid `180px repeat(5, minmax(0,1fr)) 92px`, gap 12. Header row of weekday labels (today in accent) and `Week`. Rows are 40px: name at 16/600, five weekday bars in a 22px box (`align-items: end`), week total at 16/600 right-aligned. Bars use the **accent**, not a project colour — they encode hours per person. Today's bar at 45% opacity; empty weekdays at 9% height in `--decor`.
A missing weekday is an amber hatched bar at ~40% height plus a `1 missing` chip beside the name. Sort by hours descending so the person needing attention lands at the bottom.
Paginate at nine rows with **Show 9 more**. Below: "Hierarchy security decides who appears here — the page never widens the read. Totals only; no descriptions, no tickets."

---

## Sheets, alerts and transient states

*Artboards 04, 10–17.*

**Stop sheet (04)** — 580px, radius 18, material, centred over a dimmed (52% black) blurred backdrop. Duration at Large title + `HH:MM – HH:MM · date`; a day bar with the new entry in accent and any adjacent gap hatched amber; a line — "This lands here. 36m earlier today is still untracked." — with a 32px accent-tint **Fill it** pill; then a settings-style field list on a 5% tint at radius 12, rows `Description / Project / Task / Billed to`, labels 96px wide at Subhead, values right-aligned at 17px, separators inset 96px. The Task row carries an inline accent **New task…**. Under the list, 13px secondary: "Inherited from Timeflow. Changing it here affects this entry only." Footer: **Discard** (secondary text) left, **Save** pill right.

**Entry sheet (10)** — the stop sheet plus a `Time` row with two 34px editable time fields, and **Delete** in `--danger` at the footer left. **No confirmation dialog** — delete immediately and show the undo toast. Confirming twice for something reversible is a pattern to stop using.

**Idle prompt (11)** — "You stopped moving at 15:42" at Title 1; "The timer kept running for 47 minutes after that. Only you know whether that was work." A day bar showing the tracked span in accent and the idle span hatched amber, with `started / last activity / now` beneath. Then three 52px rows, 12px apart: **Trim to 15:42** (accent fill, right-aligned `keeps 37m`), **Keep all of it** (5.5% tint, right-aligned total), **Discard the entry** (`--danger` text, no fill). The bar shows what each choice does before it is made.

**12h auto-stop (12)** — "Stopped after 12 hours"; explains it saved at 12h 00m against the named project and how to correct it. Actions: **Fix the end time** (accent pill) and **It was right** (secondary text). No apology, no jargon.

**Offline (13)** — a 44px strip at radius 10 on `--warn @ 10%`, an 8px warn dot, and 15px text in `#5C3D00`. Rendered unconditionally with only its text conditional, so the live region already exists in the a11y tree when it fills (the current code does this correctly — keep it).

**Failed save (13)** — takes over the hero rather than becoming a toast: eyebrow turns `Not saved` in `--danger`, the clock stays, a 17px line explains that retrying keeps the original end time, and the primary pill becomes **Retry save**.

**Isolation warning (14)** — the only full-width alarm in the app, and **persistent, not a toast**: `--danger @ 8%` fill, 22% inset ring, Title 2 heading, body prose, a solid `--danger` **Copy details for IT** pill and a **What this means** text button. It must not disappear on its own.

**Loading (15)** — skeletons shaped like the screen being loaded (title bar, clock block, day bar, rows), shimmering via `opacity .55 → 1 → .55` over 1.6s with 100ms stagger. **No spinners anywhere.**

**Toasts (16)** — bottom-centre above the floating bar, 52px, radius 14, `rgba(30,34,28,.90)` + blur in **both** themes, 16px light text. Three shapes: success (accent dot + "Saved 1h 24m to Timeflow"), undo ("Entry deleted" + accent **Undo**), error (warn dot + message + **Retry**). One at a time, dismissed on the next action. Anything the user must act on is not a toast.

**Empty states (17)** — never "No data." Each names what is missing, why the screen is blank, and the single next move; the primary action lives *inside* the empty state. Show the skeleton of the real component instead of an illustration — no illustrations anywhere.

---

## Interactions

- **`Ctrl/Cmd + .`** toggles the timer, as today. With a pending failed stop it retries with the *original* stop timestamp, never `now`. With no project selected it focuses the project field and flashes the inline hint — Start is never disabled.
- **Stop** opens the stop sheet. Saving from it is what writes the entry.
- **Drag on the day bar** (timer screen) or **on the calendar grid** opens the entry sheet prefilled with that span. Dragging a calendar block's edge resizes; dragging its body reschedules. Keyboard equivalent: `Shift + arrows`, as today.
- **Tapping a grey segment** in any day bar, or a **Fill it** pill, opens the entry sheet prefilled with the gap.
- **Continue / Start** on a resume row restarts the timer with the same project, task, description and billing fields.
- Sheets: 200ms ease-out scale-and-fade in, dismiss on `Esc` and on backdrop click. Focus trapped (`useFocusTrap` already exists).
- The running dot pulses on a 2.4s cycle; respect `prefers-reduced-motion` by holding it static.
- Nav selection, segmented controls and pills get an accent-tint hover at ~60% of the selected tint. No transitions longer than 200ms anywhere.

## State

No new global state. Everything maps onto existing hooks:

| Need | Existing owner |
|---|---|
| Running timer, drafts, multi-tab sync | `useTimer` |
| Idle detection, 12h auto-stop | `useTimerSafety`, `useIdleGuard` |
| Entries for the loaded range, isolation check | `useTimeEntries`, `DataContext` |
| Projects, tasks | `useProjects`, `useTasks` |
| Weekly target | `useWeeklyTarget` |
| Theme | `useTheme` |
| Toasts and undo | `ToastContext`, `useUndoableMutations` |
| Gaps | `utils/gaps.ts` (add configurable working hours) |

New local state: `stopSheetEntry` (the just-stopped entry awaiting confirmation), `editingEntry`, `expandedProjectId`, `teamScope: "direct" | "hierarchy"`, and a page-size counter per paginated list.

Note that the timer screen absorbs Overview's data needs, so its `useRangeRequest` should ask for the current week rather than Overview's twelve.

## Screen map — old files to new

| Design | Replaces | Action |
|---|---|---|
| Timer (01–03) | `TimerBar.tsx`, `OverviewPage.tsx`, `TodayStrip.tsx`, `TargetRing.tsx` | New `TimerPage.tsx`; `TargetRing` survives restyled; `TodayStrip` becomes the shared `DayBar` component |
| Stop sheet (04) / Entry sheet (10) | `EntryModal.tsx` | Rewrite as one sheet with two modes |
| Timesheet (05) | `TimesheetPage.tsx`, `EntryRow.tsx`, `DateRangeFilter.tsx` | Restyle; `DateRangeFilter` becomes the segmented control |
| Calendar (06) | `CalendarPage.tsx` | Restyle only — `useCalendarDrag` and `calendarGeometry.ts` are unchanged |
| Reports (07) | `ReportsPage.tsx`, `SvgBarChart.tsx` | Restyle; drop the KPI strip |
| Projects (08) | `ProjectsPage.tsx`, `Sparkline.tsx` | Rewrite as one list + accordion; delete `Sparkline` |
| Team (09) | `TeamPage.tsx` | Restyle; add the direct/hierarchy scope toggle |
| Idle (11) | `IdleModal.tsx` | Rewrite |
| Auto-stop (12) | toast in `useTimerSafety` | Promote to a sheet |
| Offline / retry (13) | `offline-banner` in `App.tsx`, retry in `TimerBar.tsx` | Restyle; move retry into the hero |
| Isolation (14) | toast in `useTimeEntries` | Promote to a persistent banner |
| Loading (15) | `PageSkeleton`, `ReportsSkeleton` in `PageRouter.tsx` | Reshape per screen |
| Toasts (16) | `ToastContext.tsx` | Restyle only |

**New shared components:** `DayBar`, `SegmentedControl`, `Sheet`, `ListCard` + `ListRow`, `FloatingActionBar`, `Pill`.

## Suggested order

1. Tokens and type in `src/styles.css`; load Instrument Sans. Run `npm run test` — `styles.contrast.test.ts` is the gate.
2. Shared components above.
3. Timer screen, and delete Overview + Focus mode + the heatmap in the same change.
4. Stop sheet and entry sheet.
5. Timesheet, Calendar, Reports, Projects, Team.
6. States: idle, auto-stop, offline, isolation, loading, toasts, empty states.

Keep the four checks green throughout (`lint`, `typecheck`, `test`, `build`). The existing test suites for `TimerBar`, `EntryModal`, `OverviewPage` and `ProjectsPage` will need rewriting alongside their components; `useCalendarDrag`, `gaps`, `reportAggregations` and `rounding` tests should all still pass untouched — if they don't, the redesign has changed behaviour it wasn't supposed to.

## Assets

- `everence-mark.png` — the Everence emblem, cropped from `src/everence-logo.png` already in the repo. Sits at 22 × 22 in the sidebar beside a "Timeflow" wordmark set in Instrument Sans 15/600. The full logo's charcoal wordmark does not survive dark mode, which is why only the mark is used.
- **No icon set.** Sidebar navigation is text-only, deliberately: nothing to draw, nothing to maintain, and it reads calmer. `Icons.tsx` can be reduced to the few glyphs still used (play, stop, chevron) or dropped entirely.


---

## Deviations, and why

Recorded here rather than by editing the brief above, so the two can be
compared.

**The calendar grid stays at 72px per hour, not 48.** The brief specifies
`one hour = 48px` and `top = (startMinutes − 480) × 0.8`, and also says
`useCalendarDrag` and `calendarGeometry.ts` are unchanged. Those two cannot
both hold: the geometry module's `SLOT_HEIGHT` is what produces 72px/hour, and
every drag, resize, snap and keyboard nudge is derived from it. The
instruction not to touch the geometry is the stronger one — it protects
behaviour, where the pixel figure protects an appearance the brief itself
calls "a reference size, not a constraint". The grid scrolls either way.

**Stop writes the entry; the stop sheet confirms it.** The brief says "Saving
from it is what writes the entry". It doesn't, and shouldn't: the timer has
already created a draft row in Dataverse, and a sheet that held the hours in
memory until somebody pressed Save would lose a day's tracked time to a closed
tab — the one failure this app must not have. So Stop saves exactly as it did
before, and the sheet sits over the saved entry: **Save** commits the
corrections made in it, **Discard** deletes it and offers undo. Both labels
stay accurate, the retry and multi-tab paths are untouched, and nothing can
strand an open draft.

**A dirty sheet ignores backdrop clicks.** The brief says sheets dismiss on Esc
and on backdrop click. Esc and the footer's own Cancel do. A backdrop click on
a form with typed work in it does nothing at all, because it is the one
dismissal nobody ever aims — it is what a mis-aimed click at the sheet's edge
lands on (#104). The delete confirmation the brief removes is genuinely gone;
this is not that.

**Reports keeps the empty-range recovery.** Not in the brief either way. An
empty report that can say "you logged 10h in the month" and switch to it is a
recovery rather than a dead end, which is the brief's own empty-state rule.

**`buildMatrix` / `buildMatrixDisplay` in `reportAggregations.ts` were left
unused, and have since been deleted.** The project × period matrix is not on
the redesigned Reports screen. The helpers and their tests stayed in place for
the redesign itself because the brief asks explicitly that
`reportAggregations`' tests keep passing untouched; the cleanup followed as
[#150](https://github.com/TheShield2594/timeflow/issues/150), which also took
`resolveEffectiveRange` — the redesigned page recovers from an empty range
through `findNarrowestRangeWithData` instead.

**`--dim-display` is exempt from the 4.5:1 rule the brief states above.** The
token table gives it as 3.2:1 while the sentence introducing the tables says
`styles.contrast.test.ts` asserts 4.5:1 for *every* text token — the brief
contradicts itself, and taken literally the gate it describes would fail on the
palette it ships with. The tables won, because the exemption is real: WCAG's
large-text threshold is 3:1, and the idle clock is 96px. So the test asserts
4.5:1 for `--label`, `--label-secondary`, `--accent`, `--danger` and `--warn`,
and 3:1 for `--dim-display` alone — held to that one use by a separate
assertion that the token is referenced exactly once, which is what stops the
exemption spreading to text nobody exempted.

**Dates are month-first and the clock is 12-hour, not what the mocks show.**
The brief writes every time as `HH:MM` and every date day-first, and the
redesign shipped `en-GB` and a 24-hour `clockAt` to match. Both went in as a
detail of a large change rather than as a decision of their own, and for a
US-based company `8 September` and `17:30` are not what people read
([#152](https://github.com/TheShield2594/timeflow/issues/152)). `DATE_LOCALE`
is `en-US` and `clockAt` reads `5:30 PM`; the two places the 24-hour form was
narrower — the calendar's 52px hour gutter and the day bar's five axis ticks —
use `clockAtCompact` ("9 AM"), which is narrower still. The 24-hour form
survives as `timeInputAt`, because that is the value format
`<input type="time">` takes whatever it renders.

**The entry sheet has a `Date` row the brief doesn't give it.** The brief
specifies the entry sheet as "the stop sheet plus a `Time` row"; that left
dragging a block on the calendar as the only way to move an entry to another
day, and no way at all from the Timesheet
([#151](https://github.com/TheShield2594/timeflow/issues/151)). Mis-dated time
is a billing error, so the row went in and the day bar and gap nudge recompute
from the edited date rather than the date the sheet opened on. Outside the
loaded range the sheet has no day to draw and says so instead of drawing an
empty one. The stop sheet keeps neither row, for the reason it already keeps
no `Time` row: the clock decided both.

**Sheets take a 96% material, not the 72% the token table gives.** The brief
gives one `--material` for "floating action bars, sheets", and 72% is right for
the action bar: it carries a hint over an empty grid and the translucency is
most of what says it floats. A sheet is different — it is read *through*, and
over the calendar the entry sheet's own values competed with the blocks behind
them. Blur doesn't settle that either, because `backdrop-filter` is the first
thing a locked-down host drops, and where it does the sheet is 72% of nothing.
So `--material-sheet` is the modal's fill at 96%, the blur stays as the bonus
it now is, and the action bar keeps `--material` unchanged.

**The `Billed to` row's number field is labelled `Ratio`.** The brief names the
row but not the placeholder, which read `Account`. Everywhere else the company
meets this value it is the ratio — the Dataverse column, the CSV header, the
Projects list — and a field that answers to two names in one app is a field
people fill in wrong. It is still an account identifier and still never a
multiplier (#71); only the word on screen changed.
