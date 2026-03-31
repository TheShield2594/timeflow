import type { TimeEntry, Project, Task } from "../types";

function escapeCSV(value: string | number | undefined | null): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
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
  filename = "timeflow-export.csv"
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
    "User",
  ];

  const rows = entries
    .filter((e) => e.endTime) // only completed entries
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((e) => {
      const project = projectMap.get(e.projectId);
      const task = e.taskId ? taskMap.get(e.taskId) : undefined;
      const durationHours = e.durationMinutes
        ? (e.durationMinutes / 60).toFixed(2)
        : "";

      return [
        escapeCSV(e.date),
        escapeCSV(formatDateTime(e.startTime)),
        escapeCSV(formatDateTime(e.endTime)),
        escapeCSV(e.durationMinutes),
        escapeCSV(durationHours),
        escapeCSV(project?.name),
        escapeCSV(task?.name),
        escapeCSV(e.description),
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
  const today = new Date().toISOString().split("T")[0];
  if (from && to) return `timeflow-${from}-to-${to}.csv`;
  return `timeflow-${today}.csv`;
}
