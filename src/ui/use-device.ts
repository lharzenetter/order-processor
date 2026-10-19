import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

export interface Device {
  /** Started from the Home Screen icon rather than in a browser tab. */
  readonly standalone: boolean;
  /** A Screen Wake Lock is held right now. */
  readonly wakeLockHeld: boolean;
  readonly wakeLockSupported: boolean;
  /** The service worker has a new version waiting for Aktualisieren. */
  readonly updateWaiting: boolean;
  readonly update: () => void;
}

function isStandalone(): boolean {
  // `navigator.standalone` is Safari's own flag for Home Screen web apps.
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true
  );
}

/** The device features the window iPad relies on: Home Screen start, Wake Lock, updates. */
export function useDevice(): Device {
  const [standalone] = useState(isStandalone);
  const [wakeLockHeld, setWakeLockHeld] = useState(false);
  const wakeLockSupported = "wakeLock" in navigator;
  const {
    needRefresh: [updateWaiting],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (!wakeLockSupported) {
      return;
    }
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    async function acquire(): Promise<void> {
      if (document.visibilityState !== "visible" || disposed) {
        return;
      }
      try {
        sentinel = await navigator.wakeLock.request("screen");
        setWakeLockHeld(true);
        sentinel.addEventListener("release", () => {
          setWakeLockHeld(false);
        });
      } catch {
        setWakeLockHeld(false);
      }
    }
    // The browser drops the lock whenever the page is hidden, so it is taken again on return.
    function handleVisibility(): void {
      void acquire();
    }
    void acquire();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      void sentinel?.release();
    };
  }, [wakeLockSupported]);

  return {
    standalone,
    wakeLockHeld,
    wakeLockSupported,
    updateWaiting,
    update() {
      void updateServiceWorker(true);
    },
  };
}
