import { useCallback, useState } from "react";
import { ROUNDING_LABELS, type RoundingRule } from "../services/csvExport";

// One rounding rule for every personal export. The Timesheet and Reports each
// used to have an "Export CSV", and only Reports applied the rule — so the same
// range exported from the two pages billed different hours. The Team export
// keeps its own key on purpose (a manager's rollup is a different document).
// A device preference, not data, so it lives in localStorage.
const ROUNDING_STORAGE_KEY = "tt_export_rounding";

function readStoredRounding(): RoundingRule {
  try {
    const v = localStorage.getItem(ROUNDING_STORAGE_KEY);
    if (v && v in ROUNDING_LABELS) return v as RoundingRule;
  } catch { /* default below */ }
  return "exact";
}

export function useExportRounding(): [RoundingRule, (rule: RoundingRule) => void] {
  const [rounding, setRoundingState] = useState<RoundingRule>(readStoredRounding);
  const setRounding = useCallback((rule: RoundingRule) => {
    setRoundingState(rule);
    try { localStorage.setItem(ROUNDING_STORAGE_KEY, rule); } catch { /* preference only */ }
  }, []);
  return [rounding, setRounding];
}
