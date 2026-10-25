// The writing loop as a person uses it: write, delegate, keep writing, review the answer, ask and answer.
import {test, expect} from '@playwright/test';
import {startFakeModel} from '../test/fixtures/fake-model.mjs';
import {startRumi} from '../test/fixtures/rumi.mjs';

let model, rumi;
test.beforeAll(async () => {
  model = await startFakeModel();
  rumi = await startRumi({modelPort: model.port, config: {theme: 'light'}});
});
test.afterAll(async () => {
  await rumi?.stop();
  await model?.close();
});

const open = async page => {
  await page.goto(`${rumi.base}/?token=${rumi.token}`);
  await expect(page.locator('.tiptap')).toBeVisible();
};

test('a page without the access token is locked', async ({browser}) => {
  const fresh = await browser.newContext();
  const page = await fresh.newPage();
  await page.goto(rumi.base);
  await expect(page.getByText('Open Rumi from your computer')).toBeVisible();
  await fresh.close();
});

test('first run opens the welcome tour, and a delegated passage comes back to insert', async ({page}) => {
  await open(page);
  await expect(page.locator('.doc-title')).toHaveValue('Welcome to Rumi');
  // Select the example question and delegate it as a Write task.
  await page.locator('.tiptap blockquote p').click({clickCount: 3});
  await page.keyboard.press('Control+Enter');
  const box = page.getByRole('dialog', {name: 'Delegate'});
  await expect(box).toBeVisible();
  await box.getByRole('radio', {name: 'Write'}).click();
  await box.getByLabel('Task instruction').fill('Answer it briefly');
  await box.getByRole('button', {name: 'Delegate', exact: true}).click();
  // The passage is highlighted and keeps its task; the answer arrives in the margin.
  await expect(page.locator('.tiptap .task-link')).toHaveCount(1);
  await page.getByRole('button', {name: '1 suggestion'}).click();
  const card = page.getByRole('dialog', {name: /Suggestion from/});
  await expect(card).toContainText('Write at the same time each day');
  await card.getByRole('button', {name: 'Insert below'}).click();
  await expect(page.locator('.tiptap')).toContainText('Keep the bar low');
  // One undo takes it out again.
  await page.getByRole('button', {name: 'Undo'}).click();
  await expect(page.locator('.tiptap')).not.toContainText('Keep the bar low');
});

test('a worker that needs you asks beside the passage, and continues with your answer', async ({page}) => {
  await open(page);
  await page.locator('.tiptap p').first().click({clickCount: 3});
  await page.keyboard.press('Control+Enter');
  const box = page.getByRole('dialog', {name: 'Delegate'});
  await box.getByRole('radio', {name: 'Think'}).click();
  await box.getByLabel('Task instruction').fill('Rewrite this greeting [ask]');
  await box.getByLabel('Task instruction').press('Enter');
  await page.getByRole('button', {name: 'Answer its question'}).click();
  await page.getByRole('button', {name: 'Casual'}).click();
  await expect(page.getByRole('button', {name: '1 suggestion'})).toBeVisible();
});

test('documents: make one, use the slash menu, find it in the palette', async ({page}) => {
  await open(page);
  await page.getByRole('button', {name: 'New document'}).first().click();
  const title = page.locator('.doc-title');
  await expect(title).toHaveValue('Untitled');
  await title.fill('Garden notes');
  await title.press('Enter');
  await page.keyboard.type('/head');
  await expect(page.getByRole('listbox', {name: 'Insert'})).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Tomatoes');
  await expect(page.locator('.tiptap h1')).toHaveText('Tomatoes');
  await expect(page.locator('.save')).toHaveText('Saved');
  // Switch away and come back through the palette.
  await page.locator('.doc-row', {hasText: 'Welcome to Rumi'}).click();
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search commands').fill('garden');
  await page.keyboard.press('Enter');
  await expect(title).toHaveValue('Garden notes');
  await expect(page.locator('.tiptap h1')).toHaveText('Tomatoes');
});

test('settings: switch to dark, and the whole page follows', async ({page}) => {
  await open(page);
  await page.getByRole('button', {name: 'Settings'}).click();
  await page.getByRole('button', {name: 'Appearance'}).click();
  await page.getByRole('radio', {name: 'Dark'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Settings'}).click();
  await page.getByRole('button', {name: 'Appearance'}).click();
  await page.getByRole('radio', {name: 'Light'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('keyboard shortcuts are listed on ?', async ({page}) => {
  await open(page);
  await page.locator('.doc-title').click();
  await page.locator('body').press('Escape');
  await page.locator('.sidebar').click({position: {x: 10, y: 400}});
  await page.keyboard.press('Shift+?');
  await expect(page.getByRole('dialog', {name: 'Keyboard shortcuts'})).toBeVisible();
});
