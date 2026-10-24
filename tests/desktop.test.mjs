import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function desktopHarness(argv = ['electron', root]) {
  const handlers = new Map(), listeners = new Map(), protocols = new Map();
  let mainWindow;
  let printHandler = (options, callback) => callback(false, 'Print job canceled');
  const dialog = { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }), showMessageBoxSync: () => 0 };
  class WindowMock {
    constructor(options) {
      this.options = options;
      this.webContents = { mainFrame: {}, send: (...args) => { this.sent = args; }, executeJavaScript: script => script.includes('afterprint') ? new Promise(() => {}) : Promise.resolve([]), print: (options, callback) => { this.printOptions = options; printHandler(options, callback); }, setWindowOpenHandler() {}, on() {}, session: { setPermissionRequestHandler() {} } };
      this.listeners = new Map(); mainWindow = this;
    }
    on(name, handler) { this.listeners.set(name, handler); }
    loadURL(url) { this.loadedURL = url; }
    close() { this.closed = true; }
    isDestroyed() { return Boolean(this.destroyed); }
    destroy() { this.destroyed = true; }
  }
  const appPaths = new Map();
  const electron = {
    app: { requestSingleInstanceLock: () => true, quit() {}, on() {}, whenReady: () => Promise.resolve(), isPackaged: true, getPath: name => appPaths.get(name) || path.join(root, 'tmp/qa/signature-size-app'), setPath: (name, value) => appPaths.set(name, value) },
    BrowserWindow: WindowMock, dialog,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => listeners.set(name, handler) },
    Menu: { setApplicationMenu() {} }, shell: { showItemInFolder() {} },
    protocol: { registerSchemesAsPrivileged() {}, handle: (name, handler) => protocols.set(name, handler) },
    net: { fetch: async url => new Response(url) },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value, 'utf8').map(byte => byte ^ 0xaa), decryptString: value => Buffer.from(value).map(byte => byte ^ 0xaa).toString('utf8') },
  };
  const context = vm.createContext({ require: name => name === 'electron' ? electron : require(name), __dirname: path.join(root, 'electron'), process: { argv, env: {} }, Buffer, Uint8Array, Response, URL });
  vm.runInContext(await readFile(path.join(root, 'electron/main.cjs'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { handlers, listeners, protocols, dialog, appPaths, setPrintHandler: handler => { printHandler = handler; }, window: mainWindow, event: { sender: mainWindow.webContents, senderFrame: mainWindow.webContents.mainFrame } };
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

test('Save updates an opened workspace and final export opens in a separate Finals folder', async () => {
  await mkdir(path.join(root, 'tmp/qa'), { recursive: true });
  const draft = path.join(root, 'tmp/qa/save-draft.paperdesk.json');
  await writeFile(draft, 'before');
  const h = await desktopHarness(['electron', root, draft]);
  await h.handlers.get('pdf:initial')(h.event);
  const save = h.handlers.get('pdf:save');
  const updated = new TextEncoder().encode('after');
  const saved = await save(h.event, { bytes: updated, name: 'save-draft.paperdesk.json', kind: 'json', overwritePath: draft });
  assert.equal(saved.path, draft);
  assert.equal(await readFile(draft, 'utf8'), 'after');
  await assert.rejects(() => save(h.event, { bytes: updated, name: 'other.paperdesk.json', kind: 'json', overwritePath: path.join(root, 'tmp/qa/other.paperdesk.json') }), /not open for saving/);
  let requestedPath;
  h.dialog.showSaveDialog = async (_, options) => { requestedPath = options.defaultPath; return { canceled: true }; };
  await save(h.event, { bytes: updated, name: 'save-draft-final.pdf', kind: 'final-pdf', sourcePath: draft });
  assert.equal(requestedPath, path.join(root, 'tmp/qa/Final PDFs/save-draft-final.pdf'));
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

test('packet folder prefers editable workspaces and exports reviewed finals atomically', async () => {
  const folder = path.join(root, 'tmp/qa', `packet-${Date.now()}`);
  await mkdir(path.join(folder, 'Child'), { recursive: true });
  await mkdir(path.join(folder, 'Final PDFs'), { recursive: true });
  await writeFile(path.join(folder, 'Child', 'Form.pdf'), '%PDF-original');
  await writeFile(path.join(folder, 'Child', 'Form.paperdesk.json'), '{"format":"paperdesk-workspace-v1"}');
  await writeFile(path.join(folder, 'Other.pdf'), '%PDF-other');
  await writeFile(path.join(folder, 'Final PDFs', 'old.pdf'), '%PDF-old');
  const h = await desktopHarness();
  h.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  const packet = await h.handlers.get('pdf:open-packet')(h.event);
  assert.deepEqual(Array.from(packet.review.items, item => item.location), ['Child\\Form.paperdesk.json', 'Other.pdf']);
  const final = Uint8Array.from(Buffer.from('%PDF-final'));
  const result = await h.handlers.get('pdf:packet-export')(h.event, packet.review.id, 0, final);
  assert.equal(result.path, path.join(folder, 'Final PDFs', 'Child - Form-final.pdf'));
  assert.deepEqual(new Uint8Array(await readFile(result.path)), final);
  assert.equal((await readdir(path.join(folder, 'Final PDFs'))).some(name => name.endsWith('.tmp')), false);
  await h.handlers.get('pdf:review-file')(h.event, packet.review.id, 1);
  const newWorkspace = path.join(folder, 'Other.paperdesk.json');
  h.dialog.showSaveDialog = async () => ({ canceled: false, filePath: newWorkspace });
  await h.handlers.get('pdf:save')(h.event, { bytes: Uint8Array.from(Buffer.from('{"format":"paperdesk-workspace-v1"}')), name: 'Other.paperdesk.json', kind: 'json', sourcePath: path.join(folder, 'Other.pdf') });
  const updated = await h.handlers.get('pdf:packet-update')(h.event, packet.review.id, 1, newWorkspace);
  assert.equal(updated.name, 'Other.paperdesk.json');
  assert.equal((await h.handlers.get('pdf:review-file')(h.event, packet.review.id, 1)).name, 'Other.paperdesk.json');
  await assert.rejects(() => h.handlers.get('pdf:packet-export')(h.event, 'unknown', 0, final), /Reopen the packet folder/);
});

test('isolated review window uses its own single-instance profile', async () => {
  const h = await desktopHarness(['electron', root, '--paperdesk-isolated-review']);
  assert.equal(h.appPaths.get('userData'), path.join(root, 'tmp/qa/signature-size-app/Paperdesk PDF Review'));
});

test('packet batch failure leaves existing finals unchanged and removes staged files', async () => {
  const folder = path.join(root, 'tmp/qa', `transaction-${Date.now()}`);
  await mkdir(path.join(folder, 'Final PDFs'), { recursive: true });
  await writeFile(path.join(folder, 'Form.pdf'), '%PDF-original');
  const target = path.join(folder, 'Final PDFs/Form-final.pdf');
  await writeFile(target, '%PDF-existing-final');
  const h = await desktopHarness();
  h.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  const packet = await h.handlers.get('pdf:open-packet')(h.event);
  const batch = h.handlers.get('pdf:packet-export-batch'), bytes = Uint8Array.from(Buffer.from('%PDF-final'));
  await assert.rejects(() => batch(h.event, packet.review.id, [{ index: 0, bytes }, { index: 5, bytes }]), /Invalid packet/);
  assert.equal(await readFile(target, 'utf8'), '%PDF-existing-final');
  assert.deepEqual(await readdir(path.join(folder, 'Final PDFs')), ['Form-final.pdf']);
  await batch(h.event, packet.review.id, [{ index: 0, bytes, copy: true }]);
  assert.equal(await readFile(path.join(folder, 'Final PDFs/Form-copy.pdf'), 'utf8'), '%PDF-final');
  const manifest = JSON.parse(await readFile(path.join(folder, 'Final PDFs/packet-manifest.json'), 'utf8'));
  assert.equal(manifest.files[0].mode, 'original-copy');
  assert.equal(manifest.files[0].sha256.length, 64);
});

test('native print cancellation resolves without reporting a sent job and validates image input', async () => {
  const h = await desktopHarness(), print = h.handlers.get('pdf:print');
  assert.equal(await print(h.event, [{ data: 'data:image/png;base64,iVBORw0KGgo=', width: 612, height: 792 }]), false);
  await assert.rejects(() => print(h.event, [{ data: 'https://external.example/image.png', width: 612, height: 792 }]), /Invalid print/);
});

test('End print session releases a native print call whose callback never arrives', async () => {
  const h = await desktopHarness();
  h.setPrintHandler(() => {});
  const pending = h.handlers.get('pdf:print')(h.event, [{ data: 'data:image/png;base64,iVBORw0KGgo=', width: 612, height: 792 }]);
  await new Promise(resolve => setImmediate(resolve));
  await h.handlers.get('pdf:print-cancel')(h.event);
  assert.equal(await pending, false);
});

test('closing with unsaved edits requests Save first in the renderer before closing', async () => {
  const h = await desktopHarness();
  h.listeners.get('pdf:dirty')(h.event, true);
  let prevented = false;
  h.window.listeners.get('close')({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(h.window.sent, ['pdf:close-request']);
  await h.handlers.get('pdf:close')(h.event);
  assert.equal(h.window.closed, true); prevented = false;
  h.window.listeners.get('close')({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});

test('signature widths persist per signer without changing the ink image', async () => {
  const signatureFile = path.join(root, 'tmp/qa/signature-size-app/Paperdesk PDF/signatures.json');
  await mkdir(path.dirname(signatureFile), { recursive: true });
  await rm(path.join(path.dirname(signatureFile), 'signatures.enc'), { force: true });
  await writeFile(signatureFile, '[]');
  const h = await desktopHarness();
  const dataUrl = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')}`;
  const save = h.handlers.get('pdf:signatures-save');
  await save(h.event, { signer: 'Signer One', dataUrl, width: 800, height: 200 });
  await save(h.event, { signer: 'Signer Two', dataUrl, width: 800, height: 200 });
  await h.handlers.get('pdf:signatures-size')(h.event, 'Signer One', 56);
  const records = await h.handlers.get('pdf:signatures-list')(h.event);
  assert.equal(records.find(item => item.signer === 'Signer One').placementWidth, 56);
  assert.equal(records.find(item => item.signer === 'Signer Two').placementWidth, undefined);
  assert.equal(records[0].dataUrl, dataUrl);
  const encrypted = await readFile(path.join(path.dirname(signatureFile), 'signatures.enc'));
  assert.equal(encrypted.subarray(0, 5).toString(), 'PDSG1');
  assert.equal(encrypted.includes(Buffer.from('Signer One')), false);
  await assert.rejects(() => readFile(signatureFile), /ENOENT/);
  await save(h.event, { signer: 'Signer One', dataUrl, width: 800, height: 200, placementWidth: 100 });
  assert.equal((await h.handlers.get('pdf:signatures-list')(h.event)).find(item => item.signer === 'Signer One').placementWidth, 56);
  await assert.rejects(() => h.handlers.get('pdf:signatures-size')(h.event, 'Signer One', 500), /Invalid saved signature width/);
});

test('a person can save initials separately from their full signature', async () => {
  const signatureFile = path.join(root, 'tmp/qa/signature-size-app/Paperdesk PDF/signatures.json');
  await mkdir(path.dirname(signatureFile), { recursive: true });
  await rm(path.join(path.dirname(signatureFile), 'signatures.enc'), { force: true });
  await writeFile(signatureFile, '[]');
  const h = await desktopHarness();
  const dataUrl = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')}`;
  const save = h.handlers.get('pdf:signatures-save');
  await save(h.event, { signer: 'Sample Signer', dataUrl, width: 800, height: 200 });
  await save(h.event, { signer: 'Sample Signer', kind: 'initials', dataUrl, width: 80, height: 40 });
  await h.handlers.get('pdf:signatures-size')(h.event, 'Sample Signer', 22, 'initials');
  let records = await h.handlers.get('pdf:signatures-list')(h.event);
  assert.equal(records.length, 2);
  assert.equal(records.find(item => item.kind === 'signature').placementWidth, undefined);
  assert.equal(records.find(item => item.kind === 'initials').placementWidth, 22);
  await h.handlers.get('pdf:signatures-remove')(h.event, 'Sample Signer', 'initials');
  records = await h.handlers.get('pdf:signatures-list')(h.event);
  assert.deepEqual(Array.from(records, item => item.kind), ['signature']);
});
