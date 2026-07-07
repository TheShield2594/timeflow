const TEMP_PREFIX = "temp-";

export function tempId(): string {
  return TEMP_PREFIX + crypto.randomUUID();
}

export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_PREFIX);
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
