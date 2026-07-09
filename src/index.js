'use strict';
// simple-coverage — round 4: hardened fail-loud validation (missing token/
// repo when comment is enabled, zero real coverage records found across
// matched files) + correct threshold-fail ordering: the comment is posted
// FIRST so the number is visible, then the run fails loud afterward if
// coverage is below threshold — never the reverse.
const fs = require('fs');
const { resolveFiles } = require('./glob');
const { parseLcov, mergeRecordSets, summarize } = require('./lcov');
const gh = require('./github');

class FailLoud extends Error {}

function readBool(env, key, def) {
  const raw = env['INPUT_' + key];
  if (raw === undefined || raw === '') return def;
  const v = raw.trim().toLowerCase();
  if (v !== 'true' && v !== 'false') {
    throw new FailLoud('Input "' + key.toLowerCase() + '" must be "true" or "false", got "' + raw + '".');
  }
  return v === 'true';
}

function readConfig(env) {
  env = env || process.env;
  const lcovRaw = env['INPUT_LCOV'];
  if (!lcovRaw || !lcovRaw.trim()) {
    throw new FailLoud('Required input "lcov" is missing. Set it to a glob pattern, e.g. "coverage/lcov.info".');
  }
  const patterns = lcovRaw.split('\n').map(s => s.trim()).filter(Boolean);

  let threshold = null;
  const thresholdRaw = env['INPUT_THRESHOLD'];
  if (thresholdRaw !== undefined && thresholdRaw.trim() !== '') {
    threshold = Number(thresholdRaw);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      throw new FailLoud('Input "threshold" must be a number between 0 and 100, got "' + thresholdRaw + '".');
    }
  }

  const comment = readBool(env, 'COMMENT', true);
  const title = env['INPUT_TITLE'] || 'Coverage Report';

  const repo = env['GITHUB_REPOSITORY'] || '';
  const token = env['GITHUB_TOKEN'] || env['INPUT_GITHUB_TOKEN'] || '';
  const apiUrl = env['GITHUB_API_URL'] || 'https://api.github.com';
  const cwd = env['GITHUB_WORKSPACE'] || process.cwd();
  const eventPath = env['GITHUB_EVENT_PATH'] || '';

  if (comment) {
    if (!repo || !repo.includes('/')) {
      throw new FailLoud('GITHUB_REPOSITORY is missing or malformed ("' + repo + '"). Required when comment=true (the default). Set comment: "false" if you only want the raw numbers.');
    }
    if (!token) {
      throw new FailLoud('No GitHub token available, but comment=true (the default). Pass one via `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, or set comment: "false" to skip commenting.');
    }
  }

  return { patterns, threshold, comment, title, repo, token, apiUrl, cwd, eventPath };
}

async function run(env, fetchFn) {
  const cfg = readConfig(env);

  const files = resolveFiles(cfg.patterns, cfg.cwd);
  if (files.length === 0) {
    throw new FailLoud('No files matched the given "lcov" pattern(s): ' + JSON.stringify(cfg.patterns) + '. Nothing to report.');
  }

  const recordSets = files.map(f => parseLcov(fs.readFileSync(f, 'utf8')));
  const merged = mergeRecordSets(recordSets);
  const summary = summarize(merged);

  if (summary.linesFound === 0) {
    throw new FailLoud('Matched ' + files.length + ' file(s) (' + files.join(', ') + ') but found zero coverage records in any of them. ' +
      'Check these are real lcov reports (should contain SF: and DA: lines), not empty or the wrong file.');
  }

  let commentPosted = false;
  let commentUrl = null;
  const prNumber = gh.readPullRequestNumber(cfg);

  if (cfg.comment && prNumber) {
    const body = gh.formatCommentBody(cfg.title, summary, cfg.threshold);
    const existing = await gh.findExistingComment(cfg, prNumber, fetchFn);
    const result = existing
      ? await gh.updateComment(cfg, existing.id, body, fetchFn)
      : await gh.createComment(cfg, prNumber, body, fetchFn);
    commentPosted = true;
    commentUrl = result.html_url;
  }

  const thresholdPass = cfg.threshold === null ? null : summary.overallPercent >= cfg.threshold;

  return { cfg, files, summary, prNumber, commentPosted, commentUrl, thresholdPass };
}

async function main() {
  let result;
  try {
    result = await run(process.env, fetch);
  } catch (e) {
    if (e instanceof FailLoud) {
      console.error('::error::' + e.message);
      process.exitCode = 1;
      return;
    }
    console.error('::error::' + (e && e.message ? e.message : String(e)));
    process.exitCode = 1;
    return;
  }

  console.log('Coverage: ' + result.summary.overallPercent + '% (' + result.summary.linesHit + '/' + result.summary.linesFound + ' lines)');
  if (result.commentPosted) console.log('PR comment: ' + result.commentUrl);
  else console.log('No PR comment posted (comment=' + result.cfg.comment + ', prNumber=' + result.prNumber + ')');

  const outFile = process.env['GITHUB_OUTPUT'];
  if (outFile) {
    fs.appendFileSync(outFile, 'coverage_percent=' + result.summary.overallPercent + '\n');
    fs.appendFileSync(outFile, 'lines_hit=' + result.summary.linesHit + '\n');
    fs.appendFileSync(outFile, 'lines_found=' + result.summary.linesFound + '\n');
  }

  // Threshold check happens LAST, after the comment is already posted — the
  // number stays visible on the PR even when the run goes on to fail.
  if (result.thresholdPass === false) {
    console.error('::error::Coverage ' + result.summary.overallPercent + '% is below the required ' + result.cfg.threshold + '% threshold.');
    process.exitCode = 1;
  }
}

module.exports = { readConfig, run, FailLoud };

if (require.main === module) {
  main();
}
