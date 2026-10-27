import test from "node:test";
import assert from "node:assert/strict";
import { parseHostGpu } from "./sampler.ts";

test("主机 GPU 独立解析零值、缺测和 MiB", () => {
  const devices = parseHostGpu("0, GPU A, 0, 0, 12282\n1, GPU B, N/A, N/A, 16\n2, GPU C, 101, -1, invalid\n");
  assert.deepEqual(devices, [
    { index: 0, name: "GPU A", utilizationPercent: 0, memoryUsedBytes: 0, memoryTotalBytes: 12282 * 1024 * 1024 },
    { index: 1, name: "GPU B", utilizationPercent: null, memoryUsedBytes: null, memoryTotalBytes: 16 * 1024 * 1024 },
    { index: 2, name: "GPU C", utilizationPercent: null, memoryUsedBytes: null, memoryTotalBytes: null },
  ]);
});
