import React from "react";

export type DateRangePreset = "7d" | "30d" | "90d" | "thisMonth" | "all" | "custom";

export interface DateRangeState {
  preset: DateRangePreset;
  customFrom: string;
  customTo: string;
}

export const DEFAULT_RANGE: DateRangeState = {
  preset: "30d",
  customFrom: "",
  customTo: "",
};

const PRESET_LABEL: Record<DateRangePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  thisMonth: "This month",
  all: "All time",
  custom: "Custom",
};

export function resolveDateRange(state: DateRangeState): { from: string; to: string } {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  if (state.preset === "custom") {
    return {
      from: state.customFrom || todayStr,
      to: state.customTo || todayStr,
    };
  }
  if (state.preset === "all") {
    return { from: "1970-01-01", to: "9999-12-31" };
  }

  const from = new Date(today);
  if (state.preset === "7d") from.setDate(from.getDate() - 6);
  else if (state.preset === "30d") from.setDate(from.getDate() - 29);
  else if (state.preset === "90d") from.setDate(from.getDate() - 89);
  else if (state.preset === "thisMonth") from.setDate(1);

  return { from: from.toISOString().split("T")[0], to: todayStr };
}

interface Props {
  presets?: DateRangePreset[];
  value: DateRangeState;
  onChange: (next: DateRangeState) => void;
  rightSlot?: React.ReactNode;
  info?: React.ReactNode;
}

const DEFAULT_PRESETS: DateRangePreset[] = ["7d", "30d", "thisMonth"];

export const DateRangeFilter: React.FC<Props> = ({
  presets = DEFAULT_PRESETS,
  value,
  onChange,
  rightSlot,
  info,
}) => {
  const showCustom = value.preset === "custom";

  return (
    <>
      <div className="reports__controls">
        <div className="reports__range-tabs" role="tablist">
          {presets.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={value.preset === p}
              className={`reports__tab ${value.preset === p ? "reports__tab--active" : ""}`}
              onClick={() => onChange({ ...value, preset: p })}
            >
              {PRESET_LABEL[p]}
            </button>
          ))}
          <button
            role="tab"
            aria-selected={showCustom}
            className={`reports__tab ${showCustom ? "reports__tab--active" : ""}`}
            onClick={() => onChange({ ...value, preset: "custom" })}
          >
            Custom
          </button>
        </div>
        {rightSlot}
      </div>

      {showCustom && (
        <div className="reports__custom-range">
          <label className="custom-range__label">From</label>
          <input
            type="date"
            className="custom-range__input"
            value={value.customFrom}
            onChange={(e) => onChange({ ...value, customFrom: e.target.value })}
          />
          <label className="custom-range__label">To</label>
          <input
            type="date"
            className="custom-range__input"
            value={value.customTo}
            onChange={(e) => onChange({ ...value, customTo: e.target.value })}
          />
          {info && <span className="custom-range__info">{info}</span>}
        </div>
      )}
    </>
  );
};
