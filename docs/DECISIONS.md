# Decisions

Choices that shape the app and aren't obvious from the code, plus the ones
still open. A decision that lives only in someone's head is the same as no
decision — this file is where they go instead.

**Open decisions get an owner and a target date.** If neither is written down,
it isn't tracked.

---

## Open

| # | Decision | Owner | Target | Tracked in |
|---|---|---|---|---|
| D-2 | Licence: the repo carries MIT while being a private, Everence-branded internal app | @TheShield2594 | — | *below* |

D-1 (personal tasks) was settled on 2026-08-26 — see *Tasks are shared per
project, deliberately* under Settled.

### D-2 — Licence

`LICENSE` is MIT and `README.md` advertises it. That was almost certainly
inherited from a template rather than chosen: this is a private, internal,
Everence-branded time-tracking app, and MIT grants anyone who obtains a copy the
right to use, modify and redistribute it, including commercially.

Nothing is broken today — the repo is private, so nobody has obtained a copy —
but the file says something the project doesn't mean, and it is the kind of
thing that is only ever noticed at the wrong moment.

Three defensible outcomes; this needs a human to pick one, so **the file has
deliberately been left as-is**:

1. **Keep MIT.** Fine if the code may ever be shared or open-sourced. Requires
   no work — just make it a decision rather than an accident.
2. **Replace with a proprietary/all-rights-reserved notice.** Matches what the
   app actually is. Correct answer if the employer owns the code.
3. **Remove `LICENSE` entirely** and state ownership in the README. Least
   ambiguous for a private repo, at the cost of the file some tooling expects.

Whoever owns the code (the employer, most likely — check the employment terms
before deciding) should make this call. Record it here with a date, and update
the README's Licence line to match.

---

## Settled

Recorded because the reasoning is not visible from the code and has been
re-litigated at least once.

### Tasks are shared per project, deliberately (2026-08-26)

D-1, [#129](https://github.com/TheShield2594/timeflow/issues/129). `ever_workitems`
is Organization-owned and stays that way: every user sees every task under a
project, and that is the intended behaviour, not a leftover of how the table was
created.

The framing in #129 was "do task names need to be private, or only tidy" — but
the honest third answer is that they should be *shared*. Task pickers are
already filtered to the selected project (`EntrySheet`, `ProjectsPage`), and
projects themselves are org-wide, so nobody is scrolling a global list of
strangers' work. What a per-project task list actually is, is a shared
vocabulary: one "Code review" that everyone bills against, so reports aggregate
instead of fragmenting into six near-duplicate rows. Making tasks per-user would
create that fragmentation on purpose, and it is the kind of damage that only
shows up months later in a report nobody can reconcile.

Neither option in #129 was therefore taken. Option A (rebuild the table
User-owned) buys real row security at the cost of a lookup repoint on
`ever_timeentries` — the table holding the billable record — to protect data
that isn't sensitive. Option B (owner column plus a personal/shared flag) buys
tidiness the project scoping already provides, while reading as security to
anyone who doesn't know it isn't.

**The caveat this accepts:** task *names* are readable org-wide, including
directly via the Web API. Nothing confidential belongs in one. The place for
detail that shouldn't be shared is an entry's description, which lives on
`ever_timeentries` and is genuinely per-user (see below). Revisit if the app
ever spans clients who shouldn't see each other's project structure.

### Reads filter on `ownerid` via `eq-userid`, not on `ever_userid`

`ever_userid` is stamped on write for display and audit, but reads filter with
FetchXML's `eq-userid`, which Dataverse resolves server-side to the calling
user. The SDK returned inconsistent user ids across sessions, so a filter that
compared a stored id from the client could not be trusted. This depends on
`ever_timeentries` having **User** ownership — see the README's row-security
section.

### Deletes deactivate, except for time entries

Deleting a task or archiving a project sets `statecode` to Inactive rather than
removing the row: a hard delete would null the lookup on historical time entries
and silently strip names from past reports and exports. Time entries are the
only records hard-deleted, which is also why they are the only ones a restore
can ever be needed for.

### User preferences live in `localStorage`, not Dataverse

Code Apps have no per-user settings store, and adding a Dataverse table for
weekly-target hours would put schema, security-role and backup weight behind a
number nobody would miss. The cost is real and accepted: preferences are
per-device and are not backed up.

### Mobile is not a target (2026-08-12)

Scoped out during the six-discipline review. The app ships a partial mobile
implementation that is currently broken; the findings are preserved in
[the review's Appendix A](reviews/2026-08-12-multi-agent-review.md#appendix-a--deferred-mobile-findings)
in case that changes.

### Working hours are per user, not hardcoded (2026-09-09, reversed)

This entry used to record the opposite: that `src/utils/gaps.ts` confined
untracked-gap detection to a fixed 08:00–18:00 day with a 15-minute minimum,
deliberately, because a settings surface would need a per-user store this app
doesn't have.

That reasoning was wrong about what kind of thing it was. It isn't a
preference — it is the window the app searches before telling somebody their
day is complete, so on any other shift the app was quietly wrong about the one
thing it exists to get right. The store objection was answered by the entry
above it: preferences already live in `localStorage`, scoped per environment +
user, and this is one more of them (`useWorkingHours.ts`), set from the
sidebar.

Its cost is the same as every other preference here: it travels with the
browser rather than the account, so a new machine starts at the 08:00–18:00
default. That is a far smaller failure than being told a day is complete when
two hours of it were never in the search.

**The guard that matters:** a stored window ending at or before it starts is
rejected on read. An inverted window makes `findUntrackedGaps` return nothing
at all — a silent, total regression to the bug this reverses.

### Dates are month-first, the clock is 12-hour (2026-09-09)

[#152](https://github.com/TheShield2594/timeflow/issues/152). The 2026-09
redesign switched every date to day-first (`Tuesday 8 September`) and every
time to 24-hour, following the mocks. Both are reverted: `DATE_LOCALE` is
`en-US` and `clockAt` reads `5:30 PM`.

The arguments for the 24-hour clock were real — AM/PM spends two characters
saying what the surrounding day already says, and `9:05 AM` and `12:05 PM`
scan at different widths in a column meant to be read down. They lost to the
larger fact that this is a US company and `17:30` is not what its people read.
A display convention nobody asked for is not worth a support ticket, and it
had arrived as one detail of a large redesign rather than as a decision.

Three things follow from it, and re-litigating this means re-checking them:

- **`clockAt` is a display format and `timeInputAt` is not.**
  `<input type="time">` takes 24-hour `HH:MM` whatever it renders to the
  reader. Swapping one for the other silently empties every time field in the
  app.
- **Axes use `clockAtCompact`** ("9 AM"), because the calendar's hour gutter is
  a fixed 52px column and the day bar's ticks are laid out against the narrow
  form. The compact form is narrower than the `09:00` it replaced; the full
  one is not.
- **The end of a day and its start now read alike.** The 24-hour form could
  say `24:00` for the end of a day's last slot and `00:00` for the start of
  the next; 12-hour has no such notation, so both read `12:00 AM` and the
  `–` or `to` beside them carries the direction.

Display only. Stored dates are untouched, and the CSV export goes through
`formatDecimalHours` rather than either of these.

### An entry can be re-dated from the sheet that edits it (2026-09-09)

[#151](https://github.com/TheShield2594/timeflow/issues/151). The redesign's
`EntrySheet` replaced a modal that had a date field with one that didn't, so
an entry logged against the wrong day could only be moved by dragging it on
the Calendar — and not at all from the Timesheet. Mis-dated time is a billing
error, and a fix that only exists somewhere the user has to already know about
is not a fix. The `Date` row is back.

The reason it was left out is a real one and is answered rather than ignored:
the sheet draws a day bar and an untracked-gap nudge for the entry's day, and
a date that changes mid-edit would leave both describing the previous one. So
they are recomputed from the draft's date — the sheet is handed a lookup
(`useEntriesOnDate`) rather than one day's entries.

That lookup returns `null`, not `[]`, for a date outside the range the app has
loaded, and the sheet draws no bar at all for one. The two are not the same
answer: a day nobody fetched and a day nobody worked both hold zero entries,
and a bar that can't tell them apart would greet a re-date to last year with a
confident eight hours of untracked time.

The stop sheet still has no date field, for the reason it has no time one: the
clock decided both.

### The 2026-09 redesign removed features on purpose (2026-09-09)

Overview, focus mode (Pomodoro), the activity heatmap, the day-streak KPI, both
KPI strips, the timer bar's ratio/ticket fields and its inline "+ New task…"
are gone. The reasoning for each is in the README's *Deliberately not here*
table and, at length, in
[the redesign brief](design/2026-09-redesign-handoff.md); the point of
recording it here is that removing them was the work, not a casualty of it.
Re-adding one is a decision.
