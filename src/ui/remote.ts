import type { RepoRef } from '../core/evidence/github-runs.js';

const MAX_CONFIG_CHARS = 64 * 1024;
const SLUG = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/;
const GITHUB_URL = /github\.com[:/]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?\s*$/;

export function parseRepoSlug(value: string): RepoRef | undefined {
  const match = SLUG.exec(value.trim());
  return match?.[1] && match[2] && match[2] !== '.' && match[2] !== '..' ? { owner: match[1], repo: match[2] } : undefined;
}

/** Finds the GitHub repository in the text of `.git/config`, preferring the `origin` remote. */
export function parseGitHubRemote(gitConfig: string): RepoRef | undefined {
  const urls = new Map<string, string>();
  let remote: string | undefined;
  for (const raw of gitConfig.slice(0, MAX_CONFIG_CHARS).split(/\r?\n/)) {
    const line = raw.trim();
    const section = /^\[remote "([^"]+)"\]$/.exec(line);
    if (section) { remote = section[1]; continue; }
    if (line.startsWith('[')) { remote = undefined; continue; }
    const url = /^url\s*=\s*(.+)$/.exec(line);
    if (remote !== undefined && url?.[1] && !urls.has(remote)) urls.set(remote, url[1]);
  }
  for (const url of [urls.get('origin'), ...urls.values()]) {
    const match = url === undefined ? null : GITHUB_URL.exec(url);
    if (match?.[1] && match[2]) return { owner: match[1], repo: match[2] };
  }
  return undefined;
}

/** A pasted personal access token: single-line, printable, bounded. The value is never echoed or logged. */
export function isPlausibleToken(value: string): boolean {
  return value.length >= 8 && value.length <= 255 && /^[\x21-\x7e]+$/.test(value);
}
