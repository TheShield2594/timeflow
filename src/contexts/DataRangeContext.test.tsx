import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { renderHook, act, cleanup } from "@testing-library/react";
import { DataRangeProvider, useDataRange, useRangeRequest } from "./DataRangeContext";
import { addDaysStr, localDateStr } from "../utils/dates";

afterEach(cleanup);

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DataRangeProvider>{children}</DataRangeProvider>
);

const today = () => localDateStr();
const baselineFrom = () => addDaysStr(today(), -89);

describe("DataRangeProvider", () => {
  it("starts on the 90-day baseline window", () => {
    const { result } = renderHook(() => useDataRange(), { wrapper });

    expect(result.current).toMatchObject({ from: baselineFrom(), to: today() });
  });

  it("widens to cover a request that reaches outside the baseline", () => {
    const { result } = renderHook(() => useDataRange(), { wrapper });

    act(() => result.current.requestRange("reports", "1970-01-01", "9999-12-31"));

    expect(result.current).toMatchObject({ from: "1970-01-01", to: "9999-12-31" });
  });

  it("narrows again when the same page asks for a smaller range (#74)", () => {
    const { result } = renderHook(() => useDataRange(), { wrapper });

    // "All time", then back to a 7-day preset. Before #74 the range was a
    // running maximum, so every later fetch stayed pinned to all of history.
    act(() => result.current.requestRange("reports", "1970-01-01", "9999-12-31"));
    act(() => result.current.requestRange("reports", addDaysStr(today(), -6), today()));

    expect(result.current).toMatchObject({ from: baselineFrom(), to: today() });
  });

  it("narrows when a page releases its request", () => {
    const { result } = renderHook(() => useDataRange(), { wrapper });

    act(() => result.current.requestRange("calendar", "2020-01-01", "2020-01-07"));
    expect(result.current.from).toBe("2020-01-01");

    act(() => result.current.releaseRange("calendar"));
    expect(result.current.from).toBe(baselineFrom());
  });

  it("never narrows below the baseline, so page-to-page navigation doesn't refetch", () => {
    const { result } = renderHook(() => useDataRange(), { wrapper });

    act(() => result.current.requestRange("timesheet", addDaysStr(today(), -6), today()));

    expect(result.current).toMatchObject({ from: baselineFrom(), to: today() });
  });

  it("keeps the union while two pages are both asking", () => {
    const { result } = renderHook(() => useDataRange(), { wrapper });

    act(() => {
      result.current.requestRange("a", "2019-01-01", today());
      result.current.requestRange("b", baselineFrom(), "2999-12-31");
    });
    expect(result.current).toMatchObject({ from: "2019-01-01", to: "2999-12-31" });

    act(() => result.current.releaseRange("a"));
    expect(result.current).toMatchObject({ from: baselineFrom(), to: "2999-12-31" });
  });
});

describe("useRangeRequest", () => {
  it("holds the range while mounted and releases it on unmount", () => {
    const { result } = renderHook(
      () => {
        const [wide, setWide] = React.useState(true);
        useRangeRequest("calendar", wide ? "2019-06-01" : "", wide ? "2019-06-07" : "");
        return { range: useDataRange(), setWide };
      },
      { wrapper }
    );

    expect(result.current.range.from).toBe("2019-06-01");

    // Empty bounds are "nothing resolved yet", not "everything": they must not
    // compare below every real date and blow the window open.
    act(() => result.current.setWide(false));
    expect(result.current.range.from).toBe(baselineFrom());
  });
});
