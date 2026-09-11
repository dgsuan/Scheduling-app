import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * Current time, refreshed on `stepMs` boundaries (default: each minute,
 * right as the clock's minute changes) and whenever the app returns to
 * the foreground. One timeout per consumer, no busy polling.
 */
export function useNow(stepMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      clearTimeout(timer);
      const d = new Date();
      setNow(d);
      timer = setTimeout(tick, stepMs - (d.getTime() % stepMs) + 50);
    };
    tick();
    const sub = AppState.addEventListener("change", (s) => s === "active" && tick());
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [stepMs]);
  return now;
}
