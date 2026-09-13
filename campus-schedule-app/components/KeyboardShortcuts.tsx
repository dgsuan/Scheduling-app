import { router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

import { useCommandPalette } from "@/components/CommandPalette";
import { shouldIgnoreShortcut } from "@/lib/shortcuts";

// Desktop shortcuts: Ctrl/⌘+K search (works anywhere), "/" search,
// N new task, T today in Calendar. Single keys never fire while typing
// or while a dialog is open. Calendar arrow keys live in that screen.

export function KeyboardShortcuts() {
  const { toggle, setOpen } = useCommandPalette();

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
        return;
      }
      if (shouldIgnoreShortcut(e)) return;
      const key = e.key.toLowerCase();
      if (key === "/") {
        e.preventDefault();
        setOpen(true);
      } else if (key === "n") {
        e.preventDefault();
        router.navigate({ pathname: "/tasks", params: { new: "1" } });
      } else if (key === "t") {
        e.preventDefault();
        router.navigate({ pathname: "/calendar", params: { today: "1" } });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, setOpen]);

  return null;
}
