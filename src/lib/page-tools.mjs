import { PDFDocument, degrees } from 'pdf-lib';

export function parsePageOrder(text, count) {
  const result = [];
  for (const part of text.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!match) throw new Error('Enter page numbers such as 1-3, 5, 4.');
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (first < 1 || last < 1 || first > count || last > count) throw new Error(`Choose pages between 1 and ${count}.`);
    for (let page = first; first <= last ? page <= last : page >= last; page += first <= last ? 1 : -1) result.push(page - 1);
    if (result.length > 2000) throw new Error('Choose no more than 2,000 pages.');
  }
  if (!result.length) throw new Error('Choose at least one page.');
  return result;
}
export async function organizePdf(bytes, order, rotation = 0, extra = []) {
  const source = await PDFDocument.load(bytes), output = await PDFDocument.create();
  const pages = await output.copyPages(source, order);
  for (const page of pages) { page.setRotation(degrees((page.getRotation().angle + rotation) % 360)); output.addPage(page); }
  for (const bytes of extra) {
    const document = await PDFDocument.load(bytes);
    for (const page of await output.copyPages(document, document.getPageIndices())) output.addPage(page);
  }
  return output.save();
}
