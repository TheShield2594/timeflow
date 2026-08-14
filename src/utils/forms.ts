/**
 * Value-equality for the flat records the entry and project forms use as their
 * draft state.
 *
 * Identity comparison is no help here: both forms are handed a fresh `initial`
 * object on every parent render, so `draft !== initial` is true from the first
 * frame and would make a pristine form look dirty — which is the annoying half
 * of a confirm-on-close (#104).
 */
export function isDirtyDraft<T extends object>(draft: T, pristine: T): boolean {
  return (Object.keys(draft) as (keyof T)[]).some((key) => draft[key] !== pristine[key]);
}
