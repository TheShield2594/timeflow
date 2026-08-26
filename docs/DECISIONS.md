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
already filtered to the selected project (`TimerBar`, `EntryModal`), and
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

### Working hours are hardcoded 08:00–18:00, gaps floor at 15 minutes

`src/utils/gaps.ts` confines untracked-gap detection to a fixed working day
with a 15-minute minimum. Deliberate for a single-company internal app, and
deliberately not configurable — a settings surface for it would need a
per-user store this app doesn't have. The consequence is that anyone on a
non-standard shift gets under-reported gaps, silently. Revisit if shift work
ever becomes real.
