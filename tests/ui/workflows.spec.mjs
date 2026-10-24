import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.testSaves = []; window.testRecovery = [];
    window.paperdesk = {
      initialFile: async () => null, listSignatures: async () => [], recoveryList: async () => [],
      setDirty: () => {}, onOpen: () => () => {}, onReview: () => () => {}, onCloseRequest: () => () => {},
      recoverySave: async record => { window.testRecovery.push(record); }, recoveryClear: async () => {},
      save: async record => { window.testSaves.push(record); return { name: record.name, path: `C:\\Synthetic\\${record.name}` }; },
    };
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Try a practice form' }).click();
  await expect(page.getByRole('heading', { name: 'Form fields', exact: true })).toBeVisible();
});

test('editing creates recovery and Save first completes the requested navigation', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Full name', exact: true }).last().fill('Synthetic Test Person');
  await expect.poll(() => page.evaluate(() => window.testRecovery.length)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'paperdeskPDF', exact: true }).click();
  await page.getByRole('button', { name: 'Save first', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paperwork, without the work.' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(new TextDecoder().decode(window.testSaves[0].bytes)).state.values['Full name'])).toBe('Synthetic Test Person');
});

test('final preview renders saved answers and requires review confirmation', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Full name', exact: true }).last().fill('Synthetic Preview Person');
  await page.getByRole('button', { name: 'Export final PDF', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review before export' });
  await expect(dialog.getByText('Synthetic Preview Person', { exact: true })).toBeVisible();
  const exportButton = dialog.getByRole('button', { name: 'Export flattened final' });
  await expect(exportButton).toBeDisabled();
  await dialog.getByRole('checkbox').check(); await exportButton.click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => new TextDecoder().decode(window.testSaves[0].bytes.slice(0, 5)))).toBe('%PDF-');
});

test('arranging pages protects an unsaved editable draft', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Full name', exact: true }).last().fill('Synthetic Page Person');
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: 'Create PDF with these pages' }).click();
  await expect(page.getByRole('dialog', { name: 'You have unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Save first', exact: true }).click();
  await expect(page.locator('header')).toContainText('Welcome to Paperdesk-arranged.pdf');
  await expect(page.getByText('Synthetic Page Person', { exact: true })).toBeVisible();
});

test('OCR reads the bundled English model without contacting an external service', async ({ page }) => {
  const remote = [];
  await page.route('**/*', async route => {
    if (route.request().url().startsWith('http://127.0.0.1:5245')) await route.continue();
    else { remote.push(route.request().url()); await route.abort(); }
  });
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: 'Recognize text', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Recognized text', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Recognized text', exact: true })).toHaveValue(/PAPERDESK/);
  expect(remote).toEqual([]);
});

test('document tools stay usable in a smaller window and trap keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Document tools', exact: true });
  const bounds = await dialog.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(900);
  for (let i = 0; i < 18; i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});
