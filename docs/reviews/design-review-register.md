# Design-review register (July 2026) — reconstruction

Several commits and a handful of source comments cite IDs from a design-review
register — `P1-07`, `P2-15` — that was never committed. It existed only inside
the chat sessions linked at the bottom of PRs [#85](https://github.com/TheShield2594/timeflow/pull/85)
and [#86](https://github.com/TheShield2594/timeflow/pull/86), so nobody reading
the repo could answer *"what was P1-03?"* or *"were P1-01 to P1-06 ever done?"*.

This file is what could be recovered from the repo itself. It is a decoder ring,
not the original document.

**Tracked in [#109](https://github.com/TheShield2594/timeflow/issues/109).**

> **Not the same numbering as the August review.** The
> [2026-08-12 application review](2026-08-12-multi-agent-review.md) also uses
> P0/P1/P2, but those are its own severity buckets (P0-1, P0-2 …) and its
> findings are all filed as GitHub issues. The IDs below are from a *different*,
> earlier, UI-focused register. Don't cross-reference them.

## Status of the recovery

| Range | Status |
|---|---|
| P1-07 … P1-10 | **Recovered in full** — commit `a485a5a` restates each finding in its message |
| P2-15 | **Recovered in full** — commit `ceaf97e` restates the finding and its rules |
| P1-01 … P1-06 | **Inferred** from the commits that preceded them — see the caveat below |
| P2-01 … P2-14, P2-16+ | **Lost.** Nothing in the repo names them |
| Any P0 tier | **Unknown.** No commit, PR or comment references one |

Whether the register even ran to P2-16 is itself unknown; P2-15 is simply the
highest ID anything in the repo mentions.

---

## Recovered verbatim

### P1-07 — everything was green, so nothing read as important
KPI labels, values, day totals, card titles, week totals and badges all sat in
the olive family. **Fixed** in `a485a5a`: green now marks five things only
(active nav, primary button, running timer, chart bars, heatmap); micro-labels
moved to `--text-muted`; every number moved onto one three-step mono ramp
(30px KPI / 20px card / 14.5px row, tabular figures throughout).

### P1-08 — project, task, ticket and ratio were four identical pills
"PTO · Vacation" read as two unrelated tags rather than project ▸ task.
**Fixed** in `a485a5a`: one composite chip (coloured project dot +
project ▸ task), a mono hairline box for the Jira ticket, and a quiet `r2`
suffix for the ratio with the full label in its tooltip.

### P1-09 — Overview answered "what happened", never "what now"
It repeated Reports' 7-day chart and nothing on it was actionable. **Fixed** in
`a485a5a`: the page now leads with a today strip (logged blocks on a clock, with
every untracked gap of 15 minutes or more offered as a one-click log) and the
weekly target as a ring beside it; Recent became three quick-start buttons over
the existing list; the duplicated 7-day chart is gone and the heatmap stays.

### P1-10 — project cards stretched, actions competed, deletes were permanent
Cards stretched to a uniform height the content never filled, Edit and Archive
competed as two differently-styled corner buttons, every task chip carried a
permanent delete, and card totals came from the loaded date window while reading
as all-time. **Fixed** in `a485a5a`: header / tasks / footer, sized to content,
sorted by most recent activity; both actions behind one ⋯ menu; delete on chip
hover or focus; totals fixed to 30 days and labelled, with a 7-day sparkline and
"last tracked" in the footer.

### P2-15 — untracked-gap detection, on both Calendar and Overview
The Overview strip had shipped with gap detection of its own; P2-15 covered both
surfaces and defined the rules more precisely. **Fixed** in `ceaf97e`, which
pulled the logic into `src/utils/gaps.ts` so a gap can never appear in one place
and not the other. The rules, as stated once there:

- inside working hours (08:00–18:00) — outside them, untracked time is just
  "not at work" and prompting for it is noise;
- longer than 15 minutes, so the slack between back-to-back blocks doesn't
  register;
- capped at the current minute on today, and skipped entirely on future days —
  the rest of the day isn't missing, it hasn't happened;
- includes the untracked time before the first entry and after the last, not
  only the holes in between;
- but nothing at all on a day with no entries, so weekends and holidays don't
  each report a ten-hour gap;
- overlapping entries merge rather than producing a negative-width gap, and a
  running entry counts as covering the time up to now.

**Where the ID still appears in source:** `src/utils/gaps.ts:2`,
`src/components/CalendarPage.tsx:504` and `:1178`,
`src/components/CalendarPage.test.tsx:617`, `src/styles.css:2551`. Those five
comments are the reason this file exists; read them as pointing here.

---

## Inferred — treat as a hypothesis, not a record

`a485a5a` ("Address design review findings P1-07 through P1-10") was the *first*
commit to cite IDs, and it landed in PR #86. The PR immediately before it, #85,
contains exactly six substantive commits, in an order that lines up with a
register worked through from the top:

| Likely ID | Commit | Change |
|---|---|---|
| P1-01 *(inferred)* | `4058803` | Bar charts got a real axis, baseline and empty state |
| P1-02 *(inferred)* | `c66b8c1` | Reports: one empty state with a way out, not five statements of nothing |
| P1-03 *(inferred)* | `5355baf` | Timer: Start stays live; elapsed time moved into the button |
| P1-04 *(inferred)* | `bb0c7f5` | Timer bar leads with the required field, optional ones fold away |
| P1-05 *(inferred)* | `113e09b` | Timesheet rows: one grid, scannable durations, actions on hover |
| P1-06 *(inferred)* | `16bd2c6` | Calendar: the Outlook overlay quietened so tracked time reads first |

The count matches and the sequence is contiguous, which is suggestive — but no
commit message, PR body or comment states this mapping, so it is a
reconstruction. **Do not cite these IDs as fact.** If the original session is
ever reopened, replace this table with the real one or delete it.

---

## Why this can't happen again

The register is lost because the only pointer to it was a chat-session URL in a
PR body. Two rules follow, both now in [CONTRIBUTING](../../CONTRIBUTING.md):

1. **Commit messages reference GitHub issue numbers, not IDs from an external
   document.** `#96` resolves for anyone, forever; `P1-07` resolves for one
   person, for about a week.
2. **If a review produces a list worth working from, the list gets committed**
   — as issues, or as a file in `docs/reviews/`, the way the August review was.
   A finding that exists only in a session link is a finding that will be lost.
