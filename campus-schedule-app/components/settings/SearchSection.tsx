import { useMemo } from "react";
import { Platform } from "react-native";

import { SettingsSection, SettingsToggleRow } from "@/components/settings/SettingsSection";
import { useAllCanvases, useSettings } from "@/context/store";
import { ocrAvailable } from "@/lib/ocr";
import { imageFingerprint } from "@/lib/ocrText";

// Search options: finding text inside note images (on-device OCR).

export function SearchSection() {
  const { settings, updateSettings } = useSettings();
  const canvases = useAllCanvases();
  const supported = Platform.OS === "web" && ocrAvailable();

  const { total, done } = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const data of Object.values(canvases)) {
      for (const it of data.items) {
        if (it.kind !== "image" || !it.uri.startsWith("data:image/")) continue;
        total++;
        if (it.ocrOf === imageFingerprint(it.uri)) done++;
      }
    }
    return { total, done };
  }, [canvases]);

  const on = !!settings.imageTextSearch;
  const progress = !on
    ? ""
    : total === 0
      ? " No images in your notes yet."
      : done === total
        ? ` All ${total} image${total === 1 ? "" : "s"} searchable.`
        : ` ${done} of ${total} images done — the rest are read in the background while the app is open.`;

  return (
    <SettingsSection title="Search" description="What Ctrl+K search looks through, besides tasks, events, notes and courses.">
      <SettingsToggleRow
        label="Find text inside images"
        hint={
          supported
            ? `Reads printed text in photos of slides and board notes, on this device, so search can find it. The first time, this downloads the recognition engine (about 10 MB). English only.${progress}`
            : "Not available in this browser."
        }
        checked={on}
        disabled={!supported}
        onChange={(imageTextSearch) => updateSettings({ imageTextSearch })}
        last
      />
    </SettingsSection>
  );
}
