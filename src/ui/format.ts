/** "4:05": minutes and seconds, as since a buzz or a waiting time. */
export function formatSince(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "14:32": the local time of day. */
export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
