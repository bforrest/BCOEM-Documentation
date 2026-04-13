#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, extname, join, relative, basename } from 'node:path';

// ─── Arg parsing ─────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  return { deep: argv.includes('--deep') };
}

// ─── File collection ─────────────────────────────────────────────────────────

export function collectDocFiles(docsDir) {
  const results = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(md|mdx)$/.test(entry.name)) {
        try {
          const content = readFileSync(full, 'utf-8');
          results.push({ path: full, content, lines: content.split('\n') });
        } catch {
          // skip unreadable files silently
        }
      }
    }
  }
  if (!existsSync(docsDir)) return [];
  walk(docsDir);
  return results;
}

// ─── Internal link extraction ────────────────────────────────────────────────

function extractInternalLinks(file) {
  const links = [];
  const mdLinkRe = /\[(?:[^\]]*)\]\(([^)#?\s]+)/g;
  const hrefRe = /href=['"]([^'"#?]+)/g;
  file.lines.forEach((line, i) => {
    let m;
    while ((m = mdLinkRe.exec(line)) !== null) {
      const t = m[1];
      if (!t.startsWith('http') && !t.startsWith('mailto') && !t.startsWith('/')) {
        links.push({ target: t, line: i + 1 });
      }
    }
    while ((m = hrefRe.exec(line)) !== null) {
      const t = m[1];
      if (!t.startsWith('http') && !t.startsWith('mailto') && !t.startsWith('/')) {
        links.push({ target: t, line: i + 1 });
      }
    }
  });
  return links;
}

function resolveDocLink(target, sourceFile) {
  const ext = extname(target);
  const base = join(dirname(sourceFile), target);
  if (ext === '.md' || ext === '.mdx') return [base];
  return [`${base}.md`, `${base}.mdx`, join(base, 'index.md'), join(base, 'index.mdx')];
}

// ─── Check: broken internal links ────────────────────────────────────────────

export function checkBrokenLinks(files) {
  const findings = [];
  for (const file of files) {
    for (const { target, line } of extractInternalLinks(file)) {
      const candidates = resolveDocLink(target, file.path);
      if (!candidates.some(existsSync)) {
        findings.push({
          check: 'broken-links',
          file: file.path,
          line,
          text: target,
          message: `Link target does not exist: ${target}`,
        });
      }
    }
  }
  return findings;
}

// ─── Check: case-sensitivity ─────────────────────────────────────────────────

export function checkCaseSensitivity(files) {
  const findings = [];
  for (const file of files) {
    for (const { target, line } of extractInternalLinks(file)) {
      const candidates = resolveDocLink(target, file.path);
      for (const candidate of candidates) {
        const dir = dirname(candidate);
        const expectedName = basename(candidate);
        if (!existsSync(dir)) continue;
        const actual = readdirSync(dir).find(
          (n) => n.toLowerCase() === expectedName.toLowerCase()
        );
        if (actual && actual !== expectedName) {
          findings.push({
            check: 'case-sensitivity',
            file: file.path,
            line,
            text: target,
            message: `Case mismatch: link uses "${expectedName}" but disk has "${actual}"`,
          });
          break;
        }
      }
    }
  }
  return findings;
}
