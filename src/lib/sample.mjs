import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function createSample() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.13, 0.22, 0.2);
  const muted = rgb(0.43, 0.48, 0.46);
  const form = pdf.getForm();
  const text = (str, x, y, size = 11, strong = false) => page.drawText(str, { x, y, size, font: strong ? bold : font, color: strong ? dark : muted });
  page.drawRectangle({ x: 0, y: 675, width: 612, height: 117, color: rgb(0.94, 0.96, 0.93) });
  text('PAPERDESK  /  PRACTICE DOCUMENT', 48, 752, 9, true);
  text('A little less paperwork.', 48, 714, 25, true);
  text('Try filling a field, adding a note, or pasting your details in Bulk fill.', 48, 650);
  text('01   YOUR DETAILS', 48, 607, 10, true);
  const input = (name, label, x, y, width = 246) => {
    text(label, x, y + 33, 10);
    const f = form.createTextField(name);
    f.addToPage(page, { x, y, width, height: 25, borderWidth: 0.7, borderColor: rgb(0.76, 0.8, 0.77), backgroundColor: rgb(1, 1, 1), font });
    f.setFontSize(11);
    return f;
  };
  input('Full name', 'Full name', 48, 548);
  input('Email address', 'Email address', 318, 548);
  input('Phone number', 'Phone number', 48, 480);
  input('Company', 'Company / organization', 318, 480);
  input('Street address', 'Street address', 48, 412, 516);
  input('City', 'City', 48, 344);
  input('Postal code', 'ZIP / postal code', 318, 344);
  text('02   A FEW PREFERENCES', 48, 303, 10, true);
  text('Preferred contact method', 48, 273, 10);
  const contact = form.createDropdown('Contact method');
  contact.addOptions(['Email', 'Phone', 'Mail']);
  contact.addToPage(page, { x: 48, y: 238, width: 246, height: 25, borderWidth: 0.7, borderColor: rgb(0.76, 0.8, 0.77), font });
  contact.select('Email');
  contact.setFontSize(11);
  const checkbox = form.createCheckBox('Send updates');
  checkbox.addToPage(page, { x: 318, y: 244, width: 14, height: 14, borderWidth: 0.7, borderColor: rgb(0.76, 0.8, 0.77) });
  text('Send me occasional updates', 341, 247, 10);
  const notes = input('Notes', 'Anything else?', 48, 134, 516);
  notes.enableMultiline();
  text('This sample is yours to experiment with. No information is submitted anywhere.', 48, 83, 9);
  page.drawLine({ start: { x: 48, y: 62 }, end: { x: 564, y: 62 }, thickness: 0.5, color: rgb(0.8, 0.83, 0.8) });
  text('LOCAL BY DESIGN', 48, 43, 8, true);
  text('1 / 1', 540, 43, 8);
  form.updateFieldAppearances(font);
  return pdf.save();
}
