'use strict';
// Minimal, dependency-free lcov ("linux test coverage") parser. lcov is the
// most universal cross-language coverage format — emitted natively or via a
// simple converter by JS/TS, Go, Ruby, Swift, C/C++, Rust, and more. We only
// need SF: (source file) and DA:<line>,<count> records; everything else
// (branch/function coverage, test names) is ignored for v1's line-coverage
// scope.
//
// Returns one array of records per parsed file: [{ sourceFile, lines: Map<lineNo, hitCount> }]
function parseLcov(text) {
  const records = [];
  let current = null;

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('SF:')) {
      current = { sourceFile: line.slice(3).trim(), lines: new Map() };
      continue;
    }
    if (line.startsWith('DA:')) {
      if (!current) continue; // malformed: DA before SF, skip rather than crash
      const parts = line.slice(3).split(',');
      const lineNo = Number(parts[0]);
      const hitCount = Number(parts[1]);
      if (Number.isFinite(lineNo) && Number.isFinite(hitCount)) {
        const prev = current.lines.get(lineNo) || 0;
        // Same line can legitimately appear twice within one record in some
        // tool output; keep the max rather than the last-seen value.
        current.lines.set(lineNo, Math.max(prev, hitCount));
      }
      continue;
    }
    if (line === 'end_of_record') {
      if (current) records.push(current);
      current = null;
      continue;
    }
    // TN:, FN:, FNDA:, FNF:, FNH:, BRDA:, BRF:, BRH:, LH:, LF: — ignored.
  }
  // Tolerate a missing trailing end_of_record.
  if (current) records.push(current);

  return records;
}

// Merges any number of parsed lcov results (from one or more files — e.g.
// sharded test runs that each cover an overlapping subset of files) into a
// single per-file line-hit map. Correctness matters here: two shards that
// both touch the same source file must NOT have their counts summed (that
// double-counts and can even show >100% or hide real gaps) — the real
// question for each line is "was it EVER hit across all runs," so we take
// the max hit count per line, matching what `lcov --add-tracefile` does.
function mergeRecordSets(recordSets) {
  const merged = new Map(); // sourceFile -> Map<lineNo, hitCount>
  for (const records of recordSets) {
    for (const rec of records) {
      let fileMap = merged.get(rec.sourceFile);
      if (!fileMap) {
        fileMap = new Map();
        merged.set(rec.sourceFile, fileMap);
      }
      for (const [lineNo, hitCount] of rec.lines) {
        const prev = fileMap.get(lineNo) || 0;
        fileMap.set(lineNo, Math.max(prev, hitCount));
      }
    }
  }
  return merged;
}

function summarize(merged) {
  const perFile = [];
  let linesHit = 0;
  let linesFound = 0;
  for (const [sourceFile, lineMap] of merged) {
    let fileHit = 0;
    for (const count of lineMap.values()) {
      if (count > 0) fileHit++;
    }
    const fileFound = lineMap.size;
    linesHit += fileHit;
    linesFound += fileFound;
    perFile.push({
      path: sourceFile,
      hit: fileHit,
      found: fileFound,
      percent: fileFound === 0 ? null : Math.round((fileHit / fileFound) * 10000) / 100
    });
  }
  perFile.sort((a, b) => a.path.localeCompare(b.path));
  const overallPercent = linesFound === 0 ? null : Math.round((linesHit / linesFound) * 10000) / 100;
  return { overallPercent, linesHit, linesFound, perFile };
}

module.exports = { parseLcov, mergeRecordSets, summarize };
