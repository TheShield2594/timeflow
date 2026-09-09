import React from "react";

export type PillTone = "primary" | "tint" | "quiet" | "danger";
export type PillSize = "hero" | "default" | "row" | "inline" | "tiny";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: PillTone;
  size?: PillSize;
}

const SIZE_CLASS: Record<PillSize, string> = {
  hero: " pill--hero",
  default: "",
  row: " pill--row",
  inline: " pill--inline",
  tiny: " pill--tiny",
};

/**
 * Every button in the app is this shape.
 *
 * The tone is the whole vocabulary: `primary` is the one action a screen is
 * for and appears once on it, `tint` is a secondary action inside a row or a
 * sheet, `quiet` is a text button, and `danger` is text-only on purpose —
 * a destructive action never gets a fill it could be hit by accident.
 */
export const Pill: React.FC<Props> = ({ tone = "tint", size = "default", className = "", type = "button", ...rest }) => (
  <button
    type={type}
    className={`pill pill--${tone}${SIZE_CLASS[size]}${className ? ` ${className}` : ""}`}
    {...rest}
  />
);
