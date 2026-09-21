---
name: TimeFlow
description: The Everence billable-time record — a quiet, exact ledger of the working day.
colors:
  field-green: "#5A7800"
  field-green-tint: "rgba(90,120,0,.12)"
  field-green-tint-hover: "rgba(90,120,0,.07)"
  on-field-green: "#FFFFFF"
  paper-white: "#FBFBF8"
  sheet-white: "#FFFFFF"
  material: "rgba(255,255,255,.72)"
  material-sheet: "rgba(255,255,255,.96)"
  hairline: "rgba(20,22,16,.09)"
  ink: "#1B1D17"
  ink-secondary: "#676B60"
  decor-sage: "#9BA093"
  dim-display: "#8A9083"
  rust-danger: "#A33E00"
  ochre-warn: "#8A5A00"
  night-field-green: "#A9CB4B"
  night-on-field-green: "#12150F"
  charcoal-night: "#0F110E"
  night-surface: "#191C17"
  night-ink: "#EFF2EA"
  night-ink-secondary: "#A2A89A"
  night-decor: "#767C6E"
  night-dim-display: "#6A7065"
  night-danger: "#F0925F"
  night-warn: "#F0B34A"
  toast-bg: "#1E221C"
  on-toast: "#EFF2EA"
  toast-accent: "#A9CB4B"
  toast-warn: "#F0B34A"
  project-green: "#719500"
  project-lime: "#B5BF00"
  project-robin: "#4DC5E2"
  project-blue: "#0080BD"
  project-pumpkin: "#CC4F00"
  project-forest: "#225433"
  project-grass: "#358450"
  project-navy: "#003346"
  project-royal: "#00739F"
  project-lemon: "#F3AE00"
  project-charcoal: "#4B5457"
typography:
  timer:
    fontFamily: "Instrument Sans, system-ui, -apple-system, sans-serif"
    fontSize: "96px"
    fontWeight: 400
    lineHeight: "92px"
    letterSpacing: "-0.038em"
    fontFeature: "tnum"
  display:
    fontFamily: "Instrument Sans, system-ui, -apple-system, sans-serif"
    fontSize: "56px"
    fontWeight: 600
    lineHeight: "58px"
    letterSpacing: "-0.03em"
  large-title:
    fontFamily: "Instrument Sans, system-ui, -apple-system, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: "40px"
    letterSpacing: "-0.025em"
  title1:
    fontFamily: "Instrument Sans, system-ui, -apple-system, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "34px"
    letterSpacing: "-0.02em"
  title2:
    fontFamily: "Instrument Sans, system-ui, -apple-system, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Instrument Sans, system-ui, -apple-system, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "Instrument Sans, system-ui, -apple-system, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: "24px"
    fontFeature: "tnum"
  subhead:
    fontFamily: "Instrument Sans, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "20px"
  footnote:
    fontFamily: "Instrument Sans, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  group-label:
    fontFamily: "Instrument Sans, system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0.07em"
rounded:
  control: "6px"
  block: "8px"
  field-list: "12px"
  card: "14px"
  sheet: "18px"
  pill: "999px"
spacing:
  half: "4px"
  "1": "8px"
  "2": "16px"
  "3": "24px"
  "4": "32px"
  "5": "40px"
  "6": "48px"
  sidebar: "232px"
components:
  pill-primary:
    backgroundColor: "{colors.field-green}"
    textColor: "{colors.on-field-green}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "44px"
  pill-hero:
    backgroundColor: "{colors.field-green}"
    textColor: "{colors.on-field-green}"
    rounded: "{rounded.pill}"
    padding: "0 40px"
    height: "52px"
  pill-tint:
    backgroundColor: "{colors.field-green-tint}"
    textColor: "{colors.field-green}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "44px"
  pill-quiet:
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "44px"
  pill-quiet-hover:
    backgroundColor: "{colors.field-green-tint-hover}"
    textColor: "{colors.ink}"
  pill-danger:
    textColor: "{colors.rust-danger}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "44px"
  chip:
    backgroundColor: "{colors.field-green-tint}"
    textColor: "{colors.field-green}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "20px"
  list-card:
    backgroundColor: "{colors.sheet-white}"
    rounded: "{rounded.card}"
    padding: "2px 18px"
  input:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  sheet:
    backgroundColor: "{colors.material-sheet}"
    rounded: "{rounded.sheet}"
    padding: "28px 28px 22px"
    width: "580px"
  nav-link:
    textColor: "{colors.ink}"
    rounded: "{rounded.block}"
    padding: "0 12px"
    height: "44px"
  nav-link-active:
    backgroundColor: "{colors.field-green-tint}"
    textColor: "{colors.field-green}"
---

# Design System: TimeFlow

## Overview

**Creative North Star: "The Honest Ledger"**

TimeFlow is a record, and the design behaves like one. It is quiet, exact and
has no decoration. Colour carries meaning or it isn't there. Numbers sit in
tabular columns that never jitter. Missing time is drawn at the same scale as
logged time, so a gap can't hide. The system comes from the 2026-09
"first-party" redesign: content first, one unmistakable primary action per
screen, a real type hierarchy on an 8pt grid, one accent, and depth from
material rather than shadow. It uses no Apple fonts, icons or layouts. The
discipline is borrowed, the look is not.

The density is calm rather than sparse. A screen shows the day as a shape
before it shows it as numbers: a bar, a ring, a block on a grid. One sentence
explains the shape instead of a KPI strip repeating it. The palette is warm
paper and ink with a single darkened Everence green that means "you can act
here". Every other colour on screen is a project's own colour, used on that
project's marks only.

The system rejects gamification, decorative colour, card-in-card nesting, drop
shadows on content, icon-set navigation, and any "tertiary" text colour that
can't be read.

**Key Characteristics:**
- One typeface (Instrument Sans, self-hosted), ten type steps, tabular figures everywhere.
- Two readable text colours per theme; a third grey exists only for non-text marks.
- One accent, used for actions. Project colours are data and appear only on that project's marks.
- Flat content on a warm canvas; material and a single hairline only for what floats or dismisses.
- The time entry has four renderings (list row, day bar, calendar block, ring), all built from the same tokens.
- Light and dark are equal. In dark mode the accent becomes the lightest thing on screen.

## Colors

Warm paper and near-black ink, one darkened Everence green for action, and an
eleven-colour brand palette reserved for projects.

### Primary
- **Everence Field Green** (#5A7800 light / #A9CB4B dark): means "you can act here" and nothing else. Used for the primary pill (once per screen), the active nav item, the focus ring, the running-timer eyebrow and pulse, and actionable values. In light mode it is the Everence green darkened to 4.9:1 on canvas. In dark mode it flips to the lightest mark on screen, and text on it turns dark (#12150F).
- **Field Green Tint** (accent at 12% light / 16% dark): secondary pills, selected nav, chips, text selection, drag selection. The 7% / 9% hover tint is the app's universal hover wash.

### Secondary
- **Rust** (#A33E00 light / #F0925F dark): destructive text and the data-isolation alarm. Destructive actions never get a fill.
- **Ochre** (#8A5A00 light / #F0B34A dark): untracked-gap hatching, missing-day flags, warn chips. Ochre means "time is missing here".

### Tertiary: the project palette
- **Everence brand colours** (Green #719500, Lime #B5BF00, Robin #4DC5E2, Blue #0080BD, Pumpkin #CC4F00, Forest #225433, Grass #358450, Navy #003346, Royal #00739F, Lemon #F3AE00, Charcoal #4B5457): the only colours a project can be painted in. The picker excludes hues already taken. In dark mode each is lifted 44% toward the ink colour (`--pc-lift`) so the deep brand colours stay visible on a dark canvas.

### Neutral
- **Paper White** (#FBFBF8): the light window canvas, a warm off-white.
- **Sheet White** (#FFFFFF): grouped list cards and inputs, one step up from the canvas.
- **Charcoal Night** (#0F110E) / **Night Surface** (#191C17): the dark canvas and card.
- **Ink** (#1B1D17 / #EFF2EA): all primary text.
- **Ink Secondary** (#676B60 / #A2A89A): every secondary line in the app, at 5.3:1 and 7.8:1.
- **Decor Sage** (#9BA093 / #767C6E): **non-text only**. Dots, bar tracks, empty fills, placeholders, scrollbar thumbs.
- **Dim Display** (#8A9083 / #6A7065): the 96px idle clock, and nothing else.
- **Hairline** (ink at 9% / 11%): separators and the one inset ring on floating material.

### Named Rules
**The Colour-Is-Data Rule.** The accent means "act here" and a project colour means "this project". Nothing else in the app is coloured. If you want colour for emphasis, the answer is weight or size.

**The Two-Inks Rule.** A reader only ever reads Ink or Ink Secondary. Both clear 4.5:1 on every surface in both themes, and `styles.contrast.test.ts` fails the build if they don't. There is no tertiary text colour.

**The Decor-Is-Mute Rule.** Decor Sage never carries text. A rule that gives it a `font-size` fails the build.

## Typography

**Display Font:** Instrument Sans (with system-ui, -apple-system, sans-serif)
**Body Font:** Instrument Sans, the same family
**Label/Mono Font:** none separate; tabular figures come from `font-variant-numeric: tabular-nums` set once on `body`.

**Character:** a single variable grotesk used at ten fixed steps. Tight negative
tracking on the large sizes, neutral at reading sizes, and one tracked uppercase
label for group headings. It is self-hosted (latin subset, woff2) so no request
leaves the tenant.

### Hierarchy
- **Timer** (400, 96px / 92px, −0.038em): the running clock, one per app.
- **Display** (600, 56px / 58px, −0.03em): headline totals (Reports).
- **Large Title** (600, 34px / 40px, −0.025em): page titles.
- **Title 1** (600, 28px / 34px, −0.02em): the week total beside the ring; section heroes.
- **Title 2** (600, 22px / 28px, −0.015em): sheet titles and sub-sections.
- **Headline** (600, 17px / 22px): list-row titles and the values they hold.
- **Body** (400, 17px / 24px): prose and empty states. Prose is capped at 46–56ch with `text-wrap: pretty`.
- **Subhead** (400, 15px / 20px): row subtitles, field labels, pill text.
- **Footnote** (400, 13px / 18px): axis labels, row times, notes, shortcut hints.
- **Group Label** (600, 12px / 16px, 0.07em, uppercase): list group headers like `THIS WEEK` and `YESTERDAY YOU WORKED ON`.

### Named Rules
**The Ten-Steps Rule.** A screen that needs an eleventh size has drifted. Use a `.t-*` step.

**The Tabular Rule.** Every duration, time and count uses tabular figures, set globally so a column of times never shifts as its digits change.

## Layout

The app uses a fixed two-column shell: a 232px text-only sidebar and a main
column that scrolls independently, padded 40px top and 48px at the sides and
bottom. Spacing sits on an 8pt grid, with 4px as the only half-step. Screens
stack vertically: a page head (Large Title plus a toolbar of segmented controls
and dropdowns), then content groups, then an optional sticky floating action
bar at the bottom.

The Timer screen splits into two columns below the hero (the day, and a week
rail). They collapse to one column under 1040px. Reports' split collapses under
900px and the calendar reflows under 860px. Mobile is out of scope. The artboard
reference is 1280 × 840, but every screen has to reflow within desktop widths.

**The Forty-Four Rule.** Every button, role=button and link is at least 44px
tall, including on desktop. Controls drawn smaller (row pills at 34px, segments
at 26px, the calendar's chips, swatches) keep their drawing and get an
invisible 44px band above and below from a shared `::after` rule in the BASE
section. The band is vertical only, so neighbours in a row never trade clicks.
A new small control joins that selector list.

## Elevation & Depth

Content is flat, with no shadows. Depth is conveyed by material. A container
gets a surface only by **floating** (the action bar, dropdown menus),
**scrolling independently**, or **being dismissible** (sheets). It gets that
surface from a tinted translucent fill, `backdrop-filter: blur(24px)
saturate(1.6)`, and one inset hairline ring (`inset 0 0 0 1px` hairline).
Floating bars use 72% material. Sheets are read *through* and must survive a
host that drops `backdrop-filter`, so they use 96%. The scrim behind a sheet
blurs 2px.

The only shadow in the system is the 1px lift on the selected segment of a
segmented control (`0 1px 2px rgba(20,22,16,.10)`, and `.34` black in dark
mode).

### Named Rules
**The Depth-Is-Earned Rule.** No `box-shadow` on content, ever. Never put a card inside a card. If a thing doesn't float, scroll or dismiss, it sits on the canvas.

## Shapes

Radius grows with the size of the container: controls 6px, blocks and nav items
8px, field lists and choice rows 12px, list cards 14px, sheets 18px. Every
button, chip, segmented control and day-bar track is a full pill (999px).
Project dots are circles (9px, with 7px and 11px variants). The gap mark is a
2px-radius square with a 135° ochre hatch. Hatching (135°, a few pixels per
stripe) is the recurring pattern for "no time here": gap segments, empty day
bars, the action-bar swatch.

## Components

### Buttons
One shape: the pill.
- **Shape:** full pill (999px), 44px tall, 24px horizontal padding, 15px / 600.
- **Primary:** Field Green fill, white text (dark text in dark mode). **One per screen**, for that screen's primary action only.
- **Hero:** the primary pill at 52px / 18px, used only for the timer's Start/Stop.
- **Tint:** Field Green Tint fill with Field Green text, for secondary actions.
- **Quiet:** Ink Secondary text with no fill. Hover adds the 7% accent wash and Ink text.
- **Danger:** Rust text, never filled. Hover adds an 8% rust wash.
- **Sizes:** row (34px), inline (32px), tiny (30px) for in-row actions.
- **Hover / Focus:** 160ms ease-out on background and colour. Focus is a 2px Field Green outline, offset 2px. Disabled is 45% opacity.
- **Choice rows** (idle and auto-stop sheets): full-width 52px blocks at 12px radius. Primary, tint and danger variants.

### Chips
- **Style:** 20px pill, 11px / 700 uppercase at 0.06em, Field Green Tint fill with Field Green text. The warn variant uses ochre at 14%.
- **State:** static labels only. Selection is the segmented control's job.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** Sheet White / Night Surface on the canvas.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** none. Rows are separated by hairlines that start at the text origin (23px = dot + gap), never at the card edge.
- **Internal Padding:** 2px vertical, 18px horizontal (14px when tight). Rows carry 10px vertical padding.

### Inputs / Fields
- **Style:** 34px, 6px radius, surface fill, inset hairline ring, 15px text. Placeholders are Decor Sage.
- **Focus:** 2px Field Green outline, inset by 1px.
- **Field lists (sheets):** a 5% ink-tinted group at 12px radius. Each row has a 96px label column and a right-aligned borderless input that gains a 4% wash on hover.
- **Error:** a 15px Rust line below the form.

### Navigation
- **Style:** text only, with no icon set. 44px rows at 8px radius, 15px Ink text, on a sidebar tinted 3% toward ink with a hairline right edge.
- **States:** hover adds the 7% accent wash. Active uses Field Green Tint fill with Field Green text at 600.
- **Brand:** the Everence emblem at 22px plus the "TimeFlow" wordmark in Instrument Sans. The full logo's wordmark doesn't survive dark mode.

### Segmented Control
A filter that shows its own alternatives: a 30px pill track at 6% ink, 26px
items at 13px / 600. The selected item sits on a surface with the one permitted
1px shadow. It is a radio group, not tabs: one tab stop on the selected item,
and the arrow keys, Home and End move and select.

### Day Bar (signature)
The time entry drawn as a bar. It is an 18px pill track with a 2px gap between
segments. Each entry is a `flex: <minutes>` segment in its project colour.
Each untracked gap is a segment in the same track, drawn at the same scale as
the work, and ochre-hatched when it counts. The running segment fades out at
its leading edge, which reads as "still growing" without any animation. The bar
is also an input: dragging across a gap draws a Field Green Tint selection and
opens the entry sheet.

### Week Ring (signature)
A 118px ring (r=58, stroke 14, round caps) for weekly progress, next to the
total in Title 1 and a single sentence about pace. This replaces every KPI
strip.

### Toast
Bottom-centre, one at a time, and dark in both themes: a 90% Toast Night fill
(#1E221C) with Night Ink text. Because it is dark in light mode too, it never
borrows the theme's accent. Its action and dot use the fixed toast tokens,
which the contrast test checks against the toast itself. An action toast holds
while hovered or focused, and takes focus only when a delete has left focus
nowhere.

### Sheet
The app's one dismissible surface: 580px (460px narrow), 18px radius, 96%
material, an inset hairline, and a 200ms scale-in from 0.97. The stop, edit,
create, idle, auto-stop and settings flows all use it.

### Floating Action Bar
The only place a container floats outside a sheet. It is sticky at the bottom
with 72% material. The left side teaches the screen's gesture (a hatched swatch
plus a hint). The right side holds the screen's single primary pill.

## Do's and Don'ts

### Do:
- **Do** use Field Green only where the user can act, with one primary pill per screen.
- **Do** paint a project's colour only on that project's dots, bars and blocks.
- **Do** set every size from the ten `.t-*` steps and every gap from the 8pt grid (4px is the only half-step).
- **Do** show the day as a shape first (bar, ring, block) and explain it in one sentence.
- **Do** draw missing time at the same scale as logged time, with the 135° ochre hatch.
- **Do** start separators at the text origin (23px in), never at the card edge.
- **Do** give anything that floats or dismisses the material fill and one inset hairline, and nothing more.
- **Do** keep transitions at 200ms or less and respect `prefers-reduced-motion`.
- **Do** keep every hit target at least 44px tall.

### Don't:
- **Don't** add a `box-shadow` to content, or put a card inside a card.
- **Don't** introduce a third text colour, or set text in Decor Sage.
- **Don't** use Dim Display anywhere except the 96px idle clock.
- **Don't** fill a destructive button.
- **Don't** add an icon set to navigation.
- **Don't** add KPI strips, streaks, heatmaps or any other gamified compliance.
- **Don't** use colour for emphasis or decoration.
- **Don't** add an eleventh type size.
