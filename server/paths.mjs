// Where Rumi keeps things. Shared by the server and the `rumi` command, so both agree without asking each other.
//   <data>/config.json   your settings (see schema/config.schema.json)
//   <data>/server.json   the running server's port, pid and access token (readable only by you)
//   <data>/rumi.sqlite   the Global workspace and app state
//   <data>/pi/           Rumi's own Pi home: sign-ins, packages, MCP servers
//   <data>/rumi.log      the background server's log
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A checkout that already has data/ keeps using it; an installed copy keeps its data in ~/.rumi.
export const dataDir = path.resolve(
  process.env.RUMI_DATA || (fs.existsSync(path.join(appDir, 'data')) ? path.join(appDir, 'data') : path.join(os.homedir(), '.rumi')),
);
export const configFile = path.join(dataDir, 'config.json');
export const serverFile = path.join(dataDir, 'server.json');
export const logFile = path.join(dataDir, 'rumi.log');
export const piDir = path.join(dataDir, 'pi');
export const DEFAULT_PORT = 4317;

export const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;

// Writes a file only the current user can read (no-op permissions on Windows, where the profile folder is private).
export function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, text, {mode: 0o600});
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
}

export const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
