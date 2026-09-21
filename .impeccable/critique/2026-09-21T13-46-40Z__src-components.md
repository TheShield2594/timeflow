---
target: whole app (src/components)
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\brandots2\\Downloads\\time-tracker-everence\\time-tracker-v3\\src\\components"
timestamp: 2026-09-21T13-46-40Z
slug: src-components
---
Method: dual-agent (A: design review · B: detector). Browser visualization skipped: no browser tool, Playwright not installed.

## Design Health Score: 27/40 (Acceptable, the top of the band)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Projects "Hours in the loaded range" depends on which pages you visited |
| 2 | Match System / Real World | 3 | "loaded range", "in custom", "Outlook faded" |
| 3 | User Control and Freedom | 3 | Esc in task field closes the whole sheet; one toast at a time replaces a pending Undo |
| 4 | Consistency and Standards | 2 | Two CSV exports round differently; range sets differ; rounding picker differs |
| 5 | Error Prevention | 2 | Ratio/Jira "inherited" but never are; empty days hidden; dismissing idle/auto-stop commits the worse outcome |
| 6 | Recognition Rather Than Recall | 3 | Timer screen entries aren't editable |
| 7 | Flexibility and Efficiency | 3 | No duplicate from Timesheet, no keyboard Undo |
| 8 | Aesthetic and Minimalist Design | 3 | Calendar header up to 6 controls |
| 9 | Error Recovery | 3 | Toast says "Press Stop to retry", button says "Retry save" |
| 10 | Help and Documentation | 2 | Help only in title=; shortcut hint aria-hidden |

## Priority issues
- [P0] Ratio/Jira "Inherited from {project}" note is false; nothing copies project.ratio/jiraTicket into entries (EntrySheet.tsx:532-536, App.tsx:165, csvExport.ts:114-115). harden + clarify.
- [P1] Timesheet omits days with zero entries, so fully missed days are invisible (TimesheetPage.tsx:112-120). harden.
- [P1] Timesheet export is unrounded; Reports export applies rounding (TimesheetPage.tsx:170 vs ReportsPage.tsx:284). clarify.
- [P1] Dismissal commits the less accurate outcome: idle Esc/backdrop = Keep (IdleSheet.tsx:67), auto-stop = Accept (AutoStopSheet.tsx:21), stop-sheet Esc drops edits but toasts "Saved" (App.tsx:306), Esc in new-task field closes sheet. harden.
- [P2] A11y: toast Undo ~2.3:1 on the dark toast (styles.css:854-870); segmented role=tablist with no arrow keys; Team per-day values title-only; swatches read as hex; focus lost after delete; several targets <44px. audit + harden.

## Detector
1 finding: side-tab at CalendarPage.tsx:139, a false positive (a project-coloured calendar block is sanctioned). But the inline borderLeft there overrides the CSS rule at styles.css:980 that lightens dark project colours in dark mode, which is a real regression.

## Persona red flags
- Alex: can't edit entries from Timer; resume row vanishes after first log; no keyboard Undo.
- Sam: segmented tabs; title-only info; Undo unreachable and low-contrast; targets under 44px.
- Friday Jira biller: blank weekday missing; retypes ratio and ticket every time; search hides gaps; exports disagree.

## Minor
"12h in custom"; Projects "N more tasks" is dead text; no "Other" row in Reports shares; Team "Missing" includes today; Team footnote claims no descriptions/tickets but the CSV writes them; mobile calendar branch leftovers; "Entry deleted." doesn't name the entry; possible DayBar pointer-capture swallowing gap clicks (needs a browser).
