// One workspace's storage: a small key/value SQLite table plus folders for Pi sessions and task outputs.
// The global workspace lives in Rumi's data/ folder; a project workspace lives in <project>/.rumi/.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

export const GLOBAL = 'global';
export const workspaceId = folder => 'w-' + createHash('sha1').update(path.resolve(folder).toLowerCase()).digest('hex').slice(0, 12);
export const projectDataDir = folder => path.join(folder, '.rumi');

export function openStore(dir, {project = false} = {}) {
  const fresh = !fs.existsSync(path.join(dir, 'rumi.sqlite'));
  fs.mkdirSync(dir, {recursive: true});
  // Keep Rumi's files out of the project's version control unless the user decides otherwise.
  if (project && !fs.existsSync(path.join(dir, '.gitignore'))) fs.writeFileSync(path.join(dir, '.gitignore'), '# Rumi workspace data (document, tasks, agent sessions). Delete this file to commit it.\n*\n');
  const db = new DatabaseSync(path.join(dir, 'rumi.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const read = db.prepare('SELECT value FROM state WHERE id=?'), write = db.prepare('INSERT OR REPLACE INTO state VALUES (?,?)');
  return {
    dir, fresh, db,
    get: id => { const r = read.get(id); return r ? JSON.parse(r.value) : null; },
    put: (id, v) => write.run(id, JSON.stringify(v)),
    sessionsDir: path.join(dir, 'sessions'),
    outputDir: id => path.join(dir, 'outputs', id),
  };
}
