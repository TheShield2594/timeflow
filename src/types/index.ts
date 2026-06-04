export interface Project {
  id: string;
  name: string;
  color: string;
  description?: string;
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
  ratio?: number;
  jiraTicket?: string;
  date: string;
  userId: string;
  userDisplayName: string;
  tags?: string[];
}

export interface TimerState {
  isRunning: boolean;
  startTime: string | null;
  projectId: string | null;
  taskId: string | null;
  description: string;
  ratio?: number;
}

export interface DailyReport {
  date: string;
  totalMinutes: number;
  entries: TimeEntry[];
  projectBreakdown: { projectId: string; projectName: string; minutes: number; color: string }[];
}

export interface ProjectReport {
  projectId: string;
  projectName: string;
  color: string;
  totalMinutes: number;
  entryCount: number;
  tasks: { taskId: string; taskName: string; minutes: number }[];
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
}
