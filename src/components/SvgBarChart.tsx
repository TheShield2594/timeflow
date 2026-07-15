import React, { useLayoutEffect, useRef, useState } from "react";

export type Bucket = "day" | "week" | "month";

interface SvgBarChartProps {
  chartData: { key: string; minutes: number; bucket: Bucket }[];
  maxBar: number;
  shortDate: (d: string, bucket: Bucket) => string;
  formatMinutes: (m: number) => string;
}

const BAR_COLOR = "var(--ev-green)";
const BAR_COLOR_ZERO = "var(--border)";
const CHART_HEIGHT = 120; // px, chart plot area
const LABEL_HEIGHT = 28;  // px, reserved below bars for labels
const BAR_GAP_RATIO = 0.25; // fraction of slot width used for gap between bars
// Caps how wide each bar's slot can grow — without this, a handful of bars
// (e.g. a 7-day range) would stretch edge-to-edge into fat blocks.
const MAX_SLOT_PX = 90;

export const SvgBarChart: React.FC<SvgBarChartProps> = ({ chartData, maxBar, shortDate, formatMinutes }) => {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  // Measured in real pixels so the viewBox can match 1:1 — using a fixed
  // viewBox width with preserveAspectRatio="none" stretched bars AND text
  // non-uniformly whenever the container's actual width differed from it,
  // which is what made every range's day labels look horizontally smeared.
  const [containerWidth, setContainerWidth] = useState(600);
  const rafRef = useRef<number | null>(null);

  // useLayoutEffect (not useEffect) so the first measurement lands before
  // paint — otherwise the chart would flash at the 600px fallback first.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.getBoundingClientRect().width || 600);
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      // Coalesce rapid-fire resize notifications (e.g. a window drag) to one
      // update per frame instead of re-rendering on every callback.
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setContainerWidth(entry.contentRect.width));
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const totalHeight = CHART_HEIGHT + LABEL_HEIGHT;
  const n = chartData.length;
  const totalWidth = n > 0 ? Math.min(containerWidth, n * MAX_SLOT_PX) : containerWidth;
  const slotWidth = n > 0 ? totalWidth / n : totalWidth;
  const barWidth = Math.max(slotWidth * (1 - BAR_GAP_RATIO), 2);

  return (
    <div ref={containerRef} className="svg-bar-chart" style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        width={totalWidth}
        height={totalHeight}
        style={{ display: "block", margin: "0 auto", overflow: "visible" }}
        aria-label="Activity bar chart"
        role="img"
        onMouseLeave={() => setTooltip(null)}
      >
        {chartData.map(({ key, minutes, bucket }, i) => {
          const barH = minutes > 0 ? Math.max((minutes / maxBar) * CHART_HEIGHT, 4) : 0;
          const x = i * slotWidth + (slotWidth - barWidth) / 2;
          const y = CHART_HEIGHT - barH;
          const label = shortDate(key, bucket);

          return (
            <g key={key}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                fill={barH > 0 ? BAR_COLOR : BAR_COLOR_ZERO}
                opacity={barH > 0 ? 1 : 0.12}
                rx={2}

                onMouseEnter={() => {
                  const svgEl = svgRef.current;
                  if (!svgEl) return;
                  const rect = svgEl.getBoundingClientRect();
                  const svgScaleX = rect.width / totalWidth;
                  const svgScaleY = rect.height / totalHeight;
                  setTooltip({
                    x: (x + barWidth / 2) * svgScaleX,
                    y: y * svgScaleY,
                    label: minutes > 0 ? formatMinutes(minutes) : "No time logged",
                  });
                }}
                onMouseLeave={() => setTooltip(null)}
              />
              <text
                x={i * slotWidth + slotWidth / 2}
                y={CHART_HEIGHT + LABEL_HEIGHT - 6}
                textAnchor="middle"
                fontSize={n > 30 ? 7 : n > 14 ? 8 : 9}
                fill="var(--text-muted)"
                style={{ userSelect: "none" }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      {tooltip && (
        <div
          className="svg-bar-chart__tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          role="tooltip"
        >
          {tooltip.label}
        </div>
      )}
    </div>
  );
};
