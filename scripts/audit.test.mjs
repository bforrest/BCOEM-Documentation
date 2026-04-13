import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs, collectDocFiles } from './audit.mjs';

function makeTempDocs(files) {
  const root = mkdtempSync(join(tmpdir(), 'audit-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe('parseArgs', () => {
  it('defaults deep to false', () => {
    expect(parseArgs([]).deep).toBe(false);
  });
  it('sets deep to true when --deep present', () => {
    expect(parseArgs(['--deep']).deep).toBe(true);
  });
  it('ignores unknown flags', () => {
    expect(parseArgs(['--foo']).deep).toBe(false);
  });
});

describe('collectDocFiles', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns .md files', () => {
    dir = makeTempDocs({ 'guides/example.md': '# Hello' });
    const files = collectDocFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].path).toContain('example.md');
  });

  it('returns .mdx files', () => {
    dir = makeTempDocs({ 'good-to-know/thing.mdx': '# MDX' });
    const files = collectDocFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].path).toContain('thing.mdx');
  });

  it('recurses into subdirectories', () => {
    dir = makeTempDocs({
      'guides/a.md': '# A',
      'reference/b.md': '# B',
    });
    const files = collectDocFiles(dir);
    expect(files).toHaveLength(2);
  });

  it('skips non-markdown files', () => {
    dir = makeTempDocs({
      'guides/example.md': '# Hello',
      'guides/image.png': 'binary',
    });
    const files = collectDocFiles(dir);
    expect(files).toHaveLength(1);
  });

  it('populates content and lines', () => {
    dir = makeTempDocs({ 'guides/a.md': 'line1\nline2' });
    const [file] = collectDocFiles(dir);
    expect(file.content).toBe('line1\nline2');
    expect(file.lines).toEqual(['line1', 'line2']);
  });

  it('returns empty array for non-existent directory', () => {
    expect(collectDocFiles('/tmp/does-not-exist-audit-test')).toEqual([]);
  });
});
