import type { TimeEntry, Project, Task } from "../types";
import { localDateStr } from "../utils/dates";

function escapeCSV(value: string | number | undefined | null): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  // Neutralize formula injection: a cell starting with =, +, -, @, tab, or CR
  // executes as a formula when the export is opened in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Billing-style duration rounding, applied to the CSV's duration columns only
 * — stored entries are never altered. "up" rules are the timesheet-industry
 * standard (bill at least one increment for any started increment).
 */
export type RoundingRule = "exact" | "up6" | "up15" | "up30" | "nearest15";

export const ROUNDING_LABELS: Record<RoundingRule, string> = {
  exact: "Exact minutes",
  up6: "Round up to 6 min (0.1h)",
  up15: "Round up to 15 min",
  up30: "Round up to 30 min",
  nearest15: "Nearest 15 min",
};

export function applyRounding(minutes: number, rule: RoundingRule): number {
  if (minutes <= 0) return 0;
  switch (rule) {
    case "up6": return Math.ceil(minutes / 6) * 6;
    case "up15": return Math.ceil(minutes / 15) * 15;
    case "up30": return Math.ceil(minutes / 30) * 30;
    case "nearest15": return Math.round(minutes / 15) * 15;
    case "exact": return minutes;
  }
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

export function exportToCSV(
  entries: TimeEntry[],
  projects: Project[],
  tasks: Task[],
  filename = "timeflow-export.csv",
  rounding: RoundingRule = "exact"
): void {
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  const headers = [
    "Date",
    "Start Time",
    "End Time",
    "Duration (minutes)",
    "Duration (hours)",
    "Project",
    "Task",
    "Description",
    "Jira Ticket",
    "Ratio",
    "User",
  ];

  const rows = entries
    .filter((e) => e.endTime) // only completed entries
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((e) => {
      const project = projectMap.get(e.projectId);
      const task = e.taskId ? taskMap.get(e.taskId) : undefined;
      const roundedMinutes = e.durationMinutes !== undefined
        ? applyRounding(e.durationMinutes, rounding)
        : undefined;
      // Defined-check, not truthy: a 0-minute duration exports as "0.00",
      // only a missing duration leaves the cell blank.
      const durationHours = roundedMinutes !== undefined
        ? (roundedMinutes / 60).toFixed(2)
        : "";

      return [
        escapeCSV(e.date),
        escapeCSV(formatDateTime(e.startTime)),
        escapeCSV(formatDateTime(e.endTime)),
        escapeCSV(roundedMinutes),
        escapeCSV(durationHours),
        escapeCSV(project?.name),
        escapeCSV(task?.name),
        escapeCSV(e.description),
        escapeCSV(e.jiraTicket),
        escapeCSV(e.ratio),
        escapeCSV(e.userDisplayName),
      ].join(",");
    });

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function buildExportFilename(from?: string, to?: string): string {
  const today = localDateStr();
  if (from && to) return `timeflow-${from}-to-${to}.csv`;
  return `timeflow-${today}.csv`;
}
