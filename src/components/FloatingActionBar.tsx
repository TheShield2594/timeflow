import React from "react";

interface Props {
  /** What the screen's gesture is, in words. On the Calendar this is the
   *  only place the drag-to-log gesture is taught, so it is not optional
   *  decoration — a screen whose primary action is direct manipulation has
   *  to say so somewhere a keyboard user can also read it. */
  hint: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * The one container in the app that floats, and therefore the one outside a
 * sheet that earns a material. It carries the screen's single primary action
 * and, on its left, the sentence that teaches the screen.
 */
export const FloatingActionBar: React.FC<Props> = ({ hint, children }) => (
  <div className="action-bar">
    <div className="action-bar__hint">{hint}</div>
    {children}
  </div>
);
