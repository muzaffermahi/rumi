// Writes schema/config.schema.json from the settings' own description (server/config.mjs), so editors can
// autocomplete and check config.json. A test fails if the committed file falls behind.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.RUMI_DATA ||= fs.mkdtempSync(path.join(os.tmpdir(), 'rumi-schema-')); // don't read anyone's settings
delete process.env.RUMI_MAX_WORKERS;
const {jsonSchema} = await import('../server/config.mjs');
const file = new URL('../schema/config.schema.json', import.meta.url);
fs.writeFileSync(file, `${JSON.stringify(jsonSchema(), null, 2)}\n`);
console.log('schema/config.schema.json written');
