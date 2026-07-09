'use strict';
// Round 6 — pagination idempotency. A REAL local HTTP server that paginates
// the issues-comments list exactly like GitHub (per_page + page query params,
// ascending insertion order). Proves the bug fix: when our marked comment
// lands PAST the first page (the action first ran on a PR that already had
// 100+ comments), a re-run still finds it and UPDATES in place instead of
// posting a duplicate every run. Under the old single-page client, pass 2
// would create a second coverage comment (total would grow) — this asserts it
// does not.
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

function startPaginatingGitHub(preseed) {
  const comments = new Map(); // id -> { id, body, pr, html_url }
  let nextId = 1000;
  const pagesServed = new Set();

  // Pre-seed `preseed` filler comments (no marker) on PR 21, in order.
  for (let i = 0; i < preseed; i++) {
    const id = nextId++;
    comments.set(id, { id, body: 'human chatter #' + i, pr: 21, html_url: 'http://fake/c/' + id });
  }

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
      const perPage = Number(u.searchParams.get('per_page')) || 30;
      const page = Number(u.searchParams.get('page')) || 1;
      pagesServed.add(page);
      const all = [...comments.values()].filter(c => c.pr === pr); // insertion order
      const start = (page - 1) * perPage;
      return send(200, all.slice(start, start + perPage));
    }
    if (req.method === 'POST' && listMatch) {
      const pr = Number(listMatch[1]);
      const body = JSON.parse((await readBody(req)).toString('utf8')).body;
      const id = nextId++;
      const c = { id, body, pr, html_url: 'http://fake/c/' + id };
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

  return new Promise(resolve =>
    server.listen(0, '127.0.0.1', () => resolve({ server, comments, pagesServed })));
}

const MARKER = '<!-- simple-coverage:report -->';

(async () => {
  // 120 pre-existing comments means our coverage comment (created next) is
  // comment #121 — squarely on page 2 at per_page=100.
  const { server, comments, pagesServed } = await startPaginatingGitHub(120);
  const port = server.address().port;
  const apiUrl = 'http://127.0.0.1:' + port;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-r6-'));
  const evtPath = path.join(dir, 'event.json');
  fs.writeFileSync(evtPath, JSON.stringify({ pull_request: { number: 21 } }));
  fs.writeFileSync(path.join(dir, 'lcov.info'), ['SF:src/a.js', 'DA:1,1', 'DA:2,1', 'end_of_record'].join('\n'));

  const env = {
    INPUT_LCOV: 'lcov.info',
    GITHUB_WORKSPACE: dir, GITHUB_EVENT_PATH: evtPath,
    GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'tok', GITHUB_API_URL: apiUrl
  };

  const markerCount = () => [...comments.values()].filter(c => c.body.includes(MARKER)).length;
  const totalCount = () => comments.size;

  // Pass 1: creates the coverage comment. It lands at position 121 (page 2).
  const r1 = await run(env, fetch);
  assert.strictEqual(r1.commentPosted, true);
  assert.strictEqual(markerCount(), 1, 'pass 1 should create exactly one marked comment');
  assert.strictEqual(totalCount(), 121, 'pass 1: 120 filler + 1 coverage comment');
  console.log('PASS: round6 pass 1 — coverage comment created past page 1 (total 121, 1 marked)');

  // Pass 2: the marked comment is on page 2. The paginating client must find
  // and UPDATE it — NOT post a second one.
  const r2 = await run(env, fetch);
  assert.strictEqual(r2.commentPosted, true);
  assert.strictEqual(markerCount(), 1, 'pass 2 must NOT create a duplicate — still exactly one marked comment');
  assert.strictEqual(totalCount(), 121, 'pass 2: total unchanged (updated in place, not duplicated)');
  assert.ok(pagesServed.has(2), 'the client must actually have fetched page 2 to find the comment');
  console.log('PASS: round6 pass 2 — found marked comment on page 2 and updated in place (no duplicate)');

  server.close();
  console.log('ALL ROUND 6 TESTS PASSED');
})().catch(e => {
  console.error('ROUND 6 TEST FAILURE:', e);
  process.exitCode = 1;
});
