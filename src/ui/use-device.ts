import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import type { UpdateCheck } from "./update-row";

export interface Device {
  /** Started from the Home Screen icon rather than in a browser tab. */
  readonly standalone: boolean;
  /** A Screen Wake Lock is held right now. */
  readonly wakeLockHeld: boolean;
  readonly wakeLockSupported: boolean;
  /** The service worker has a new version waiting for Aktualisieren. */
  readonly updateWaiting: boolean;
  /** The waiting version's number, when version.json could be fetched. */
  readonly waitingVersion: string | null;
  readonly updateCheck: UpdateCheck;
  readonly checkForUpdate: () => void;
  readonly update: () => void;
}

function isStandalone(): boolean {
  // `navigator.standalone` is Safari's own flag for Home Screen web apps.
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true
  );
}

// version.json is left out of the precache, so it always comes from the deploy whose worker is
// waiting, not from the running build.
async function fetchWaitingVersion(): Promise<string | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json`, {
      cache: "no-store",
    });
    const body: unknown = await response.json();
    return typeof body === "object" &&
      body !== null &&
      "version" in body &&
      typeof body.version === "string"
      ? body.version
      : null;
  } catch {
    return null;
  }
}

function untilInstalled(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve, reject) => {
    function handleStateChange(): void {
      if (worker.state === "installed" || worker.state === "activated") {
        worker.removeEventListener("statechange", handleStateChange);
        resolve();
      } else if (worker.state === "redundant") {
        worker.removeEventListener("statechange", handleStateChange);
        reject(new Error("The new service worker failed to install"));
      }
    }
    worker.addEventListener("statechange", handleStateChange);
    handleStateChange();
  });
}

/** The device features the window iPad relies on: Home Screen start, Wake Lock, updates. */
export function useDevice(): Device {
  const [standalone] = useState(isStandalone);
  const [wakeLockHeld, setWakeLockHeld] = useState(false);
  const wakeLockSupported = "wakeLock" in navigator;
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck>({
    phase: "idle",
  });
  const [waitingVersion, setWaitingVersion] = useState<string | null>(null);
  const {
    needRefresh: [updateWaiting],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registered) {
      if (registered !== undefined) {
        setRegistration(registered);
      }
    },
  });

  useEffect(() => {
    if (!updateWaiting) {
      return;
    }
    let disposed = false;
    void fetchWaitingVersion().then((version) => {
      if (!disposed) {
        setWaitingVersion(version);
      }
    });
    return () => {
      disposed = true;
    };
  }, [updateWaiting]);

  async function runUpdateCheck(): Promise<void> {
    setUpdateCheck({ phase: "checking" });
    try {
      if (registration === null) {
        throw new Error("No service worker to check with");
      }
      await registration.update();
      // Aktualisieren is offered only once the new version is fully downloaded.
      if (registration.installing !== null) {
        await untilInstalled(registration.installing);
      }
      setUpdateCheck(
        registration.waiting === null
          ? { phase: "current", checkedAt: Date.now() }
          : { phase: "idle" },
      );
    } catch {
      setUpdateCheck({ phase: "failed" });
    }
  }

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
    waitingVersion: updateWaiting ? waitingVersion : null,
    updateCheck,
    checkForUpdate() {
      void runUpdateCheck();
    },
    update() {
      void updateServiceWorker(true);
    },
  };
}
