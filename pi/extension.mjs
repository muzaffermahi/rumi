// Rumi's worker extension. Inside Rumi, every task session loads rumiWorker(): the tools for its kind, plus a
// check before the run settles that the worker actually delivered (finish) and, for research, actually searched.
// (pi/cli.mjs is the small entry point the Pi CLI loads when Rumi is installed as a Pi package.)
import {webTools, rumiTools} from './tools.mjs';

const CHECK = 'rumi-check';

// ctl is owned by Rumi's task runner: {kind, searchMin, budget, cwd, outDir, contextWindow, turn, onFinish, onAsk}.
// turn is replaced before every prompt: {expectFinish, requireResearch, finished, asked, nudged:{finish, research}}.
export function rumiWorker(ctl) {
  return pi => {
    for (const t of [...webTools(ctl), ...rumiTools(ctl)]) pi.registerTool(t);

    // Before the run settles: one nudge for too little research, then one for a missing hand-back.
    pi.on('agent_before_settle', event => {
      const turn = ctl.turn;
      if (!turn || event.outcome !== 'completed' || turn.asked) return;
      let reason = null, content = '';
      if (turn.requireResearch && ctl.budget.used < ctl.searchMin && !turn.nudged.research) {
        reason = 'research';
        content = `Rumi requires at least ${ctl.searchMin} distinct web searches for this research task; you ran ${ctl.budget.used}. Plan and run the remaining searches now, read the best sources with read_page, then revise your result and call finish.`;
      } else if (turn.expectFinish && !turn.finished && !turn.nudged.finish) {
        reason = 'finish';
        content = 'You ended your turn without calling finish, so nothing was handed back to the user. If the work is done, call finish now with the answer (written as material for their document) and your notes. If it is not done, continue working, then call finish. If you truly cannot continue without the user, call ask_user.';
      }
      if (!reason) return;
      turn.nudged[reason]++;
      return {entries: [...event.entries, {type: 'custom_message', customType: CHECK, content, display: true, details: {reason, searches: ctl.budget.used}}], continue: true};
    });
  };
}
