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
