import React from "react";

/**
 * Inline SVG icon set — feather-style strokes, consistent 1.75 stroke width.
 * Kept dependency-free on purpose: Power Apps Code Apps ship a single bundle
 * and corporate environments may block external icon CDNs.
 */

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
  className,
});

export const IconTimesheet: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...base(size, className)}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" strokeWidth="2.5" />
    <line x1="3" y1="12" x2="3.01" y2="12" strokeWidth="2.5" />
    <line x1="3" y1="18" x2="3.01" y2="18" strokeWidth="2.5" />
  </svg>
);

export const IconCalendar: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...base(size, className)}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

export const IconChart: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...base(size, className)}>
    <line x1="6" y1="20" x2="6" y2="13" />
    <line x1="12" y1="20" x2="12" y2="5" />
    <line x1="18" y1="20" x2="18" y2="9" />
    <line x1="3" y1="20" x2="21" y2="20" opacity="0.4" />
  </svg>
);

export const IconFolder: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...base(size, className)}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

export const IconPlay: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...base(size, className)} fill="currentColor" stroke="none">
    <path d="M7 4.5 L19 12 L7 19.5 Z" />
  </svg>
);

export const IconStop: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...base(size, className)} fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const IconPlus: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)} strokeWidth={2}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const IconPencil: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </svg>
);

export const IconX: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)} strokeWidth={2}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const IconCheck: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)} strokeWidth={2}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const IconDownload: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const IconSearch: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.5" y2="16.5" />
  </svg>
);

export const IconChevronLeft: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)} strokeWidth={2}>
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export const IconChevronRight: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)} strokeWidth={2}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const IconClock: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15.5 14" />
  </svg>
);

export const IconUndo: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...base(size, className)}>
    <polyline points="9 14 4 9 9 4" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </svg>
);
