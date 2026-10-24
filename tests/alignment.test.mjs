import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PDFDocument, PDFName, decodePDFRawStream, rgb, TextAlignment, degrees } from 'pdf-lib';
import { inspectPdf, writePdf } from '../src/lib/pdf.mjs';

const qa = new URL('../tmp/qa/', import.meta.url);
await mkdir(qa, { recursive: true });
const fontBytes = new Uint8Array(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url)));

async function fixture() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 600]);
  const form = doc.getForm();
  page.drawText('FORM ALIGNMENT CHECK', { x: 30, y: 565, size: 18 });
  page.drawRectangle({ x: 30, y: 494, width: 552, height: 27, color: rgb(0, 0, 0) });
  page.drawText('FOR AGENCY USE ONLY', { x: 200, y: 503, size: 13, color: rgb(1, 1, 1) });
  function box(name, x, y, width, height, value = '', alignment = TextAlignment.Left) {
    page.drawRectangle({ x, y, width, height: height + 21, borderWidth: 0.6, borderColor: rgb(0, 0, 0) });
    page.drawText(`${name}:`, { x: x + 5, y: y + height + 6, size: 10 });
    const field = form.createTextField(name);
    field.enableMultiline();
    field.setAlignment(alignment);
    field.addToPage(page, { x: x + 2, y: y + 2, width: width - 4, height: height - 3, borderWidth: 0, fontSize: 11 });
    field.setFontSize(11);
    field.setText(value);
    return field;
  }
  box('Date Form Requested', 30, 433, 184, 40);
  box('Date Form Mailed', 214, 433, 184, 40, '10/22/2026');
  box('Date Form Returned', 398, 433, 184, 40);
  box('Two lines', 30, 310, 276, 65);
  box('Wrapped and right aligned', 306, 310, 276, 65, '', TextAlignment.Right);
  box('Overflow', 30, 210, 552, 32);
  return doc.save();
}

function appearance(field) {
  const widget = field.acroField.getWidgets()[0];
  const stream = widget.dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  return Buffer.from(decodePDFRawStream(stream).decode()).toString();
}
function positions(source) {
  return [...source.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)].map(match => ({ x: +match[1], y: +match[2] }));
}
const original = await fixture();
const { fields } = await inspectPdf(original);
const values = Object.fromEntries(fields.map(field => [field.name, field.value]));
Object.assign(values, {
  'Date Form Requested': '10/21/2026',
  'Two lines': 'Jamie Parker\n15 Oak Avenue',
  'Wrapped and right aligned': 'This longer answer wraps onto multiple lines while keeping the original right alignment.',
  Overflow: 'First line\nSecond line',
});

test('centers dates in tall multiline fields, including existing values, without changing form semantics', async () => {
  const output = await writePdf(original, fields, values, [], { fontBytes });
  const form = (await PDFDocument.load(output)).getForm();
  for (const name of ['Date Form Requested', 'Date Form Mailed']) {
    const field = form.getTextField(name);
    assert.equal(field.getText(), values[name]);
    assert.equal(field.isMultiline(), true);
    assert.equal(field.getAlignment(), TextAlignment.Left);
    const [line] = positions(appearance(field));
    // A centered 11pt date in a 37pt box sits near the middle, not under
    // the label at the top. Also retain the original left text inset.
    assert.ok(line.y > 12 && line.y < 17, `Unexpected date baseline: ${line.y}`);
    assert.equal(line.x, 1);
  }
  await writeFile(new URL('alignment-original.pdf', qa), original);
  await writeFile(new URL('alignment-centered.pdf', qa), output);
  await writeFile(new URL('alignment-centered-flat.pdf', qa), await writePdf(original, fields, values, [], { fontBytes, flatten: true }));
  await writeFile(new URL('alignment.paperdesk.json', qa), JSON.stringify({ format: 'paperdesk-workspace-v1', name: 'Alignment check.pdf', pdf: Buffer.from(original).toString('base64'), state: { values, additions: [] } }));
});

test('centers multiline blocks, preserves wrapping and horizontal alignment', async () => {
  const form = (await PDFDocument.load(await writePdf(original, fields, values, [], { fontBytes }))).getForm();
  const two = positions(appearance(form.getTextField('Two lines')));
  assert.equal(two.length, 2);
  assert.ok(two[0].y < 40 && two[1].y > 15);
  assert.ok(Math.abs(two[0].y - two[1].y - 13.2) < 0.001);
  const wrapped = form.getTextField('Wrapped and right aligned');
  assert.equal(wrapped.getAlignment(), TextAlignment.Right);
  const wrapLines = positions(appearance(wrapped));
  assert.ok(wrapLines.length > 1);
  assert.ok(wrapLines.some(line => line.x > 10));
  const overflow = positions(appearance(form.getTextField('Overflow')));
  assert.equal(overflow.length, 2);
  assert.ok(overflow.every(line => line.y > 0), 'Both lines remain inside the field');
});

test('refuses a flattened final when multiline text cannot fit readably', async () => {
  const tooLong = { ...values, Overflow: 'This text begins here. '.repeat(20) };
  await assert.rejects(() => writePdf(original, fields, tooLong, [], { fontBytes, flatten: true }), /Overflow.*too long for a readable fit/);
});

test('centering honors widget rotation and works without a custom font', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const field = doc.getForm().createTextField('Rotated');
  field.enableMultiline();
  field.addToPage(page, { x: 100, y: 100, width: 170, height: 42, rotate: degrees(90), borderWidth: 0 });
  field.setFontSize(12);
  const bytes = await doc.save();
  const { fields } = await inspectPdf(bytes);
  const form = (await PDFDocument.load(await writePdf(bytes, fields, { Rotated: 'Centered' }))).getForm();
  const source = appearance(form.getTextField('Rotated'));
  assert.match(source, /[\d.]+ 1 -1 [\d.]+ 0 0 cm/);
  assert.ok(positions(source)[0].y > 15 && positions(source)[0].y < 20);
});
