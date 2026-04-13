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
