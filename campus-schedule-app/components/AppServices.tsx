import { useEffect } from "react";
import { Platform } from "react-native";

import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { ReminderEngine } from "@/components/ReminderEngine";
import { FocusBar } from "@/context/focus";
import { useToast } from "@/components/Toaster";
import { useSettings } from "@/context/store";
import { registerServiceWorker } from "@/lib/pwa";

// Background pieces that render nothing (or only overlays): the reminder
// timer, service worker registration, and a toast when saving fails.

function StorageErrorWatcher() {
  const { storageError } = useSettings();
  const { toast } = useToast();
  useEffect(() => {
    if (storageError) toast({ id: "storage-error", message: "Changes not saved", description: storageError, tone: "danger", duration: 0 });
  }, [storageError, toast]);
  return null;
}

export function AppServices() {
  useEffect(() => {
    if (Platform.OS === "web") registerServiceWorker();
  }, []);
  return (
    <>
      <ReminderEngine />
      <StorageErrorWatcher />
      <KeyboardShortcuts />
      <FocusBar />
    </>
  );
}
