import React from "react";
import { ROUNDING_LABELS, type RoundingRule } from "../services/csvExport";

interface Props {
  value: RoundingRule;
  onChange: (rule: RoundingRule) => void;
}

/**
 * The rule an export bills under, stated beside the button that applies it.
 * Shared by every personal "Export CSV" so no two of them can disagree about
 * how many hours the same entries come to.
 */
export const RoundingSelect: React.FC<Props> = ({ value, onChange }) => (
  <label>
    Rounding ·{" "}
    <select
      className="field-row__select"
      value={value}
      onChange={(e) => onChange(e.target.value as RoundingRule)}
      aria-label="Rounding applied to exported durations"
    >
      {(Object.keys(ROUNDING_LABELS) as RoundingRule[]).map((rule) => (
        <option key={rule} value={rule}>{ROUNDING_LABELS[rule].toLowerCase()}</option>
      ))}
    </select>
  </label>
);
