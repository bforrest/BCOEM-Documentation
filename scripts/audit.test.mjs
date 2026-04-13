import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs, collectDocFiles, checkBrokenLinks, checkCaseSensitivity, checkMdxHazards, checkSidebarEntries, checkBasePath, checkImagePaths, checkSchemaDrift, runAudit } from './audit.mjs';

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

describe('checkBrokenLinks', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns no findings when link target exists (.md)', () => {
    dir = makeTempDocs({
      'guides/page.md': '[see ref](../reference/exists)',
      'reference/exists.md': '# Exists',
    });
    const files = collectDocFiles(dir);
    expect(checkBrokenLinks(files)).toHaveLength(0);
  });

  it('flags a link whose target does not exist', () => {
    dir = makeTempDocs({
      'guides/page.md': '[broken](../reference/missing)',
    });
    const files = collectDocFiles(dir);
    const findings = checkBrokenLinks(files);
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('broken-links');
    expect(findings[0].text).toBe('../reference/missing');
  });

  it('skips external links', () => {
    dir = makeTempDocs({
      'guides/page.md': '[ext](https://example.com)',
    });
    const files = collectDocFiles(dir);
    expect(checkBrokenLinks(files)).toHaveLength(0);
  });

  it('skips absolute paths', () => {
    dir = makeTempDocs({
      'guides/page.md': '[abs](/some/path)',
    });
    const files = collectDocFiles(dir);
    expect(checkBrokenLinks(files)).toHaveLength(0);
  });

  it('resolves .mdx extension', () => {
    dir = makeTempDocs({
      'guides/page.md': '[see ref](../reference/thing)',
      'reference/thing.mdx': '# Thing',
    });
    const files = collectDocFiles(dir);
    expect(checkBrokenLinks(files)).toHaveLength(0);
  });

  it('includes line number in finding', () => {
    dir = makeTempDocs({
      'guides/page.md': '# Title\n\nSee [broken](./nope)',
    });
    const files = collectDocFiles(dir);
    const findings = checkBrokenLinks(files);
    expect(findings[0].line).toBe(3);
  });

  it('finds multiple links on separate lines in the same file', () => {
    dir = makeTempDocs({
      'guides/page.md': '[first](./first)\n[second](./second)\n[third](./third)',
    });
    const files = collectDocFiles(dir);
    const findings = checkBrokenLinks(files);
    // all three targets are missing, so we should get 3 findings
    expect(findings).toHaveLength(3);
  });
});

describe('checkCaseSensitivity', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns no findings when case matches exactly', () => {
    dir = makeTempDocs({
      'guides/page.md': '[ref](../reference/Example)',
      'reference/Example.md': '# Ex',
    });
    const files = collectDocFiles(dir);
    expect(checkCaseSensitivity(files)).toHaveLength(0);
  });

  it('flags when link case differs from disk filename', () => {
    dir = makeTempDocs({
      'guides/page.md': '[ref](../reference/example)',
      'reference/Example.md': '# Ex',
    });
    const files = collectDocFiles(dir);
    const findings = checkCaseSensitivity(files);
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('case-sensitivity');
    expect(findings[0].message).toMatch(/Example/);
  });

  it('skips links where parent directory does not exist', () => {
    dir = makeTempDocs({
      'guides/page.md': '[ref](../nonexistent/thing)',
    });
    const files = collectDocFiles(dir);
    expect(checkCaseSensitivity(files)).toHaveLength(0);
  });
});

describe('checkMdxHazards', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('ignores .md files (only checks .mdx)', () => {
    dir = makeTempDocs({ 'guides/plain.md': 'Some {text} here' });
    const files = collectDocFiles(dir);
    expect(checkMdxHazards(files)).toHaveLength(0);
  });

  it('flags unescaped { in MDX prose', () => {
    dir = makeTempDocs({
      'good-to-know/page.mdx': '---\ntitle: T\n---\n\nUse margin: {0px} for this.',
    });
    const files = collectDocFiles(dir);
    const findings = checkMdxHazards(files);
    expect(findings.some((f) => f.check === 'mdx-hazards')).toBe(true);
    expect(findings.some((f) => f.message.includes('unescaped'))).toBe(true);
  });

  it('does not flag { inside a code fence', () => {
    dir = makeTempDocs({
      'good-to-know/page.mdx': '---\ntitle: T\n---\n\n```css\nmargin: {0px}\n```',
    });
    const files = collectDocFiles(dir);
    expect(checkMdxHazards(files)).toHaveLength(0);
  });

  it('does not flag { in inline code', () => {
    dir = makeTempDocs({
      'good-to-know/page.mdx': '---\ntitle: T\n---\n\nUse `{value}` in JSX.',
    });
    const files = collectDocFiles(dir);
    expect(checkMdxHazards(files)).toHaveLength(0);
  });

  it('does not flag { on lines starting with < (JSX component lines)', () => {
    dir = makeTempDocs({
      'good-to-know/page.mdx':
        '---\ntitle: T\n---\n\n<Component prop={value}>\n  content\n</Component>',
    });
    const files = collectDocFiles(dir);
    const unescaped = checkMdxHazards(files).filter((f) => f.message.includes('unescaped'));
    expect(unescaped).toHaveLength(0);
  });

  it('flags raw Markdown list inside JSX component', () => {
    dir = makeTempDocs({
      'good-to-know/page.mdx':
        '---\ntitle: T\n---\n\n<Thread>\n- item one\n- item two\n</Thread>',
    });
    const files = collectDocFiles(dir);
    const findings = checkMdxHazards(files).filter((f) => f.message.includes('Markdown list'));
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not flag Markdown list outside JSX', () => {
    dir = makeTempDocs({
      'good-to-know/page.mdx': '---\ntitle: T\n---\n\n- item one\n- item two',
    });
    const files = collectDocFiles(dir);
    const findings = checkMdxHazards(files).filter((f) => f.message.includes('Markdown list'));
    expect(findings).toHaveLength(0);
  });
});

describe('checkSidebarEntries', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns no findings when all guide files are in sidebar', () => {
    dir = makeTempDocs({ 'guides/example.md': '# Ex' });
    const files = collectDocFiles(dir);
    const configPath = join(dir, 'astro.config.mjs');
    writeFileSync(configPath, `export default { sidebar: [{ items: [{ label: 'Ex', slug: 'guides/example' }] }] }`);
    expect(checkSidebarEntries(files, configPath)).toHaveLength(0);
  });

  it('flags a guide file missing from sidebar', () => {
    dir = makeTempDocs({
      'guides/example.md': '# Ex',
      'guides/new-page.md': '# New',
    });
    const files = collectDocFiles(dir);
    const configPath = join(dir, 'astro.config.mjs');
    writeFileSync(configPath, `export default { sidebar: [{ items: [{ label: 'Ex', slug: 'guides/example' }] }] }`);
    const findings = checkSidebarEntries(files, configPath);
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('sidebar');
    expect(findings[0].text).toBe('guides/new-page');
  });

  it('does not flag files in autogenerated directories (reference, good-to-know)', () => {
    dir = makeTempDocs({
      'reference/item.md': '# Item',
      'good-to-know/tip.md': '# Tip',
    });
    const files = collectDocFiles(dir);
    const configPath = join(dir, 'astro.config.mjs');
    writeFileSync(configPath, `export default { sidebar: [] }`);
    expect(checkSidebarEntries(files, configPath)).toHaveLength(0);
  });
});

describe('checkBasePath', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('flags hardcoded base path in href', () => {
    dir = makeTempDocs({
      'guides/page.md': '<a href="/BCOEM-Documentation/guides/example">link</a>',
    });
    const files = collectDocFiles(dir);
    const findings = checkBasePath(files, '/BCOEM-Documentation');
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('base-path');
  });

  it('flags hardcoded base path in src', () => {
    dir = makeTempDocs({
      'guides/page.md': '<img src="/BCOEM-Documentation/assets/img.png" />',
    });
    const files = collectDocFiles(dir);
    const findings = checkBasePath(files, '/BCOEM-Documentation');
    expect(findings).toHaveLength(1);
  });

  it('returns no findings for other paths', () => {
    dir = makeTempDocs({
      'guides/page.md': '<a href="/other/path">link</a>',
    });
    const files = collectDocFiles(dir);
    expect(checkBasePath(files, '/BCOEM-Documentation')).toHaveLength(0);
  });
});

describe('checkImagePaths', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns no findings when image exists relative to file', () => {
    dir = makeTempDocs({ 'guides/page.md': '![alt](./img.png)' });
    // create img.png next to page.md
    writeFileSync(join(dir, 'guides/img.png'), '');
    const files = collectDocFiles(dir);
    expect(checkImagePaths(files, join(dir, 'assets'), join(dir, 'public'))).toHaveLength(0);
  });

  it('returns no findings when image exists in assetsDir', () => {
    dir = makeTempDocs({ 'guides/page.md': '![alt](../assets/img.png)' });
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'assets/img.png'), '');
    const files = collectDocFiles(dir);
    expect(checkImagePaths(files, join(dir, 'assets'), join(dir, 'public'))).toHaveLength(0);
  });

  it('flags an image that does not exist anywhere', () => {
    dir = makeTempDocs({ 'guides/page.md': '![alt](./missing.png)' });
    const files = collectDocFiles(dir);
    const findings = checkImagePaths(files, join(dir, 'assets'), join(dir, 'public'));
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('image-paths');
  });

  it('skips external image URLs', () => {
    dir = makeTempDocs({ 'guides/page.md': '![alt](https://example.com/img.png)' });
    const files = collectDocFiles(dir);
    expect(checkImagePaths(files, '/tmp/assets', '/tmp/public')).toHaveLength(0);
  });
});

describe('checkSchemaDrift', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns no findings for valid frontmatter with title', async () => {
    dir = makeTempDocs({ 'guides/page.md': '---\ntitle: My Page\n---\n\n# Content' });
    const files = collectDocFiles(dir);
    expect(await checkSchemaDrift(files)).toHaveLength(0);
  });

  it('flags missing title', async () => {
    dir = makeTempDocs({ 'guides/page.md': '---\ndescription: No title\n---\n\n# Content' });
    const files = collectDocFiles(dir);
    const findings = await checkSchemaDrift(files);
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('schema-drift');
    expect(findings[0].message).toMatch(/title/);
  });

  it('flags non-string description', async () => {
    dir = makeTempDocs({ 'guides/page.md': '---\ntitle: T\ndescription: 42\n---\n\n# Content' });
    const files = collectDocFiles(dir);
    const findings = await checkSchemaDrift(files);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/description/);
  });

  it('allows missing description (it is optional)', async () => {
    dir = makeTempDocs({ 'guides/page.md': '---\ntitle: T\n---\n\n# Content' });
    const files = collectDocFiles(dir);
    expect(await checkSchemaDrift(files)).toHaveLength(0);
  });

  it('allows valid string description', async () => {
    dir = makeTempDocs({ 'guides/page.md': '---\ntitle: T\ndescription: A description\n---\n' });
    const files = collectDocFiles(dir);
    expect(await checkSchemaDrift(files)).toHaveLength(0);
  });
});

import { runAudit } from './audit.mjs';

describe('runAudit', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns a report with correct shape', async () => {
    dir = mkdtempSync(join(tmpdir(), 'runaudit-test-'));
    const docsDir = join(dir, 'src/content/docs/guides');
    mkdirSync(docsDir, { recursive: true });
    mkdirSync(join(dir, 'src/assets'), { recursive: true });
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(docsDir, 'example.md'), '---\ntitle: Example\n---\n\n# Hello');
    writeFileSync(
      join(dir, 'astro.config.mjs'),
      `export default defineConfig({ base: '/BCOEM-Documentation', integrations: [starlight({ sidebar: [{ items: [{ slug: 'guides/example' }] }] })] })`
    );

    const report = await runAudit({ rootDir: dir });

    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('deep', false);
    expect(report.summary).toHaveProperty('totalFindings');
    expect(typeof report.summary.totalFindings).toBe('number');
    expect(Array.isArray(report.summary.passed)).toBe(true);
    expect(Array.isArray(report.summary.failed)).toBe(true);
    expect(Array.isArray(report.findings)).toBe(true);
  });

  it('runs deep checks when deep:true', async () => {
    dir = mkdtempSync(join(tmpdir(), 'runaudit-deep-'));
    const docsDir = join(dir, 'src/content/docs/guides');
    mkdirSync(docsDir, { recursive: true });
    mkdirSync(join(dir, 'src/assets'), { recursive: true });
    mkdirSync(join(dir, 'public'), { recursive: true });
    writeFileSync(join(docsDir, 'example.md'), '---\ntitle: Example\n---\n\n# Hello');
    writeFileSync(join(dir, 'astro.config.mjs'), `export default { base: '/BCOEM-Documentation' }`);

    const report = await runAudit({ rootDir: dir, deep: true });

    expect(report.deep).toBe(true);
    const allChecks = report.summary.passed.concat(report.summary.failed);
    expect(allChecks).toContain('image-paths');
    expect(allChecks).toContain('schema-drift');
  });

  it('file paths in findings are relative to rootDir', async () => {
    dir = mkdtempSync(join(tmpdir(), 'runaudit-paths-'));
    const docsDir = join(dir, 'src/content/docs/guides');
    mkdirSync(docsDir, { recursive: true });
    mkdirSync(join(dir, 'src/assets'), { recursive: true });
    mkdirSync(join(dir, 'public'), { recursive: true });
    // file with broken link to ensure findings exist
    writeFileSync(join(docsDir, 'page.md'), '---\ntitle: Page\n---\n\n[broken](./missing)');
    writeFileSync(join(dir, 'astro.config.mjs'), `export default { base: '/BCOEM-Documentation' }`);

    const report = await runAudit({ rootDir: dir });

    expect(report.findings.length).toBeGreaterThan(0);
    // All file paths should be relative (not start with /)
    for (const f of report.findings) {
      expect(f.file).not.toMatch(/^\//);
    }
  });
});
