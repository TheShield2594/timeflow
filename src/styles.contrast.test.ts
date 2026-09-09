import { describe, it, expect } from "vitest";
// ?raw rather than fs: it keeps this test on Vite's own resolution, so it needs
// no @types/node and no assumption about the cwd the suite runs from.
import css from "./styles.css?raw";

/**
 * Contrast is the one design property in this app that a reviewer can't eyeball
 * reliably — `--text-faint` shipped at 2.46:1 for a long time while carrying the
 * calendar's hour labels and the Project × Period headers (#88).
 *
 * The redesign narrowed the palette to two text colours per theme precisely so
 * this file can be short and absolute: everything a reader reads is --label or
 * --label-secondary, and both clear AA on every surface. The two deliberate
 * exceptions each have a rule of their own below — --decor may never carry
 * text at all, and --dim-display may be used exactly once.
 */

/**
 * The declaration body of a rule, picked by selector and — because `:root`
 * carries the Everence project palette in one block and the theme's own
 * tokens in another — optionally by a token it must contain.
 */
function block(selector: string, contains?: string): string {
  let from = 0;
  for (;;) {
    const start = css.indexOf(`${selector} {`, from);
    if (start === -1) throw new Error(`No ${selector} block in styles.css declaring ${contains ?? "anything"}`);
    const end = css.indexOf("\n}", start);
    const body = css.slice(start, end);
    if (!contains || body.includes(contains)) return body;
    from = end + 1;
  }
}

function token(scope: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(scope);
  if (!m) throw new Error(`--${name} is not a plain hex value in this theme`);
  return m[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = [
  { name: "light", scope: block(":root", "--canvas") },
  { name: "dark", scope: block(':root[data-theme="dark"]') },
];

/**
 * Every opaque surface a text token can land on. --material is deliberately
 * not here: it is 72% of a background that is always one of these two, so it
 * sits between them and neither bound moves.
 */
const SURFACES = ["canvas", "surface"];

describe.each(THEMES)("$name theme", ({ scope }) => {
  // 4.5:1 is WCAG 1.4.3 for body text. None of these tokens is reserved for
  // large text, so the large-text exemption doesn't apply to any of them —
  // --accent included, which carries 15px pill labels and section actions.
  it.each(["label", "label-secondary", "accent", "danger", "warn"])(
    "--%s reads at AA on every surface",
    (name) => {
      const fg = token(scope, name);
      for (const surface of SURFACES) {
        expect(
          Number(contrast(fg, token(scope, surface)).toFixed(2)),
          `--${name} on --${surface}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  );

  // The accent inverts its role between themes: white on green in light, near
  // black on lime in dark. Whichever way round it is, the label on the app's
  // one primary button has to be readable.
  it("--on-accent reads at AA against the accent fill", () => {
    expect(
      Number(contrast(token(scope, "on-accent"), token(scope, "accent")).toFixed(2))
    ).toBeGreaterThanOrEqual(4.5);
  });

  // --decor is deliberately below AA: it exists so bar tracks, dots and empty
  // fills can stay quiet. The test is that it stays *visible*, and that nobody
  // promotes it back into a text token by giving it --label-secondary's value.
  it("--decor stays visible but distinct from --label-secondary", () => {
    const decor = token(scope, "decor");
    expect(decor).not.toBe(token(scope, "label-secondary"));
    expect(contrast(decor, token(scope, "surface"))).toBeGreaterThan(2);
  });

  // The idle clock is 96px, so WCAG's large-text threshold is the one that
  // applies to it. It is the only text in the app that gets that exemption.
  it("--dim-display clears the 3:1 large-text threshold", () => {
    const fg = token(scope, "dim-display");
    for (const surface of SURFACES) {
      expect(
        Number(contrast(fg, token(scope, surface)).toFixed(2)),
        `--dim-display on --${surface}`
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

// Declarations only. These assertions are about what the stylesheet *does*, and
// the comments here quote the very patterns being banned.
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Innermost rules — a selector, and the body between `{` and `}` with no
 * nested braces. That is every declaration block and no @media/@supports
 * wrapper.
 */
const declarationRules = [...rules.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim(), body: m[2] }));

describe("token definitions", () => {
  // The bug in #101 wasn't a badly chosen colour, it was five rules leaning on
  // an inline fallback for a token nobody had defined — which resolved to the
  // literal in *both* themes and so failed AA in dark mode while looking fine
  // in review. A fallback is what let that stay invisible, so the rule is that
  // custom properties are referenced bare.
  it("no var() reference carries an inline fallback colour", () => {
    const offenders = rules
      .split("\n")
      .filter((line: string) => /var\(\s*--[\w-]+\s*,/.test(line))
      // A fallback that names another token is a documented alias, not a
      // hardcoded colour hiding a missing definition.
      .filter((line: string) => !/var\(\s*--[\w-]+\s*,\s*var\(/.test(line));
    expect(offenders).toEqual([]);
  });

  // Every semantic token should be reachable from a rule. An unused one is
  // either dead weight or, worse, a lie about where a colour comes from —
  // --accent and --accent-hover once claimed to be the app's accent while the
  // actual accent lived in --accent-solid and --ev-green-dark (#101).
  //
  // The --ev-* block is exempt: it declares the Everence palette in full, as
  // the list a project's colour is picked from, and stays complete whether or
  // not every colour in it is currently assigned to a project.
  it("defines no semantic token that nothing references", () => {
    const defined = new Set(
      [...rules.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1])
    );
    const referenced = new Set(
      [...rules.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1])
    );
    const unused = [...defined].filter(
      (t) => !referenced.has(t) && !t.startsWith("--ev-")
    );
    expect(unused).toEqual([]);
  });
});

describe("--decor usage", () => {
  // The split only holds if decoration is the *only* thing on it. A rule that
  // puts --decor on something with a font-size is styling text someone is
  // meant to read, which is the exact mistake #88 was about. Checked per
  // declaration block rather than per line so it can't be dodged by wrapping.
  it("never lands on a rule that sets a font-size", () => {
    const offenders = declarationRules
      .filter((r) => r.body.includes("var(--decor)"))
      .filter((r) => /font-size\s*:/.test(r.body))
      .map((r) => r.selector);
    expect(offenders).toEqual([]);
  });

  /**
   * The font-size check alone does not enforce the rule: `color: var(--decor)`
   * on a rule that inherits its type passes it while painting text at 2.6:1.
   * So the *foreground* uses are enumerated instead.
   *
   * Placeholders are the one exception, and a deliberate one: every field in
   * this app carries a real <label>, the placeholder repeats it, and a
   * placeholder at full contrast is indistinguishable from a filled-in value —
   * which is its own, worse, failure.
   */
  const DECOR_TEXT_ALLOWLIST = /::placeholder/;

  it("is never used as a foreground colour outside the documented exception", () => {
    const offenders = declarationRules
      .filter((r) => /(^|[^-])color\s*:[^;]*var\(--decor\)/.test(r.body))
      .filter((r) => !DECOR_TEXT_ALLOWLIST.test(r.selector))
      .map((r) => r.selector);
    expect(offenders).toEqual([]);
  });
});

describe("--dim-display usage", () => {
  // "The idle clock at 96px only" is not a comment anybody can enforce by
  // reading. One reference is the whole rule: a second use is by definition
  // some other piece of text wearing a 3.2:1 grey.
  it("is referenced by exactly one rule", () => {
    const uses = [...rules.matchAll(/var\(--dim-display\)/g)];
    expect(uses).toHaveLength(1);
  });
});
