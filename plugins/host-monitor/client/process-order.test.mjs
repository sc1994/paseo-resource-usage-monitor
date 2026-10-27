import test from 'node:test';
import assert from 'node:assert/strict';
import { orderProcesses } from './process-order.ts';

const item = (pid, cpuPercent, gpuPercent, gpuMemoryBytes, rxBytesPerSec, txBytesPerSec, memoryBytes = null) => ({
  pid, cpuPercent, gpuPercent, gpuMemoryBytes, rxBytesPerSec, txBytesPerSec, memoryBytes,
});
const rows = [item(4, null, null, null, null, null), item(3, 5, 8, 20, 3, 4),
  item(1, 5, 8, 30, 4, 3), item(2, 9, 2, 40, 9, 1)];
const ids = (key, direction) =>
  orderProcesses(rows, key, direction).map((row) => row.pid);

test('CPU 排序在升降序均将空值置后，同值按 PID 排序', () => {
  assert.deepEqual(ids('cpu', 'desc'), [2, 1, 3, 4]);
  assert.deepEqual(ids('cpu', 'asc'), [1, 3, 2, 4]);
});
test('GPU 利用率和显存按各自数值排序', () => {
  assert.deepEqual(ids('gpu', 'desc'), [1, 3, 2, 4]);
  assert.deepEqual(ids('gpuMemory', 'asc'), [3, 1, 2, 4]);
  assert.deepEqual(ids('gpuMemory', 'desc'), [2, 1, 3, 4]);
});
test('网络按双向总量排序，缺少任一方向视为未知', () => {
  assert.deepEqual(ids('network', 'desc'), [2, 1, 3, 4]);
  assert.deepEqual(ids('network', 'asc'), [1, 3, 2, 4]);
  assert.equal(orderProcesses([item(1, 0, 0, 0, 5, null), item(2, 0, 0, 0, 0, 0)], 'network', 'asc')[1].pid, 1);
});
test('下载和上传分别排序，单向缺测与零值独立处理', () => {
  const items = [item(1, 0, 0, 0, 9, 0), item(2, 0, 0, 0, 0, 9), item(3, 0, 0, 0, null, 5), item(4, 0, 0, 0, 5, null)];
  assert.deepEqual(orderProcesses(items, 'download', 'desc').map(row => row.pid), [1, 4, 2, 3]);
  assert.deepEqual(orderProcesses(items, 'upload', 'desc').map(row => row.pid), [2, 3, 1, 4]);
  assert.deepEqual(orderProcesses(items, 'download', 'asc').map(row => row.pid), [2, 4, 1, 3]);
});

test('内存排序保留零值，同值按 PID 排序，空值最后且排序后截取', () => {
  const all = Array.from({ length: 13 }, (_, i) => item(i + 1, 0, 0, 0, 0, 0, i === 0 ? null : i <= 2 ? 0 : i));
  assert.deepEqual(orderProcesses(all, 'memory', 'asc').map(row => row.pid).slice(0, 3), [2, 3, 4]);
  assert.deepEqual(orderProcesses(all, 'memory', 'desc').map(row => row.pid).slice(-3), [2, 3, 1]);
  assert.equal(orderProcesses(all, 'memory', 'desc').slice(0, 12)[0].pid, 13);
  assert.equal(orderProcesses(all, 'memory', 'desc').slice(0, 12).some(row => row.pid === 1), false);
});

test('先对完整列表排序再截取前 12', () => {
  const all = Array.from({ length: 13 }, (_, i) => item(i + 1, 13 - i, i === 12 ? 100 : 0, 0, 0, 0));
  assert.equal(orderProcesses(all, 'gpu', 'desc').slice(0, 12)[0].pid, 13);
});
