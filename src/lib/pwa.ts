/**
 * PWA plumbing: service worker registration + update detection, persistent storage,
 * and the install prompt. The module attaches its window listeners on import, so
 * importing it early (main.tsx does, via registerServiceWorker) means a
 * `beforeinstallprompt` fired before React mounts is not lost.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/* ── tiny external store ───────────────────────────────────────── */

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

const hasWindow = typeof window !== 'undefined';

/* ── Service worker + updates ──────────────────────────────────── */

const updateStore = createStore<ServiceWorker | null>(null);
let reloadingForUpdate = false;

function watchRegistration(reg: ServiceWorkerRegistration, onUpdate?: (reg: ServiceWorkerRegistration) => void) {
  const announce = (worker: ServiceWorker | null) => {
    if (!worker) return;
    updateStore.set(worker);
    onUpdate?.(reg);
  };
  // A previous visit may have left a worker waiting.
  if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);

  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      // `controller` is null on the very first install: nothing to "update" then.
      if (installing.state === 'installed' && navigator.serviceWorker.controller) announce(installing);
    });
  });
}

/**
 * Registers /sw.js (production builds only). Returns the registration, or null when
 * unsupported / in dev. `onUpdate` fires when a new version is installed and waiting.
 */
export async function registerServiceWorker(opts: {
  onUpdate?: (reg: ServiceWorkerRegistration) => void;
} = {}): Promise<ServiceWorkerRegistration | null> {
  if (!hasWindow || !import.meta.env.PROD || !('serviceWorker' in navigator)) return null;

  const register = async (): Promise<ServiceWorkerRegistration | null> => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      watchRegistration(reg, opts.onUpdate);

      // Look for new versions hourly and whenever the app returns to the foreground.
      const check = () => {
        reg.update().catch(() => undefined);
      };
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadingForUpdate) window.location.reload();
      });
      return reg;
    } catch {
      return null; // private mode, blocked, etc. — the app works fine without it
    }
  };

  if (document.readyState === 'complete') return register();
  return new Promise((resolve) => window.addEventListener('load', () => resolve(register()), { once: true }));
}

/** Tells the waiting worker to take over; the page reloads once it does. */
export function applyUpdate(): void {
  const worker = updateStore.get();
  if (!worker) {
    if (hasWindow) window.location.reload();
    return;
  }
  reloadingForUpdate = true;
  worker.postMessage({ type: 'SKIP_WAITING' });
  // Safety net if controllerchange never fires.
  setTimeout(() => window.location.reload(), 4000);
}

export function dismissUpdate(): void {
  updateStore.set(null);
}

/** True while a new app version is installed and waiting to be activated. */
export function useUpdateAvailable(): { available: boolean; apply: () => void; dismiss: () => void } {
  const worker = useSyncExternalStore(updateStore.subscribe, updateStore.get, () => null);
  return { available: worker !== null, apply: applyUpdate, dismiss: dismissUpdate };
}

/* ── Persistent storage ────────────────────────────────────────── */

export interface StorageStatus {
  supported: boolean;
  persisted: boolean;
  /** bytes */
  usage: number | null;
  quota: number | null;
}

export async function requestPersistentStorage(): Promise<StorageStatus> {
  const status: StorageStatus = { supported: false, persisted: false, usage: null, quota: null };
  if (typeof navigator === 'undefined' || !navigator.storage) return status;
  status.supported = true;
  try {
    status.persisted = (await navigator.storage.persisted?.()) ?? false;
    if (!status.persisted && navigator.storage.persist) status.persisted = await navigator.storage.persist();
  } catch {
    /* denied or unsupported — report as not persisted */
  }
  try {
    const est = await navigator.storage.estimate?.();
    status.usage = est?.usage ?? null;
    status.quota = est?.quota ?? null;
  } catch {
    /* ignore */
  }
  return status;
}

/* ── Install prompt ────────────────────────────────────────────── */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const deferredStore = createStore<BeforeInstallPromptEvent | null>(null);
const installedStore = createStore<boolean>(false);

export function isStandalone(): boolean {
  if (!hasWindow) return false;
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/** iPhone / iPad Safari (incl. iPadOS reporting as Mac): no install event, manual "Add to Home Screen". */
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iosDevice = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webkitOnly = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return iosDevice && webkitOnly;
}

if (hasWindow) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own, less intrusive UI
    deferredStore.set(e as BeforeInstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => {
    deferredStore.set(null);
    installedStore.set(true);
  });
}

export interface InstallPromptState {
  /** Chromium-style one-click install is available. */
  canInstall: boolean;
  /** iOS Safari, not yet installed: show "Share -> Add to Home Screen" instructions. */
  showIosHint: boolean;
  installed: boolean;
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

export function useInstallPrompt(): InstallPromptState {
  const deferred = useSyncExternalStore(deferredStore.subscribe, deferredStore.get, () => null);
  const justInstalled = useSyncExternalStore(installedStore.subscribe, installedStore.get, () => false);
  const [standalone, setStandalone] = useState(isStandalone);

  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: standalone)');
    if (!mq) return;
    const onChange = () => setStandalone(isStandalone());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const install = useCallback(async () => {
    const evt = deferredStore.get();
    if (!evt) return 'unavailable' as const;
    try {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      deferredStore.set(null); // a prompt event is single-use
      return outcome;
    } catch {
      return 'unavailable' as const;
    }
  }, []);

  const installed = standalone || justInstalled;
  return {
    canInstall: deferred !== null && !installed,
    showIosHint: !installed && deferred === null && isIosSafari(),
    installed,
    install,
  };
}
