// Rumi's worker extension. Inside Rumi, every task session loads rumiWorker(): the tools for its kind, plus a
// check before the run settles that the worker actually delivered (finish) and, for research, actually searched.
// (pi/cli.mjs is the small entry point the Pi CLI loads when Rumi is installed as a Pi package.)
import path from 'node:path';
import {webTools, rumiTools} from './tools.mjs';

const CHECK = 'rumi-check';
const SHELLS = new Set(['bash', 'powershell']);
const FILE_WRITERS = new Set(['write', 'edit']);

// ctl is owned by Rumi's task runner: {kind, searchMin, budget, cwd, outDir, contextWindow, search, allowPrivate,
// approvals, turn, onFinish, onAsk, onPropose}.
// turn is replaced before every prompt: {expectFinish, requireResearch, finished, asked, readWeb, nudged:{finish, research}}.
export function rumiWorker(ctl) {
  return pi => {
    for (const t of [...webTools(ctl), ...rumiTools(ctl)]) pi.registerTool(t);

    // Research, Write and Think tasks read the project but write only in their own task folder.
    pi.on('tool_call', event => {
      if (ctl.editsProject !== false || !FILE_WRITERS.has(event.toolName) || !ctl.outDir) return;
      const target = path.resolve(ctl.cwd || ctl.outDir, String(event.input?.path ?? event.input?.file_path ?? ''));
      const rel = path.relative(ctl.outDir, target);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return {block: true, reason: `This kind of task can't change the project. Write files in your task folder instead: ${ctl.outDir}`};
      }
    });

    // Shell commands may need the user's go-ahead: always, or once the run has read a web page (whose text could be
    // steering the worker). ctl.approvals: 'off' | 'after-web' | 'always'.
    pi.on('tool_call', async (event, ctx) => {
      if (!SHELLS.has(event.toolName) || !ctl.approvals || ctl.approvals === 'off') return;
      if (ctl.approvals === 'after-web' && !ctl.turn?.readWeb) return;
      const command = String(event.input?.command ?? '').slice(0, 2000);
      const why =
        ctl.approvals === 'always' ? 'You asked to approve every command.' : 'This task read a web page earlier, so Rumi checks commands with you first.';
      const confirm = ctx?.ui?.confirm || ctl.confirm;
      const ok = confirm ? await confirm('Run this command?', `${command}\n\n${why}`) : false;
      if (!ok)
        return {
          block: true,
          reason: 'The user did not approve this command. Do not try to run it another way; continue without it or explain what you needed in your notes.',
        };
    });

    // Before the run settles: one nudge for too little research, then one for a missing hand-back.
    pi.on('agent_before_settle', event => {
      const turn = ctl.turn;
      if (!turn || event.outcome !== 'completed' || turn.asked) return;
      let reason = null,
        content = '';
      if (turn.requireResearch && ctl.budget.used < ctl.searchMin && !turn.nudged.research) {
        reason = 'research';
        content = `Rumi requires at least ${ctl.searchMin} distinct web searches for this research task; you ran ${ctl.budget.used}. Plan and run the remaining searches now, read the best sources with read_page, then revise your result and call finish.`;
      } else if (turn.expectFinish && !turn.finished && !turn.nudged.finish) {
        reason = 'finish';
        content =
          'You ended your turn without calling finish, so nothing was handed back to the user. If the work is done, call finish now with the answer (written as material for their document) and your notes. If it is not done, continue working, then call finish. If you truly cannot continue without the user, call ask_user.';
      }
      if (!reason) return;
      turn.nudged[reason]++;
      return {
        entries: [...event.entries, {type: 'custom_message', customType: CHECK, content, display: true, details: {reason, searches: ctl.budget.used}}],
        continue: true,
      };
    });
  };
}
