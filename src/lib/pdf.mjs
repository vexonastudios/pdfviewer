import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFSignature, PDFButton, PDFName, PDFDict, PDFRawStream, decodePDFRawStream, StandardFonts, defaultCheckBoxAppearanceProvider, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { fittingTextFieldAppearance } from './field-appearance.mjs';

export const readableName = name => name.split('.').at(-1).replace(/\[\d+\]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim() || name;

function describeField(field) {
  const base = { name: field.getName(), label: readableName(field.getName()), readOnly: field.isReadOnly(), required: field.isRequired(), options: [] };
  if (field instanceof PDFTextField) return { ...base, type: 'text', value: field.getText() ?? '', multiline: field.isMultiline(), maxLength: field.getMaxLength(), password: field.isPassword() };
  if (field instanceof PDFCheckBox) return { ...base, type: 'checkbox', value: field.isChecked() };
  if (field instanceof PDFDropdown) return { ...base, type: 'dropdown', options: field.getOptions(), value: field.getSelected()[0] ?? '', editable: field.isEditable() };
  if (field instanceof PDFOptionList) return { ...base, type: 'list', options: field.getOptions(), value: field.getSelected(), multiselect: field.isMultiselect() };
  if (field instanceof PDFRadioGroup) return { ...base, type: 'radio', options: field.getOptions(), radioValues: Object.fromEntries(field.acroField.getOnValues().map((value, index) => [value.decodeText(), field.getOptions()[index]])), value: field.getSelected() ?? '' };
  return { ...base, type: field instanceof PDFSignature ? 'signature' : field instanceof PDFButton ? 'button' : 'unsupported', readOnly: true, value: '' };
}

export async function inspectPdf(bytes) {
  try {
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();
    if (form.hasXFA()) return { fields: [], readOnlyReason: 'This is an XFA form. Viewing is available; filling and saving edits are not supported.' };
    const raw = form.getFields();
    const signed = raw.some(field => field instanceof PDFSignature && field.acroField.dict.get(PDFName.of('V')));
    return { fields: raw.map(describeField), readOnlyReason: signed ? 'This PDF contains a digital signature. Editing is disabled to preserve the signed document.' : '' };
  } catch (error) {
    return { fields: [], readOnlyReason: /encrypt/i.test(error.message) ? 'This PDF is encrypted. You can view it, but editing encrypted files is not supported.' : 'This PDF can be viewed, but its form structure could not be safely edited.' };
  }
}

function setField(field, value) {
  if (field instanceof PDFTextField) field.setText(String(value ?? ''));
  else if (field instanceof PDFCheckBox) value ? field.check() : field.uncheck();
  else if (field instanceof PDFDropdown || field instanceof PDFOptionList) { if (value === '' || (Array.isArray(value) && !value.length)) field.clear(); else field.select(value); }
  else if (field instanceof PDFRadioGroup) value ? field.select(value) : field.clear();
  else throw new Error(`The field “${field.getName()}” cannot be filled.`);
}

function usesFontBasedCheck(doc, widget) {
  if (widget.getAppearanceCharacteristics()?.getCaptions()?.normal === '4') return true;
  const normal = widget.getAppearances()?.normal;
  const on = widget.getOnValue();
  if (!(normal instanceof PDFDict) || !on) return false;
  const stream = doc.context.lookup(normal.get(on));
  if (!(stream instanceof PDFRawStream)) return false;
  try {
    const commands = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
    return /\/ZaDb\b/.test(commands) && /\(4\)\s*Tj\b/.test(commands);
  } catch { return false; }
}

export async function writePdf(original, fields, values, additions = [], { flatten = false, fontBytes } = {}) {
  const doc = await PDFDocument.load(original);
  const form = doc.getForm();
  if (form.hasXFA()) throw new Error('XFA forms cannot be edited.');
  if (form.getFields().some(field => field instanceof PDFSignature && field.acroField.dict.get(PDFName.of('V')))) throw new Error('Digitally signed PDFs cannot be edited.');
  let font;
  if (fontBytes) { doc.registerFontkit(fontkit); font = await doc.embedFont(fontBytes, { subset: true }); }
  else font = await doc.embedFont(StandardFonts.Helvetica);
  const glyphSet = font ? new Set(font.getCharacterSet()) : null;
  function ensureText(text) {
    const missing = [...new Set([...text].filter(char => !/[\r\n\t]/.test(char) && glyphSet && !glyphSet.has(char.codePointAt(0))))];
    if (missing.length) throw new Error(`The bundled font cannot display: ${missing.join(' ')}. These characters were not saved. Use a supported spelling.`);
  }
  const expected = [];
  for (const descriptor of fields) {
    if (!Object.hasOwn(values, descriptor.name) || descriptor.readOnly) continue;
    const value = values[descriptor.name];
    const changed = JSON.stringify(value) !== JSON.stringify(descriptor.value);
    // Existing text values may have clipped appearances in reopened workspaces.
    if (!changed && descriptor.type !== 'text') continue;
    ensureText(Array.isArray(value) ? value.join('') : String(value));
    const field = form.getField(descriptor.name);
    if (changed) setField(field, value);
    if (field instanceof PDFTextField) field.updateAppearances(font, fittingTextFieldAppearance);
    expected.push([descriptor.name, value]);
  }
  form.updateFieldAppearances(font);
  // Some forms use ZapfDingbats character "4" for square choices, even when
  // the appearance caption is absent. Its check can disappear when rendered.
  // Replace only those font-based appearances with a vector check.
  for (const field of form.getFields()) {
    if ((field instanceof PDFRadioGroup || field instanceof PDFCheckBox) && field.acroField.getWidgets().length &&
        field.acroField.getWidgets().every(widget => usesFontBasedCheck(doc, widget))) {
      for (const widget of field.acroField.getWidgets()) {
        if (!(widget.getBorderStyle()?.getWidth() > 0)) widget.getOrCreateBorderStyle().setWidth(0.8);
      }
      field.updateAppearances(defaultCheckBoxAppearanceProvider);
    }
  }
  if (flatten) {
    form.flatten({ updateFieldAppearances: false });
    // pdf-lib can leave dangling widget references after flattening. Retain only
    // live, non-widget annotations and remove the now-unused form catalog entry.
    for (const page of doc.getPages()) {
      const annotations = page.node.Annots();
      if (!annotations) continue;
      for (let index = annotations.size() - 1; index >= 0; index--) {
        const annotation = doc.context.lookup(annotations.get(index));
        if (!annotation || annotation.get?.(PDFName.of('Subtype')) === PDFName.of('Widget')) annotations.remove(index);
      }
    }
    doc.catalog.delete(PDFName.of('AcroForm'));
  }
  // Draw movable additions after flattening so a form widget cannot paint over
  // a signature or text placed within its rectangle.
  const inkImages = new Map();
  for (const addition of additions) {
    const page = doc.getPage(addition.page - 1);
    const color = rgb(0.10, 0.16, 0.22);
    if (addition.kind === 'text') {
      ensureText(addition.text);
      const angle = addition.rotation || 0;
      const radians = angle * Math.PI / 180;
      const down = addition.size * 0.86;
      page.drawText(addition.text.replace(/\t/g, '    '), {
        x: addition.x + Math.sin(radians) * down, y: addition.y - Math.cos(radians) * down,
        size: addition.size, font, color, rotate: degrees(angle), lineHeight: addition.size * 1.25,
      });
    } else if (addition.kind === 'signature') {
      if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(addition.dataUrl || '') || addition.dataUrl.length > 2_000_000 || !(addition.width > 0 && addition.width <= 500) || !(addition.height > 0 && addition.height <= 500)) throw new Error('A placed signature is invalid.');
      let image = inkImages.get(addition.dataUrl);
      if (!image) { image = await doc.embedPng(addition.dataUrl); inkImages.set(addition.dataUrl, image); }
      const angle = (addition.rotation || 0) * Math.PI / 180;
      page.drawImage(image, { x: addition.x + Math.sin(angle) * addition.height, y: addition.y - Math.cos(angle) * addition.height, width: addition.width, height: addition.height, rotate: degrees(addition.rotation || 0) });
    } else if (addition.kind === 'check') {
      const angle = (addition.rotation || 0) * Math.PI / 180;
      const point = (x, y) => ({ x: addition.x + x * Math.cos(angle) + y * Math.sin(angle), y: addition.y + x * Math.sin(angle) - y * Math.cos(angle) });
      page.drawLine({ start: point(0, 0.45 * addition.size), end: point(0.32 * addition.size, 0.8 * addition.size), thickness: addition.size * 0.12, color });
      page.drawLine({ start: point(0.32 * addition.size, 0.8 * addition.size), end: point(addition.size, 0), thickness: addition.size * 0.12, color });
    }
  }
  const output = await doc.save();
  const reopened = await PDFDocument.load(output);
  if (flatten) {
    if (reopened.getForm().getFields().length) throw new Error('The flattened copy did not pass verification.');
  } else {
    for (const [name, value] of expected) {
      const actual = describeField(reopened.getForm().getField(name)).value;
      if (JSON.stringify(actual) !== JSON.stringify(value)) throw new Error(`The saved value for “${name}” did not pass verification.`);
    }
  }
  return output;
}

export function fieldSchema(fields, additions) {
  return {
    instructions: 'Prepare only values supported by the information I provide. Return a flat JSON object using the exact field names below, or an array of such objects for multiple records. Use true/false for checkboxes and one of the listed options for choice fields. Do not guess missing information. I will review and apply the result in Paperdesk PDF.',
    fields: [...fields.filter(field => !field.readOnly).map(({ name, label, type, options, required, maxLength }) => ({ name, label, type, ...(options?.length ? { options } : {}), ...(required ? { required } : {}), ...(maxLength ? { maxLength } : {}) })),
      ...additions.filter(item => item.kind === 'text' && item.label.trim()).map(item => ({ name: `Text: ${item.label}`, label: item.label, type: 'text' }))],
  };
}
