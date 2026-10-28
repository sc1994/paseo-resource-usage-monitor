import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const gpuDeviceSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string(),
  utilizationPercent: z.number().nullable(),
  memoryUsedBytes: z.number().nullable(),
  memoryTotalBytes: z.number().nullable(),
});

const sampleSchema = z.object({
  at: z.number(),
  cpuPercent: z.number(),
  memoryPercent: z.number(),
  diskPercent: z.number().nullable(),
  rxBytesPerSec: z.number(),
  txBytesPerSec: z.number(),
  gpus: z.array(gpuDeviceSchema),
});

const diskSchema = z.object({
  mount: z.string(),
  device: z.string(),
  fsType: z.string(),
  totalBytes: z.number(),
  usedBytes: z.number(),
  /** Free space an unprivileged user can still write; excludes blocks reserved for root. */
  availableBytes: z.number(),
});

const memorySchema = z.object({
  totalBytes: z.number(),
  /** Memory in use and not reclaimable: what the RAM percentage shows. */
  usedBytes: z.number(),
  /** macOS: cached files the system can drop at once, counted as neither used nor free. */
  cachedBytes: z.number().nullable(),
  /** macOS: the kernel's memory pressure level; when present it, not the percentage, sets the color. */
  pressure: z.enum(["normal", "warning", "critical"]).nullable(),
});

export const hostStatsRpc = defineRpc({
  name: "host.stats",
  input: z.object({}),
  output: z.object({
    hostname: z.string(),
    platform: z.string(),
    uptimeSeconds: z.number(),
    cpuCount: z.number(),
    cpuModel: z.string(),
    loadAverage: z.tuple([z.number(), z.number(), z.number()]),
    memory: memorySchema,
    gpu: z.object({
      devices: z.array(gpuDeviceSchema),
      reason: z.string().nullable(),
    }),
    network: z
      .object({ rxTotalBytes: z.number(), txTotalBytes: z.number() })
      .nullable(),
    disks: z.array(diskSchema),
    sampleIntervalMs: z.number(),
    current: sampleSchema,
    history: z.array(sampleSchema),
  }),
});

export type HostSample = z.infer<typeof sampleSchema>;
export type DiskUsage = z.infer<typeof diskSchema>;
export type MemoryUsage = z.infer<typeof memorySchema>;
export type MemoryPressure = NonNullable<MemoryUsage["pressure"]>;

export function gpuHistory(samples: readonly HostSample[], index: number): {
  utilizationPercent: (number | null)[];
  memoryPercent: (number | null)[];
} {
  const utilizationPercent: (number | null)[] = [];
  const memoryPercent: (number | null)[] = [];
  for (const sample of samples) {
    const gpu = sample.gpus.find((device) => device.index === index);
    utilizationPercent.push(gpu?.utilizationPercent ?? null);
    memoryPercent.push(gpu && gpu.memoryUsedBytes !== null && gpu.memoryTotalBytes !== null && gpu.memoryTotalBytes > 0
      ? (gpu.memoryUsedBytes / gpu.memoryTotalBytes) * 100
      : null);
  }
  return { utilizationPercent, memoryPercent };
}

/** Like df: the share of the space a user can fill, excluding blocks reserved for root. */
export function diskPercent(disk: Pick<DiskUsage, "usedBytes" | "availableBytes">): number {
  const usable = disk.usedBytes + disk.availableBytes;
  return usable > 0 ? (disk.usedBytes / usable) * 100 : 0;
}

/** All disks added together, as one figure for the sidebar. */
export function sumDisks(disks: readonly DiskUsage[]) {
  const sum = { totalBytes: 0, usedBytes: 0, availableBytes: 0 };
  for (const disk of disks) {
    sum.totalBytes += disk.totalBytes;
    sum.usedBytes += disk.usedBytes;
    sum.availableBytes += disk.availableBytes;
  }
  return { ...sum, percent: diskPercent(sum) };
}
