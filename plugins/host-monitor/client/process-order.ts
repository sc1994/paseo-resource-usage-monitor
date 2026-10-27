import type { GpuMode, ProcessUsage } from "../shared/processes";

export type SortKey = "cpu" | "memory" | "gpu" | "network";
export type SortDirection = "asc" | "desc";

export function networkTotal(process: ProcessUsage): number | null {
  return process.rxBytesPerSec === null || process.txBytesPerSec === null
    ? null
    : process.rxBytesPerSec + process.txBytesPerSec;
}

function value(process: ProcessUsage, key: SortKey, gpuMode: GpuMode): number | null {
  if (key === "cpu") return process.cpuPercent;
  if (key === "memory") return process.memoryBytes;
  if (key === "network") return networkTotal(process);
  if (gpuMode === "memory") return process.gpuMemoryBytes;
  return gpuMode === "utilization" ? process.gpuPercent : null;
}

export function orderProcesses(
  processes: readonly ProcessUsage[], key: SortKey, direction: SortDirection, gpuMode: GpuMode,
): ProcessUsage[] {
  return [...processes].sort((a, b) => {
    const left = value(a, key, gpuMode);
    const right = value(b, key, gpuMode);
    if (left === null && right === null) return a.pid - b.pid;
    if (left === null) return 1;
    if (right === null) return -1;
    return (direction === "asc" ? left - right : right - left) || a.pid - b.pid;
  });
}
