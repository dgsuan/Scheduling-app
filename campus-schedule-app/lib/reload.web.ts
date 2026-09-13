/** Reload so every provider re-reads storage. */
export async function reloadApp(): Promise<boolean> {
  window.location.reload();
  return true;
}
