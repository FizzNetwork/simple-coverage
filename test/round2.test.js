'use strict';
const assert = require('assert');
const { parseLcov, mergeRecordSets, summarize } = require('../src/lcov');

function t(name, fn) {
  try { fn(); console.log('PASS: ' + name); }
  catch (e) { console.error('FAIL: ' + name, e); process.exitCode = 1; }
}

t('parses a single simple lcov record', () => {
  const text = [
    'TN:',
    'SF:src/a.js',
    'DA:1,1',
    'DA:2,0',
    'DA:3,1',
    'LF:3',
    'LH:2',
    'end_of_record'
  ].join('\n');
  const records = parseLcov(text);
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].sourceFile, 'src/a.js');
  assert.strictEqual(records[0].lines.get(1), 1);
  assert.strictEqual(records[0].lines.get(2), 0);
  assert.strictEqual(records[0].lines.get(3), 1);
});

t('parses multiple records in one file', () => {
  const text = [
    'SF:src/a.js', 'DA:1,1', 'end_of_record',
    'SF:src/b.js', 'DA:1,0', 'end_of_record'
  ].join('\n');
  const records = parseLcov(text);
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[1].sourceFile, 'src/b.js');
});

t('tolerates a missing trailing end_of_record', () => {
  const text = ['SF:src/a.js', 'DA:1,1'].join('\n');
  const records = parseLcov(text);
  assert.strictEqual(records.length, 1);
});

t('single-shard summary computes correct percent', () => {
  const text = ['SF:src/a.js', 'DA:1,1', 'DA:2,0', 'DA:3,1', 'DA:4,0', 'end_of_record'].join('\n');
  const records = parseLcov(text);
  const merged = mergeRecordSets([records]);
  const summary = summarize(merged);
  assert.strictEqual(summary.linesHit, 2);
  assert.strictEqual(summary.linesFound, 4);
  assert.strictEqual(summary.overallPercent, 50);
});

t('CORRECTNESS: two overlapping shards merge by max-hit-per-line, not summed', () => {
  // Shard A hits lines 1 and 3 of a.js, misses line 2. Fully covers b.js.
  const shardA = [
    'SF:src/a.js', 'DA:1,1', 'DA:2,0', 'DA:3,1', 'end_of_record',
    'SF:src/b.js', 'DA:1,1', 'DA:2,1', 'end_of_record'
  ].join('\n');
  // Shard B hits line 2 of a.js (which A missed), misses 1 and 3. Also fully covers b.js.
  const shardB = [
    'SF:src/a.js', 'DA:1,0', 'DA:2,1', 'DA:3,0', 'end_of_record',
    'SF:src/b.js', 'DA:1,1', 'DA:2,1', 'end_of_record'
  ].join('\n');

  const recordsA = parseLcov(shardA);
  const recordsB = parseLcov(shardB);
  const merged = mergeRecordSets([recordsA, recordsB]);
  const summary = summarize(merged);

  // Union across both shards: a.js all 3 lines hit at least once somewhere,
  // b.js both lines hit in both shards. Real answer must be 5/5 = 100%.
  assert.strictEqual(summary.linesFound, 5, 'found count must count each real line once, not once per shard');
  assert.strictEqual(summary.linesHit, 5, 'a merged line hit in EITHER shard must count as hit');
  assert.strictEqual(summary.overallPercent, 100);

  const aFile = summary.perFile.find(f => f.path === 'src/a.js');
  assert.strictEqual(aFile.hit, 3);
  assert.strictEqual(aFile.found, 3);
});

t('a file present in only one of several shards is still counted once, correctly', () => {
  const shardA = ['SF:only-in-a.js', 'DA:1,1', 'DA:2,0', 'end_of_record'].join('\n');
  const shardB = ['SF:only-in-b.js', 'DA:1,1', 'end_of_record'].join('\n');
  const merged = mergeRecordSets([parseLcov(shardA), parseLcov(shardB)]);
  const summary = summarize(merged);
  assert.strictEqual(summary.linesFound, 3);
  assert.strictEqual(summary.linesHit, 2);
  assert.strictEqual(summary.perFile.length, 2);
});

t('empty input produces a null percent, not a crash or divide-by-zero garbage', () => {
  const merged = mergeRecordSets([parseLcov('')]);
  const summary = summarize(merged);
  assert.strictEqual(summary.overallPercent, null);
  assert.strictEqual(summary.linesFound, 0);
});

console.log('ALL ROUND 2 TESTS DONE');
