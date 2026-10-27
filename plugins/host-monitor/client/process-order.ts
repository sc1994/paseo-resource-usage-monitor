import type { ProcessUsage } from "../shared/processes";

export type SortKey = "cpu" | "memory" | "gpu" | "gpuMemory" | "network" | "download" | "upload";
export type SortDirection = "asc" | "desc";

export function networkTotal(process: ProcessUsage): number | null {
  return process.rxBytesPerSec === null || process.txBytesPerSec === null
    ? null
    : process.rxBytesPerSec + process.txBytesPerSec;
}

function value(process: ProcessUsage, key: SortKey): number | null {
  if (key === "cpu") return process.cpuPercent;
  if (key === "memory") return process.memoryBytes;
  if (key === "network") return networkTotal(process);
  if (key === "download") return process.rxBytesPerSec;
  if (key === "upload") return process.txBytesPerSec;
  return key === "gpuMemory" ? process.gpuMemoryBytes : process.gpuPercent;
}

export function orderProcesses(
  processes: readonly ProcessUsage[], key: SortKey, direction: SortDirection,
): ProcessUsage[] {
  return [...processes].sort((a, b) => {
    const left = value(a, key);
    const right = value(b, key);
    if (left === null && right === null) return a.pid - b.pid;
    if (left === null) return 1;
    if (right === null) return -1;
    return (direction === "asc" ? left - right : right - left) || a.pid - b.pid;
  });
}
