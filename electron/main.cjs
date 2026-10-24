const { app, BrowserWindow, dialog, ipcMain, shell, Menu, protocol, net, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'paperdesk', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let window;
let dirty = false;
const signatureDirectory = () => path.join(app.getPath('appData'), 'Paperdesk PDF');
const signaturePath = () => path.join(signatureDirectory(), 'signatures.enc');
const legacySignaturePath = () => path.join(signatureDirectory(), 'signatures.json');
async function atomicWrite(target, bytes) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, target);
  } catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
}
function validSignature(record) {
  if (!record || typeof record.signer !== 'string' || !record.signer.trim() || record.signer.length > 80 || /[\x00-\x1f]/.test(record.signer) || typeof record.dataUrl !== 'string' ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(record.dataUrl) || record.dataUrl.length > 2_000_000 ||
      !Number.isInteger(record.width) || !Number.isInteger(record.height) ||
      record.width < 1 || record.height < 1 || record.width > 3000 || record.height > 3000) throw new Error('Invalid signature image.');
  if (record.placementWidth !== undefined && (!Number.isFinite(record.placementWidth) || record.placementWidth < 5 || record.placementWidth > 350)) throw new Error('Invalid saved signature width.');
  const kind = record.kind ?? 'signature';
  if (!['signature', 'initials'].includes(kind)) throw new Error('Unknown saved ink type.');
  const png = Buffer.from(record.dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('A PNG signature image is required.');
  return { signer: record.signer, kind, dataUrl: record.dataUrl, width: record.width, height: record.height, ...(record.placementWidth === undefined ? {} : { placementWidth: record.placementWidth }) };
}
async function readSignatures() {
  try {
    const encrypted = await fs.readFile(signaturePath());
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('Windows signature encryption is unavailable on this computer.');
    if (encrypted.subarray(0, 5).toString() !== 'PDSG1') throw new Error('The saved signature library is not recognized.');
    const records = JSON.parse(safeStorage.decryptString(encrypted.subarray(5)));
    return Array.isArray(records) ? records.map(validSignature).slice(0, 20) : [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      const records = JSON.parse(await fs.readFile(legacySignaturePath(), 'utf8'));
      const safe = Array.isArray(records) ? records.map(validSignature).slice(0, 20) : [];
      await writeSignatures(safe);
      await fs.rm(legacySignaturePath());
      return safe;
    } catch (legacyError) { if (legacyError.code === 'ENOENT') return []; throw legacyError; }
  }
}
async function writeSignatures(records) {
  if (!safeStorage?.isEncryptionAvailable()) throw new Error('Windows signature encryption is unavailable on this computer.');
  const encrypted = Buffer.concat([Buffer.from('PDSG1'), safeStorage.encryptString(JSON.stringify(records))]);
  await atomicWrite(signaturePath(), encrypted);
}
const fileArguments = args => args.slice(1).filter(arg => /(?:\.pdf|\.paperdesk\.json)$/i.test(arg));
let pendingPaths = fileArguments(process.argv);
const reviewSessions = new Map();
const openedPaths = new Set();
// An isolated review window can run beside an older Paperdesk build without
// taking over its single-instance lock. Signature ink stays in appData.
if (process.argv.includes('--paperdesk-isolated-review')) {
  const reviewProfile = path.join(app.getPath('appData'), 'Paperdesk PDF Review');
  fsSync.mkdirSync(reviewProfile, { recursive: true });
  app.setPath('userData', reviewProfile);
}
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
  reviewSessions.set(id, { paths, root: null });
  return { file, review: { id, items: paths.map(filePath => ({ name: path.basename(filePath) })) } };
}

async function packetPaths(root) {
  const found = [];
  async function visit(directory, depth) {
    if (depth > 4) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ['Final PDFs', 'node_modules', 'release'].includes(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target, depth + 1);
      else if (entry.isFile() && /(?:\.pdf|\.paperdesk\.json)$/i.test(entry.name)) found.push(target);
      if (found.length > 200) throw new Error('This folder has more than 200 PDFs and workspaces. Choose a smaller packet folder.');
    }
  }
  await visit(root, 0);
  const workspaces = new Set(found.filter(file => /\.paperdesk\.json$/i.test(file)).map(file => file.replace(/\.paperdesk\.json$/i, '').toLowerCase()));
  return found.filter(file => !/\.pdf$/i.test(file) || !workspaces.has(file.replace(/\.pdf$/i, '').toLowerCase()))
    .sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b), undefined, { numeric: true }));
}

function packetFinalPath(session, index) {
  const source = session.paths[index];
  const within = session.root && !path.relative(session.root, source).startsWith('..') && !path.isAbsolute(path.relative(session.root, source));
  const relative = within ? path.relative(session.root, source) : path.basename(source);
  const name = relative.replace(/(?:\.paperdesk\.json|\.pdf)$/i, '').replace(/[\\/]/g, ' - ').replace(/[<>:"|?*\x00-\x1f]/g, '_');
  return path.join(session.root || path.dirname(source), 'Final PDFs', `${name}-final.pdf`);
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
ipcMain.handle('pdf:open-packet', async event => {
  validSender(event);
  const result = await dialog.showOpenDialog(window, { title: 'Open a folder of PDFs and workspaces', properties: ['openDirectory'] });
  if (result.canceled) return null;
  const root = path.resolve(result.filePaths[0]);
  const paths = await packetPaths(root);
  if (!paths.length) throw new Error('This folder has no PDFs or Paperdesk workspaces.');
  const file = await readPDF(paths[0]);
  const id = randomUUID();
  const session = { paths, root };
  reviewSessions.set(id, session);
  const items = await Promise.all(paths.map(async (filePath, index) => {
    const final = packetFinalPath(session, index);
    const source = await fs.stat(filePath);
    const exported = await fs.stat(final).then(info => info.mtimeMs >= source.mtimeMs).catch(() => false);
    return { name: path.basename(filePath), location: path.relative(root, filePath), exported };
  }));
  return { file, review: { id, root, items } };
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
  const session = reviewSessions.get(id);
  if (!session || !Number.isInteger(index) || index < 0 || index >= session.paths.length) throw new Error('This review item is unavailable. Reopen the review queue.');
  return readPDF(session.paths[index]);
});
ipcMain.handle('pdf:packet-update', async (event, id, index, filePath) => {
  validSender(event);
  const session = reviewSessions.get(id);
  const resolved = path.resolve(String(filePath));
  if (!session?.root || !Number.isInteger(index) || index < 0 || index >= session.paths.length ||
      !/\.paperdesk\.json$/i.test(resolved) || !openedPaths.has(resolved)) throw new Error('This saved workspace cannot replace a packet item.');
  session.paths[index] = resolved;
  return { name: path.basename(resolved), location: path.relative(session.root, resolved), exported: false };
});
ipcMain.handle('pdf:packet-export', async (event, id, index, bytes) => {
  validSender(event);
  const session = reviewSessions.get(id);
  if (!session?.root || !Number.isInteger(index) || index < 0 || index >= session.paths.length) throw new Error('Reopen the packet folder before exporting.');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 500 * 1024 * 1024) throw new Error('Invalid final PDF.');
  const target = packetFinalPath(session, index);
  await atomicWrite(target, bytes);
  return { name: path.basename(target), path: target };
});
ipcMain.handle('pdf:save', async (event, { bytes, name, kind, overwritePath, sourcePath }) => {
  validSender(event);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 500 * 1024 * 1024) throw new Error('Invalid output file or file larger than 500 MB.');
  const extension = kind === 'zip' ? 'zip' : kind === 'json' ? 'json' : 'pdf';
  const safeName = path.basename(String(name || 'document')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  if (overwritePath) {
    const target = path.resolve(overwritePath);
    if (kind !== 'json' || !/\.paperdesk\.json$/i.test(target) || !openedPaths.has(target)) throw new Error('This workspace is not open for saving. Use Save As instead.');
    await atomicWrite(target, bytes);
    return { name: path.basename(target), path: target };
  }
  let defaultPath = safeName;
  if (kind === 'json' && sourcePath && openedPaths.has(path.resolve(sourcePath))) defaultPath = path.join(path.dirname(path.resolve(sourcePath)), safeName);
  if (kind === 'final-pdf' && sourcePath && openedPaths.has(path.resolve(sourcePath))) {
    const exportDirectory = path.join(path.dirname(path.resolve(sourcePath)), 'Final PDFs');
    await fs.mkdir(exportDirectory, { recursive: true });
    defaultPath = path.join(exportDirectory, safeName);
  }
  const result = await dialog.showSaveDialog(window, { title: kind === 'final-pdf' ? 'Export final PDF' : kind === 'json' ? 'Save workspace' : 'Save a copy', defaultPath, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
  if (result.canceled) return null;
  await atomicWrite(result.filePath, bytes);
  if (kind === 'json' && /\.paperdesk\.json$/i.test(result.filePath)) openedPaths.add(path.resolve(result.filePath));
  return { name: path.basename(result.filePath), path: result.filePath };
});
ipcMain.handle('pdf:signatures-list', async event => { validSender(event); return readSignatures(); });
ipcMain.handle('pdf:signatures-save', async (event, record) => {
  validSender(event);
  const existing = await readSignatures();
  const kind = record?.kind ?? 'signature';
  const previous = existing.find(item => item.signer === record?.signer && item.kind === kind);
  const safe = validSignature({ ...record, placementWidth: previous?.placementWidth ?? record?.placementWidth });
  const records = existing.filter(item => item.signer !== safe.signer || item.kind !== safe.kind);
  if (records.length >= 20) throw new Error('Remove a saved signature before adding another.');
  records.push(safe);
  await writeSignatures(records);
  return records;
});
ipcMain.handle('pdf:signatures-size', async (event, signer, placementWidth, kind = 'signature') => {
  validSender(event);
  if (typeof signer !== 'string' || !signer.trim() || signer.length > 80 || !['signature', 'initials'].includes(kind) || !Number.isFinite(placementWidth) || placementWidth < 5 || placementWidth > 350) throw new Error('Invalid saved signature width.');
  const records = await readSignatures();
  const record = records.find(item => item.signer === signer && item.kind === kind);
  if (!record) throw new Error('This signature is no longer saved on this computer.');
  record.placementWidth = placementWidth;
  await writeSignatures(records);
  return placementWidth;
});
ipcMain.handle('pdf:signatures-remove', async (event, signer, kind = 'signature') => {
  validSender(event);
  if (typeof signer !== 'string' || !signer.trim() || signer.length > 80 || !['signature', 'initials'].includes(kind)) throw new Error('Unknown signer.');
  const records = (await readSignatures()).filter(item => item.signer !== signer || item.kind !== kind);
  await writeSignatures(records);
  return records;
});
ipcMain.on('pdf:dirty', (event, value) => { validSender(event); dirty = Boolean(value); });
ipcMain.handle('pdf:show-output', async (event, filePath) => {
  validSender(event);
  // Only reveal a location; never execute the file.
  shell.showItemInFolder(String(filePath));
});
