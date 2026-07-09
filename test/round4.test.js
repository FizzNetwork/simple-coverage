'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, FailLoud } = require('../src/index');

function t(name, fn) { return Promise.resolve().then(fn).then(() => console.log('PASS: ' + name)).catch(e => { console.error('FAIL: ' + name, e); process.exitCode = 1; }); }

function fixtureDir(lcovText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-test4-'));
  fs.writeFileSync(path.join(dir, 'lcov.info'), lcovText);
  return dir;
}
function eventFile(dir, prNumber) {
  const p = path.join(dir, 'event.json');
  fs.writeFileSync(p, JSON.stringify({ pull_request: { number: prNumber } }));
  return p;
}
const SIMPLE_LCOV = ['SF:src/a.js', 'DA:1,1', 'DA:2,0', 'end_of_record'].join('\n');
const neverFetch = async (url) => { throw new Error('fetch should never be called, got: ' + url); };

async function testFailsLoudOnMissingRepoWhenCommentEnabled() {
  const dir = fixtureDir(SIMPLE_LCOV);
  const env = { INPUT_LCOV: 'lcov.info', GITHUB_WORKSPACE: dir, GITHUB_TOKEN: 't' }; // no GITHUB_REPOSITORY
  let threw = null;
  try { await run(env, neverFetch); } catch (e) { threw = e; }
  assert.ok(threw instanceof FailLoud);
  assert.ok(/GITHUB_REPOSITORY is missing/.test(threw.message));
}

async function testFailsLoudOnMissingTokenWhenCommentEnabled() {
  const dir = fixtureDir(SIMPLE_LCOV);
  const env = { INPUT_LCOV: 'lcov.info', GITHUB_WORKSPACE: dir, GITHUB_REPOSITORY: 'o/r' }; // no token
  let threw = null;
  try { await run(env, neverFetch); } catch (e) { threw = e; }
  assert.ok(threw instanceof FailLoud);
  assert.ok(/No GitHub token available/.test(threw.message));
}

async function testNoTokenNeededWhenCommentDisabled() {
  const dir = fixtureDir(SIMPLE_LCOV);
  const env = { INPUT_LCOV: 'lcov.info', GITHUB_WORKSPACE: dir, INPUT_COMMENT: 'false' }; // no repo, no token, comment off
  const result = await run(env, neverFetch);
  assert.strictEqual(result.commentPosted, false);
  assert.strictEqual(result.summary.overallPercent, 50);
}

async function testFailsLoudOnZeroCoverageRecords() {
  const dir = fixtureDir('this is not a real lcov file at all');
  const env = { INPUT_LCOV: 'lcov.info', GITHUB_WORKSPACE: dir, INPUT_COMMENT: 'false' };
  let threw = null;
  try { await run(env, neverFetch); } catch (e) { threw = e; }
  assert.ok(threw instanceof FailLoud);
  assert.ok(/zero coverage records/.test(threw.message));
}

async function testThresholdFailStillPostsCommentFirst() {
  const dir = fixtureDir(SIMPLE_LCOV); // 50% coverage
  const evt = eventFile(dir, 11);
  let postedBody = null;
  const fetchFn = async (url, opts) => {
    if (url.includes('/issues/11/comments') && (!opts || !opts.method)) return { ok: true, json: async () => [] };
    if (url.endsWith('/issues/11/comments') && opts.method === 'POST') {
      postedBody = JSON.parse(opts.body).body;
      return { ok: true, json: async () => ({ id: 1, html_url: 'https://gh/c/1' }) };
    }
    throw new Error('unexpected: ' + url);
  };
  const env = { INPUT_LCOV: 'lcov.info', GITHUB_WORKSPACE: dir, GITHUB_EVENT_PATH: evt, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't', INPUT_THRESHOLD: '90' };
  const result = await run(env, fetchFn);
  // run() itself does NOT throw on a threshold miss — the comment must go out first.
  assert.strictEqual(result.commentPosted, true);
  assert.ok(postedBody.includes('Below the required 90% threshold'));
  assert.strictEqual(result.thresholdPass, false);
}

async function testThresholdPassReportedCorrectly() {
  const dir = fixtureDir(SIMPLE_LCOV); // 50%
  const env = { INPUT_LCOV: 'lcov.info', GITHUB_WORKSPACE: dir, INPUT_COMMENT: 'false', INPUT_THRESHOLD: '10' };
  const result = await run(env, neverFetch);
  assert.strictEqual(result.thresholdPass, true);
}

(async () => {
  await t('fails loud on missing repo when comment enabled', testFailsLoudOnMissingRepoWhenCommentEnabled);
  await t('fails loud on missing token when comment enabled', testFailsLoudOnMissingTokenWhenCommentEnabled);
  await t('no token/repo needed when comment=false', testNoTokenNeededWhenCommentDisabled);
  await t('fails loud on zero real coverage records', testFailsLoudOnZeroCoverageRecords);
  await t('threshold miss posts the comment BEFORE failing', testThresholdFailStillPostsCommentFirst);
  await t('threshold pass reported correctly', testThresholdPassReportedCorrectly);
  console.log('ALL ROUND 4 TESTS DONE');
})();
