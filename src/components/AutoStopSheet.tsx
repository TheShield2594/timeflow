import React from "react";
import { Sheet } from "./Sheet";
import { Pill } from "./Pill";

interface Props {
  /** The project the capped entry was saved against, if it had one. */
  projectName?: string;
  onFix: () => void;
  onAccept: () => void;
}

/**
 * The 12-hour safety net, said out loud.
 *
 * It used to be a toast, which is the wrong shape for it twice over: it
 * reports something the user did not ask for, and it needs an answer. What
 * happened, what was saved, and how to correct it — no apology, no jargon,
 * and it does not call itself a safety net.
 */
export const AutoStopSheet: React.FC<Props> = ({ projectName, onFix, onAccept }) => (
  <Sheet label="Timer stopped after 12 hours" onClose={onAccept} narrow>
    <h2 className="t-title1">Stopped after 12 hours</h2>
    <p className="sheet__meta t-body t-prose">
      A timer this long is almost always one somebody forgot. It was saved at 12h 00m
      {projectName ? <> against <strong>{projectName}</strong></> : null} so nothing was lost —
      correct the end time if that isn&rsquo;t right.
    </p>
    <div className="sheet__foot">
      <div className="sheet__foot-right">
        <Pill tone="quiet" onClick={onAccept}>It was right</Pill>
        <Pill tone="primary" onClick={onFix}>Fix the end time</Pill>
      </div>
    </div>
  </Sheet>
);
