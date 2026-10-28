import test from "node:test";
import assert from "node:assert/strict";
import { parseHostGpu } from "./sampler.ts";
import { diskPercent, gpuHistory, sumDisks } from "../shared/stats.ts";

test("磁盘使用率排除预留块并按容量汇总", () => {
  const disks = [
    { mount: "/", device: "a", fsType: "x", totalBytes: 120, usedBytes: 40, availableBytes: 60 },
    { mount: "/data", device: "b", fsType: "x", totalBytes: 300, usedBytes: 150, availableBytes: 150 },
  ];
  assert.equal(diskPercent(disks[0]), 40);
  assert.equal(sumDisks(disks).percent, 47.5);
  assert.equal(diskPercent({ usedBytes: 0, availableBytes: 0 }), 0);
  assert.equal(sumDisks([]).percent, 0);
});

test("主机 GPU 独立解析零值、缺测和 MiB", () => {
  const devices = parseHostGpu("0, GPU A, 0, 0, 12282\n1, GPU B, N/A, N/A, 16\n2, GPU C, 101, -1, invalid\n");
  assert.deepEqual(devices, [
    { index: 0, name: "GPU A", utilizationPercent: 0, memoryUsedBytes: 0, memoryTotalBytes: 12282 * 1024 * 1024 },
    { index: 1, name: "GPU B", utilizationPercent: null, memoryUsedBytes: null, memoryTotalBytes: 16 * 1024 * 1024 },
    { index: 2, name: "GPU C", utilizationPercent: null, memoryUsedBytes: null, memoryTotalBytes: null },
  ]);
});

test("GPU 历史按设备索引保留零值和各项缺测", () => {
  const device = (index, utilizationPercent, memoryUsedBytes, memoryTotalBytes) => ({
    index, name: `GPU ${index}`, utilizationPercent, memoryUsedBytes, memoryTotalBytes,
  });
  const sample = (gpus) => ({
    at: 0, cpuPercent: 0, memoryPercent: 0, diskPercent: null,
    rxBytesPerSec: 0, txBytesPerSec: 0, gpus,
  });
  const samples = [
    sample([device(1, 99, 90, 100), device(0, 0, 0, 100)]),
    sample([device(0, null, 25, 100), device(1, 88, 80, 100)]),
    sample([device(1, 77, 70, 100)]),
    sample([device(0, 40, null, 100)]),
    sample([device(0, 50, 10, 0)]),
    sample([device(0, 60, 10, null)]),
  ];
  assert.deepEqual(gpuHistory(samples, 0), {
    utilizationPercent: [0, null, null, 40, 50, 60],
    memoryPercent: [0, 25, null, null, null, null],
  });
  assert.deepEqual(gpuHistory(samples, 1), {
    utilizationPercent: [99, 88, 77, null, null, null],
    memoryPercent: [90, 80, 70, null, null, null],
  });
});
