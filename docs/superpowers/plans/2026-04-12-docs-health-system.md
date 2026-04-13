# Docs Health System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an autonomous docs health system that audits the Starlight site on every PR and weekly, auto-fixes what it finds via a `claude -p` loop, and opens a PR with the results.

**Architecture:** A deterministic Node audit script (`scripts/audit.mjs`) scans docs files and emits structured JSON findings. A bash autofix script (`scripts/autofix.sh`) takes those findings, builds a focused prompt, invokes `claude -p` with restricted tool access, verifies with `npm run build`, retries up to 3×, then opens a PR. Two GitHub Actions workflows wire these together: a fast PR-time audit and a deep weekly cron.

**Tech Stack:** Node.js ESM, Vitest, gray-matter, GitHub Actions, `claude` CLI (`@anthropic-ai/claude-code`), `gh` CLI

---

## File Map

| File | Status | Purpose |
|---|---|---|
| `scripts/audit.mjs` | **Create** | Deterministic auditor — all check functions + CLI entry |
| `scripts/audit.test.mjs` | **Create** | Vitest unit tests for every exported audit function |
| `scripts/autofix.sh` | **Create** | Fix loop: branch → prompt → `claude -p` → build → PR |
| `docs/audit-report-template.md` | **Create** | Reference template for PR comment format |
| `.github/workflows/audit-pr.yml` | **Create** | Runs on every PR: fast audit + comment |
| `.github/workflows/audit-weekly.yml` | **Create** | Runs Monday 9am UTC: deep audit + auto-fix PR |
| `package.json` | **Modify** | Add `gray-matter` as dev dependency |

---

## Task 1: Install gray-matter and scaffold audit.mjs with parseArgs + file collection

**Files:**
- Create: `scripts/audit.mjs`
- Create: `scripts/audit.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Install gray-matter**

```bash
cd /path/to/BCOEM-Documentation
npm install -D gray-matter
```

Expected: `package.json` updated, `node_modules/gray-matter` present.

- [ ] **Step 2: Write failing tests for parseArgs and collectDocFiles**

Create `scripts/audit.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs, collectDocFiles } from './audit.mjs';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTempDocs(files) {
  const root = mkdtempSync(join(tmpdir(), 'audit-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

// ─── parseArgs ───────────────────────────────────────────────────────────────

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

// ─── collectDocFiles ─────────────────────────────────────────────────────────

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
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run scripts/audit.test.mjs
```

Expected: FAIL — `audit.mjs` does not exist.

- [ ] **Step 4: Create scripts/audit.mjs with parseArgs and collectDocFiles**

```javascript
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
        const content = readFileSync(full, 'utf-8');
        results.push({ path: full, content, lines: content.split('\n') });
      }
    }
  }
  walk(docsDir);
  return results;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run scripts/audit.test.mjs
```

Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/audit.mjs scripts/audit.test.mjs package.json package-lock.json
git commit -m "feat: scaffold audit.mjs with parseArgs and collectDocFiles"
```

---

## Task 2: Broken-links and case-sensitivity checks

**Files:**
- Modify: `scripts/audit.mjs` (append)
- Modify: `scripts/audit.test.mjs` (append)

- [ ] **Step 1: Append failing tests**

Append to `scripts/audit.test.mjs`:

```javascript
import { checkBrokenLinks, checkCaseSensitivity } from './audit.mjs';

// ─── checkBrokenLinks ────────────────────────────────────────────────────────

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
});

// ─── checkCaseSensitivity ────────────────────────────────────────────────────

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

  it('skips links where the parent directory does not exist', () => {
    dir = makeTempDocs({
      'guides/page.md': '[ref](../nonexistent/thing)',
    });
    const files = collectDocFiles(dir);
    expect(checkCaseSensitivity(files)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run scripts/audit.test.mjs
```

Expected: FAIL — `checkBrokenLinks` and `checkCaseSensitivity` not defined.

- [ ] **Step 3: Append link extraction helpers and check functions to audit.mjs**

Append to `scripts/audit.mjs`:

```javascript
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
  return [`${base}.md`, `${base}.mdx`, join(base, 'index.md'), join(base, 'index.mdx`)];
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
```

- [ ] **Step 4: Fix the backtick typo in resolveDocLink**

The template literal in `resolveDocLink` has a stray backtick. Ensure the function reads:

```javascript
function resolveDocLink(target, sourceFile) {
  const ext = extname(target);
  const base = join(dirname(sourceFile), target);
  if (ext === '.md' || ext === '.mdx') return [base];
  return [`${base}.md`, `${base}.mdx`, join(base, 'index.md'), join(base, 'index.mdx')];
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run scripts/audit.test.mjs
```

Expected: PASS — all tests including the new link/case tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/audit.mjs scripts/audit.test.mjs
git commit -m "feat: add checkBrokenLinks and checkCaseSensitivity"
```

---

## Task 3: MDX hazards check

**Files:**
- Modify: `scripts/audit.mjs` (append)
- Modify: `scripts/audit.test.mjs` (append)

- [ ] **Step 1: Append failing tests**

Append to `scripts/audit.test.mjs`:

```javascript
import { checkMdxHazards } from './audit.mjs';

describe('checkMdxHazards', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('ignores .md files', () => {
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

  it('does not flag { on JSX component lines', () => {
    dir = makeTempDocs({
      'good-to-know/page.mdx':
        '---\ntitle: T\n---\n\n<Component prop={value}>\n  content\n</Component>',
    });
    const files = collectDocFiles(dir);
    // JSX lines starting with < are exempt
    const unescaped = checkMdxHazards(files).filter((f) =>
      f.message.includes('unescaped')
    );
    expect(unescaped).toHaveLength(0);
  });

  it('flags raw Markdown list inside JSX component', () => {
    dir = makeTempDocs({
      'good-to-know/page.mdx':
        '---\ntitle: T\n---\n\n<Thread>\n- item one\n- item two\n</Thread>',
    });
    const files = collectDocFiles(dir);
    const findings = checkMdxHazards(files).filter((f) =>
      f.message.includes('Markdown list')
    );
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not flag Markdown list outside JSX', () => {
    dir = makeTempDocs({
      'good-to-know/page.mdx': '---\ntitle: T\n---\n\n- item one\n- item two',
    });
    const files = collectDocFiles(dir);
    const findings = checkMdxHazards(files).filter((f) =>
      f.message.includes('Markdown list')
    );
    expect(findings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run scripts/audit.test.mjs
```

Expected: FAIL — `checkMdxHazards` not defined.

- [ ] **Step 3: Append checkMdxHazards to audit.mjs**

```javascript
// ─── Check: MDX hazards ───────────────────────────────────────────────────────

export function checkMdxHazards(files) {
  const findings = [];
  for (const file of files) {
    if (!file.path.endsWith('.mdx')) continue;

    let inFence = false;
    let jsxDepth = 0;

    file.lines.forEach((line, i) => {
      const lineNum = i + 1;
      const trimmed = line.trim();

      // Track code fences
      if (/^```|^~~~/.test(trimmed)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;

      // Skip frontmatter, imports, blank lines
      if (/^---/.test(trimmed) || /^import\s/.test(trimmed) || trimmed === '') return;

      // Track JSX depth by counting opens/closes of PascalCase components
      const opens = (line.match(/<[A-Z][A-Za-z]*(?:\s[^>]*)?>(?!.*\/>)/g) || []).length;
      const closes = (line.match(/<\/[A-Z][A-Za-z]*>/g) || []).length;
      const selfClose = (line.match(/<[A-Z][A-Za-z]*[^>]*\/>/g) || []).length;
      jsxDepth = Math.max(0, jsxDepth + opens - closes - selfClose);

      // Remove inline code before checking for bare {
      const stripped = line.replace(/`[^`]+`/g, '___');

      // Unescaped { in prose: not on a JSX component line (starting with <),
      // not a JSX expression line (starting with {)
      if (stripped.includes('{') && !/^\s*[<{]/.test(line)) {
        findings.push({
          check: 'mdx-hazards',
          file: file.path,
          line: lineNum,
          text: trimmed.substring(0, 80),
          message: 'Potential unescaped { in prose — escape as \\{ or move into a code block',
        });
      }

      // Raw Markdown list inside an open JSX component
      if (jsxDepth > 0 && /^\s*[-*]\s+/.test(line)) {
        findings.push({
          check: 'mdx-hazards',
          file: file.path,
          line: lineNum,
          text: trimmed.substring(0, 80),
          message: 'Raw Markdown list inside JSX component — use <ul>/<li> instead',
        });
      }
    });
  }
  return findings;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/audit.test.mjs
```

Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/audit.mjs scripts/audit.test.mjs
git commit -m "feat: add checkMdxHazards"
```

---

## Task 4: Sidebar and base-path checks

**Files:**
- Modify: `scripts/audit.mjs` (append)
- Modify: `scripts/audit.test.mjs` (append)

- [ ] **Step 1: Append failing tests**

Append to `scripts/audit.test.mjs`:

```javascript
import { checkSidebarEntries, checkBasePath } from './audit.mjs';

// ─── checkSidebarEntries ──────────────────────────────────────────────────────

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

  it('does not flag files in autogenerated directories', () => {
    dir = makeTempDocs({
      'reference/item.md': '# Item',
      'good-to-know/tip.md': '# Tip',
    });
    const files = collectDocFiles(dir);
    const configPath = join(dir, 'astro.config.mjs');
    writeFileSync(configPath, `export default { sidebar: [] }`);
    // reference/ and good-to-know/ are autogenerated — no findings expected
    expect(checkSidebarEntries(files, configPath)).toHaveLength(0);
  });
});

// ─── checkBasePath ───────────────────────────────────────────────────────────

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run scripts/audit.test.mjs
```

Expected: FAIL — `checkSidebarEntries` and `checkBasePath` not defined.

- [ ] **Step 3: Append both check functions to audit.mjs**

```javascript
// ─── Check: missing sidebar entries ──────────────────────────────────────────

export function checkSidebarEntries(files, configPath) {
  const findings = [];
  const configContent = readFileSync(configPath, 'utf-8');

  // Extract manually-listed slugs (e.g. slug: 'guides/example')
  const slugRe = /slug:\s*['"]([^'"]+)['"]/g;
  const listedSlugs = new Set();
  let m;
  while ((m = slugRe.exec(configContent)) !== null) {
    listedSlugs.add(m[1]);
  }

  // Only check files in guides/ — reference/ and good-to-know/ are autogenerated
  const guideFiles = files.filter((f) => /\/guides\//.test(f.path));
  for (const file of guideFiles) {
    // Derive slug: strip everything up to and including /docs/, remove extension
    const slugMatch = file.path.match(/\/docs\/(.+)\.(md|mdx)$/);
    if (!slugMatch) continue;
    const slug = slugMatch[1];
    if (!listedSlugs.has(slug)) {
      findings.push({
        check: 'sidebar',
        file: file.path,
        line: 1,
        text: slug,
        message: `Guide file "${slug}" has no sidebar entry in astro.config.mjs`,
      });
    }
  }
  return findings;
}

// ─── Check: hardcoded base-path ───────────────────────────────────────────────

export function checkBasePath(files, basePath) {
  const findings = [];
  const escaped = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:href|src)=['"][^'"]*${escaped}`, 'g');
  for (const file of files) {
    file.lines.forEach((line, i) => {
      re.lastIndex = 0;
      if (re.test(line)) {
        findings.push({
          check: 'base-path',
          file: file.path,
          line: i + 1,
          text: line.trim().substring(0, 80),
          message: `Hardcoded base path "${basePath}" in href/src — let Astro's base config handle this`,
        });
      }
    });
  }
  return findings;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/audit.test.mjs
```

Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/audit.mjs scripts/audit.test.mjs
git commit -m "feat: add checkSidebarEntries and checkBasePath"
```

---

## Task 5: Deep checks — image paths and schema drift

**Files:**
- Modify: `scripts/audit.mjs` (append)
- Modify: `scripts/audit.test.mjs` (append)

- [ ] **Step 1: Append failing tests**

Append to `scripts/audit.test.mjs`:

```javascript
import { checkImagePaths, checkSchemaDrift } from './audit.mjs';

// ─── checkImagePaths ──────────────────────────────────────────────────────────

describe('checkImagePaths', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns no findings when image exists in assets dir', () => {
    dir = makeTempDocs({ 'guides/page.md': '![alt](../assets/img.png)' });
    const assetsDir = join(dir, '../assets');
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, 'img.png'), '');
    const files = collectDocFiles(dir);
    expect(checkImagePaths(files, assetsDir, join(dir, '../public'))).toHaveLength(0);
  });

  it('flags an image that does not exist anywhere', () => {
    dir = makeTempDocs({ 'guides/page.md': '![alt](../assets/missing.png)' });
    const files = collectDocFiles(dir);
    const findings = checkImagePaths(files, join(dir, '../assets'), join(dir, '../public'));
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe('image-paths');
  });

  it('skips external image URLs', () => {
    dir = makeTempDocs({ 'guides/page.md': '![alt](https://example.com/img.png)' });
    const files = collectDocFiles(dir);
    expect(checkImagePaths(files, '/tmp/assets', '/tmp/public')).toHaveLength(0);
  });
});

// ─── checkSchemaDrift ─────────────────────────────────────────────────────────

describe('checkSchemaDrift', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns no findings for valid frontmatter', async () => {
    dir = makeTempDocs({ 'guides/page.md': '---\ntitle: My Page\n---\n\n# Content' });
    const files = collectDocFiles(dir);
    expect(await checkSchemaDrift(files)).toHaveLength(0);
  });

  it('flags missing title', async () => {
    dir = makeTempDocs({ 'guides/page.md': '---\ndescription: No title here\n---\n\n# Content' });
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

  it('allows missing description', async () => {
    dir = makeTempDocs({ 'guides/page.md': '---\ntitle: T\n---\n\n# Content' });
    const files = collectDocFiles(dir);
    expect(await checkSchemaDrift(files)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run scripts/audit.test.mjs
```

Expected: FAIL — `checkImagePaths` and `checkSchemaDrift` not defined.

- [ ] **Step 3: Append both check functions to audit.mjs**

```javascript
// ─── Check: image paths (deep) ────────────────────────────────────────────────

export function checkImagePaths(files, assetsDir, publicDir) {
  const findings = [];
  const imgRe = /!\[[^\]]*\]\(([^)#?\s]+)/g;
  const srcRe = /src=['"]([^'"#?]+)/g;
  for (const file of files) {
    file.lines.forEach((line, i) => {
      let m;
      const targets = [];
      while ((m = imgRe.exec(line)) !== null) targets.push(m[1]);
      while ((m = srcRe.exec(line)) !== null) targets.push(m[1]);
      for (const target of targets) {
        if (target.startsWith('http')) continue;
        const candidates = [
          join(dirname(file.path), target),
          join(assetsDir, target.replace(/^\.?\//, '')),
          join(publicDir, target.replace(/^\.?\//, '')),
        ];
        if (!candidates.some(existsSync)) {
          findings.push({
            check: 'image-paths',
            file: file.path,
            line: i + 1,
            text: target,
            message: `Image not found: ${target}`,
          });
        }
      }
    });
  }
  return findings;
}

// ─── Check: schema drift (deep) ───────────────────────────────────────────────

export async function checkSchemaDrift(files) {
  const { default: matter } = await import('gray-matter');
  const findings = [];
  for (const file of files) {
    const { data } = matter(file.content);
    if (!data.title || typeof data.title !== 'string') {
      findings.push({
        check: 'schema-drift',
        file: file.path,
        line: 1,
        text: JSON.stringify(data.title ?? null),
        message: 'Missing or non-string "title" in frontmatter (required by Starlight)',
      });
    }
    if (data.description !== undefined && typeof data.description !== 'string') {
      findings.push({
        check: 'schema-drift',
        file: file.path,
        line: 1,
        text: JSON.stringify(data.description),
        message: '"description" frontmatter must be a string if present',
      });
    }
  }
  return findings;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run scripts/audit.test.mjs
```

Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/audit.mjs scripts/audit.test.mjs
git commit -m "feat: add checkImagePaths and checkSchemaDrift (deep checks)"
```

---

## Task 6: runAudit orchestrator and CLI entry point

**Files:**
- Modify: `scripts/audit.mjs` (append)
- Modify: `scripts/audit.test.mjs` (append)

- [ ] **Step 1: Append integration test**

Append to `scripts/audit.test.mjs`:

```javascript
import { runAudit } from './audit.mjs';
import { writeFileSync } from 'node:fs';

describe('runAudit', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns a report with correct shape', async () => {
    // Minimal valid project layout
    dir = mkdtempSync(join(tmpdir(), 'runaudit-test-'));
    const docsDir = join(dir, 'src/content/docs/guides');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, 'example.md'), '---\ntitle: Example\n---\n\n# Hello');
    writeFileSync(
      join(dir, 'astro.config.mjs'),
      `export default { base: '/BCOEM-Documentation', integrations: [{ sidebar: [{ items: [{ slug: 'guides/example' }] }] }] }`
    );

    const report = await runAudit({ rootDir: dir });

    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('deep', false);
    expect(report.summary).toHaveProperty('totalFindings');
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
    expect(report.summary.passed.concat(report.summary.failed)).toContain('image-paths');
    expect(report.summary.passed.concat(report.summary.failed)).toContain('schema-drift');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run scripts/audit.test.mjs
```

Expected: FAIL — `runAudit` not defined.

- [ ] **Step 3: Append runAudit and CLI entry to audit.mjs**

```javascript
// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runAudit({ deep = false, rootDir = process.cwd() } = {}) {
  const docsDir = join(rootDir, 'src/content/docs');
  const assetsDir = join(rootDir, 'src/assets');
  const publicDir = join(rootDir, 'public');
  const configPath = join(rootDir, 'astro.config.mjs');

  // Read base path from config
  const configContent = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';
  const baseMatch = configContent.match(/base:\s*['"]([^'"]+)['"]/);
  const basePath = baseMatch ? baseMatch[1] : '';

  const files = collectDocFiles(docsDir);

  const allFindings = [
    ...checkBrokenLinks(files),
    ...checkCaseSensitivity(files),
    ...checkMdxHazards(files),
    ...(existsSync(configPath) ? checkSidebarEntries(files, configPath) : []),
    ...(basePath ? checkBasePath(files, basePath) : []),
  ];

  if (deep) {
    allFindings.push(
      ...checkImagePaths(files, assetsDir, publicDir),
      ...(await checkSchemaDrift(files))
    );
  }

  // Relativise file paths
  const findings = allFindings.map((f) => ({
    ...f,
    file: relative(rootDir, f.file ?? f.path),
  }));

  const allChecks = ['broken-links', 'case-sensitivity', 'mdx-hazards', 'sidebar', 'base-path'];
  if (deep) allChecks.push('image-paths', 'schema-drift');

  const failedChecks = [...new Set(findings.map((f) => f.check))];
  const passedChecks = allChecks.filter((c) => !failedChecks.includes(c));

  return {
    timestamp: new Date().toISOString(),
    deep,
    summary: { totalFindings: findings.length, passed: passedChecks, failed: failedChecks },
    findings,
  };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('audit.mjs')) {
  const { deep } = parseArgs(process.argv.slice(2));
  runAudit({ deep }).then((report) => {
    writeFileSync('audit-report.json', JSON.stringify(report, null, 2));
    const { totalFindings } = report.summary;
    console.log(`Audit complete: ${totalFindings} finding(s)`);
    for (const f of report.findings) {
      console.log(`  [${f.check}] ${f.file}:${f.line} — ${f.message}`);
    }
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: PASS — all tests in scripts/ and src/.

- [ ] **Step 5: Smoke-test the CLI**

```bash
node scripts/audit.mjs
cat audit-report.json
```

Expected: valid JSON written to `audit-report.json`, console output listing findings (or "0 finding(s)").

- [ ] **Step 6: Commit**

```bash
git add scripts/audit.mjs scripts/audit.test.mjs
git commit -m "feat: add runAudit orchestrator and CLI entry point"
```

---

## Task 7: Create audit report template

**Files:**
- Create: `docs/audit-report-template.md`

- [ ] **Step 1: Create the template**

Create `docs/audit-report-template.md`:

```markdown
## Docs Health Audit — {DATE}

**Mode:** {MODE}
**Build:** {BUILD_STATUS}

### Summary

| Check | Status | Findings |
|---|---|---|
| broken-links | {broken-links-status} | {broken-links-count} |
| case-sensitivity | {case-sensitivity-status} | {case-sensitivity-count} |
| mdx-hazards | {mdx-hazards-status} | {mdx-hazards-count} |
| sidebar | {sidebar-status} | {sidebar-count} |
| base-path | {base-path-status} | {base-path-count} |
| image-paths | {image-paths-status} | {image-paths-count} |
| schema-drift | {schema-drift-status} | {schema-drift-count} |

### Findings

{FINDINGS_LIST}

### Actions Taken

{ACTIONS_TAKEN}

---
🤖 Generated by the [docs health system](../../scripts/autofix.sh)
```

- [ ] **Step 2: Commit**

```bash
git add docs/audit-report-template.md
git commit -m "docs: add audit report template"
```

---

## Task 8: Create autofix.sh

**Files:**
- Create: `scripts/autofix.sh`

- [ ] **Step 1: Create the script**

Create `scripts/autofix.sh`:

```bash
#!/usr/bin/env bash
# Autonomous docs fix loop.
# Usage: scripts/autofix.sh <path-to-audit-report.json> [--deep]
set -euo pipefail

REPORT_PATH="${1:?Usage: autofix.sh <audit-report.json> [--deep]}"
DEEP="${2:-}"
MAX_ATTEMPTS=3
BRANCH="docs/auto-fix-$(date +%Y%m%d-%H%M%S)"
BUILD_PASSED=false
BUILD_ERRORS=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# ─── Git config for CI ────────────────────────────────────────────────────────

git config user.email "github-actions[bot]@users.noreply.github.com"
git config user.name "github-actions[bot]"

# ─── Guard: nothing to do? ────────────────────────────────────────────────────

FINDINGS_COUNT=$(node -e "
const r = JSON.parse(require('fs').readFileSync('$REPORT_PATH', 'utf-8'));
process.stdout.write(String(r.summary.totalFindings));
")

if [ "$FINDINGS_COUNT" -eq 0 ]; then
  echo "audit-report has 0 findings — nothing to fix."
  exit 0
fi

# ─── Branch ───────────────────────────────────────────────────────────────────

git checkout -b "$BRANCH"

# ─── Read context ─────────────────────────────────────────────────────────────

REPORT=$(cat "$REPORT_PATH")
CLAUDE_MD=$(cat "$ROOT_DIR/CLAUDE.md" 2>/dev/null || echo "(no CLAUDE.md found)")

build_prompt() {
  local extra_errors="${1:-}"
  cat <<PROMPT
You are fixing issues in a Starlight/Astro documentation site.

## Project Conventions (from CLAUDE.md)
${CLAUDE_MD}

## Audit Findings
\`\`\`json
${REPORT}
\`\`\`

## Your Task
Fix every finding listed in the audit report above. For each finding:
- \`file\` is the relative path from the project root
- \`line\` is the approximate line number
- \`message\` explains what needs to be fixed

After fixing all findings, run: npm run build

${extra_errors:+## Previous Build Errors (fix these too)
${extra_errors}}
PROMPT
}

# ─── Fix loop ─────────────────────────────────────────────────────────────────

for attempt in $(seq 1 $MAX_ATTEMPTS); do
  echo "=== Fix attempt ${attempt}/${MAX_ATTEMPTS} ==="

  PROMPT_FILE=$(mktemp /tmp/autofix-prompt-XXXXX.txt)
  build_prompt "$BUILD_ERRORS" > "$PROMPT_FILE"

  claude -p "$(cat "$PROMPT_FILE")" \
    --allowedTools "Edit,Read,Glob,Grep,Bash(npm run build)"

  rm -f "$PROMPT_FILE"

  if npm run build > /tmp/build-out.txt 2>&1; then
    BUILD_PASSED=true
    echo "Build passed on attempt ${attempt}."
    break
  else
    BUILD_ERRORS="${BUILD_ERRORS}

--- Attempt ${attempt} build errors ---
$(cat /tmp/build-out.txt)"
    echo "Build failed on attempt ${attempt}."
  fi
done

# ─── Commit changes ───────────────────────────────────────────────────────────

git add -A
if git diff --cached --quiet; then
  echo "Claude made no file changes. Exiting without opening PR."
  git checkout -
  git branch -D "$BRANCH"
  exit 0
fi

git commit -m "docs: auto-fix audit findings [$(date +%Y-%m-%d)]"

# ─── Build PR body ────────────────────────────────────────────────────────────

DATE=$(date +%Y-%m-%d)
MODE=$([ -n "$DEEP" ] && echo "Deep (weekly)" || echo "PR audit")
BUILD_STATUS=$([ "$BUILD_PASSED" = true ] && echo "✅ Passing" || echo "❌ Failing (after ${MAX_ATTEMPTS} attempts)")

PR_BODY=$(node -e "
const fs = require('fs');
const r = JSON.parse(fs.readFileSync('$REPORT_PATH', 'utf-8'));
const checks = ['broken-links','case-sensitivity','mdx-hazards','sidebar','base-path'];
if (r.deep) checks.push('image-paths','schema-drift');

const rows = checks.map(c => {
  const status = r.summary.failed.includes(c) ? '❌' : '✅';
  const count = r.findings.filter(f => f.check === c).length;
  return \`| \${c} | \${status} | \${count} |\`;
}).join('\n');

const findingsList = r.findings.length === 0
  ? 'None'
  : r.findings.map(f => \`- **[\${f.check}]** \\\`\${f.file}:\${f.line}\\\` — \${f.message}\`).join('\n');

const buildNote = '$BUILD_PASSED' === 'true'
  ? ''
  : '\n> ⚠️ **Build still failing after $MAX_ATTEMPTS fix attempts — human review needed.**';

const body = [
  '## Docs Health Audit — $DATE',
  '',
  '**Mode:** $MODE',
  '**Build:** $BUILD_STATUS',
  '',
  '### Summary',
  '',
  '| Check | Status | Findings |',
  '|---|---|---|',
  rows,
  '',
  '### Findings',
  '',
  findingsList,
  '',
  '### Actions Taken',
  '',
  'Automated fixes applied by \`scripts/autofix.sh\`.',
  buildNote,
  '',
  '---',
  '🤖 Generated by the docs health system',
].join('\n');

process.stdout.write(body);
")

# ─── Open PR ──────────────────────────────────────────────────────────────────

LABELS="docs-auto-fix"
if [ "$BUILD_PASSED" = false ]; then
  LABELS="docs-auto-fix,build-failing"
fi

git push origin "$BRANCH"

gh pr create \
  --title "docs: auto-fix ${DATE}" \
  --body "$PR_BODY" \
  --base main \
  --label "$LABELS"
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x scripts/autofix.sh
```

- [ ] **Step 3: Create the required GitHub labels in the repo**

Run once (requires `gh` auth):

```bash
gh label create "docs-auto-fix" --color "0075ca" --description "Automated docs fix PR"
gh label create "build-failing" --color "d93f0b" --description "Build is still failing after auto-fix"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/autofix.sh
git commit -m "feat: add autofix.sh fix loop"
```

---

## Task 9: Create audit-pr.yml workflow

**Files:**
- Create: `.github/workflows/audit-pr.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/audit-pr.yml`:

```yaml
name: Docs Health Audit (PR)

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write
  pull-requests: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          # Full history needed for git operations in autofix.sh
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - name: Install Claude Code CLI
        run: npm install -g @anthropic-ai/claude-code

      - name: Run audit
        run: node scripts/audit.mjs

      - name: Run autofix if findings exist
        if: ${{ fromJson(steps.audit-result.outputs.findings_count || '0') > 0 }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: bash scripts/autofix.sh audit-report.json

      - name: Post PR comment
        if: always()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          node -e "
          const fs = require('fs');
          const r = JSON.parse(fs.readFileSync('audit-report.json', 'utf-8'));
          const checks = ['broken-links','case-sensitivity','mdx-hazards','sidebar','base-path'];
          const rows = checks.map(c => {
            const status = r.summary.failed.includes(c) ? '❌' : '✅';
            const count = r.findings.filter(f => f.check === c).length;
            return \`| \${c} | \${status} | \${count} |\`;
          }).join('\n');
          const summary = r.summary.totalFindings === 0
            ? '✅ All checks passed — no issues found.'
            : \`⚠️ \${r.summary.totalFindings} finding(s). A fix PR has been opened targeting \\\`main\\\`.\`;
          const body = [
            '## Docs Health Audit',
            '',
            summary,
            '',
            '| Check | Status | Findings |',
            '|---|---|---|',
            rows,
            '',
            '---',
            '🤖 [docs health system](../../scripts/audit.mjs)',
          ].join('\n');
          fs.writeFileSync('pr-comment.md', body);
          "
          gh pr comment ${{ github.event.pull_request.number }} \
            --body-file pr-comment.md \
            --repo ${{ github.repository }}
```

- [ ] **Step 2: Fix the conditional step — read findings_count from the audit output**

The `steps.audit-result.outputs.findings_count` reference won't work without an explicit output. Replace the audit step and the conditional with:

```yaml
      - name: Run audit
        id: audit
        run: |
          node scripts/audit.mjs
          COUNT=$(node -e "const r=require('./audit-report.json'); process.stdout.write(String(r.summary.totalFindings))")
          echo "findings_count=$COUNT" >> "$GITHUB_OUTPUT"

      - name: Run autofix if findings exist
        if: ${{ steps.audit.outputs.findings_count > 0 }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: bash scripts/autofix.sh audit-report.json
```

- [ ] **Step 3: Write the final corrected workflow file**

Overwrite `.github/workflows/audit-pr.yml` with the corrected version:

```yaml
name: Docs Health Audit (PR)

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write
  pull-requests: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - name: Install Claude Code CLI
        run: npm install -g @anthropic-ai/claude-code

      - name: Run audit
        id: audit
        run: |
          node scripts/audit.mjs
          COUNT=$(node -e "const r=require('./audit-report.json'); process.stdout.write(String(r.summary.totalFindings))")
          echo "findings_count=$COUNT" >> "$GITHUB_OUTPUT"

      - name: Run autofix if findings exist
        if: ${{ steps.audit.outputs.findings_count > 0 }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: bash scripts/autofix.sh audit-report.json

      - name: Post PR comment
        if: always()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          node -e "
          const fs = require('fs');
          const r = JSON.parse(fs.readFileSync('audit-report.json', 'utf-8'));
          const checks = ['broken-links','case-sensitivity','mdx-hazards','sidebar','base-path'];
          const rows = checks.map(c => {
            const status = r.summary.failed.includes(c) ? '❌' : '✅';
            const count = r.findings.filter(f => f.check === c).length;
            return \`| \${c} | \${status} | \${count} |\`;
          }).join('\n');
          const summary = r.summary.totalFindings === 0
            ? '✅ All checks passed — no issues found.'
            : \`⚠️ \${r.summary.totalFindings} finding(s). A fix PR has been opened targeting \\\`main\\\`.\`;
          const body = [
            '## Docs Health Audit',
            '',
            summary,
            '',
            '| Check | Status | Findings |',
            '|---|---|---|',
            rows,
            '',
            '---',
            '🤖 [docs health system](../../scripts/audit.mjs)',
          ].join('\n');
          fs.writeFileSync('pr-comment.md', body);
          "
          gh pr comment ${{ github.event.pull_request.number }} \
            --body-file pr-comment.md \
            --repo ${{ github.repository }}
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/audit-pr.yml
git commit -m "feat: add audit-pr.yml GitHub Actions workflow"
```

---

## Task 10: Create audit-weekly.yml workflow

**Files:**
- Create: `.github/workflows/audit-weekly.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/audit-weekly.yml`:

```yaml
name: Docs Health Audit (Weekly Deep)

on:
  schedule:
    - cron: '0 9 * * 1'   # Monday 9am UTC
  workflow_dispatch:        # allow manual trigger

permissions:
  contents: write
  pull-requests: write

jobs:
  deep-audit:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout main
        uses: actions/checkout@v6
        with:
          ref: main
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - name: Install Claude Code CLI
        run: npm install -g @anthropic-ai/claude-code

      - name: Run deep audit
        id: audit
        run: |
          node scripts/audit.mjs --deep
          COUNT=$(node -e "const r=require('./audit-report.json'); process.stdout.write(String(r.summary.totalFindings))")
          echo "findings_count=$COUNT" >> "$GITHUB_OUTPUT"

      - name: Run autofix if findings exist
        if: ${{ steps.audit.outputs.findings_count > 0 }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: bash scripts/autofix.sh audit-report.json --deep

      - name: Log clean result
        if: ${{ steps.audit.outputs.findings_count == 0 }}
        run: echo "✅ Weekly deep audit passed — no findings."
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/audit-weekly.yml
git commit -m "feat: add audit-weekly.yml cron workflow"
```

---

## Task 11: Add audit-report.json to .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Ensure audit-report.json is not committed**

```bash
echo "audit-report.json" >> .gitignore
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore audit-report.json"
```

---

## Prerequisites Checklist (before first run)

- [ ] Add `ANTHROPIC_API_KEY` as a GitHub Actions repo secret (Settings → Secrets → Actions)
- [ ] Run `gh label create "docs-auto-fix" --color "0075ca" --description "Automated docs fix PR"` once
- [ ] Run `gh label create "build-failing" --color "d93f0b" --description "Build still failing after auto-fix"` once
- [ ] Verify `gh auth status` is authenticated in CI (the built-in `GITHUB_TOKEN` handles this automatically in Actions)
