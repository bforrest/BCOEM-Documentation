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
  file.lines.forEach((line, i) => {
    const mdLinkRe = /\[(?:[^\]]*)\]\(([^)#?\s]+)/g;
    const hrefRe = /href=['"]([^'"#?]+)/g;
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

      // Skip frontmatter delimiters, imports, blank lines
      if (/^---/.test(trimmed) || /^import\s/.test(trimmed) || trimmed === '') return;

      // Track JSX depth by counting PascalCase component opens/closes
      const opens = (line.match(/<[A-Z][A-Za-z]*(?:\s[^>]*)?>(?!.*\/>)/g) || []).length;
      const closes = (line.match(/<\/[A-Z][A-Za-z]*>/g) || []).length;
      const selfClose = (line.match(/<[A-Z][A-Za-z]*[^>]*\/>/g) || []).length;
      jsxDepth = Math.max(0, jsxDepth + opens - closes - selfClose);

      // Remove inline code before checking for bare {
      const stripped = line.replace(/`[^`]+`/g, '___');

      // Unescaped { in prose: not on a JSX line (starting with <) or JSX expression line (starting with {)
      if (stripped.includes('{') && !/^\s*[<{]/.test(line)) {
        findings.push({
          check: 'mdx-hazards',
          file: file.path,
          line: lineNum,
          text: trimmed.substring(0, 80),
          message: 'Potential unescaped { in prose — escape as \\{ or wrap in a code block',
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

  // Only check files under guides/ — reference/ and good-to-know/ are autogenerated
  const guideFiles = files.filter((f) => /\/guides\//.test(f.path));
  for (const file of guideFiles) {
    // Derive slug from path: capture everything from guides/ to the end, minus extension
    const slugMatch = file.path.match(/(guides\/.+)\.(md|mdx)$/);
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

// ─── Check: image paths (deep) ────────────────────────────────────────────────

export function checkImagePaths(files, assetsDir, publicDir) {
  const findings = [];
  const imgRe = /!\[[^\]]*\]\(([^)#?\s]+)/g;
  const srcRe = /src=['"]([^'"#?]+)/g;
  for (const file of files) {
    file.lines.forEach((line, i) => {
      imgRe.lastIndex = 0;
      srcRe.lastIndex = 0;
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

  // Relativise all file paths
  const findings = allFindings.map((f) => ({
    ...f,
    file: relative(rootDir, f.file),
  }));

  const allCheckNames = ['broken-links', 'case-sensitivity', 'mdx-hazards', 'sidebar', 'base-path'];
  if (deep) allCheckNames.push('image-paths', 'schema-drift');

  const failedChecks = [...new Set(findings.map((f) => f.check))];
  const passedChecks = allCheckNames.filter((c) => !failedChecks.includes(c));

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
    console.error('Audit error:', err.message);
    writeFileSync('audit-report.json', JSON.stringify({
      timestamp: new Date().toISOString(),
      deep: false,
      summary: { totalFindings: 0, passed: [], failed: [] },
      findings: [],
      error: err.message,
    }, null, 2));
    process.exit(0);
  });
}
