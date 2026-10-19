import type { DeviceStore } from "../storage/index";

/**
 * Saves the event log as JSON through the Share sheet, falling back to a download. Resolves
 * `false` when the staff closed the Share sheet without saving; only a successful export counts
 * as the last export.
 */
export async function exportLog(store: DeviceStore): Promise<boolean> {
  const at = Date.now();
  const contents = JSON.stringify(await store.exportFile(at));
  const file = new File([contents], fileName(at), {
    type: "application/json",
  });
  if (
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return false;
      }
      download(file);
    }
  } else {
    download(file);
  }
  await store.recordExport(at);
  return true;
}

/** Reads a chosen export file as JSON; `undefined` if it is not JSON at all. */
export async function readExportFile(file: File): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(await file.text());
    return parsed;
  } catch {
    return undefined;
  }
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

function fileName(at: number): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `kirbe-pager-${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}
