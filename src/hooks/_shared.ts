const TEMP_PREFIX = "temp-";

export function tempId(): string {
  return TEMP_PREFIX + crypto.randomUUID();
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
