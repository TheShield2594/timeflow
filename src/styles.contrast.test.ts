import { describe, it, expect } from "vitest";
// ?raw rather than fs: it keeps this test on Vite's own resolution, so it needs
// no @types/node and no assumption about the cwd the suite runs from.
import css from "./styles.css?raw";

/**
 * Contrast is the one design property in this app that a reviewer can't eyeball
 * reliably — `--text-faint` shipped at 2.46:1 for a long time while carrying the
 * calendar's hour labels and the Project × Period headers (#88). These tokens
 * are load-bearing enough to assert on.
 */

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No ${selector} block in styles.css`);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
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
  { name: "light", scope: block(":root") },
  { name: "dark", scope: block(':root[data-theme="dark"]') },
];

// Every surface a text token can land on. --surface-3 is the tightest of the
// four, so it's the one that decides whether a value is usable app-wide.
const SURFACES = ["bg", "surface", "surface-2", "surface-3"];

describe.each(THEMES)("$name theme", ({ scope }) => {
  // 4.5:1 is WCAG 1.4.3 for body text. None of these tokens are reserved for
  // large text, so the large-text exemption doesn't apply to any of them.
  it.each(["text", "text-muted", "text-faint"])(
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

  // --text-decor is deliberately below AA: it exists so placeholders and the
  // "·" separators can stay quiet. The test is that it stays *distinguishable*
  // from the surface, and that nobody promotes it back into a text token by
  // giving it the same value as --text-faint.
  it("--text-decor stays visible but distinct from --text-faint", () => {
    const decor = token(scope, "text-decor");
    expect(decor).not.toBe(token(scope, "text-faint"));
    expect(contrast(decor, token(scope, "surface"))).toBeGreaterThan(2);
  });
});

describe("--text-decor usage", () => {
  // The split only holds if decoration is the *only* thing on it. A rule that
  // sets a font-size is styling text someone is meant to read, which is the
  // exact mistake #88 was about.
  it("is only used on placeholders, separators and decorative marks", () => {
    const offenders = css
      .split("\n")
      .filter((line: string) => line.includes("var(--text-decor)"))
      .filter((line: string) => !line.trim().startsWith("--text-decor"))
      .filter(
        (line: string) =>
          !/::placeholder|__sep|-sep\b|::before|__empty-icon|scrollbar-thumb|__dot\b/.test(line)
      );
    expect(offenders).toEqual([]);
  });
});
