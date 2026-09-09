import React from "react";
import { render, type RenderResult } from "@testing-library/react";
import { DataApiProvider, type DataApi } from "../contexts/DataContext";
import { DataRangeProvider } from "../contexts/DataRangeContext";
import { ToastProvider } from "../contexts/ToastContext";
import { DEFAULT_WORKING_HOURS, type WorkingHours } from "../hooks/useWorkingHours";
import type { Project, Task, TimeEntry } from "../types";

/**
 * Pages read their data from `useData()` rather than from props, which is the
 * whole point of DataContext — but it means a page can no longer be rendered
 * by handing it nineteen props. This stands up the three contexts a page
 * expects with a fixed data layer, so a test still says what it means:
 * these entries, these projects, and then assert on what the screen says.
 */
export function makeDataApi(overrides: Partial<DataApi> = {}): DataApi {
  const noop = async () => { /* tests assert on the spies they pass in */ };
  return {
    entries: [],
    projects: [],
    tasks: [],
    loading: false,
    rangeLoading: false,
    isolationBreach: false,
    createEntry: (async () => ({}) as TimeEntry),
    editEntry: (async () => ({}) as TimeEntry),
    deleteEntry: noop,
    refreshEntries: noop,
    addProject: (async () => ({}) as Project),
    editProject: (async () => ({}) as Project),
    archiveProject: noop,
    restoreProject: noop,
    addTask: (async () => ({}) as Task),
    deleteTask: noop,
    renameTask: noop,
    loadTasksForProject: () => { /* no lazy loading in tests */ },
    ...overrides,
  };
}

/** The three providers a page expects, around whatever is being rendered. */
export function wrapWithData(ui: React.ReactElement, api: DataApi): React.ReactElement {
  return (
    <ToastProvider>
      <DataRangeProvider>
        <DataApiProvider value={api}>{ui}</DataApiProvider>
      </DataRangeProvider>
    </ToastProvider>
  );
}

export function renderWithData(
  ui: React.ReactElement,
  data: Partial<DataApi> = {},
): RenderResult & { api: DataApi; rerenderWithData: (ui: React.ReactElement, data?: Partial<DataApi>) => void } {
  const api = makeDataApi(data);
  const result = render(wrapWithData(ui, api));
  return {
    ...result,
    api,
    // Data reaches a page through context, so "the hook applied the edit" is a
    // new provider value rather than a new prop — a plain rerender of the page
    // element wouldn't carry it.
    rerenderWithData: (nextUi, nextData = {}) =>
      result.rerender(wrapWithData(nextUi, makeDataApi({ ...data, ...nextData }))),
  };
}

export const TEST_WORKING_HOURS: WorkingHours = DEFAULT_WORKING_HOURS;
