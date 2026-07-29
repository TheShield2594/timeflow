import React from "react";

interface Props {
  /** One value per day, oldest first. */
  values: number[];
  color: string;
  label: string;
}

const WIDTH = 62;
const HEIGHT = 18;
const GAP = 1.5;

/** Seven bars of recent activity, sized to sit inside a card footer. Purely
 *  supplementary — the accessible reading is the `label` the caller passes. */
export const Sparkline: React.FC<Props> = ({ values, color, label }) => {
  const max = Math.max(...values, 1);
  const barWidth = (WIDTH - GAP * (values.length - 1)) / values.length;

  return (
    <svg
      className="sparkline"
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
    >
      {values.map((v, i) => {
        // Logged days keep a visible stub so "a little" never reads as "none".
        const h = v > 0 ? Math.max(2, (v / max) * HEIGHT) : 1;
        return (
          <rect
            key={i}
            x={i * (barWidth + GAP)}
            y={HEIGHT - h}
            width={barWidth}
            height={h}
            rx={1}
            fill={v > 0 ? color : "currentColor"}
            opacity={v > 0 ? 0.85 : 0.25}
          />
        );
      })}
    </svg>
  );
};
