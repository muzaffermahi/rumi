// The demo video behind docs/demo.gif: delegate a passage, keep writing while it works, then take the answer.
// Runs only with DEMO=1: `DEMO=1 npm run test:e2e -- demo` writes test-results/demo.webm; ffmpeg turns it into
// docs/demo.gif (fps=12, width 960, 128-colour palette) and docs/demo.mp4 (H.264). Uses the scripted model.
import fs from 'node:fs';
import {test, expect} from '@playwright/test';
import {startFakeModel} from '../test/fixtures/fake-model.mjs';
import {startRumi} from '../test/fixtures/rumi.mjs';

test.skip(!process.env.DEMO, 'Only when recording the demo (DEMO=1).');
const size = {width: 1280, height: 800};
test.use({viewport: size, deviceScaleFactor: 1, video: {mode: 'on', size}});
test.setTimeout(120_000);

const DEMO = `<p>We want to start a small reading club for people in town who would like to read more and talk about it.</p>
<h2>How it works</h2>
<p>The club will meet on a regular basis, probably once every month, and we are thinking that the town library would be a good place to do it, in the evening. Every month the group would read something, maybe a book or maybe some essays, and the choice would be made by members taking turns.</p>
<h2>What we can learn</h2>
<p>How do other reading clubs keep people coming back after the first few meetings?</p>
<h2>Next steps</h2>
<ul><li><p>Ask the library about a room on first Thursdays</p></li></ul>`;

let model, rumi;
test.beforeAll(async () => {
  process.env.FAKE_MODEL_DELAY = '2500';
  model = await startFakeModel();
  rumi = await startRumi({modelPort: model.port, provider: 'demo', modelId: 'writer', config: {theme: 'light'}});
  const {body: doc} = await rumi.api('/w/global/docs', {method: 'POST', body: {title: 'A reading club for our town'}});
  await rumi.api(`/w/global/docs/${doc.id}`, {method: 'PUT', body: {html: DEMO}});
  await rumi.api('/settings', {method: 'PUT', body: {onboarded: true}});
});
test.afterAll(async () => {
  delete process.env.FAKE_MODEL_DELAY;
  await rumi?.stop();
  await model?.close();
});

// A visible pointer that glides to each target, since recordings don't show the real one.
const POINTER = `addEventListener('DOMContentLoaded', () => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;border-radius:50%;background:rgba(31,122,104,.35);border:2px solid #1f7a68;pointer-events:none;transform:translate(-50%,-50%);left:-40px;top:-40px;transition:transform .1s';
  document.body.append(d);
  setInterval(() => document.querySelectorAll('[contenteditable]').forEach(e => (e.spellcheck = false)), 100);
  addEventListener('mousemove', e => { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => (d.style.transform = 'translate(-50%,-50%) scale(.7)'), true);
  addEventListener('mouseup', () => (d.style.transform = 'translate(-50%,-50%)'), true);
});`;
async function glide(page, locator, {click = 1, dx = 0.5} = {}) {
  const b = await locator.boundingBox();
  const x = b.x + b.width * dx;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y, {steps: 20});
  await page.waitForTimeout(150);
  if (click) await page.mouse.click(x, y, {clickCount: click});
}

test('demo', async ({page}) => {
  await page.addInitScript(POINTER);
  await page.goto(`${rumi.base}/?token=${rumi.token}`);
  await page.locator('.doc-row', {hasText: 'A reading club'}).click();
  await expect(page.locator('.doc-title')).toHaveValue('A reading club for our town');
  await page.mouse.move(640, 400);
  await page.waitForTimeout(1200);

  // Select a passage and hand it to a worker.
  await glide(page, page.locator('.tiptap p', {hasText: 'The club will meet'}), {click: 3});
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+Enter');
  const box = page.getByRole('dialog', {name: 'Delegate'});
  await page.waitForTimeout(500);
  await glide(page, box.getByRole('radio', {name: 'Write'}));
  await box.getByLabel('Task instruction').pressSequentially('Make it tighter and clearer for newcomers', {delay: 30});
  await page.waitForTimeout(300);
  await box.getByLabel('Task instruction').press('Enter');
  await page.waitForTimeout(600);

  // A second one, a research question.
  await glide(page, page.locator('.tiptap p', {hasText: 'How do other reading clubs'}), {click: 3});
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(400);
  await glide(page, box.getByRole('radio', {name: 'Research'}));
  await box.getByLabel('Task instruction').press('Enter');
  await page.waitForTimeout(400);

  // Keep writing while they work.
  await glide(page, page.locator('.tiptap li p', {hasText: 'Ask the library'}), {dx: 0.98});
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Make a one-page flyer for the café and the library', {delay: 45});
  await expect(page.getByRole('button', {name: '1 suggestion'})).toHaveCount(2, {timeout: 20_000});
  await page.waitForTimeout(1000);

  // Read the research answer beside its passage.
  await glide(page, page.getByRole('button', {name: '1 suggestion'}).nth(1));
  await expect(page.getByRole('dialog', {name: /Suggestion from/})).toContainText('Keep it small');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Replace the rewritten passage, seeing what changed word by word.
  await glide(page, page.getByRole('button', {name: '1 suggestion'}).first());
  const card = page.getByRole('dialog', {name: /Suggestion from/});
  await page.waitForTimeout(800);
  await glide(page, card.getByRole('tab', {name: 'Changes'}));
  await page.waitForTimeout(2500);
  await glide(page, card.getByRole('button', {name: 'Replace passage'}));
  await page.waitForTimeout(2500);

  const video = page.video();
  await page.close();
  fs.mkdirSync('test-results', {recursive: true});
  await video.saveAs('test-results/demo.webm');
});
