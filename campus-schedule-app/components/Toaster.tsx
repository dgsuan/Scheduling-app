import { X } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { PopIn } from "@/components/PopIn";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { cn } from "@/lib/utils";

// Small toast stack for feedback that shouldn't interrupt: "Task deleted ·
// Undo", in-app reminders, save failures. Announced politely to screen
// readers; each toast auto-dismisses unless it's marked persistent.

export type ToastOptions = {
  message: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** ms; 0 keeps it until dismissed. */
  duration?: number;
  tone?: "default" | "danger";
  /** Replaces an existing toast with the same id instead of stacking. */
  id?: string;
};

type Toast = ToastOptions & { id: string };

const DEFAULT_DURATION = 5000;
const MAX_VISIBLE = 3;

const ToastContext = createContext<{
  toast: (t: ToastOptions) => string;
  dismiss: (id: string) => void;
} | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (opts: ToastOptions) => {
      const id = opts.id ?? `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.filter((t) => t.id !== id), { ...opts, id }].slice(-MAX_VISIBLE));
      clearTimeout(timers.current.get(id));
      const duration = opts.duration ?? DEFAULT_DURATION;
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const { wide } = useBreakpoint();
  return (
    <View
      pointerEvents="box-none"
      aria-live="polite"
      style={{
        position: Platform.OS === "web" ? ("fixed" as "absolute") : "absolute",
        left: 0,
        right: 0,
        bottom: wide ? 24 : 84,
        alignItems: "center",
        paddingHorizontal: 16,
        gap: 8,
        zIndex: 100,
      }}
    >
      {toasts.map((t) => (
        <PopIn key={t.id} offsetY={8} style={{ width: "100%", maxWidth: 440 }}>
          <View
            role="status"
            className={cn(
              "bg-foreground flex-row items-center gap-3 rounded-xl py-2.5 pl-4 pr-2 shadow-lg shadow-black/20",
              t.tone === "danger" && "bg-destructive"
            )}
          >
            <View className="flex-1 py-0.5">
              <Text className="text-background text-sm font-medium">{t.message}</Text>
              {t.description ? <Text className="text-background/75 text-xs">{t.description}</Text> : null}
            </View>
            {t.actionLabel ? (
              <Pressable
                onPress={() => {
                  t.onAction?.();
                  onDismiss(t.id);
                }}
                accessibilityRole="button"
                className="rounded-md px-3 py-1.5 web:transition-colors web:hover:bg-background/15 active:bg-background/20"
              >
                <Text className={cn("text-sm font-semibold", t.tone === "danger" ? "text-white" : "text-primary-foreground")}>
                  {t.actionLabel}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => onDismiss(t.id)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              hitSlop={8}
              className="rounded-md p-1.5 web:transition-colors web:hover:bg-background/15"
            >
              <Icon as={X} size={14} className="text-background/70" />
            </Pressable>
          </View>
        </PopIn>
      ))}
    </View>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
