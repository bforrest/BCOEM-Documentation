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
