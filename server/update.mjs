// Is there a newer Rumi? One request to GitHub's public releases API a day, when updateCheck is on. Nothing about
// you is sent. How to update depends on how Rumi was installed.
import fs from 'node:fs';
import path from 'node:path';
import {appDir, version} from './paths.mjs';

export const REPO = 'muzaffermahi/rumi';
export const RELEASES = `https://github.com/${REPO}/releases`;

// 1.2.3 vs 1.10.0, ignoring a leading v and pre-release suffixes.
export function newer(a, b) {
  const parts = v => String(v).replace(/^v/, '').split(/[-+]/)[0].split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// How this copy was installed, and what updating it takes.
export function installKind() {
  if (fs.existsSync(path.join(appDir, '.git'))) return {kind: 'git', how: 'git pull && npm ci && npm run build'};
  if (
    fs.existsSync(path.join(appDir, '..', 'node')) &&
    (fs.existsSync(path.join(appDir, '..', 'Rumi.cmd')) ||
      fs.existsSync(path.join(appDir, '..', 'Rumi.command')) ||
      fs.existsSync(path.join(appDir, '..', 'rumi.sh')))
  ) {
    return {kind: 'download', how: `Download the new version from ${RELEASES}/latest and replace this folder (your data is kept in ~/.rumi)`};
  }
  if (appDir.split(path.sep).includes('node_modules')) return {kind: 'npm', how: 'npm install -g rumi-app@latest'};
  return {kind: 'unknown', how: `See ${RELEASES}/latest`};
}

export async function latestRelease() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {Accept: 'application/vnd.github+json', 'User-Agent': `rumi/${version}`},
    signal: AbortSignal.timeout(10000),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw Error(`GitHub HTTP ${r.status}`);
  const j = await r.json();
  return {version: String(j.tag_name || '').replace(/^v/, ''), url: j.html_url, notes: String(j.body || '').slice(0, 4000), published: j.published_at};
}

export async function checkForUpdate() {
  const latest = await latestRelease();
  return {
    current: version,
    latest: latest?.version || null,
    available: !!latest && newer(latest.version, version),
    url: latest?.url || RELEASES,
    notes: latest?.notes || '',
    install: installKind(),
    checked: new Date().toISOString(),
  };
}
