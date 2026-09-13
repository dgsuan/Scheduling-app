import * as Updates from "expo-updates";

/** Reload so every provider re-reads storage. False if the app must be restarted manually. */
export async function reloadApp(): Promise<boolean> {
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    return false; // e.g. development builds
  }
}
