import { defaultTextFieldAppearanceProvider, PDFOperatorNames, setTextMatrix, adjustDimsForRotation, reduceRotation, layoutMultilineText } from 'pdf-lib';
import { fitFontSize } from './form-utils.mjs';

// PDF forms often specify a fixed /DA font size even when the value is longer
// than the widget. Reduce only overflowing single-line values so the complete
// value stays visible in saved PDFs and in other PDF readers.
export function fittingTextFieldAppearance(field, widget, font) {
  if (field.isMultiline()) return fittingMultilineAppearance(field, widget, font);
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
        if (font.widthOfTextAtSize(text.replace(/[\r\n]/g, ' '), fitted) > available + 0.1) {
          throw new Error(`The answer in “${field.getName()}” is too long for its field. Shorten it before exporting.`);
        }
        holder.setDefaultAppearance(appearance.replace(/(\/[\w.-]+\s+)(\d*\.?\d+)(\s+Tf)(?![\s\S]*\bTf)/, (_, before, __, after) => `${before}${fitted}${after}`));
      }
    }
  }
  const operators = centeredTextFieldAppearance(field, widget, font);
  if (!field.isCombed() && field.getText()) {
    const rotation = reduceRotation(widget.getAppearanceCharacteristics()?.getRotation());
    const { width } = adjustDimsForRotation(widget.getRectangle(), rotation);
    const inset = (widget.getBorderStyle()?.getWidth() ?? 0) + 1;
    const size = Number(operators.find(operator => operator.name === PDFOperatorNames.SetFontAndSize)?.args[1]?.toString());
    if (!(size > 0) || font.widthOfTextAtSize(field.getText().replace(/[\r\n]/g, ' '), size) > width - 2 * inset + 0.1) {
      throw new Error(`The answer in “${field.getName()}” is too long for its field. Shorten it before exporting.`);
    }
  }
  return operators;
}

function fittingMultilineAppearance(field, widget, font) {
  let operators = defaultTextFieldAppearanceProvider(field, widget, font);
  const rotation = reduceRotation(widget.getAppearanceCharacteristics()?.getRotation());
  const { width, height } = adjustDimsForRotation(widget.getRectangle(), rotation);
  const inset = (widget.getBorderStyle()?.getWidth() ?? 0) + 1;
  const available = { x: inset, y: inset, width: width - 2 * inset, height: height - 2 * inset };
  const holder = widget.getDefaultAppearance() ? widget : field.acroField;
  const appearance = holder.getDefaultAppearance() || '';
  const fontOperator = operators.find(operator => operator.name === PDFOperatorNames.SetFontAndSize);
  const initialSize = Number(fontOperator?.args[1]?.toString());
  const fits = size => {
    if (!(size > 0) || available.width <= 0 || available.height <= 0) return false;
    const lines = layoutMultilineText(field.getText() || '', { alignment: field.getAlignment(), fontSize: size, font, bounds: available }).lines;
    return lines.every(line => line.width <= available.width + 0.1) &&
      lines.length * Math.max(size, font.heightAtSize(size)) * 1.2 <= available.height + 0.1;
  };
  if (!fits(initialSize) || (field.getText() && initialSize < 7)) {
    const fontSizePattern = /(\/[\w.-]+\s+)(\d*\.?\d+)(\s+Tf)(?![\s\S]*\bTf)/;
    if (!fontSizePattern.test(appearance)) throw new Error(`The answer in “${field.getName()}” cannot be fitted. Shorten it before exporting.`);
    let fitted = Math.max(7, Math.min(initialSize, 12));
    while (fitted >= 7 && !fits(fitted)) fitted -= 0.5;
    if (fitted < 7) throw new Error(`The answer in “${field.getName()}” is too long for a readable fit. Shorten it before exporting.`);
    holder.setDefaultAppearance(appearance.replace(fontSizePattern, (_, before, __, after) => `${before}${fitted}${after}`));
    operators = defaultTextFieldAppearanceProvider(field, widget, font);
  }
  return centerMultilineOperators(field, widget, font, operators);
}

// Keep the form's borders, colors, rotation, wrapping and horizontal alignment.
// Only reposition the text lines; moving the whole appearance would also move
// its clipping rectangle and border. Use the same 1.2 line height as the editor.
export function centeredTextFieldAppearance(field, widget, font) {
  const operators = defaultTextFieldAppearanceProvider(field, widget, font);
  return centerMultilineOperators(field, widget, font, operators);
}

function centerMultilineOperators(field, widget, font, operators) {
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
