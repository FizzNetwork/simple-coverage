'use strict';
// Minimal, dependency-free glob. Supports '*' within a single path segment
// plus literal paths. Deliberately no recursive '**' — keeps matching
// behavior obvious and auditable rather than clever.
const fs = require('fs');
const path = require('path');

function escapeRegex(s) { return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }

function matchSegment(pattern, name) {
  const re = new RegExp('^' + pattern.split('*').map(escapeRegex).join('.*') + '$');
  return re.test(name);
}

function resolveOne(pattern, cwd) {
  const full = path.isAbsolute(pattern) ? pattern : path.join(cwd, pattern);
  const dir = path.dirname(full);
  const base = path.basename(full);
  if (!base.includes('*')) {
    return (fs.existsSync(full) && fs.statSync(full).isFile()) ? [full] : [];
  }
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => matchSegment(base, name))
    .map(name => path.join(dir, name))
    .filter(p => fs.statSync(p).isFile())
    .sort();
}

function resolveFiles(patterns, cwd) {
  cwd = cwd || process.cwd();
  const seen = new Set();
  const out = [];
  for (const p of patterns) {
    for (const f of resolveOne(p, cwd)) {
      if (!seen.has(f)) { seen.add(f); out.push(f); }
    }
  }
  return out;
}

module.exports = { resolveFiles };
