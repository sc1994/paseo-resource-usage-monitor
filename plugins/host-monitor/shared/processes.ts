import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const processUsageSchema = z.object({
  pid: z.number().int().positive(),
  startTime: z.string().regex(/^\d+$/),
  name: z.string(),
  user: z.string(),
  command: z.string(),
  cpuPercent: z.number().nullable(),
  gpuPercent: z.number().nullable(),
  gpuMemoryBytes: z.number().nullable(),
  rxBytesPerSec: z.number().nullable(),
  txBytesPerSec: z.number().nullable(),
  canTerminate: z.boolean(),
  protectionReason: z.string().nullable(),
});

const capabilitySchema = z.object({ available: z.boolean(), reason: z.string().nullable() });
const gpuModeSchema = z.enum(["utilization", "memory", "unavailable"]);
const processStatsSchema = z.object({
  sampledAt: z.number(),
  intervalMs: z.number(),
  processes: z.array(processUsageSchema),
  capabilities: z.object({
    cpu: capabilitySchema,
    gpu: z.object({ mode: gpuModeSchema, reason: z.string().nullable() }),
    network: capabilitySchema,
    release: capabilitySchema,
  }),
});

const terminateResultSchema = z.object({
  status: z.enum(["terminated", "already_exited", "permission_denied", "protected", "identity_changed", "still_running", "unavailable", "error"]),
  message: z.string(),
});

export const processStatsRpc = defineRpc({
  name: "host.processes",
  input: z.object({}),
  output: processStatsSchema,
});

export const terminateProcessRpc = defineRpc({
  name: "host.process.terminate",
  input: z.object({ pid: z.number().int().gt(1), startTime: z.string().regex(/^\d+$/) }),
  output: terminateResultSchema,
});

export type ProcessUsage = z.infer<typeof processUsageSchema>;
export type ProcessStats = z.infer<typeof processStatsSchema>;
export type TerminateResult = z.infer<typeof terminateResultSchema>;
export type GpuMode = z.infer<typeof gpuModeSchema>;
