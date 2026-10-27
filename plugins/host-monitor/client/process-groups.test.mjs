import test from 'node:test';
import assert from 'node:assert/strict';
import { groupProcesses } from './process-order.ts';

const item = (pid, name, values = {}) => ({
  pid, name, startTime: String(pid * 10), user: 'alice', command: name,
  cpuPercent: null, memoryBytes: null, gpuPercent: null, gpuMemoryBytes: null,
  rxBytesPerSec: null, txBytesPerSec: null, canTerminate: true, protectionReason: null,
  ...values,
});

test('全量分组后排序，保留跨用户成员身份及原始顺序', () => {
  const rows = [item(1, 'worker', { cpuPercent: 70 }),
    ...Array.from({ length: 12 }, (_, i) => item(i + 2, `other${i}`, { cpuPercent: 80 })),
    item(14, 'worker', { user: 'bob', cpuPercent: 90 })];
  const original = [...rows];
  const groups = groupProcesses(rows, 'cpu', 'desc');
  assert.equal(groups.length, 13);
  assert.equal(groups[0].name, 'worker');
  assert.equal(groups[0].usage.cpuPercent, 160);
  assert.deepEqual(groups[0].members, [rows[0], rows[13]]);
  assert.deepEqual(groups[0].members.map(({ pid, startTime, user }) => [pid, startTime, user]), [[1, '10', 'alice'], [14, '140', 'bob']]);
  assert.deepEqual(rows, original);
});

test('各资源只汇总已知值，零值、全缺测和部分缺测互相区分', () => {
  const rows = [item(1, 'same', { cpuPercent: 0, memoryBytes: 3, gpuPercent: 75, rxBytesPerSec: 0 }),
    item(2, 'same', { memoryBytes: null, gpuPercent: 50, rxBytesPerSec: null, txBytesPerSec: 5 })];
  const group = groupProcesses(rows, 'cpu', 'desc')[0];
  assert.deepEqual(group.usage, { cpuPercent: 0, memoryBytes: 3, gpuPercent: 125, gpuMemoryBytes: null, rxBytesPerSec: 0, txBytesPerSec: 5 });
  assert.deepEqual([...group.partial].sort(), ['cpuPercent', 'memoryBytes', 'rxBytesPerSec', 'txBytesPerSec']);
});

test('GPU、显存和网络方向独立排序，空值最后，同值按名称排序', () => {
  const rows = [item(1, 'b', { gpuPercent: 10, gpuMemoryBytes: 30, rxBytesPerSec: 0, txBytesPerSec: 8 }),
    item(2, 'a', { gpuPercent: 10, gpuMemoryBytes: 10, rxBytesPerSec: 9, txBytesPerSec: 0 }),
    item(3, 'missing', {})];
  const names = (key, direction) => groupProcesses(rows, key, direction).map(group => group.name);
  assert.deepEqual(names('gpu', 'desc'), ['a', 'b', 'missing']);
  assert.deepEqual(names('gpuMemory', 'desc'), ['b', 'a', 'missing']);
  assert.deepEqual(names('download', 'desc'), ['a', 'b', 'missing']);
  assert.deepEqual(names('upload', 'desc'), ['b', 'a', 'missing']);
  assert.deepEqual(names('gpuMemory', 'asc'), ['a', 'b', 'missing']);
});
