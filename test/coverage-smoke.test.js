'use strict';
// Real node:test-based smoke test — separate from the 28 assert-based tests
// in round1-6/e2e. Its only job is to exercise the actual src modules under
// Node's built-in coverage instrumentation, so this project can dogfood
// itself: this file's real lcov output (generated via
// `node --test --experimental-test-coverage --test-reporter=lcov`) is what
// gets fed into simple-coverage running on its OWN pull requests.
const test = require('node:test');
const assert = require('assert');
const { parseLcov, mergeRecordSets, summarize } = require('../src/lcov');
const { resolveFiles } = require('../src/glob');
const { readConfig } = require('../src/index');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('lcov parse + merge + summarize round-trip', () => {
  const text = ['SF:a.js', 'DA:1,1', 'DA:2,0', 'end_of_record'].join('\n');
  const records = parseLcov(text);
  const merged = mergeRecordSets([records]);
  const summary = summarize(merged);
  assert.strictEqual(summary.overallPercent, 50);
});

test('glob resolves a real file on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-smoke-'));
  fs.writeFileSync(path.join(dir, 'x.info'), 'SF:a.js\nDA:1,1\nend_of_record');
  const files = resolveFiles(['*.info'], dir);
  assert.strictEqual(files.length, 1);
});

test('readConfig accepts a minimal valid comment:false config', () => {
  const cfg = readConfig({ INPUT_LCOV: 'x', INPUT_COMMENT: 'false' });
  assert.strictEqual(cfg.comment, false);
});
