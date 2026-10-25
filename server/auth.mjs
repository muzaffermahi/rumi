// Who may talk to the server. Only this computer's browser, on this port (Host and Origin checks stop other
// websites and DNS rebinding), and only with Rumi's access token (which stops other programs and other users on
// this computer from starting tasks that run commands as you).
// The token is kept in <data>/server.json, readable only by you. `rumi` opens the browser with ?token=…, the server
// moves it into an HttpOnly cookie and drops it from the address bar.
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {readJson, serverFile, writePrivate, version} from './paths.mjs';

export const token = readJson(serverFile, {}).token || randomBytes(24).toString('base64url');

export function writeServerFile(port) {
  writePrivate(serverFile, JSON.stringify({port, pid: process.pid, token, version, started: new Date().toISOString()}, null, 1));
}

const same = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieName = port => `rumi_${port}`;
function cookieOf(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function authorised(req, port) {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  return same(bearer, token) || same(cookieOf(req, cookieName(port)), token);
}

// Paths anyone on this computer may load: the page itself and the health check `rumi` uses to find the server.
const OPEN = new Set(['/api/health']);

export function guard(port) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  return (req, res, next) => {
    if (!hosts.includes(req.headers.host)) return res.sendStatus(403);
    if (req.headers.origin && !hosts.map(h => `http://${h}`).includes(req.headers.origin)) return res.sendStatus(403);
    if (typeof req.query.token === 'string') {
      if (!same(req.query.token, token)) return res.status(403).send('This link has an old access token. Open Rumi again with the rumi command.');
      res.setHeader('Set-Cookie', `${cookieName(port)}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
      const url = new URL(req.originalUrl, `http://${req.headers.host}`);
      url.searchParams.delete('token');
      return res.redirect(302, url.pathname + url.search);
    }
    if (!req.path.startsWith('/api/') || OPEN.has(req.path) || authorised(req, port)) return next();
    res.status(401).json({error: 'locked', message: 'Open Rumi with the rumi command (or the Rumi shortcut) to unlock this page.'});
  };
}
