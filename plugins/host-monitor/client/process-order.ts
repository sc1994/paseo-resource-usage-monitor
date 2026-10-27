import type { ProcessUsage } from "../shared/processes";

export type SortKey = "cpu" | "memory" | "gpu" | "gpuMemory" | "network" | "download" | "upload";
export type SortDirection = "asc" | "desc";

export type ProcessResources = Pick<ProcessUsage, "cpuPercent" | "memoryBytes" | "gpuPercent" | "gpuMemoryBytes" | "rxBytesPerSec" | "txBytesPerSec">;
export type ProcessGroup = { name: string; members: ProcessUsage[]; usage: ProcessResources; partial: ReadonlySet<keyof ProcessResources> };

export function networkTotal(process: Pick<ProcessResources, "rxBytesPerSec" | "txBytesPerSec">): number | null {
  return process.rxBytesPerSec === null || process.txBytesPerSec === null
    ? null
    : process.rxBytesPerSec + process.txBytesPerSec;
}

function value(process: ProcessResources, key: SortKey): number | null {
  if (key === "cpu") return process.cpuPercent;
  if (key === "memory") return process.memoryBytes;
  if (key === "network") return networkTotal(process);
  if (key === "download") return process.rxBytesPerSec;
  if (key === "upload") return process.txBytesPerSec;
  return key === "gpuMemory" ? process.gpuMemoryBytes : process.gpuPercent;
}

function compareResources(a: ProcessResources, b: ProcessResources, key: SortKey, direction: SortDirection): number {
  const left = value(a, key);
  const right = value(b, key);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === "asc" ? left - right : right - left;
}

export function orderProcesses(
  processes: readonly ProcessUsage[], key: SortKey, direction: SortDirection,
): ProcessUsage[] {
  return [...processes].sort((a, b) => compareResources(a, b, key, direction) || a.pid - b.pid);
}

export function groupProcesses(
  processes: readonly ProcessUsage[], key: SortKey, direction: SortDirection,
): ProcessGroup[] {
  const byName = new Map<string, ProcessUsage[]>();
  for (const process of processes) {
    const members = byName.get(process.name);
    if (members) members.push(process);
    else byName.set(process.name, [process]);
  }
  const fields: (keyof ProcessResources)[] = ["cpuPercent", "memoryBytes", "gpuPercent", "gpuMemoryBytes", "rxBytesPerSec", "txBytesPerSec"];
  const groups: ProcessGroup[] = [];
  for (const [name, members] of byName) {
    const usage: ProcessResources = { cpuPercent: null, memoryBytes: null, gpuPercent: null, gpuMemoryBytes: null, rxBytesPerSec: null, txBytesPerSec: null };
    const partial = new Set<keyof ProcessResources>();
    for (const field of fields) {
      let missing = false;
      for (const member of members) {
        const amount = member[field];
        if (amount === null) missing = true;
        else usage[field] = (usage[field] ?? 0) + amount;
      }
      if (missing && usage[field] !== null) partial.add(field);
    }
    groups.push({ name, members, usage, partial });
  }
  return groups.sort((a, b) => compareResources(a.usage, b.usage, key, direction) || a.name.localeCompare(b.name));
}
