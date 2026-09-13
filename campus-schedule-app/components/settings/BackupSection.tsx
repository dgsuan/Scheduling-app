import * as DocumentPicker from "expo-document-picker";
import { Download, TriangleAlert, Upload } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SettingsRow, SettingsSection } from "@/components/settings/SettingsSection";
import { useToast } from "@/components/Toaster";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useSettings } from "@/context/store";
import {
  applyBackup,
  backupFilename,
  createBackup,
  estimateStorageBytes,
  hasUndoRestore,
  undoLastRestore,
  validateBackup,
  type BackupFile,
  type BackupSummary,
} from "@/lib/backup";
import { canDownloadFiles, downloadText } from "@/lib/download";
import { reloadApp } from "@/lib/reload";
import { cn } from "@/lib/utils";

/** Browsers typically allow ~5 MB of localStorage per site. */
const STORAGE_BUDGET_BYTES = 5 * 1024 * 1024;

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;

function summaryLines(s: BackupSummary): string {
  const parts = [
    [s.courses, "course"],
    [s.tasks, "task"],
    [s.events, "event"],
    [s.notes, "note"],
    [s.images, "image"],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`)
    .join(", ") || "no items";
}

export function BackupSection() {
  const { toast } = useToast();
  const { storageError } = useSettings();
  const [bytes, setBytes] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [pending, setPending] = useState<{ backup: BackupFile; summary: BackupSummary; name: string } | null>(null);
  const [mode, setMode] = useState<"replace" | "merge">("replace");
  const [busy, setBusy] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);

  useEffect(() => {
    estimateStorageBytes().then(setBytes).catch(() => {});
    hasUndoRestore().then(setCanUndo).catch(() => {});
  }, [storageError]);

  const exportBackup = async () => {
    const backup = await createBackup();
    const ok = downloadText(backupFilename(), JSON.stringify(backup, null, 2));
    if (ok) toast({ message: "Backup downloaded", description: backupFilename() });
  };

  const pickFile = async () => {
    setErrors(null);
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/json", ".json"], copyToCacheDirectory: false });
    if (res.canceled) return;
    const asset = res.assets[0];
    let text: string;
    try {
      text = asset.file ? await asset.file.text() : await (await fetch(asset.uri)).text();
    } catch {
      setErrors(["Couldn't read that file."]);
      return;
    }
    const result = validateBackup(text);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setMode("replace");
    setPending({ backup: result.backup, summary: result.summary, name: asset.name });
  };

  const restore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await applyBackup(pending.backup, mode);
      setPending(null);
      if (!(await reloadApp())) toast({ message: "Backup restored", description: "Restart the app to see your restored data.", duration: 0 });
    } catch {
      setPending(null);
      setErrors(["Restoring failed — most likely storage is full. Nothing was changed."]);
    } finally {
      setBusy(false);
    }
  };

  const used = bytes ?? 0;
  const pct = Math.min(1, used / STORAGE_BUDGET_BYTES);

  return (
    <SettingsSection title="Backup" description="Everything lives on this device. Export a file now and then, and restore it on any browser.">
      <SettingsRow
        label="Storage used"
        hint={bytes == null ? "Measuring…" : `About ${mb(used)} of roughly ${mb(STORAGE_BUDGET_BYTES)} available to this site. Images take the most space.`}
        stacked
      >
        <View className="bg-muted h-1.5 overflow-hidden rounded-full" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
          <View className={cn("h-full rounded-full", pct > 0.85 ? "bg-destructive" : pct > 0.6 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.max(2, pct * 100)}%` }} />
        </View>
        {storageError ? (
          <Text className="text-destructive text-sm" role="alert">
            {storageError}
          </Text>
        ) : null}
      </SettingsRow>

      <SettingsRow
        label="Export backup"
        hint={canDownloadFiles ? "Courses, tasks, events, notes (with images), grades and settings in one .json file." : "Available in the web version."}
      >
        <Button size="sm" onPress={exportBackup} disabled={!canDownloadFiles}>
          <Icon as={Download} size={14} className="text-primary-foreground" />
          <Text>Export backup</Text>
        </Button>
      </SettingsRow>

      <SettingsRow label="Restore from file" hint="You'll see what's inside and confirm before anything changes." last={!canUndo} stacked>
        <View className="flex-row flex-wrap gap-2">
          <Button size="sm" variant="outline" onPress={pickFile}>
            <Icon as={Upload} size={14} />
            <Text>Choose backup file…</Text>
          </Button>
        </View>
        {errors ? (
          <View className="border-destructive/40 bg-destructive/10 gap-1 rounded-lg border p-3" role="alert">
            <View className="flex-row items-center gap-2">
              <Icon as={TriangleAlert} size={15} className="text-destructive" />
              <Text className="text-sm font-semibold">This file can't be restored</Text>
            </View>
            {errors.map((e) => (
              <Text key={e} className="text-muted-foreground font-mono text-xs">
                {e}
              </Text>
            ))}
            <Text className="text-muted-foreground text-xs">Your current data wasn't changed.</Text>
          </View>
        ) : null}
      </SettingsRow>

      {canUndo ? (
        <SettingsRow label="Undo last restore" hint="Put back the data you had before your most recent restore." last>
          <Button size="sm" variant="ghost" onPress={() => setConfirmUndo(true)}>
            <Text>Undo restore</Text>
          </Button>
        </SettingsRow>
      ) : null}

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? `${pending.name} — ${summaryLines(pending.summary)}${pending.summary.exportedAt ? `, saved ${new Date(pending.summary.exportedAt).toLocaleString()}` : ""}.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <View className="gap-2">
            <SegmentedControl
              value={mode}
              onChange={setMode}
              options={[
                { value: "replace", label: "Replace" },
                { value: "merge", label: "Merge" },
              ]}
              accessibilityLabel="Restore mode"
            />
            <Text className="text-muted-foreground text-sm leading-5">
              {mode === "replace"
                ? "Your current courses, tasks, notes and settings will be replaced by the backup. Your appearance settings are kept if the file has none."
                : "Items from the backup are added; anything you already have is kept as it is, including your settings."}
            </Text>
            <Text className="text-muted-foreground text-xs">You can undo this afterwards from this screen.</Text>
          </View>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              <Text>Cancel</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              onPress={restore}
              disabled={busy}
              className={mode === "replace" ? "bg-destructive web:hover:bg-destructive/90" : undefined}
            >
              <Text className={mode === "replace" ? "text-white" : undefined}>
                {busy ? "Restoring…" : mode === "replace" ? "Replace my data" : "Merge"}
              </Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDialog
        open={confirmUndo}
        onOpenChange={setConfirmUndo}
        title="Undo the last restore?"
        description="Your data goes back to how it was right before the restore. Changes made since then will be lost."
        confirmLabel="Undo restore"
        onConfirm={async () => {
          setConfirmUndo(false);
          await undoLastRestore();
          await reloadApp();
        }}
      />
    </SettingsSection>
  );
}
