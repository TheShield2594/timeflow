import React, { useState } from "react";
import { clockAt } from "../utils/dates";
import { normalizeWorkingHours, type WorkingHours } from "../hooks/useWorkingHours";
import { Sheet } from "./Sheet";
import { Pill } from "./Pill";

interface Props {
  workingHours: WorkingHours;
  onChange: (next: Partial<WorkingHours>) => void;
  onClose: () => void;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Working hours, and the floor below which a hole isn't worth mentioning.
 *
 * This is a correctness setting rather than a preference: gap detection was
 * hardcoded to 08:00–18:00, so anyone on a different shift was told their day
 * was complete when two hours of it were outside the search window.
 */
export const SettingsSheet: React.FC<Props> = ({ workingHours, onChange, onClose }) => {
  const [start, setStart] = useState(clockAt(workingHours.startMin));
  const [end, setEnd] = useState(clockAt(workingHours.endMin));
  const [floor, setFloor] = useState(String(workingHours.gapMustExceedMinutes));

  const preview = normalizeWorkingHours({
    startMin: toMinutes(start),
    endMin: toMinutes(end),
    gapMustExceedMinutes: Number(floor),
  });
  const endIsInvalid = toMinutes(end) <= toMinutes(start);

  const save = () => {
    onChange(preview);
    onClose();
  };

  return (
    <Sheet label="Working hours" onClose={onClose} narrow>
      <h2 className="t-title1">Working hours</h2>
      <p className="sheet__meta t-body t-prose">
        Untracked time is only worth pointing at inside the hours you actually work.
        Outside them it isn&rsquo;t a gap in your timesheet, it&rsquo;s an evening.
      </p>

      <div className="sheet__section field-list">
        <div className="field-row">
          <label className="field-row__label" htmlFor="wh-start">Day starts</label>
          <span className="field-row__value">
            <input id="wh-start" type="time" className="input input--time" value={start} onChange={(e) => setStart(e.target.value)} />
          </span>
        </div>
        <div className="field-row">
          <label className="field-row__label" htmlFor="wh-end">Day ends</label>
          <span className="field-row__value">
            <input id="wh-end" type="time" className="input input--time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </span>
        </div>
        <div className="field-row">
          <label className="field-row__label" htmlFor="wh-floor">Ignore gaps under</label>
          <span className="field-row__value">
            <input
              id="wh-floor" type="number" min="0" max="240" step="5"
              className="field-row__input" style={{ maxWidth: 90 }}
              value={floor} onChange={(e) => setFloor(e.target.value)}
            />
            <span className="field-row__sep">minutes</span>
          </span>
        </div>
      </div>

      {endIsInvalid && (
        <p className="form-error" role="alert">
          The day has to end after it starts — saving keeps {clockAt(preview.endMin)}.
        </p>
      )}
      <p className="sheet__note">
        Stored on this device for this environment. Power Apps Code Apps have no per-user
        settings table, so it travels with the browser rather than the account.
      </p>

      <div className="sheet__foot">
        <div className="sheet__foot-right">
          <Pill tone="quiet" onClick={onClose}>Cancel</Pill>
          <Pill tone="primary" onClick={save}>Save</Pill>
        </div>
      </div>
    </Sheet>
  );
};
