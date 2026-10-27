import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { compactBytes } from './format.ts';

test('紧凑字节数保留缺测与零值', () => {
  assert.equal(compactBytes(null), '--');
  assert.equal(compactBytes(0), '0B');
  assert.equal(compactBytes(2 * 1024 ** 3), '2.0G');
});
