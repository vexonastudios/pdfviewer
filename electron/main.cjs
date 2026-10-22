const { app, BrowserWindow, dialog, ipcMain, shell, Menu, protocol, net } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'paperdesk', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let window;
let dirty = false;
const signaturePath = () => path.join(app.getPath('appData'), 'Paperdesk PDF', 'signatures.json');
function validSignature(record) {
  if (!record || typeof record.signer !== 'string' || !record.signer.trim() || record.signer.length > 80 || /[\x00-\x1f]/.test(record.signer) || typeof record.dataUrl !== 'string' ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(record.dataUrl) || record.dataUrl.length > 2_000_000 ||
      !Number.isInteger(record.width) || !Number.isInteger(record.height) ||
      record.width < 1 || record.height < 1 || record.width > 3000 || record.height > 3000) throw new Error('Invalid signature image.');
  const png = Buffer.from(record.dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('A PNG signature image is required.');
  return { signer: record.signer, dataUrl: record.dataUrl, width: record.width, height: record.height };
}
async function readSignatures() {
  try {
    const records = JSON.parse(await fs.readFile(signaturePath(), 'utf8'));
    return Array.isArray(records) ? records.map(validSignature).slice(0, 20) : [];
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function writeSignatures(records) {
  const target = signaturePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(records), { mode: 0o600 });
}
const fileArguments = args => args.slice(1).filter(arg => /(?:\.pdf|\.paperdesk\.json)$/i.test(arg));
let pendingPaths = fileArguments(process.argv);
const reviewSessions = new Map();
const openedPaths = new Set();
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();

function validSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unknown caller');
}

async function readPDF(filePath) {
  const resolved = path.resolve(filePath);
  if (!['.pdf', '.json'].includes(path.extname(resolved).toLowerCase())) throw new Error('Choose a PDF or Paperdesk workspace.');
  const stat = await fs.stat(resolved);
  if (stat.size > 300 * 1024 * 1024) throw new Error('This PDF is larger than the 300 MB limit.');
  const bytes = await fs.readFile(resolved);
  openedPaths.add(resolved);
  return { name: path.basename(resolved), path: resolved, bytes: new Uint8Array(bytes) };
}

async function prepareOpen(paths) {
  const file = await readPDF(paths[0]);
  if (paths.length === 1) return { file, review: null };
  const id = randomUUID();
  reviewSessions.set(id, paths);
  return { file, review: { id, items: paths.map(filePath => ({ name: path.basename(filePath) })) } };
}

app.on('second-instance', (_, args) => {
  const paths = fileArguments(args);
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
    if (paths.length) prepareOpen(paths).then(open => window.webContents.send(paths.length > 1 ? 'pdf:open-review' : 'pdf:open-file', paths.length > 1 ? open : open.file)).catch(error => dialog.showErrorBox('Cannot open PDF', error.message));
  }
});

app.whenReady().then(() => {
  const assetRoot = path.resolve(__dirname, '../dist');
  protocol.handle('paperdesk', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    const target = path.resolve(assetRoot, '.' + decodeURIComponent(url.pathname));
    const relative = path.relative(assetRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1480, height: 980, minWidth: 1000, minHeight: 700,
    title: 'Paperdesk PDF', backgroundColor: '#f8f7f3',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
  window.on('close', event => {
    if (dirty && dialog.showMessageBoxSync(window, { type: 'question', buttons: ['Keep editing', 'Discard and close'], defaultId: 0, cancelId: 0, message: 'Close without saving your changes?', detail: 'Your original PDF has not been changed.' }) !== 1) event.preventDefault();
  });
  if (!app.isPackaged && process.env.PAPERDESK_DEV_URL === 'http://127.0.0.1:5173') window.loadURL(process.env.PAPERDESK_DEV_URL);
  else window.loadURL('paperdesk://app/index.html');
});
app.on('window-all-closed', () => app.quit());

ipcMain.handle('pdf:open', async event => {
  validSender(event);
  const result = await dialog.showOpenDialog(window, { title: 'Open a PDF or workspace', filters: [{ name: 'PDF or Paperdesk workspace', extensions: ['pdf', 'json'] }], properties: ['openFile'] });
  return result.canceled ? null : readPDF(result.filePaths[0]);
});
ipcMain.handle('pdf:initial', async event => {
  validSender(event);
  if (!pendingPaths.length) return null;
  const paths = pendingPaths;
  pendingPaths = [];
  return prepareOpen(paths);
});
ipcMain.handle('pdf:review-file', async (event, id, index) => {
  validSender(event);
  const paths = reviewSessions.get(id);
  if (!paths || !Number.isInteger(index) || index < 0 || index >= paths.length) throw new Error('This review item is unavailable. Reopen the review queue.');
  return readPDF(paths[index]);
});
ipcMain.handle('pdf:save', async (event, { bytes, name, kind, overwritePath, sourcePath }) => {
  validSender(event);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 500 * 1024 * 1024) throw new Error('Invalid output file or file larger than 500 MB.');
  const extension = kind === 'zip' ? 'zip' : kind === 'json' ? 'json' : 'pdf';
  const safeName = path.basename(String(name || 'document')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  if (overwritePath) {
    const target = path.resolve(overwritePath);
    if (kind !== 'json' || !/\.paperdesk\.json$/i.test(target) || !openedPaths.has(target)) throw new Error('This workspace is not open for saving. Use Save As instead.');
    await fs.writeFile(target, bytes);
    return { name: path.basename(target), path: target };
  }
  let defaultPath = safeName;
  if (kind === 'final-pdf' && sourcePath && openedPaths.has(path.resolve(sourcePath))) {
    const exportDirectory = path.join(path.dirname(path.resolve(sourcePath)), 'Final PDFs');
    await fs.mkdir(exportDirectory, { recursive: true });
    defaultPath = path.join(exportDirectory, safeName);
  }
  const result = await dialog.showSaveDialog(window, { title: kind === 'final-pdf' ? 'Export final PDF' : kind === 'json' ? 'Save workspace' : 'Save a copy', defaultPath, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
  if (result.canceled) return null;
  await fs.writeFile(result.filePath, bytes);
  if (kind === 'json' && /\.paperdesk\.json$/i.test(result.filePath)) openedPaths.add(path.resolve(result.filePath));
  return { name: path.basename(result.filePath), path: result.filePath };
});
ipcMain.handle('pdf:signatures-list', async event => { validSender(event); return readSignatures(); });
ipcMain.handle('pdf:signatures-save', async (event, record) => {
  validSender(event);
  const safe = validSignature(record);
  const records = (await readSignatures()).filter(item => item.signer !== safe.signer);
  if (records.length >= 20) throw new Error('Remove a saved signature before adding another.');
  records.push(safe);
  await writeSignatures(records);
  return records;
});
ipcMain.handle('pdf:signatures-remove', async (event, signer) => {
  validSender(event);
  if (typeof signer !== 'string' || !signer.trim() || signer.length > 80) throw new Error('Unknown signer.');
  const records = (await readSignatures()).filter(item => item.signer !== signer);
  await writeSignatures(records);
  return records;
});
ipcMain.on('pdf:dirty', (event, value) => { validSender(event); dirty = Boolean(value); });
ipcMain.handle('pdf:show-output', async (event, filePath) => {
  validSender(event);
  // Only reveal a location; never execute the file.
  shell.showItemInFolder(String(filePath));
});
