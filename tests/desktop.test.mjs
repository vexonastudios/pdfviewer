import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function desktopHarness(argv = ['electron', root]) {
  const handlers = new Map(), listeners = new Map(), protocols = new Map();
  let mainWindow;
  const dialog = { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }), showMessageBoxSync: () => 0 };
  class WindowMock {
    constructor(options) {
      this.options = options;
      this.webContents = { mainFrame: {}, setWindowOpenHandler() {}, on() {}, session: { setPermissionRequestHandler() {} } };
      this.listeners = new Map(); mainWindow = this;
    }
    on(name, handler) { this.listeners.set(name, handler); }
    loadURL(url) { this.loadedURL = url; }
  }
  const electron = {
    app: { requestSingleInstanceLock: () => true, quit() {}, on() {}, whenReady: () => Promise.resolve(), isPackaged: true },
    BrowserWindow: WindowMock, dialog,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => listeners.set(name, handler) },
    Menu: { setApplicationMenu() {} }, shell: { showItemInFolder() {} },
    protocol: { registerSchemesAsPrivileged() {}, handle: (name, handler) => protocols.set(name, handler) },
    net: { fetch: async url => new Response(url) },
  };
  const context = vm.createContext({ require: name => name === 'electron' ? electron : require(name), __dirname: path.join(root, 'electron'), process: { argv, env: {} }, Uint8Array, Response, URL });
  vm.runInContext(await readFile(path.join(root, 'electron/main.cjs'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { handlers, listeners, protocols, dialog, window: mainWindow, event: { sender: mainWindow.webContents, senderFrame: mainWindow.webContents.mainFrame } };
}

test('desktop loads only local assets with sandboxed, isolated renderer', async () => {
  const h = await desktopHarness();
  assert.equal(h.window.loadedURL, 'paperdesk://app/index.html');
  assert.equal(h.window.options.webPreferences.sandbox, true);
  assert.equal(h.window.options.webPreferences.nodeIntegration, false);
  const handler = h.protocols.get('paperdesk');
  assert.equal((await handler({ url: 'paperdesk://elsewhere/file.txt' })).status, 404);
  assert.equal((await handler({ url: 'paperdesk://app/..%5C..%5Csecret' })).status, 403);
  assert.match(await (await handler({ url: 'paperdesk://app/fonts/NotoSans-Regular.ttf' })).text(), /dist\/fonts\/NotoSans-Regular\.ttf/);
});

test('desktop save backend handles cancellation, selected file paths, bytes and sender checks', async () => {
  const h = await desktopHarness(); const save = h.handlers.get('pdf:save');
  const bytes = Uint8Array.from([37, 80, 68, 70, 45]);
  assert.equal(await save(h.event, { bytes, name: 'test.pdf', kind: 'pdf' }), null);
  await mkdir(path.join(root, 'tmp/qa'), { recursive: true });
  const output = path.join(root, 'tmp/qa/desktop-save-test.bin');
  h.dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
  const result = await save(h.event, { bytes, name: 'test.pdf', kind: 'pdf' });
  assert.equal(result.path, output); assert.deepEqual(new Uint8Array(await readFile(output)), bytes);
  await assert.rejects(() => save({ sender: {}, senderFrame: {} }, { bytes, name: 'test.pdf' }), /Unknown caller/);
  await assert.rejects(() => save(h.event, { bytes: 'invalid', name: 'test.pdf' }), /Invalid output/);
});

test('desktop open backend reads the selected PDF and cancelled dialogs do not change files', async () => {
  const h = await desktopHarness(); const open = h.handlers.get('pdf:open');
  assert.equal(await open(h.event), null);
  await mkdir(path.join(root, 'tmp/qa'), { recursive: true });
  const input = path.join(root, 'tmp/qa/desktop-open-test.pdf');
  await writeFile(input, '%PDF-test');
  h.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] });
  const result = await open(h.event);
  assert.equal(result.name, 'desktop-open-test.pdf'); assert.equal(new TextDecoder().decode(result.bytes), '%PDF-test');
});

test('desktop review queue preserves argument order and opens each file on demand', async () => {
  await mkdir(path.join(root, 'tmp/qa'), { recursive: true });
  const first = path.join(root, 'tmp/qa/review-first.paperdesk.json');
  const second = path.join(root, 'tmp/qa/review-second.pdf');
  await writeFile(first, '{"format":"paperdesk-workspace-v1"}');
  await writeFile(second, '%PDF-second');
  const h = await desktopHarness(['electron', root, first, second]);
  const initial = await h.handlers.get('pdf:initial')(h.event);
  assert.equal(initial.file.name, 'review-first.paperdesk.json');
  assert.deepEqual(Array.from(initial.review.items, item => item.name), ['review-first.paperdesk.json', 'review-second.pdf']);
  const next = await h.handlers.get('pdf:review-file')(h.event, initial.review.id, 1);
  assert.equal(next.name, 'review-second.pdf');
  assert.equal(new TextDecoder().decode(next.bytes), '%PDF-second');
  await assert.rejects(() => h.handlers.get('pdf:review-file')(h.event, initial.review.id, 2), /review item is unavailable/);
  await assert.rejects(() => h.handlers.get('pdf:review-file')({ sender: {} }, initial.review.id, 0), /Unknown caller/);
});

test('closing with unsaved edits can be cancelled', async () => {
  const h = await desktopHarness();
  h.listeners.get('pdf:dirty')(h.event, true);
  let prevented = false;
  h.window.listeners.get('close')({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  h.dialog.showMessageBoxSync = () => 1; prevented = false;
  h.window.listeners.get('close')({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});
