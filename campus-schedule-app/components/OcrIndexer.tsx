import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { useAllCanvases, useCanvasEditor, useSettings } from "@/context/store";
import { ocrAvailable, recognizeText, stopOcr } from "@/lib/ocr";
import { cleanOcrText, imageFingerprint } from "@/lib/ocrText";

// While "Find text inside images" is on: recognizes text in note images one
// at a time, a few seconds after things settle, and saves it on the image so
// search can find it. Runs on this device only; renders nothing.

const START_DELAY_MS = 3000;
const BETWEEN_IMAGES_MS = 1500;
const MAX_FAILURES_IN_A_ROW = 3;

export function OcrIndexer() {
  const { settings } = useSettings();
  const canvases = useAllCanvases();
  const { updateItem } = useCanvasEditor();
  const enabled = !!settings.imageTextSearch && Platform.OS === "web" && ocrAvailable();

  const latest = useRef({ canvases, updateItem, enabled });
  latest.current = { canvases, updateItem, enabled };
  const running = useRef(false);
  const failed = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) void stopOcr();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const nextJob = () => {
      for (const [canvasId, data] of Object.entries(latest.current.canvases)) {
        for (const it of data.items) {
          if (it.kind !== "image" || !it.uri.startsWith("data:image/") || failed.current.has(it.id)) continue;
          if (it.ocrOf !== imageFingerprint(it.uri)) return { canvasId, item: it };
        }
      }
      return null;
    };
    const work = async () => {
      running.current = true;
      let failuresInARow = 0;
      try {
        while (latest.current.enabled) {
          const job = nextJob();
          if (!job) break;
          try {
            const text = cleanOcrText(await recognizeText(job.item.uri));
            if (!latest.current.enabled) break;
            latest.current.updateItem(job.canvasId, job.item.id, { ocrText: text || undefined, ocrOf: imageFingerprint(job.item.uri) });
            failuresInARow = 0;
          } catch {
            failed.current.add(job.item.id);
            if (++failuresInARow >= MAX_FAILURES_IN_A_ROW) break;
          }
          await new Promise((r) => setTimeout(r, BETWEEN_IMAGES_MS));
        }
      } finally {
        running.current = false;
      }
    };
    const timer = setTimeout(() => {
      if (!running.current) void work();
    }, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, canvases]);

  return null;
}
