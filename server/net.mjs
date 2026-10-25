// Fetching pages for workers without letting a web page steer them into this computer or your network.
// Every hop of a redirect is checked, and the address checked is the one connected to (no DNS rebinding).
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

const blocked = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
  ['2001:db8::', 32],
])
  blocked.addSubnet(a, p, 'ipv6');

export function isPrivateAddress(address) {
  const family = net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null;
  if (!family) return true;
  const mapped = family === 'ipv6' && address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return blocked.check(mapped, 'ipv4');
  return blocked.check(address, family);
}

export class BlockedAddress extends Error {}

const MAX_BYTES = 8 * 1024 * 1024;

// Resolves to {status, url, headers, text}. Rejects with BlockedAddress for private addresses unless allowPrivate.
export async function safeFetch(input, {signal, headers = {}, allowPrivate = false, redirects = 5} = {}) {
  let url = new URL(input);
  for (let hop = 0; hop <= redirects; hop++) {
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('Only http and https pages can be read.');
    const r = await request(url, {signal, headers, allowPrivate});
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
      r.body.resume();
      url = new URL(r.headers.location, url);
      continue;
    }
    return {status: r.status, ok: r.status >= 200 && r.status < 300, url: url.href, headers: r.headers, text: await readBody(r)};
  }
  throw Error('Too many redirects.');
}

function request(url, {signal, headers, allowPrivate}) {
  const literal = net.isIP(url.hostname.replace(/^\[|\]$/g, ''));
  if (literal && !allowPrivate && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
    return Promise.reject(
      new BlockedAddress(
        `${url.hostname} is on this computer or your local network, which workers cannot open. Turn on "Allow private network" in Settings if you need it.`,
      ),
    );
  }
  const lookup = (host, options, cb) =>
    dns.lookup(host, {...options, all: true}, (err, addresses) => {
      if (err) return cb(err);
      const ok = allowPrivate ? addresses : addresses.filter(a => !isPrivateAddress(a.address));
      if (!ok.length) return cb(new BlockedAddress(`${host} points to this computer or your local network, which workers cannot open.`));
      if (options.all) cb(null, ok);
      else cb(null, ok[0].address, ok[0].family);
    });
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, {headers: {'Accept-Encoding': 'gzip, deflate, br', ...headers}, lookup, signal, timeout: 30_000}, res =>
      resolve({status: res.statusCode, headers: res.headers, body: res}),
    );
    req.on('timeout', () => req.destroy(Error('The page took too long to respond.')));
    req.on('error', reject);
  });
}

function readBody(r) {
  const enc = String(r.headers['content-encoding'] || '').toLowerCase();
  const stream =
    enc === 'gzip'
      ? r.body.pipe(zlib.createGunzip())
      : enc === 'deflate'
        ? r.body.pipe(zlib.createInflate())
        : enc === 'br'
          ? r.body.pipe(zlib.createBrotliDecompress())
          : r.body;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    stream.on('data', c => {
      size += c.length;
      if (size > MAX_BYTES) {
        stream.destroy();
        resolve(Buffer.concat(chunks).toString('utf8'));
      } else chunks.push(c);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}
