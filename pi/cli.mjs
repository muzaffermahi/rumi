// Rumi as a Pi package: `pi install git:github.com/muzaffermahi/rumi` adds a /rumi command that opens Rumi on
// the current folder, and Rumi's skills (pi/skills) become available in Pi. It imports nothing heavy on purpose.
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const launcher = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rumi.mjs');

export default function (pi) {
  pi.registerCommand('rumi', {
    description: 'Open Rumi, a writing workspace, on the current folder',
    handler: async (args, ctx) => {
      // Pi may run as a compiled binary; Rumi needs Node.
      const node = /node(\.exe)?$/i.test(process.execPath) ? process.execPath : 'node';
      spawn(node, [launcher, args?.trim() || ctx.cwd], {detached: true, stdio: 'ignore', windowsHide: true}).unref();
      ctx.ui.notify('Opening Rumi in your browser…', 'info');
    },
  });
}
