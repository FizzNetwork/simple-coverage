'use strict';
const assert = require('assert');
const { readConfig, FailLoud } = require('../src/index');

function t(name, fn) {
  try { fn(); console.log('PASS: ' + name); }
  catch (e) { console.error('FAIL: ' + name, e); process.exitCode = 1; }
}

t('missing lcov fails loud', () => {
  let threw = null;
  try { readConfig({}); } catch (e) { threw = e; }
  assert.ok(threw instanceof FailLoud);
  assert.ok(/Required input "lcov"/.test(threw.message));
});

t('valid lcov + no threshold parses (comment stays default true, repo/token supplied)', () => {
  const cfg = readConfig({ INPUT_LCOV: 'coverage/lcov.info', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' });
  assert.deepStrictEqual(cfg.patterns, ['coverage/lcov.info']);
  assert.strictEqual(cfg.threshold, null);
  assert.strictEqual(cfg.comment, true);
  assert.strictEqual(cfg.title, 'Coverage Report');
});

t('multi-line lcov patterns parse', () => {
  const cfg = readConfig({ INPUT_LCOV: 'a/lcov.info\nb/lcov.info', INPUT_COMMENT: 'false' });
  assert.deepStrictEqual(cfg.patterns, ['a/lcov.info', 'b/lcov.info']);
});

t('valid threshold parses as number', () => {
  const cfg = readConfig({ INPUT_LCOV: 'x', INPUT_THRESHOLD: '85.5', INPUT_COMMENT: 'false' });
  assert.strictEqual(cfg.threshold, 85.5);
});

t('out-of-range threshold fails loud', () => {
  let threw = null;
  try { readConfig({ INPUT_LCOV: 'x', INPUT_THRESHOLD: '150', INPUT_COMMENT: 'false' }); } catch (e) { threw = e; }
  assert.ok(threw instanceof FailLoud, 'expected FailLoud for threshold>100');
});

t('non-numeric threshold fails loud', () => {
  let threw = null;
  try { readConfig({ INPUT_LCOV: 'x', INPUT_THRESHOLD: 'high', INPUT_COMMENT: 'false' }); } catch (e) { threw = e; }
  assert.ok(threw instanceof FailLoud, 'expected FailLoud for non-numeric threshold');
});

t('invalid comment boolean fails loud', () => {
  let threw = null;
  try { readConfig({ INPUT_LCOV: 'x', INPUT_COMMENT: 'yes' }); } catch (e) { threw = e; }
  assert.ok(threw instanceof FailLoud, 'expected FailLoud for invalid comment value');
});

console.log('ALL ROUND 1 TESTS DONE');
