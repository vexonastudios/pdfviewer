import { defaultTextFieldAppearanceProvider, PDFOperatorNames, setTextMatrix, adjustDimsForRotation, reduceRotation } from 'pdf-lib';
import { fitFontSize } from './form-utils.mjs';

// PDF forms often specify a fixed /DA font size even when the value is longer
// than the widget. Reduce only overflowing single-line values so the complete
// value stays visible in saved PDFs and in other PDF readers.
export function fittingTextFieldAppearance(field, widget, font) {
  if (!field.isMultiline() && !field.isCombed()) {
    const holder = widget.getDefaultAppearance() ? widget : field.acroField;
    const appearance = holder.getDefaultAppearance() || '';
    const matches = [...appearance.matchAll(/\/[\w.-]+\s+(\d*\.?\d+)\s+Tf/g)];
    const size = Number(matches.at(-1)?.[1]);
    const text = field.getText() ?? '';
    if (size > 0 && text) {
      const rotation = reduceRotation(widget.getAppearanceCharacteristics()?.getRotation());
      const { width } = adjustDimsForRotation(widget.getRectangle(), rotation);
      const inset = (widget.getBorderStyle()?.getWidth() ?? 0) + 1;
      const available = Math.max(1, width - 2 * inset - 2);
      const measured = font.widthOfTextAtSize(text.replace(/[\r\n]/g, ' '), size);
      if (measured > available) {
        const fitted = fitFontSize(size, measured, available);
        holder.setDefaultAppearance(appearance.replace(/(\/[\w.-]+\s+)(\d*\.?\d+)(\s+Tf)(?![\s\S]*\bTf)/, (_, before, __, after) => `${before}${fitted}${after}`));
      }
    }
  }
  return centeredTextFieldAppearance(field, widget, font);
}

// Keep the form's borders, colors, rotation, wrapping and horizontal alignment.
// Only reposition the text lines; moving the whole appearance would also move
// its clipping rectangle and border. Use the same 1.2 line height as the editor.
export function centeredTextFieldAppearance(field, widget, font) {
  const operators = defaultTextFieldAppearanceProvider(field, widget, font);
  if (!field.isMultiline()) return operators;
  const matrices = operators.filter(operator => operator.name === PDFOperatorNames.SetTextMatrix);
  const fontOperator = operators.find(operator => operator.name === PDFOperatorNames.SetFontAndSize);
  if (!matrices.length || !fontOperator) return operators;

  const size = Number(fontOperator.args[1].toString());
  const rotation = reduceRotation(widget.getAppearanceCharacteristics()?.getRotation());
  const { height } = adjustDimsForRotation(widget.getRectangle(), rotation);
  const inset = (widget.getBorderStyle()?.getWidth() ?? 0) + 1;
  const lineHeight = size * 1.2;
  const ascent = font.heightAtSize(size, { descender: false });
  const descent = font.heightAtSize(size) - ascent;
  // Overflow stays anchored at the top, so the first line is never pushed out
  // of the field. Short entries are centered as a complete block of lines.
  const top = inset + Math.max(0, (height - 2 * inset - matrices.length * lineHeight) / 2);
  const firstBaseline = height - top - (lineHeight + ascent - descent) / 2;
  let line = 0;
  return operators.map(operator => operator.name === PDFOperatorNames.SetTextMatrix
    ? setTextMatrix(...operator.args.slice(0, 5), firstBaseline - line++ * lineHeight)
    : operator);
}
