import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFDict, decodePDFRawStream, degrees } from 'pdf-lib';
import { createSample } from '../src/lib/sample.mjs';
import { inspectPdf, writePdf } from '../src/lib/pdf.mjs';

const fontBytes = new Uint8Array(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url)));
const original = await createSample();
const { fields } = await inspectPdf(original);
const values = Object.fromEntries(fields.map(field => [field.name, field.value]));
await mkdir(new URL('../tmp/qa/', import.meta.url), { recursive: true });
await writeFile(new URL('../tmp/qa/sample.pdf', import.meta.url), original);
test('saves Unicode, checkbox and dropdown values in the form tree, with appearances', async () => {
  const expected = { ...values, 'Full name': 'José García', 'Email address': 'jose@example.com', 'Phone number': '(555) 010-0248', 'Company': 'Northwind Studio', 'Street address': '15 Oak Avenue', 'City': 'Madison', 'Postal code': '00123', 'Notes': 'Please call after 3 pm.', 'Send updates': true, 'Contact method': 'Phone' };
  const output = await writePdf(original, fields, expected, [], { fontBytes });
  const reopened = await PDFDocument.load(output);
  assert.equal(reopened.getForm().getTextField('Full name').getText(), 'José García');
  assert.equal(reopened.getForm().getTextField('Postal code').getText(), '00123');
  assert.equal(reopened.getForm().getCheckBox('Send updates').isChecked(), true);
  assert.deepEqual(reopened.getForm().getDropdown('Contact method').getSelected(), ['Phone']);
  for (const field of reopened.getForm().getFields()) for (const widget of field.acroField.getWidgets()) assert.ok(widget.dict.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N')));
  const originalAgain = await PDFDocument.load(original);
  assert.equal(originalAgain.getForm().getTextField('Full name').getText(), undefined);
  await writeFile(new URL('../tmp/qa/filled.pdf', import.meta.url), output);
});
test('flattening removes form widgets, and placed text is exported', async () => {
  const additions = [{ kind: 'text', text: 'Reviewed by Jamie', x: 48, y: 115, size: 11, page: 1, rotation: 0 }, { kind: 'check', x: 400, y: 115, size: 14, page: 1, rotation: 0 }];
  const output = await writePdf(original, fields, { ...values, 'Full name': 'Jamie Parker' }, additions, { flatten: true, fontBytes });
  const reopened = await PDFDocument.load(output);
  assert.equal(reopened.getForm().getFields().length, 0);
  for (const page of reopened.getPages()) {
    const annotations = page.node.Annots();
    for (let i = 0; i < (annotations?.size() ?? 0); i++) assert.notEqual(annotations.lookup(i, PDFDict).get(PDFName.of('Subtype'))?.toString(), '/Widget');
  }
  await writeFile(new URL('../tmp/qa/flattened.pdf', import.meta.url), output);
});
test('a placed ink signature survives export while form fields stay editable', async () => {
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==';
  const additions = [{ kind: 'signature', dataUrl: pixel, x: 48, y: 115, width: 160, height: 32, page: 1, rotation: 0 }];
  const output = await writePdf(original, fields, { ...values, 'Full name': 'Jamie Parker' }, additions, { fontBytes });
  const reopened = await PDFDocument.load(output);
  assert.equal(reopened.getForm().getTextField('Full name').getText(), 'Jamie Parker');
  assert.ok(reopened.getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict).keys().length > 0);
  await writeFile(new URL('../tmp/qa/signature-placement.pdf', import.meta.url), output);
});
test('a flattened final retains placed ink while removing editable fields', async () => {
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==';
  const additions = [{ kind: 'signature', dataUrl: pixel, x: 48, y: 115, width: 160, height: 32, page: 1, rotation: 0 }];
  const output = await writePdf(original, fields, { ...values, 'Full name': 'Jamie Parker' }, additions, { flatten: true, fontBytes });
  const reopened = await PDFDocument.load(output);
  assert.equal(reopened.getForm().getFields().length, 0);
  assert.ok(reopened.getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict).keys().length > 0);
});
test('different records are independent, and clearing fields survives reopening', async () => {
  const a = await writePdf(original, fields, { ...values, 'Full name': 'Record A', 'Contact method': '' }, [], { fontBytes });
  const b = await writePdf(original, fields, { ...values, 'Full name': 'Record B' }, [], { fontBytes });
  assert.equal((await PDFDocument.load(a)).getForm().getTextField('Full name').getText(), 'Record A');
  assert.deepEqual((await PDFDocument.load(a)).getForm().getDropdown('Contact method').getSelected(), []);
  assert.equal((await PDFDocument.load(b)).getForm().getTextField('Full name').getText(), 'Record B');
});
test('long single-line values remain complete and their saved appearance fits the field', async () => {
  const doc = await PDFDocument.create(); const page = doc.addPage();
  const email = doc.getForm().createTextField('Email Address');
  email.addToPage(page, { x: 50, y: 700, width: 160, height: 28, fontSize: 10 });
  const source = await doc.save();
  const { fields: emailFields } = await inspectPdf(source);
  const address = 'alexander.longname@examplemail.com';
  const output = await writePdf(source, emailFields, { 'Email Address': address }, [], { fontBytes });
  const reopened = await PDFDocument.load(output);
  const saved = reopened.getForm().getTextField('Email Address');
  assert.equal(saved.getText(), address);
  const appearance = saved.acroField.getWidgets()[0].getDefaultAppearance() || saved.acroField.getDefaultAppearance();
  const size = Number([...appearance.matchAll(/\/[\w.-]+\s+(\d*\.?\d+)\s+Tf/g)].at(-1)?.[1]);
  assert.ok(size > 0 && size < 10, `expected a fitted appearance, got ${size} from ${JSON.stringify(appearance)}`);
  const { fields: existingFields } = await inspectPdf(output);
  const resaved = await PDFDocument.load(await writePdf(output, existingFields, { 'Email Address': address }, [], { fontBytes }));
  assert.equal(resaved.getForm().getTextField('Email Address').getText(), address);
});
test('radio and multi-select fields preserve their typed values', async () => {
  const doc = await PDFDocument.create(); const page = doc.addPage();
  const radio = doc.getForm().createRadioGroup('Priority'); radio.addOptionToPage('Normal', page, { x: 50, y: 650 }); radio.addOptionToPage('Urgent', page, { x: 50, y: 600 });
  const list = doc.getForm().createOptionList('Interests'); list.addOptions(['One', 'Two', 'Three']); list.enableMultiselect(); list.addToPage(page, { x: 100, y: 600, width: 100, height: 100 });
  const bytes = await doc.save(); const { fields } = await inspectPdf(bytes);
  const output = await writePdf(bytes, fields, { Priority: 'Urgent', Interests: ['One', 'Three'] }, [], { fontBytes });
  const reopened = await PDFDocument.load(output);
  assert.equal(reopened.getForm().getRadioGroup('Priority').getSelected(), 'Urgent');
  assert.deepEqual(reopened.getForm().getOptionList('Interests').getSelected(), ['One', 'Three']);
});

test('square radio choices render a font-independent check mark', async () => {
  const doc = await PDFDocument.create(); const page = doc.addPage();
  const radio = doc.getForm().createRadioGroup('Coverage');
  radio.addOptionToPage('Yes', page, { x: 50, y: 650, width: 12, height: 12 });
  radio.addOptionToPage('No', page, { x: 90, y: 650, width: 12, height: 12 });
  for (const widget of radio.acroField.getWidgets()) widget.getAppearanceCharacteristics().setCaptions({ normal: '4' });
  const bytes = await doc.save(); const { fields } = await inspectPdf(bytes);
  const reopened = await PDFDocument.load(await writePdf(bytes, fields, { Coverage: 'No' }, [], { fontBytes }));
  const filled = reopened.getForm().getRadioGroup('Coverage');
  assert.equal(filled.getSelected(), 'No');
  const widgets = filled.acroField.getWidgets();
  assert.equal(widgets[1].getAppearanceState().toString(), widgets[1].getOnValue().toString());
  for (const widget of widgets) {
    const normal = widget.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFDict);
    const on = normal.lookup(widget.getOnValue());
    assert.equal(on.dict.get(PDFName.of('Resources')), undefined);
  }
});
test('square checkboxes render a font-independent check mark', async () => {
  const doc = await PDFDocument.create(); const page = doc.addPage();
  const box = doc.getForm().createCheckBox('Monthly assistance');
  box.addToPage(page, { x: 50, y: 650, width: 12, height: 12 });
  box.acroField.getWidgets()[0].getAppearanceCharacteristics().setCaptions({ normal: '4' });
  const bytes = await doc.save(); const { fields } = await inspectPdf(bytes);
  const reopened = await PDFDocument.load(await writePdf(bytes, fields, { 'Monthly assistance': true }, [], { fontBytes }));
  const filled = reopened.getForm().getCheckBox('Monthly assistance');
  assert.equal(filled.isChecked(), true);
  const widget = filled.acroField.getWidgets()[0];
  assert.equal(widget.getAppearanceState().toString(), widget.getOnValue().toString());
  const normal = widget.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFDict);
  const on = normal.lookup(widget.getOnValue());
  assert.equal(on.dict.get(PDFName.of('Resources')), undefined);
});
test('font-based checkbox without an appearance caption still prints its check mark', async () => {
  const doc = await PDFDocument.create(); const page = doc.addPage();
  const box = doc.getForm().createCheckBox('Information sheet received');
  box.addToPage(page, { x: 50, y: 650, width: 12, height: 12 });
  const widget = box.acroField.getWidgets()[0];
  const normal = widget.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFDict);
  const onValue = widget.getOnValue();
  const legacy = doc.context.flateStream('0 g\nBT\n/ZaDb 8 Tf\n2 2 Td\n(4) Tj\nET\n', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 12, 12] });
  normal.set(onValue, doc.context.register(legacy));
  widget.dict.lookup(PDFName.of('MK'), PDFDict)?.delete(PDFName.of('CA'));
  const bytes = await doc.save(); const { fields } = await inspectPdf(bytes);
  const reopened = await PDFDocument.load(await writePdf(bytes, fields, { 'Information sheet received': true }, [], { fontBytes }));
  const filled = reopened.getForm().getCheckBox('Information sheet received');
  assert.equal(filled.isChecked(), true);
  const filledWidget = filled.acroField.getWidgets()[0];
  const appearance = filledWidget.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFDict).lookup(filledWidget.getOnValue());
  const commands = new TextDecoder('latin1').decode(decodePDFRawStream(appearance).decode());
  assert.doesNotMatch(commands, /\/ZaDb/);
  assert.match(commands, /\bS\b/);
});
test('rejects unsupported glyphs instead of silently corrupting saved text', async () => {
  await assert.rejects(() => writePdf(original, fields, { ...values, 'Full name': '😀' }, [], { fontBytes }), /cannot display/);
});
test('creates rotation and crop box fixtures for viewer placement checks', async () => {
  const doc = await PDFDocument.create();
  for (const rotation of [0, 90, 180, 270]) {
    const page = doc.addPage([612, 792]); page.setRotation(degrees(rotation)); page.setCropBox(25, 35, 560, 700);
    page.drawText(`Page rotated ${rotation} degrees`, { x: 50, y: 700, size: 18 });
  }
  await writeFile(new URL('../tmp/qa/rotated.pdf', import.meta.url), await doc.save());
});
