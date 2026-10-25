// The README's screenshots, taken from a neutral demo document with the scripted model.
// Runs only with SCREENSHOTS=1: `SCREENSHOTS=1 npm run test:e2e -- screenshots`. Writes docs/*.png.
import {test, expect} from '@playwright/test';
import {startFakeModel} from '../test/fixtures/fake-model.mjs';
import {startRumi} from '../test/fixtures/rumi.mjs';

test.skip(!process.env.SCREENSHOTS, 'Only when refreshing the README screenshots (SCREENSHOTS=1).');
test.use({viewport: {width: 1440, height: 900}, deviceScaleFactor: 2});

const DEMO = `<p>We want to start a small reading club for people in town who would like to read more and talk about it.</p>
<h2>How it works</h2>
<p>The club will meet on a regular basis, probably once every month, and we are thinking that the town library would be a good place to do it, in the evening. Every month the group would read something, maybe a book or maybe some essays, and the choice would be made by members taking turns.</p>
<h2>What we can learn</h2>
<p>How do other reading clubs keep people coming back after the first few meetings?</p>
<h2>Risks</h2>
<p>Risks: people stop coming, the room is not available, nobody wants to choose.</p>
<h2>Next steps</h2>
<ul><li><p>Ask the library about a room on first Thursdays</p></li><li><p>Make a one-page flyer</p></li></ul>`;

let model, rumi;
test.beforeAll(async () => {
  model = await startFakeModel();
  rumi = await startRumi({modelPort: model.port, provider: 'demo', modelId: 'writer', config: {theme: 'light'}});
  const {body: doc} = await rumi.api('/w/global/docs', {method: 'POST', body: {title: 'A reading club for our town'}});
  await rumi.api(`/w/global/docs/${doc.id}`, {method: 'PUT', body: {html: DEMO}});
  await rumi.api('/settings', {method: 'PUT', body: {onboarded: true}});
});
test.afterAll(async () => {
  await rumi?.stop();
  await model?.close();
});

// Lets cards finish fading in and clears toasts, so pictures show only the work.
const settle = async page => {
  for (const close of await page.locator('.toast .ghost').all()) await close.click({timeout: 500}).catch(() => {});
  await page.waitForTimeout(600);
};
async function delegate(page, text, kind, instruction = '') {
  const p = page.locator('.tiptap p', {hasText: text}).first();
  await p.click({clickCount: 3});
  await page.keyboard.press('Control+Enter');
  const box = page.getByRole('dialog', {name: 'Delegate'});
  await box.getByRole('radio', {name: kind}).click();
  if (instruction) await box.getByLabel('Task instruction').fill(instruction);
  return box;
}

test('README screenshots', async ({page}) => {
  await page.goto(`${rumi.base}/?token=${rumi.token}`);
  await page.locator('.doc-row', {hasText: 'A reading club'}).click();
  await expect(page.locator('.doc-title')).toHaveValue('A reading club for our town');

  // The Delegate box, open over a passage.
  const box = await delegate(page, 'The club will meet', 'Write', 'Make it tighter and clearer for newcomers');
  await settle(page);
  await page.screenshot({path: 'docs/delegate.png'});
  await box.getByRole('button', {name: 'Delegate', exact: true}).click();

  // Two more tasks running beside the writing.
  await (await delegate(page, 'How do other reading clubs', 'Research')).getByLabel('Task instruction').press('Enter');
  await (await delegate(page, 'Risks: people stop coming', 'Think', 'What is the real risk, and how do we plan for it?'))
    .getByLabel('Task instruction')
    .press('Enter');
  await expect(page.getByRole('button', {name: '1 suggestion'})).toHaveCount(3);

  // The margin with its answers, one open.
  await page.getByRole('button', {name: '1 suggestion'}).nth(1).click();
  await expect(page.getByRole('dialog', {name: /Suggestion from/})).toContainText('Keep it small');
  await expect(page.locator('.toast')).toHaveCount(0, {timeout: 10_000});
  await settle(page);
  await page.screenshot({path: 'docs/suggestion.png'});
  await page.keyboard.press('Escape');

  // Replacing a passage, shown as a word diff.
  await page.getByRole('button', {name: '1 suggestion'}).first().click();
  const card = page.getByRole('dialog', {name: /Suggestion from/});
  await card.getByRole('tab', {name: 'Changes'}).click();
  await settle(page);
  await page.screenshot({path: 'docs/replace.png'});
  await card.getByRole('button', {name: 'Replace passage'}).click();

  // A task's conversation beside the document.
  await page.locator('.task-row', {hasText: 'What is the real risk'}).click();
  await expect(page.locator('.task-pane')).toContainText('Handed back');
  await settle(page);
  await page.screenshot({path: 'docs/conversation.png'});
  await page.getByRole('button', {name: 'Close task'}).click();

  // The command palette.
  await page.keyboard.press('Control+k');
  await settle(page);
  await page.screenshot({path: 'docs/palette.png'});
  await page.keyboard.press('Escape');

  // Dark mode.
  await rumi.api('/settings', {method: 'PUT', body: {theme: 'dark'}});
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', {name: '1 suggestion'}).last().click();
  await settle(page);
  await page.screenshot({path: 'docs/dark.png'});
});
