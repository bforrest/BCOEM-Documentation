# Thread Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `Thread`/`Reply`/`IssueThread` Astro components for rendering threaded Q&A dialogue in Starlight MDX pages, plus a `fetch-issues.mjs` script that populates a local `issues.json` from the GitHub API.

**Architecture:** A pure-function `avatarColor` utility (unit-tested with Vitest) underpins all three components. `Reply.astro` is the recursive building block; `Thread.astro` wraps it with a header; `IssueThread.astro` reads `src/data/issues.json` and renders a flat list. Components are imported per `.mdx` file (standard Astro pattern — no global registry needed). The fetch script is a standalone Node ESM module accepting CLI flags.

**Tech Stack:** Astro 6, Starlight 0.38, `@astrojs/mdx` (already bundled as a Starlight dependency), Vitest, GitHub REST API (`/issues` + `/issues/:id/comments` endpoints).

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `src/lib/avatarColor.js` | Create | Pure fn: author string → deterministic hex color |
| `src/lib/avatarColor.test.js` | Create | Vitest unit tests for avatarColor |
| `src/components/Reply.astro` | Create | Single post: avatar, author name, speech bubble, nested slot |
| `src/components/Thread.astro` | Create | Root container: header, optional issue link, slot for replies |
| `src/components/IssueThread.astro` | Create | Data-driven: reads issues.json, renders Thread + flat Reply list |
| `src/data/issues.json` | Create | Fetched issue data (initially empty array `[]`) |
| `scripts/fetch-issues.mjs` | Create | CLI script: queries GitHub API, writes src/data/issues.json |
| `scripts/fetch-issues.test.mjs` | Create | Vitest tests for CLI arg parsing and data-transform logic |
| `vitest.config.js` | Create | Vitest configuration |
| `src/content/docs/good-to-know/Cant-add-judges-to-tables.mdx` | Create | Demo: convert existing .md to .mdx using Thread components |
| `src/content/docs/good-to-know/Cant-add-judges-to-tables.md` | Delete | Replaced by .mdx version |

---

## Task 1: Install Vitest and configure

**Files:**
- Create: `vitest.config.js`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest
```

Expected: `package.json` now lists `"vitest"` under `devDependencies`.

- [ ] **Step 2: Create vitest config**

Create `vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{js,mjs}', 'scripts/**/*.test.mjs'],
  },
});
```

- [ ] **Step 3: Add test script to package.json**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 4: Verify Vitest runs**

```bash
npm test
```

Expected output: `No test files found` (or similar — no failures).

- [ ] **Step 5: Commit**

```bash
git add vitest.config.js package.json package-lock.json
git commit -m "chore: add Vitest"
```

---

## Task 2: Avatar color utility (TDD)

**Files:**
- Create: `src/lib/avatarColor.js`
- Create: `src/lib/avatarColor.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/avatarColor.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { avatarColor, avatarInitials } from './avatarColor.js';

describe('avatarColor', () => {
  it('returns a hex color string', () => {
    const color = avatarColor('BCOEMSupport');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('is deterministic — same name always returns same color', () => {
    expect(avatarColor('Alice')).toBe(avatarColor('Alice'));
  });

  it('returns different colors for different names', () => {
    // Not guaranteed but very likely with a palette of 8+
    const colors = ['Alice', 'Bob', 'Carol', 'Dave'].map(avatarColor);
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThan(1);
  });
});

describe('avatarInitials', () => {
  it('returns up to 2 characters from the name', () => {
    expect(avatarInitials('BCOEMSupport')).toBe('BC');
  });

  it('returns single char for single-char names', () => {
    expect(avatarInitials('X')).toBe('X');
  });

  it('uses first letter of each word for multi-word names', () => {
    expect(avatarInitials('Original Poster')).toBe('OP');
  });

  it('handles empty string gracefully', () => {
    expect(avatarInitials('')).toBe('?');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```

Expected: FAIL — `Cannot find module './avatarColor.js'`

- [ ] **Step 3: Implement avatarColor.js**

Create `src/lib/avatarColor.js`:

```js
const PALETTE = [
  '#0969da', // blue
  '#2da44e', // green
  '#6e40c9', // purple
  '#cf222e', // red
  '#bf8700', // yellow
  '#1b7c83', // teal
  '#e16f24', // orange
  '#8250df', // violet
];

/**
 * Deterministically maps an author name to a palette color.
 * @param {string} name
 * @returns {string} hex color
 */
export function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/**
 * Returns up to 2 initials from a name.
 * Multi-word names use the first letter of each of the first two words.
 * Single words use the first two characters.
 * @param {string} name
 * @returns {string}
 */
export function avatarInitials(name) {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/avatarColor.js src/lib/avatarColor.test.js
git commit -m "feat: add avatarColor and avatarInitials utilities"
```

---

## Task 3: Reply.astro component

**Files:**
- Create: `src/components/Reply.astro`

`Reply` renders one post: an initials avatar, the author name, a speech-bubble body, and a slot for nested child replies. The `color` prop overrides the auto-assigned palette color.

- [ ] **Step 1: Create src/components/ directory and Reply.astro**

Create `src/components/Reply.astro`:

```astro
---
import { avatarColor, avatarInitials } from '../lib/avatarColor.js';

interface Props {
  author: string;
  color?: string;
}

const { author, color } = Astro.props;
const bgColor = color ?? avatarColor(author);
const initials = avatarInitials(author);
---

<div class="reply">
  <div class="reply-avatar" style={`background-color: ${bgColor}`}>
    {initials}
  </div>
  <div class="reply-body">
    <div class="reply-header">
      <span class="reply-author">{author}</span>
    </div>
    <div class="reply-bubble">
      <slot />
    </div>
    <div class="reply-children">
      <slot name="replies" />
    </div>
  </div>
</div>

<style>
  .reply {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin-bottom: 12px;
  }

  .reply-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 13px;
    flex-shrink: 0;
    font-family: var(--sl-font-system-mono, monospace);
  }

  .reply-body {
    flex: 1;
    min-width: 0;
  }

  .reply-header {
    margin-bottom: 4px;
  }

  .reply-author {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--sl-color-text);
  }

  .reply-bubble {
    background: var(--sl-color-bg);
    border: 1px solid var(--sl-color-hairline);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 0.875rem;
    line-height: 1.6;
    color: var(--sl-color-text);
  }

  .reply-bubble :global(p:last-child) {
    margin-bottom: 0;
  }

  .reply-children {
    margin-top: 10px;
    margin-left: 24px;
  }

  /* Scale avatar down for nested replies */
  .reply-children :global(.reply-avatar) {
    width: 28px;
    height: 28px;
    font-size: 11px;
  }

  .reply-children :global(.reply-children .reply-avatar) {
    width: 22px;
    height: 22px;
    font-size: 9px;
  }
</style>
```

- [ ] **Step 2: Verify astro build succeeds**

```bash
npm run build 2>&1 | tail -5
```

Expected: `Complete!` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Reply.astro
git commit -m "feat: add Reply component"
```

---

## Task 4: Thread.astro component

**Files:**
- Create: `src/components/Thread.astro`

`Thread` is the root container. It renders a header bar (with an optional GitHub Issue link) and a slot for `Reply` children.

- [ ] **Step 1: Create Thread.astro**

Create `src/components/Thread.astro`:

```astro
---
interface Props {
  issue?: string;
}

const { issue } = Astro.props;

// Extract a short label from the issue URL, e.g. "#42"
function issueLabel(url: string): string {
  const match = url.match(/\/issues\/(\d+)/);
  return match ? `#${match[1]}` : 'Issue';
}
---

<div class="thread">
  {issue && (
    <div class="thread-header">
      <a
        href={issue}
        target="_blank"
        rel="noopener noreferrer"
        class="thread-issue-link"
      >
        {issueLabel(issue)} on GitHub ↗
      </a>
    </div>
  )}
  <div class="thread-body">
    <slot />
  </div>
</div>

<style>
  .thread {
    border: 1px solid var(--sl-color-hairline);
    border-radius: 8px;
    overflow: hidden;
    margin: 1.5rem 0;
  }

  .thread-header {
    background: var(--sl-color-bg-nav);
    border-bottom: 1px solid var(--sl-color-hairline);
    padding: 8px 14px;
    display: flex;
    justify-content: flex-end;
  }

  .thread-issue-link {
    font-size: 0.75rem;
    color: var(--sl-color-text-accent);
    text-decoration: none;
  }

  .thread-issue-link:hover {
    text-decoration: underline;
  }

  .thread-body {
    padding: 16px;
  }
</style>
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `Complete!`

- [ ] **Step 3: Commit**

```bash
git add src/components/Thread.astro
git commit -m "feat: add Thread component"
```

---

## Task 5: Create src/data/issues.json

**Files:**
- Create: `src/data/issues.json`

- [ ] **Step 1: Create the file with an empty array**

Create `src/data/issues.json`:

```json
[]
```

- [ ] **Step 2: Commit**

```bash
git add src/data/issues.json
git commit -m "chore: add empty issues.json data file"
```

---

## Task 6: IssueThread.astro component

**Files:**
- Create: `src/components/IssueThread.astro`

Reads `src/data/issues.json` at build time, finds the issue by `id`, and renders a `Thread` with a flat list of `Reply` components — one for the OP body, then one per comment.

- [ ] **Step 1: Create IssueThread.astro**

Create `src/components/IssueThread.astro`:

```astro
---
import Thread from './Thread.astro';
import Reply from './Reply.astro';
import issues from '../data/issues.json';

interface Issue {
  id: number;
  title: string;
  url: string;
  author: string;
  body: string;
  comments: { author: string; body: string }[];
}

interface Props {
  id: number;
}

const { id } = Astro.props;
const issue = (issues as Issue[]).find((i) => i.id === id);
---

{issue ? (
  <Thread issue={issue.url}>
    <Reply author={issue.author}>
      <Fragment set:html={issue.body} />
    </Reply>
    {issue.comments.map((comment) => (
      <Reply author={comment.author}>
        <Fragment set:html={comment.body} />
      </Reply>
    ))}
  </Thread>
) : (
  <div class="issue-not-found">
    Issue #{id} not found in issues.json. Run <code>node scripts/fetch-issues.mjs</code> to populate.
  </div>
)}

<style>
  .issue-not-found {
    border: 1px dashed var(--sl-color-hairline);
    border-radius: 6px;
    padding: 12px 16px;
    font-size: 0.875rem;
    color: var(--sl-color-text);
    opacity: 0.7;
    margin: 1.5rem 0;
  }
</style>
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `Complete!`

- [ ] **Step 3: Commit**

```bash
git add src/components/IssueThread.astro
git commit -m "feat: add IssueThread component"
```

---

## Task 7: fetch-issues.mjs script (TDD)

**Files:**
- Create: `scripts/fetch-issues.mjs`
- Create: `scripts/fetch-issues.test.mjs`

The script has two testable pure-function layers: argument parsing and the GitHub response → `issues.json` shape transform. The actual HTTP calls are not tested.

- [ ] **Step 1: Write failing tests**

Create `scripts/fetch-issues.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { parseArgs, transformIssue } from './fetch-issues.mjs';

describe('parseArgs', () => {
  it('parses --repo', () => {
    const args = parseArgs(['--repo', 'bcoem/app']);
    expect(args.repo).toBe('bcoem/app');
  });

  it('parses --label (single)', () => {
    const args = parseArgs(['--repo', 'bcoem/app', '--label', 'good-to-know']);
    expect(args.labels).toEqual(['good-to-know']);
  });

  it('parses --label (multiple)', () => {
    const args = parseArgs(['--repo', 'bcoem/app', '--label', 'a', '--label', 'b']);
    expect(args.labels).toEqual(['a', 'b']);
  });

  it('defaults state to "all"', () => {
    const args = parseArgs(['--repo', 'bcoem/app']);
    expect(args.state).toBe('all');
  });

  it('parses --state', () => {
    const args = parseArgs(['--repo', 'bcoem/app', '--state', 'closed']);
    expect(args.state).toBe('closed');
  });

  it('throws when --repo is missing', () => {
    expect(() => parseArgs([])).toThrow('--repo is required');
  });
});

describe('transformIssue', () => {
  const githubIssue = {
    number: 42,
    title: "Can't add judges",
    html_url: 'https://github.com/bcoem/app/issues/42',
    user: { login: 'OriginalPoster' },
    body: 'Some issue body',
  };

  const githubComments = [
    { user: { login: 'BCOEMSupport' }, body: 'Here is the fix' },
    { user: { login: 'OriginalPoster' }, body: 'Thanks!' },
  ];

  it('maps id from number', () => {
    expect(transformIssue(githubIssue, githubComments).id).toBe(42);
  });

  it('maps title', () => {
    expect(transformIssue(githubIssue, githubComments).title).toBe("Can't add judges");
  });

  it('maps url from html_url', () => {
    expect(transformIssue(githubIssue, githubComments).url).toBe(
      'https://github.com/bcoem/app/issues/42'
    );
  });

  it('maps author from user.login', () => {
    expect(transformIssue(githubIssue, githubComments).author).toBe('OriginalPoster');
  });

  it('maps body', () => {
    expect(transformIssue(githubIssue, githubComments).body).toBe('Some issue body');
  });

  it('maps comments', () => {
    const result = transformIssue(githubIssue, githubComments);
    expect(result.comments).toEqual([
      { author: 'BCOEMSupport', body: 'Here is the fix' },
      { author: 'OriginalPoster', body: 'Thanks!' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```

Expected: FAIL — `Cannot find module './fetch-issues.mjs'`

- [ ] **Step 3: Implement fetch-issues.mjs**

Create `scripts/fetch-issues.mjs`:

```js
#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Parses CLI arguments.
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{ repo: string, labels: string[], state: string }}
 */
export function parseArgs(argv) {
  const args = { repo: null, labels: [], state: 'all' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') args.repo = argv[++i];
    else if (argv[i] === '--label') args.labels.push(argv[++i]);
    else if (argv[i] === '--state') args.state = argv[++i];
  }
  if (!args.repo) throw new Error('--repo is required (e.g. --repo owner/name)');
  return args;
}

/**
 * Transforms a GitHub API issue + comments into the issues.json shape.
 * @param {object} issue - GitHub issue object
 * @param {object[]} comments - GitHub comments array
 * @returns {object}
 */
export function transformIssue(issue, comments) {
  return {
    id: issue.number,
    title: issue.title,
    url: issue.html_url,
    author: issue.user.login,
    body: issue.body ?? '',
    comments: comments.map((c) => ({
      author: c.user.login,
      body: c.body ?? '',
    })),
  };
}

async function fetchIssues({ repo, labels, state }) {
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const labelParam = labels.length ? `&labels=${labels.join(',')}` : '';
  const url = `https://api.github.com/repos/${repo}/issues?state=${state}&per_page=100${labelParam}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  const issues = await res.json();

  const results = [];
  for (const issue of issues) {
    if (issue.pull_request) continue; // skip PRs
    const commentsRes = await fetch(issue.comments_url, { headers });
    if (!commentsRes.ok) throw new Error(`Failed to fetch comments for #${issue.number}`);
    const comments = await commentsRes.json();
    results.push(transformIssue(issue, comments));
  }
  return results;
}

// Only run as CLI entry point, not when imported by tests
if (process.argv[1] && process.argv[1].endsWith('fetch-issues.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Fetching issues from ${args.repo}…`);
  fetchIssues(args)
    .then((data) => {
      const outPath = resolve(process.cwd(), 'src/data/issues.json');
      writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`Written ${data.length} issues to src/data/issues.json`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test
```

Expected: All tests PASS (12 passing).

- [ ] **Step 5: Add fetch script to package.json scripts**

In `package.json`, add:

```json
"fetch-issues": "node scripts/fetch-issues.mjs"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-issues.mjs scripts/fetch-issues.test.mjs package.json
git commit -m "feat: add fetch-issues script with arg parsing and transform"
```

---

## Task 8: Demo — convert existing doc to MDX

Converts `Cant-add-judges-to-tables.md` to `.mdx` using the hand-authored `Thread` components, proving the full component pipeline works end-to-end.

**Files:**
- Create: `src/content/docs/good-to-know/Cant-add-judges-to-tables.mdx`
- Delete: `src/content/docs/good-to-know/Cant-add-judges-to-tables.md`

- [ ] **Step 1: Create the .mdx version**

Create `src/content/docs/good-to-know/Cant-add-judges-to-tables.mdx`:

```mdx
---
title: "Can't add judges to tables"
---

import Thread from '../../../components/Thread.astro';
import Reply from '../../../components/Reply.astro';

<Thread>
  <Reply author="Forum User">
    Can't add judges to tables, in either planning mode or preparation mode. Was able to add
    some judges to Session 1, but have repeatedly tried to add judges to remaining tables in
    subsequent sessions. It allows me to go to assign judges, click the available judges to
    assign to the table, then click Assign Judges, and then says "Info edited successfully",
    but then no judges are actually assigned. Tried many times and refreshed. Why can't I
    assign judges to my tables?
    <Reply slot="replies" author="BCOEMSupport">
      I'm sorry you're experiencing this issue. However, I'm not able to recreate it in my
      2.8.2 test environment. I created multiple tables and was able to assign/unassign judges
      and stewards to each in both Tables Planning and Competition modes.

      It's curious that you were able to assign judges to Session 1 but not others. This
      indicates the assignment scripting worked at that time, so there may be other conditions
      present. Could you check:

      - Whether you can still assign/unassign judges to Session 1 tables
      - If not using queued judging, that all tables have flights defined
      - If not using queued judging, that all flights are assigned to rounds
      - Whether you added any sessions after the judging signup window
      - Whether you have any mods or altered code running
      <Reply slot="replies" author="Forum User">
        AH yes — the Tables had not yet been assigned to rounds. Now I am able to assign
        judges. Thank you for the quick response!
      </Reply>
    </Reply>
  </Reply>
</Thread>
```

- [ ] **Step 2: Delete the old .md file**

```bash
git rm src/content/docs/good-to-know/Cant-add-judges-to-tables.md
```

- [ ] **Step 3: Verify the build succeeds and produces expected output**

```bash
npm run build 2>&1 | tail -5
```

Expected: `Complete!`

Then check the built output contains the thread HTML:

```bash
grep -r "reply-bubble" dist/ | head -3
```

Expected: At least one match.

- [ ] **Step 4: Commit**

```bash
git add src/content/docs/good-to-know/Cant-add-judges-to-tables.mdx
git commit -m "feat: convert Cant-add-judges-to-tables to MDX with Thread component"
```

---

## Task 9: Add fetch-issues usage note to .gitignore

**Files:**
- Modify: `.gitignore` (create if absent)

- [ ] **Step 1: Ensure .env and .superpowers are ignored**

```bash
echo ".env" >> .gitignore
echo ".superpowers/" >> .gitignore
```

- [ ] **Step 2: Verify**

```bash
cat .gitignore
```

Expected: Both lines present.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore .env and .superpowers"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| MDX authoring with `<Thread>` / `<Reply>` | Tasks 3, 4, 8 |
| Arbitrary nesting | Task 3 (nested slot + indent CSS) |
| Free-form `author` prop | Tasks 3, 6 |
| Initials avatar with auto-color | Task 2, 3 |
| GitHub Issue link on thread | Task 4 |
| `IssueThread` from JSON, flat list | Tasks 5, 6 |
| Fetch script with `--label`, `--state`, `--repo` | Task 7 |
| Scoped styles using Starlight CSS vars | Tasks 3, 4, 6 |
| Per-file imports (no global registry) | Task 8 demo |
| `GITHUB_TOKEN` from `.env` | Task 9 + script note |
| `astro.config.mjs` unchanged | Confirmed — MDX already bundled via Starlight |

**All requirements covered. No placeholders. Types consistent across tasks.**
