import test from 'node:test';
import assert from 'node:assert/strict';
import { orderProcesses } from './process-order.ts';

const item = (pid, cpuPercent, gpuPercent, gpuMemoryBytes, rxBytesPerSec, txBytesPerSec) => ({
  pid, cpuPercent, gpuPercent, gpuMemoryBytes, rxBytesPerSec, txBytesPerSec,
});
const rows = [item(4, null, null, null, null, null), item(3, 5, 8, 20, 3, 4),
  item(1, 5, 8, 30, 4, 3), item(2, 9, 2, 10, 9, 1)];
const ids = (key, direction, mode = 'utilization') =>
  orderProcesses(rows, key, direction, mode).map((row) => row.pid);

test('CPU 排序在升降序均将空值置后，同值按 PID 排序', () => {
  assert.deepEqual(ids('cpu', 'desc'), [2, 1, 3, 4]);
  assert.deepEqual(ids('cpu', 'asc'), [1, 3, 2, 4]);
});
test('GPU 利用率和显存按各自数值排序', () => {
  assert.deepEqual(ids('gpu', 'desc'), [1, 3, 2, 4]);
  assert.deepEqual(ids('gpu', 'asc', 'memory'), [2, 3, 1, 4]);
});
test('网络按双向总量排序，缺少任一方向视为未知', () => {
  assert.deepEqual(ids('network', 'desc'), [2, 1, 3, 4]);
  assert.deepEqual(ids('network', 'asc'), [1, 3, 2, 4]);
  assert.equal(orderProcesses([item(1, 0, 0, 0, 5, null), item(2, 0, 0, 0, 0, 0)], 'network', 'asc', 'utilization')[1].pid, 1);
});
test('先对完整列表排序再截取前 12', () => {
  const all = Array.from({ length: 13 }, (_, i) => item(i + 1, 13 - i, i === 12 ? 100 : 0, 0, 0, 0));
  assert.equal(orderProcesses(all, 'gpu', 'desc', 'utilization').slice(0, 12)[0].pid, 13);
});
