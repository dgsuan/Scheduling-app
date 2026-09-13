import { useEffect, useState } from "react";

// Installable web app: registers the service worker (next to the manifest,
// so it works under the GitHub Pages base path) and exposes the browser's
// install prompt to the Settings screen.

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

/** Register once. Skipped in development and where unsupported. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return registration;
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (__DEV__ || !("serviceWorker" in navigator) || !manifest) {
    registration = Promise.resolve(null);
    return registration;
  }
  const swUrl = new URL("sw.js", manifest.href).href;
  registration = navigator.serviceWorker.register(swUrl).catch(() => null);
  return registration;
}

export function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  return registerServiceWorker().then((r) => r ?? navigator.serviceWorker.getRegistration().then((x) => x ?? null));
}

export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return {
    supported: true,
    installed: isStandalone(),
    canPrompt: !!deferredPrompt,
    ios: isIOS(),
    prompt: async () => {
      if (!deferredPrompt) return false;
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      notify();
      return choice.outcome === "accepted";
    },
  };
}
