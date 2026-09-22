// Opt-in live regression: node tests/document-browser.mjs CONFIG_PATH PDF_RELATIVE_PATH
// Uses a fresh browser context, never submits a prompt or changes document content.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import yaml from 'js-yaml';

const config = yaml.load(await readFile(process.argv[2], 'utf8'));
const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
try {
  const page = await browser.newPage({ httpCredentials: { username: config.username, password: config.password }, viewport: { width: 1400, height: 1000 } });
  await page.goto(`http://127.0.0.1:${config.port || 3080}`);
  const input = page.locator('[contenteditable=true]');
  await input.click();
  const cdp = await page.context().newCDPSession(page);
  const compose = async text => {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.getSelection().toString()), '', 'IME caret must stay collapsed');
  };
  for (const text of ['n', 'ni', 'nih', 'nihao']) await compose(text);
  await cdp.send('Input.insertText', { text: '你好' });
  assert.equal(await input.innerText(), '你好');
  await input.press('Control+a');
  await compose('z'); await compose('zhong');
  await cdp.send('Input.insertText', { text: '中' });
  assert.equal(await input.innerText(), '中', 'composition replaces the selected draft');
  await input.press('Control+a'); await input.press('Backspace');
  await compose('q');
  await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  assert.equal((await input.innerText()).trim(), '', 'cancelled composition leaves no seed');
  await input.pressSequentially('abc');
  assert.equal(await input.innerText(), 'abc');
  await input.press('Control+a'); await input.press('Backspace');
  console.log('PASS: IME first character, continuous composition, Chinese commit, replacement, cancellation, ASCII');

  await page.getByRole('button', { name: '打开右侧边栏', exact: true }).click();
  await page.getByRole('button', { name: '项目文件' }).click();
  for (const name of process.argv[3].split('/')) await page.getByRole('button', { name, exact: true }).click();
  const controls = page.locator('[data-amadeus-pdf-controls]');
  await controls.waitFor();
  const number = controls.getByRole('spinbutton', { name: 'PDF 页码' });
  const total = Number(await number.getAttribute('max'));
  assert.ok(total > 1, 'use a multipage PDF');
  await page.locator('[data-pdf-page="1"] [data-pdf-text] .textLayer span').first().waitFor();
  const canvas = page.locator('[data-pdf-page="1"] canvas');
  const initial = (await canvas.boundingBox()).width;
  await controls.getByRole('button', { name: '放大', exact: true }).click();
  await page.waitForTimeout(100);
  assert.ok(Math.abs((await canvas.boundingBox()).width / initial - 1.1) < .02);
  await number.fill(String(total)); await number.press('Enter');
  await page.locator(`[data-pdf-page="${total}"] [data-pdf-text] .textLayer span`).first().waitFor();
  await page.waitForTimeout(150);
  assert.equal(await number.inputValue(), String(total));
  const alignment = await page.locator(`[data-pdf-page="${total}"]`).evaluate(node => {
    const canvas = node.querySelector('canvas').getBoundingClientRect();
    const text = node.querySelector('.textLayer').getBoundingClientRect();
    return Math.abs(canvas.width - text.width);
  });
  assert.ok(alignment < 2, `zoomed text layer must align with canvas: ${alignment}`);
  await number.fill('0'); await number.press('Enter');
  assert.equal(await number.inputValue(), '1');
  await number.fill('99999'); await number.press('Enter');
  assert.equal(await number.inputValue(), String(total));
  await controls.locator('[data-amadeus-pdf-scroll]').evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(150);
  assert.equal(await number.inputValue(), '1');
  await controls.getByRole('button', { name: '重置缩放' }).click();
  await page.waitForTimeout(100);
  assert.ok(Math.abs((await canvas.boundingBox()).width - initial) < 2);
  console.log('PASS: PDF zoom, reset, page jump, boundaries, scroll tracking, zoomed text alignment');
  const fit = controls.getByRole('button', { name: '适应侧边栏宽度' });
  await fit.click();
  assert.equal(await fit.getAttribute('aria-pressed'), 'true');
  for (const width of [360, 900]) {
    await controls.evaluate((el, width) => { el.style.width = `${width}px`; }, width);
    await page.waitForTimeout(200);
    const available = await controls.locator('[data-amadeus-pdf-scroll]').evaluate(el => el.clientWidth);
    assert.ok(Math.abs((await canvas.boundingBox()).width - available) < 2, 'fit follows sidebar width');
  }
  await controls.evaluate(el => { el.style.width = '100%'; });
  await controls.getByRole('button', { name: '缩小', exact: true }).click();
  assert.equal(await fit.getAttribute('aria-pressed'), 'false');
  await fit.click();
  assert.equal(await fit.getAttribute('aria-pressed'), 'true');
  console.log('PASS: fit width follows narrow/wide sidebar and can be restored after manual zoom');
} finally { await browser.close(); }

