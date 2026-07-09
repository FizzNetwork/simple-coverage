'use strict';
// End-to-end test: a REAL local HTTP server standing in for the GitHub API
// (real sockets, real JSON parsing) — not a mocked fetchFn. Runs the full
// index.js run() over the actual Node fetch + http stack, twice: fresh PR
// comment, then a re-run with different coverage numbers to prove the
// idempotent update path and the threshold-fail-after-comment ordering
// both hold over real HTTP, not just against a hand-written mock.
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run } = require('../src/index');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function startFakeGitHub() {
  const comments = new Map(); // id -> { id, body, pr }
  let nextId = 500;

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(obj === null ? '' : JSON.stringify(obj));
    };

    const listMatch = p.match(/^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/);
    if (req.method === 'GET' && listMatch) {
      const pr = Number(listMatch[1]);
      const list = [...comments.values()].filter(c => c.pr === pr);
      return send(200, list);
    }
    if (req.method === 'POST' && listMatch) {
      const pr = Number(listMatch[1]);
      const body = JSON.parse((await readBody(req)).toString('utf8')).body;
      const id = nextId++;
      const c = { id, body, pr, html_url: 'http://fake-github.test/comment/' + id };
      comments.set(id, c);
      return send(201, c);
    }
    const patchMatch = p.match(/^\/repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/);
    if (req.method === 'PATCH' && patchMatch) {
      const id = Number(patchMatch[1]);
      const c = comments.get(id);
      if (!c) return send(404, { message: 'not found' });
      c.body = JSON.parse((await readBody(req)).toString('utf8')).body;
      return send(200, c);
    }
    send(404, { message: 'no route: ' + req.method + ' ' + p });
  });

  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, comments })));
}

(async () => {
  const { server, comments } = await startFakeGitHub();
  const port = server.address().port;
  const apiUrl = 'http://127.0.0.1:' + port;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-e2e-'));
  const evtPath = path.join(dir, 'event.json');
  fs.writeFileSync(evtPath, JSON.stringify({ pull_request: { number: 21 } }));

  // Pass 1: 50% coverage, threshold 80 -> should comment AND fail.
  fs.writeFileSync(path.join(dir, 'lcov.info'), ['SF:src/a.js', 'DA:1,1', 'DA:2,0', 'end_of_record'].join('\n'));
  const env1 = {
    INPUT_LCOV: 'lcov.info', INPUT_THRESHOLD: '80',
    GITHUB_WORKSPACE: dir, GITHUB_EVENT_PATH: evtPath,
    GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'tok', GITHUB_API_URL: apiUrl
  };
  const result1 = await run(env1, fetch);
  assert.strictEqual(result1.summary.overallPercent, 50);
  assert.strictEqual(result1.commentPosted, true);
  assert.strictEqual(result1.thresholdPass, false);
  assert.strictEqual(comments.size, 1);
  const firstBody = [...comments.values()][0].body;
  assert.ok(firstBody.includes('50%'));
  assert.ok(firstBody.includes('Below the required 80% threshold'));
  console.log('PASS: e2e pass 1 — real HTTP create, correct percent, threshold-fail flagged, comment still posted');

  // Pass 2: fix the code so coverage is 100%, re-run on the SAME PR.
  fs.writeFileSync(path.join(dir, 'lcov.info'), ['SF:src/a.js', 'DA:1,1', 'DA:2,1', 'end_of_record'].join('\n'));
  const result2 = await run(env1, fetch);
  assert.strictEqual(result2.summary.overallPercent, 100);
  assert.strictEqual(result2.thresholdPass, true);
  // Must still be exactly ONE comment on the PR — updated, not duplicated.
  assert.strictEqual(comments.size, 1);
  const updatedBody = [...comments.values()][0].body;
  assert.ok(updatedBody.includes('100%'));
  assert.ok(!updatedBody.includes('Below the required'));
  console.log('PASS: e2e pass 2 — real HTTP re-run updates the SAME comment, no duplicate, reflects new number');

  server.close();
  console.log('ALL E2E TESTS PASSED');
})().catch(e => {
  console.error('E2E TEST FAILURE:', e);
  process.exitCode = 1;
});
