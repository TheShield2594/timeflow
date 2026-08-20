/**
 * `ratio` is a **billing account/rate identifier**, not a numeric multiplier
 * (#71). It labels which account a project's or entry's time is billed to;
 * `parseRatioInput` accordingly keeps it a non-negative whole number. Nothing
 * may multiply, sum or otherwise do arithmetic with it — a "Weighted total"
 * KPI once did (Σ duration × ratio), which turned an account code like `2`
 * into a plausible-looking but meaningless number of hours on the billing
 * dashboard.
 */
export interface Project {
  id: string;
  name: string;
  color: string;
  description?: string;
  /** Billing account identifier — see the note above; never a multiplier. */
  ratio?: number;
  jiraTicket?: string;
  isActive: boolean;
  createdAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  isActive: boolean;
}

export interface TimeEntry {
  id: string;
  projectId: string;
  taskId?: string;
  description?: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  /** Billing account identifier — see the note on Project.ratio; never a multiplier. */
  ratio?: number;
  jiraTicket?: string;
  date: string;
  userId: string;
  userDisplayName: string;
}

export interface TimerState {
  isRunning: boolean;
  startTime: string | null;
  projectId: string | null;
  taskId: string | null;
  description: string;
  ratio?: number;
  jiraTicket?: string;
  /** Dataverse record ID of the draft entry written on timer start (#15). */
  draftEntryId?: string;
  /** ISO timestamp recorded when a stop attempt fails, enabling retry (#32). */
  pendingStopAt?: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  environmentId: string;
}

/** A meeting pulled from the user's Outlook calendar (read-only overlay). */
export interface OutlookEvent {
  id: string;
  subject: string;
  startTime: string;
  endTime: string;
}
