const { app, BrowserWindow, dialog, ipcMain, shell, Menu, protocol, net, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'paperdesk', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let window;
let dirty = false;
let cancelPrint = null;
const testProfile = !app.isPackaged && process.argv.includes('--paperdesk-test-profile');
if (testProfile) { const directory = path.resolve(__dirname, '../tmp/qa/desktop-profile'); fsSync.mkdirSync(directory, { recursive: true }); app.setPath('userData', directory); }
const signatureDirectory = () => path.join(app.getPath(testProfile ? 'userData' : 'appData'), 'Paperdesk PDF');
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
const vault = require(path.join(__dirname, 'vault.cjs'))(path.join(signatureDirectory(), 'Private drafts'), safeStorage, atomicWrite);
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
const lock = testProfile || app.requestSingleInstanceLock();
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

function packetFinalPath(session, index, copy = false) {
  const source = session.paths[index];
  const within = session.root && !path.relative(session.root, source).startsWith('..') && !path.isAbsolute(path.relative(session.root, source));
  const relative = within ? path.relative(session.root, source) : path.basename(source);
  const name = relative.replace(/(?:\.paperdesk\.json|\.pdf)$/i, '').replace(/[\\/]/g, ' - ').replace(/[<>:"|?*\x00-\x1f]/g, '_');
  return path.join(session.root || path.dirname(source), 'Final PDFs', `${name}-${copy ? 'copy' : 'final'}.pdf`);
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
    width: 1480, height: 980, minWidth: 760, minHeight: 560, icon: path.join(assetRoot, 'app-icon.png'),
    title: 'Paperdesk PDF', backgroundColor: '#f8f7f3',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
  window.on('close', event => {
    if (dirty) { event.preventDefault(); window.webContents.send('pdf:close-request'); }
  });
  window.on('closed', () => { cancelPrint?.(); app.quit(); });
  if (!app.isPackaged && process.env.PAPERDESK_DEV_URL === 'http://127.0.0.1:5173') window.loadURL(process.env.PAPERDESK_DEV_URL);
  else window.loadURL('paperdesk://app/index.html');
});
app.on('window-all-closed', () => app.quit());
ipcMain.handle('pdf:close', event => { validSender(event); dirty = false; window.close(); });

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
    await vault.backup(target);
    await atomicWrite(target, bytes);
    return { name: path.basename(target), path: target };
  }
  let defaultPath = safeName;
  if (kind === 'json' && sourcePath && openedPaths.has(path.resolve(sourcePath))) defaultPath = path.join(path.dirname(path.resolve(sourcePath)), safeName);
  if (['final-pdf', 'copy-pdf'].includes(kind) && sourcePath && openedPaths.has(path.resolve(sourcePath))) {
    const exportDirectory = path.join(path.dirname(path.resolve(sourcePath)), 'Final PDFs');
    await fs.mkdir(exportDirectory, { recursive: true });
    defaultPath = path.join(exportDirectory, safeName);
  }
  const result = await dialog.showSaveDialog(window, { title: kind === 'final-pdf' ? 'Export final PDF' : kind === 'json' ? 'Save workspace' : 'Save a copy', defaultPath, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
  if (result.canceled) return null;
  if (kind === 'json') await vault.backup(result.filePath);
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

ipcMain.handle('pdf:recovery-save', async (event, record) => {
  validSender(event);
  if (!record || typeof record.name !== 'string' || typeof record.documentId !== 'string' || typeof record.bytes !== 'string' || record.bytes.length > 700 * 1024 * 1024 || record.sourcePath && !openedPaths.has(path.resolve(record.sourcePath))) throw new Error('Invalid recovery draft.');
  return vault.snapshot(record);
});
ipcMain.handle('pdf:recovery-clear', async (event, source) => { validSender(event); if (typeof source !== 'string') throw new Error('Invalid draft.'); return vault.clear(source); });
ipcMain.handle('pdf:recovery-list', async (event, kind = 'recovery') => { validSender(event); if (!['recovery', 'history'].includes(kind)) throw new Error('Invalid history.'); return vault.list(kind); });
ipcMain.handle('pdf:recovery-read', async (event, kind, id) => {
  validSender(event);
  const record = await vault.restore(kind, id);
  if (record.sourcePath) openedPaths.add(path.resolve(record.sourcePath));
  return { ...record, bytes: new Uint8Array(Buffer.from(record.bytes, 'base64')), name: record.name.endsWith('.paperdesk.json') ? record.name : record.name.replace(/\.pdf$/i, '') + '.paperdesk.json' };
});
ipcMain.handle('pdf:recovery-remove', async (event, kind, id) => { validSender(event); return vault.remove(kind, id); });
ipcMain.handle('pdf:merge-open', async event => {
  validSender(event);
  const result = await dialog.showOpenDialog(window, { title: 'Choose PDFs to append', filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile', 'multiSelections'] });
  if (result.canceled) return [];
  if (result.filePaths.length > 50) throw new Error('Append no more than 50 PDFs at a time.');
  return Promise.all(result.filePaths.map(readPDF));
});
ipcMain.handle('pdf:check-updates', async event => {
  validSender(event);
  const response = await net.fetch('https://api.github.com/repos/vexonastudios/pdfviewer/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error('The update service is unavailable. Try again later.');
  const release = await response.json(), version = String(release.tag_name || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Unrecognized release version.');
  const current = app.getVersion();
  const newer = version.split('.').map(Number).some((part, index, parts) => part > Number(current.split('.')[index]) && parts.slice(0, index).every((value, i) => value === Number(current.split('.')[i])));
  return { current, version, available: newer };
});
ipcMain.handle('pdf:download-update', async event => { validSender(event); await shell.openExternal('https://github.com/vexonastudios/pdfviewer/releases/latest'); });
ipcMain.handle('pdf:print', async (event, images) => {
  validSender(event);
  if (cancelPrint) throw new Error('Close the current print session before starting another.');
  if (!Array.isArray(images) || !images.length || images.length > 300 || images.reduce((sum, image) => sum + String(image.data).length, 0) > 400 * 1024 * 1024 || images.some(image => !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image.data) || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width < 1 || image.height < 1)) throw new Error('Invalid print pages.');
  const printer = new BrowserWindow({ show: false, parent: window, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  let canceled = false;
  cancelPrint = () => { canceled = true; };
  try {
    const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{margin:0}section{break-after:page}section:last-child{break-after:auto}img{width:100%;height:100%;object-fit:contain;display:block}${images.map((image, index) => `@page sheet${index}{margin:0;size:${image.width}pt ${image.height}pt}.sheet${index}{page:sheet${index};width:${image.width}pt;height:${image.height}pt}`).join('')}</style>${images.map((image, index) => `<section class="sheet${index}"><img src="${image.data}"></section>`).join('')}`;
    await printer.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await printer.webContents.executeJavaScript('Promise.all([...document.images].map(image => image.decode()))');
    if (canceled) return false;
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (success, error) => { if (settled) return; settled = true; cancelPrint = null; error ? reject(error) : resolve(success); };
      cancelPrint = () => finish(false);
      printer.webContents.executeJavaScript('new Promise(resolve => window.addEventListener("afterprint", () => resolve(false), { once: true }))').then(() => finish(false), () => finish(false));
      printer.webContents.print({ silent: false, printBackground: true, margins: { marginType: 'none' } }, (success, reason) => finish(success, !success && !/cancel/i.test(reason) ? new Error(reason || 'Printing failed.') : null));
    });
  } finally { cancelPrint = null; if (!printer.isDestroyed()) printer.destroy(); }
});
ipcMain.handle('pdf:print-cancel', event => { validSender(event); cancelPrint?.(); });
ipcMain.handle('pdf:packet-export-batch', async (event, id, entries) => {
  validSender(event);
  const session = reviewSessions.get(id);
  if (!session?.root || !Array.isArray(entries) || !entries.length || entries.length > 200) throw new Error('Reopen the packet before exporting.');
  const staged = [], targets = new Set();
  let total = 0;
  try {
    for (const entry of entries) {
      if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index >= session.paths.length || !(entry.bytes instanceof Uint8Array) || Buffer.from(entry.bytes.subarray(0, 5)).toString() !== '%PDF-' || (total += entry.bytes.length) > 500 * 1024 * 1024) throw new Error('Invalid packet output or packet exceeds 500 MB.');
      const target = packetFinalPath(session, entry.index, Boolean(entry.copy));
      if (targets.has(target.toLowerCase())) throw new Error('Two packet documents have the same final filename. Rename one before exporting.');
      targets.add(target.toLowerCase());
      const temporary = target + '.' + randomUUID() + '.stage';
      await atomicWrite(temporary, entry.bytes);
      staged.push({ target, temporary, hash: createHash('sha256').update(entry.bytes).digest('hex'), copy: Boolean(entry.copy) });
    }
    for (const item of staged) {
      if (await fs.stat(item.target).catch(() => null)) { item.backup = item.target + '.' + randomUUID() + '.previous'; await fs.rename(item.target, item.backup); }
      await fs.rename(item.temporary, item.target); item.committed = true;
    }
    await atomicWrite(path.join(session.root, 'Final PDFs', 'packet-manifest.json'), JSON.stringify({ exportedAt: new Date().toISOString(), files: staged.map(item => ({ name: path.basename(item.target), mode: item.copy ? 'original-copy' : 'flattened', sha256: item.hash })) }, null, 2));
  } catch (error) {
    for (const item of staged.toReversed()) {
      if (item.committed) await fs.rm(item.target, { force: true });
      if (item.backup) await fs.rename(item.backup, item.target);
      await fs.rm(item.temporary, { force: true });
    }
    throw error;
  }
  for (const item of staged) if (item.backup) await fs.rm(item.backup, { force: true });
  return { count: staged.length, path: path.join(session.root, 'Final PDFs', 'packet-manifest.json') };
});
