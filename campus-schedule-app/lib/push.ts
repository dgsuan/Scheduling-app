// Background (push) reminders are web-only for now; see push.web.ts.

export type PushSupport = "ok" | "no-key" | "unsupported";

export function pushSupport(): PushSupport {
  return "unsupported";
}

export function pushActiveHere(): boolean {
  return false;
}

export async function enablePush(): Promise<void> {
  throw new Error("Background reminders aren't available in this version of the app.");
}

export async function disablePush(): Promise<void> {}
