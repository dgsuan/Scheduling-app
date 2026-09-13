// Shared guards for single-key keyboard shortcuts (web).

/** True when the key press belongs to a text field, not a shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "range", "button", "submit"].includes(type);
  }
  return !!el.closest("[contenteditable=true]");
}

/** Single-key shortcuts stay quiet while typing, with modifiers, or while a dialog is open. */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return true;
  if (isTypingTarget(e.target)) return true;
  return !!document.querySelector('[role="dialog"], [role="alertdialog"]');
}
