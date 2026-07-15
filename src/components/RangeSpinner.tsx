import React from "react";

/** Inline indicator shown while a wider date range is being fetched in the
 *  background (data already on screen stays put — nothing unmounts). */
export const RangeSpinner: React.FC<{ label?: string }> = ({ label = "Loading more entries…" }) => (
  <span className="range-spinner" role="status">
    <span className="range-spinner__dot" aria-hidden="true" />
    <span className="visually-hidden">{label}</span>
  </span>
);
