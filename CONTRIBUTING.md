# Contributing to TimeFlow

This app is the company's billable-time record. The bar for changes to it is
therefore "would I be comfortable if this were wrong for a month before anyone
noticed?" — most bugs here are silent and arithmetic.

New to the codebase? Read the [README](README.md) first for what the app is and
how it's deployed, and [CLAUDE.md](CLAUDE.md) for the conventions that aren't
obvious from the code.

---

## Setup

```bash
npm install
npm run dev          # runs against mock data in localStorage
```

Node is pinned by `.nvmrc` and enforced by `engines` in `package.json`
(`^20.19.0 || >=22.12.0` — Vite 7's floor). CI runs the version in `.nvmrc`.

**On Linux you need `libsecret-1-dev`** (`sudo apt install libsecret-1-dev`)
before `npm install`, or the native `keytar` build fails with a cryptic
`node-gyp` error. It arrives via `@microsoft/power-apps` →
`@azure/msal-node-extensions` → `keytar` and never reaches the app bundle.

Without the Power Apps host, the app runs on a localStorage mock with the same
semantics as Dataverse. There is no seed data — create a project from the
Projects page.

## Checks

All four must pass; CI runs them plus `npm run build` on every push to `main`
and every PR.

```bash
npm run lint          # ESLint flat config — warnings fail
npm run typecheck     # tsc --noEmit
npm test              # vitest, single run
npm run build         # tsc && vite build
```

`npx vitest` (no `run`) starts the watcher.

`npm run test:coverage` is what CI actually runs, and it enforces thresholds
(`vitest.config.ts`). Raise them when the floor rises; never lower them to
make a build pass.

`npm run build` asserts that the web font and the logo still inline as base64.
They sit a few hundred bytes under Vite's `assetsInlineLimit`, and an external
asset URL 404s under the Power Apps host — so growing either past the limit
would break production with no other warning (#116).

## Tests

- Tests live next to what they cover, as `*.test.ts(x)`.
- The suite runs in `TZ=America/New_York`, set in `vitest.config.ts`. CI
  machines are UTC, where every day is 24 hours and the whole DST class of bugs
  ([#87](https://github.com/TheShield2594/timeflow/issues/87)) is invisible.
  Don't remove it. Tests that need another zone stub `TZ` themselves.
- Service tests come in pairs: `*.test.ts` covers the mock path, `*.host.test.ts`
  covers the Power Apps host path with the SDK stubbed. A change to a service
  usually needs both.
- Anything that computes a duration, a date key or a total deserves a test with
  a DST day, a midnight crossing, or an empty range in it. Those are where this
  app's bugs actually live.

## Conventions

- **Dates**: never `toISOString()` for a calendar date. Use the helpers in
  `src/utils/dates.ts` — see the rule at the top of that file.
- **Data layer**: components and hooks never talk to the SDK. They go through
  `src/services/*`, which decide mock-vs-host once.
- **Comments explain why, not what.** The existing ones read as arguments for a
  decision; match that. No Claude/Anthropic branding anywhere in code, comments
  or commit messages.
- **`src/generated/` is generated** by `pac code add-data-source`. Don't hand-edit
  it; it isn't linted. To regenerate it after a Dataverse schema change:

  ```bash
  npm run pac:regen    # needs `pac` on PATH and an authenticated pac auth profile
  ```

  That re-adds each of the three tables against the connection id already in
  `power.config.json`, then you commit the diff under `src/generated/` and
  `.power/schemas/`. Both are checked in on purpose (#7) so a clone builds
  without `pac`; regeneration used to be an undocumented side effect of
  running the CLI by hand (#116).

## Commits and PRs

- Commit as the repo owner (see [CLAUDE.md](CLAUDE.md)).
- Subject line in the imperative, under ~72 characters, describing the effect
  rather than the file touched: *"Stop a zero-duration entry from covering the
  rest of the day"*, not *"update gaps.ts"*.
- The body explains why the change is right, and what would break without it.
- **Reference GitHub issue numbers — never IDs from a document that isn't in
  this repo.** An earlier round of work cited `P1-07` and `P2-15` from a review
  register that lived only in a chat session; it is now
  [partially unrecoverable](docs/reviews/design-review-register.md). `#96`
  resolves for anyone, forever.
- Open issues carry a `P0` / `P1` / `P2` label alongside a type label
  (`bug`, `enhancement`, `documentation`, `accessibility`, `performance`,
  `architecture`, `build`). Use the same vocabulary in commit messages and PR
  titles.

## Decisions

Choices that shape the app — and open questions that need one — go in
[`docs/DECISIONS.md`](docs/DECISIONS.md). An open decision without an owner and
a date is not tracked, it's just a worry. Don't leave one in a personal
markdown file.

---

## Releases and tagging

There is one environment and no CD pipeline, so a "release" is: a tag, a
CHANGELOG entry, and a `pac code push`. The tag is the only thing that makes
*"what is prod running?"* answerable, and the only thing that makes rollback
possible — [rollback](docs/RUNBOOK.md#3-rollback) works by rebuilding a tag.

**Versioning** is semver against user-visible behaviour:

| Bump | When |
|---|---|
| patch | fixes only |
| minor | new capability, no migration required |
| major | a Dataverse schema change users' data must be migrated for, or a breaking change to what's already stored |

**To cut a release**, from a clean `main`:

1. Bump `version` in `package.json` (it is not read at runtime — it exists so
   the tag and the manifest agree).
2. Move the `## Unreleased` items in [`CHANGELOG.md`](CHANGELOG.md) under a new
   version heading with today's date.
3. Commit: `Release vX.Y.Z`.
4. Tag and push:
   ```bash
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin main --follow-tags
   ```
5. Deploy and smoke-test per [the runbook](docs/RUNBOOK.md#2-deploy).
6. Create the GitHub release from the tag, pasting the CHANGELOG section.

**Every deploy gets a tag**, including a hotfix and including a rollback. A
deploy nobody tagged is a deploy nobody can reverse. Never move a tag that has
been in prod — cut a new one.
