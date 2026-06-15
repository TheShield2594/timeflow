import React, { createContext, useCallback, useContext, useState } from "react";
import { localDateStr, localDateDaysAgo } from "../utils/dates";

const INITIAL_DAYS_LOADED = 90;

interface DataRangeApi {
  from: string;
  to: string;
  ensureRangeLoaded: (from: string, to: string) => void;
}

const DataRangeCtx = createContext<DataRangeApi | null>(null);

export const DataRangeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [range, setRange] = useState(() => ({
    from: localDateDaysAgo(INITIAL_DAYS_LOADED - 1),
    to: localDateStr(),
  }));

  const ensureRangeLoaded = useCallback((from: string, to: string) => {
    setRange((prev) => {
      const nextFrom = from < prev.from ? from : prev.from;
      const nextTo = to > prev.to ? to : prev.to;
      if (nextFrom === prev.from && nextTo === prev.to) return prev;
      return { from: nextFrom, to: nextTo };
    });
  }, []);

  return (
    <DataRangeCtx.Provider value={{ from: range.from, to: range.to, ensureRangeLoaded }}>
      {children}
    </DataRangeCtx.Provider>
  );
};

export function useDataRange(): DataRangeApi {
  const ctx = useContext(DataRangeCtx);
  if (!ctx) throw new Error("useDataRange must be used inside DataRangeProvider");
  return ctx;
}
