'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../src/index');

function t(name, fn) { return fn().then(() => console.log('PASS: ' + name)).catch(e => { console.error('FAIL: ' + name, e); process.exitCode = 1; }); }

function fixtureDir(lcovText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-test3-'));
  fs.writeFileSync(path.join(dir, 'lcov.info'), lcovText);
  return dir;
}

function eventFile(dir, prNumber) {
  const p = path.join(dir, 'event.json');
  fs.writeFileSync(p, JSON.stringify({ pull_request: { number: prNumber } }));
  return p;
}

const SIMPLE_LCOV = ['SF:src/a.js', 'DA:1,1', 'DA:2,0', 'end_of_record'].join('\n');

async function testCreatesNewCommentOnPr() {
  const dir = fixtureDir(SIMPLE_LCOV);
  const evt = eventFile(dir, 42);
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, method: (opts && opts.method) || 'GET' });
    if (url.includes('/issues/42/comments') && (!opts || !opts.method)) {
      return { ok: true, json: async () => [] }; // no existing comment
    }
    if (url.endsWith('/issues/42/comments') && opts.method === 'POST') {
      const body = JSON.parse(opts.body).body;
      assert.ok(body.includes('<!-- simple-coverage:report -->'));
      assert.ok(body.includes('50%'));
      return { ok: true, json: async () => ({ id: 1, html_url: 'https://gh/comment/1' }) };
    }
    throw new Error('unexpected call: ' + url);
  };
  const env = { INPUT_LCOV: 'lcov.info', GITHUB_WORKSPACE: dir, GITHUB_EVENT_PATH: evt, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' };
  const result = await run(env, fetchFn);
  assert.strictEqual(result.commentPosted, true);
  assert.strictEqual(result.summary.overallPercent, 50);
  assert.strictEqual(calls.filter(c => c.method === 'POST').length, 1);
}

async function testUpdatesExistingCommentIdempotently() {
  const dir = fixtureDir(SIMPLE_LCOV);
  const evt = eventFile(dir, 7);
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, method: (opts && opts.method) || 'GET' });
    if (url.includes('/issues/7/comments') && (!opts || !opts.method)) {
      return { ok: true, json: async () => [{ id: 99, body: 'old\n<!-- simple-coverage:report -->\nstale' }] };
    }
    if (url.endsWith('/issues/comments/99') && opts.method === 'PATCH') {
      return { ok: true, json: async () => ({ id: 99, html_url: 'https://gh/comment/99' }) };
    }
    throw new Error('unexpected call (should PATCH existing 99, not POST a new one): ' + url + ' ' + (opts && opts.method));
  };
  const env = { INPUT_LCOV: 'lcov.info', GITHUB_WORKSPACE: dir, GITHUB_EVENT_PATH: evt, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' };
  const result = await run(env, fetchFn);
  assert.strictEqual(result.commentPosted, true);
  assert.strictEqual(calls.filter(c => c.method === 'PATCH').length, 1);
  assert.strictEqual(calls.filter(c => c.method === 'POST').length, 0);
}

async function testSkipsCommentOnNonPrEvent() {
  const dir = fixtureDir(SIMPLE_LCOV);
  const env = { INPUT_LCOV: 'lcov.info', GITHUB_WORKSPACE: dir, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' }; // no GITHUB_EVENT_PATH
  const result = await run(env, async () => { throw new Error('fetch must not be called on a non-PR event'); });
  assert.strictEqual(result.commentPosted, false);
  assert.strictEqual(result.prNumber, null);
  assert.strictEqual(result.summary.overallPercent, 50);
}

async function testSkipsCommentWhenCommentFalse() {
  const dir = fixtureDir(SIMPLE_LCOV);
  const evt = eventFile(dir, 5);
  const env = { INPUT_LCOV: 'lcov.info', GITHUB_WORKSPACE: dir, GITHUB_EVENT_PATH: evt, INPUT_COMMENT: 'false', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' };
  const result = await run(env, async () => { throw new Error('fetch must not be called when comment=false'); });
  assert.strictEqual(result.commentPosted, false);
}

(async () => {
  await t('creates a new comment on a PR event', testCreatesNewCommentOnPr);
  await t('re-run on same PR updates existing comment, not duplicate', testUpdatesExistingCommentIdempotently);
  await t('skips commenting on a non-PR event (e.g. push)', testSkipsCommentOnNonPrEvent);
  await t('skips commenting when comment=false', testSkipsCommentWhenCommentFalse);
  console.log('ALL ROUND 3 TESTS DONE');
})();
