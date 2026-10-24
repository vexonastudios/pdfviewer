import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { encodeWorkspace, decodeWorkspace, WorkspacePasswordError } from '../src/lib/workspace.mjs';
import { parsePageOrder, organizePdf } from '../src/lib/page-tools.mjs';
import { preflight } from '../src/lib/preflight.mjs';
import { writePdf } from '../src/lib/pdf.mjs';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);

test('portable protected workspaces preserve answers and reject a wrong password or modified ciphertext', async () => {
  const draft = { format: 'paperdesk-workspace-v1', name: 'Private.pdf', pdf: 'JVBERi0=', state: { values: { test: 'private-value' }, additions: [] } };
  const bytes = await encodeWorkspace(draft, 'test-password-123');
  assert.equal(new TextDecoder().decode(bytes).includes('private-value'), false);
  await assert.rejects(() => decodeWorkspace(bytes), WorkspacePasswordError);
  await assert.rejects(() => decodeWorkspace(bytes, 'wrong-password'), WorkspacePasswordError);
  assert.deepEqual((await decodeWorkspace(bytes, 'test-password-123')).restored, draft.state);
  const modified = JSON.parse(new TextDecoder().decode(bytes)); modified.ciphertext = 'AA' + modified.ciphertext.slice(2);
  await assert.rejects(() => decodeWorkspace(new TextEncoder().encode(JSON.stringify(modified)), 'test-password-123'), WorkspacePasswordError);
  assert.deepEqual((await decodeWorkspace(await encodeWorkspace(draft))).restored, draft.state);
});

test('page tools preserve requested order, extract pages, append documents and save rotation', async () => {
  const first = await PDFDocument.create(); first.addPage([200, 300]); first.addPage([400, 500]); first.addPage([600, 700]);
  const extra = await PDFDocument.create(); extra.addPage([800, 900]);
  assert.deepEqual(parsePageOrder('3-2,1', 3), [2, 1, 0]);
  assert.throws(() => parsePageOrder('0,1', 3)); assert.throws(() => parsePageOrder('1,unknown', 3));
  const result = await PDFDocument.load(await organizePdf(await first.save(), [2, 0], 90, [await extra.save()]));
  assert.deepEqual(result.getPages().map(page => page.getWidth()), [600, 200, 800]);
  assert.equal(result.getPage(0).getRotation().angle, 90);
});

test('export rejects placed answers that would be clipped by a page edge', async () => {
  const doc = await PDFDocument.create(); doc.addPage([300, 400]);
  const mark = { kind: 'text', label: 'Address', text: 'This answer runs off the page', page: 1, x: 280, y: 200, size: 12 };
  const bytes = await doc.save();
  await assert.rejects(() => writePdf(bytes, [], {}, [mark], { flatten: true }), /page edge/);
});

test('preflight identifies blanks on their actual pages and distinguishes original copies', async () => {
  const pdf = { numPages: 2, getFieldObjects: async () => ({ required: [{ page: 1 }] }), getPage: async () => ({ getTextContent: async () => ({ items: [] }), getAnnotations: async () => [] }) };
  const fields = [{ name: 'required', label: 'Full name', type: 'text', required: true }, { name: 'sig', label: 'Signature', type: 'signature', readOnly: true, page: 2 }];
  const issues = await preflight(pdf, fields, { values: {}, additions: [] }, 'Protected');
  assert.equal(issues.find(issue => issue.kind === 'required').page, 2);
  assert.equal(issues.filter(issue => issue.kind === 'signing').length, 1);
  assert.equal(issues[0].kind, 'copy');
  const filled = await preflight(pdf, fields, { values: { required: 'Sample' }, additions: [{ targetField: 'sig' }] });
  assert.equal(filled.length, 0);
});

test('recovery and five-version history are encrypted and restorable without touching source files', async () => {
  await mkdir(path.join(process.cwd(), 'tmp/qa'), { recursive: true });
  const folder = await mkdtemp(path.join(process.cwd(), 'tmp/qa/vault-'));
  const safe = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value).map(byte => byte ^ 0xaa), decryptString: value => Buffer.from(value).map(byte => byte ^ 0xaa).toString() };
  const atomic = async (file, bytes) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file + '.tmp', bytes); await rename(file + '.tmp', file); };
  const vault = require('../electron/vault.cjs')(folder, safe, atomic);
  const source = path.join(folder, 'draft.paperdesk.json');
  const bytes = Buffer.from('secret recovery').toString('base64');
  await vault.snapshot({ name: 'Draft.pdf', sourcePath: source, documentId: 'draft', bytes });
  const records = await vault.list('recovery'); assert.equal(records.length, 1); assert.equal(records[0].bytes, undefined);
  assert.equal((await vault.restore('recovery', records[0].id)).bytes, bytes);
  assert.equal((await readFile(path.join(folder, 'recovery', (await readdir(path.join(folder, 'recovery')))[0]))).includes(Buffer.from(bytes)), false);
  for (let i = 0; i < 7; i++) { await writeFile(source, `version ${i}`); await vault.backup(source); }
  assert.equal((await vault.list('history')).length, 5); assert.equal(await readFile(source, 'utf8'), 'version 6');
  await assert.rejects(() => vault.restore('history', '../escape'), /Invalid/);
  await vault.clear(source); assert.equal((await vault.list('recovery')).length, 0);
  await rm(folder, { recursive: true });
});
