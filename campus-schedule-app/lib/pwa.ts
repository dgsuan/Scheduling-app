// Native builds are already installed apps; the web version is pwa.web.ts.
// Signatures match the web module so shared code typechecks the same way.

export function isStandalone(): boolean {
  return true;
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  return Promise.resolve(null);
}

export function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  return Promise.resolve(null);
}

export function useInstallPrompt() {
  return { supported: false, installed: true, canPrompt: false, ios: false, prompt: async () => false };
}
