'use strict';
// Thin GitHub REST wrapper for PR comments. fetchFn injected for testing,
// same pattern as simple-release's src/github.js.
const fs = require('fs');

const MARKER = '<!-- simple-coverage:report -->';
// Safety bound on comment pagination: 50 pages * 100/page = 5000 comments.
// No real PR reaches this; the cap only stops a hang if an API stand-in
// keeps returning full pages forever.
const MAX_COMMENT_PAGES = 50;

function ghHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'simple-coverage-action'
  };
}

// Pull requests use the "issues" comment endpoints in the GitHub REST API —
// a PR is an issue under the hood. Reads the real event payload GitHub
// Actions writes to GITHUB_EVENT_PATH to find the PR number; returns null
// on any non-PR trigger (push, schedule, etc.) rather than guessing.
function readPullRequestNumber(cfg) {
  if (!cfg.eventPath) return null;
  let raw;
  try {
    raw = fs.readFileSync(cfg.eventPath, 'utf8');
  } catch (e) {
    return null;
  }
  let event;
  try {
    event = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (event && event.pull_request && typeof event.pull_request.number === 'number') {
    return event.pull_request.number;
  }
  return null;
}

// Walk every page of the PR's comments looking for our marked comment.
// A single ?per_page=100 fetch (the old behavior) only saw the first 100
// comments, so on a PR where our comment sits past page 1 — e.g. the action
// first ran on a PR that already had 100+ comments — it was never found and
// a duplicate got posted on every run, defeating the whole idempotency
// promise. Paginate until we find it, hit an empty/short (last) page, or the
// safety cap. Dependency-free: increments `page` rather than parsing Link
// headers, so it works against any faithful stand-in too.
async function findExistingComment(cfg, prNumber, fetchFn) {
  const perPage = 100;
  for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
    const url = cfg.apiUrl + '/repos/' + cfg.repo + '/issues/' + prNumber +
      '/comments?per_page=' + perPage + '&page=' + page;
    const res = await fetchFn(url, { headers: ghHeaders(cfg.token) });
    if (!res.ok) throw new Error('GitHub API error listing PR comments: ' + res.status + ' ' + await res.text());
    const comments = await res.json();
    if (!Array.isArray(comments) || comments.length === 0) return null;
    const found = comments.find(c => typeof c.body === 'string' && c.body.includes(MARKER));
    if (found) return found;
    if (comments.length < perPage) return null; // last page reached, not found
  }
  return null;
}

async function createComment(cfg, prNumber, body, fetchFn) {
  const url = cfg.apiUrl + '/repos/' + cfg.repo + '/issues/' + prNumber + '/comments';
  const res = await fetchFn(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(cfg.token)),
    body: JSON.stringify({ body })
  });
  if (!res.ok) throw new Error('GitHub API error creating PR comment: ' + res.status + ' ' + await res.text());
  return res.json();
}

async function updateComment(cfg, commentId, body, fetchFn) {
  const url = cfg.apiUrl + '/repos/' + cfg.repo + '/issues/comments/' + commentId;
  const res = await fetchFn(url, {
    method: 'PATCH',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(cfg.token)),
    body: JSON.stringify({ body })
  });
  if (!res.ok) throw new Error('GitHub API error updating PR comment: ' + res.status + ' ' + await res.text());
  return res.json();
}

function formatCommentBody(title, summary, threshold) {
  const lines = [];
  lines.push(MARKER);
  lines.push('## ' + title);
  lines.push('');
  if (summary.overallPercent === null) {
    lines.push('No coverage data found.');
  } else {
    lines.push('**Overall: ' + summary.overallPercent + '%** (' + summary.linesHit + '/' + summary.linesFound + ' lines)');
    if (threshold !== null) {
      const pass = summary.overallPercent >= threshold;
      lines.push('');
      lines.push((pass ? '✅ Meets' : '❌ Below') + ' the required ' + threshold + '% threshold.');
    }
    lines.push('');
    lines.push('| File | Coverage | Lines |');
    lines.push('|---|---|---|');
    for (const f of summary.perFile) {
      lines.push('| ' + f.path + ' | ' + (f.percent === null ? 'n/a' : f.percent + '%') + ' | ' + f.hit + '/' + f.found + ' |');
    }
  }
  return lines.join('\n');
}

module.exports = { MARKER, readPullRequestNumber, findExistingComment, createComment, updateComment, formatCommentBody };
