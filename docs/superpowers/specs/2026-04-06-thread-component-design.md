# Thread Component Design

**Date:** 2026-04-06  
**Project:** BCOEM-Documentation (Astro + Starlight)

## Overview

A threaded dialogue component for rendering Q&A and support conversations inside Starlight MDX pages. Styled after GitHub Issues: speech-bubble posts, circular initials avatars, and an optional issue link in the thread header.

Two authoring modes:
- **Data-driven** (`<IssueThread>`) — renders a GitHub Issue and its flat comment list from a local JSON file
- **Hand-authored** (`<Thread>` + `<Reply>`) — arbitrary nesting for conversations not sourced from GitHub

---

## Component API

### `<IssueThread id={number} />`

Reads `src/data/issues.json` at build time, finds the issue by `id`, and renders the thread. Comments are rendered as a flat list (mirroring GitHub's data model).

```mdx
<IssueThread id={42} />
```

### `<Thread>` + `<Reply>`

Hand-authored threads with arbitrary nesting. `<Reply>` components can be nested inside other `<Reply>` components to any depth.

```mdx
<Thread issue="https://github.com/org/repo/issues/42">
  <Reply author="OriginalPoster">
    Can't add judges to tables in planning mode...
  </Reply>
  <Reply author="BCOEMSupport">
    I couldn't recreate it in 2.8.2. Could you check...
    <Reply author="OriginalPoster">
      AH yes — tables weren't assigned to rounds. Fixed!
    </Reply>
  </Reply>
</Thread>
```

#### `<Thread>` props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `issue` | `string` | No | Full GitHub Issue URL. Rendered as a small link in the thread header. |

#### `<Reply>` props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `author` | `string` | Yes | Display name for the post. Used to render the avatar initials and label. |
| `color` | `string` | No | CSS color for the avatar background. If omitted, auto-assigned by hashing the author name against a fixed palette — same author always gets the same color. |

Children are MDX prose (paragraphs, lists, inline code, etc.).

---

## Data Shape: `src/data/issues.json`

Populated by the fetch script. Each entry represents one GitHub Issue.

```json
[
  {
    "id": 42,
    "title": "Can't add judges to tables",
    "url": "https://github.com/org/repo/issues/42",
    "author": "OriginalPoster",
    "body": "...",
    "comments": [
      { "author": "BCOEMSupport", "body": "..." },
      { "author": "OriginalPoster", "body": "..." }
    ]
  }
]
```

---

## Fetch Script: `scripts/fetch-issues.mjs`

A Node.js script that queries the GitHub REST API and writes to `src/data/issues.json`.

**Flags:**

| Flag | Description |
|------|-------------|
| `--repo owner/name` | Target repository (required) |
| `--label "label-name"` | Filter by label (repeatable) |
| `--state open\|closed\|all` | Filter by issue state (default: `all`) |

**Usage:**
```bash
node scripts/fetch-issues.mjs --repo bcoem/app --label "good-to-know" --state closed
```

The script fetches issues and their comments via the GitHub REST API, merges them into the `issues.json` shape above, and overwrites `src/data/issues.json`. Requires a `GITHUB_TOKEN` environment variable for authenticated requests. This should be set in a local `.env` file (not committed) or in CI environment variables.

---

## Component Files

All components live in `src/components/`:

| File | Purpose |
|------|---------|
| `Thread.astro` | Root container for hand-authored threads. Renders the header (title + optional issue link) and a `<slot />` for `<Reply>` children. |
| `Reply.astro` | Single post. Renders avatar/initials bubble, author name, speech-bubble body, and a nested `<slot />` for child replies. |
| `IssueThread.astro` | Data-driven wrapper. Reads `issues.json`, finds the matching `id`, renders `Thread` + flat `Reply` list. |

---

## Styling

- **Scoped `<style>` blocks** in each `.astro` file — no global CSS additions.
- **Visual style:** GitHub Issues — `1px` bordered speech bubbles, subtle background fill on post body.
- **Avatars:** 36px circle, up to 2-character initials, color from hash palette or explicit `color` prop.
- **Nesting indent:** 24px left margin per depth level, no enforced maximum.
- **Issue link:** Small, right-aligned in thread header, opens in new tab.
- **Dark mode:** Uses Starlight CSS custom properties (`--sl-color-bg`, `--sl-color-bg-nav`, `--sl-color-text`, `--sl-color-text-accent`, `--sl-color-hairline`) so both themes work automatically without extra configuration.

---

## Starlight Integration

Components are registered globally via MDX's `components` option in `astro.config.mjs`, so `.mdx` files can use `<Thread>`, `<Reply>`, and `<IssueThread>` without an import statement.

```js
// astro.config.mjs
import mdx from '@astrojs/mdx';

export default defineConfig({
  integrations: [
    starlight({ ... }),
    mdx({
      components: {
        Thread: './src/components/Thread.astro',
        Reply: './src/components/Reply.astro',
        IssueThread: './src/components/IssueThread.astro',
      }
    })
  ]
});
```

---

## Out of Scope

- Reactions, voting, or like counts
- Real-time updates or live GitHub sync
- Pagination of comments
- Authentication UI within the component
