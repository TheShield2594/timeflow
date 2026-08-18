/**
 * Colour constants shared by the components and the Dataverse mappers.
 */

/**
 * Swatch colour for a project that has none — a row saved before `ever_color`
 * was populated, or an entry whose project has been hard-deleted out from
 * under it (the "Unassigned" bucket on the Team rollup).
 *
 * Seven places each carried their own literal for this: six used `#6366f1`,
 * an indigo that isn't in the Everence palette at all, and the Team rollup
 * used `#9aaa94` (#101). One constant, and a deliberately neutral one: a
 * colourless project should read as "no colour set", not wear a brand colour
 * it was never assigned. Green-tinted grey rather than a flat one so it sits
 * in the palette's family, and chosen to clear 3:1 against the surfaces of
 * BOTH themes (3.8:1 light, 4.3:1 dark) — the dot is often the only thing
 * distinguishing one row's project from another's.
 */
export const DEFAULT_PROJECT_COLOR = "#788774";
