import { findFlatInitialTargets } from './initial-targets.mjs';
import { findFlatSignatureTargets } from './signature-targets.mjs';
import { isDateSignedField } from './form-utils.mjs';

export async function preflight(pdf, fields, state, readOnlyReason = '') {
  const issues = [], marks = new Set(state.additions.map(item => item.targetField));
  const blank = value => value == null || value === '' || value === false || Array.isArray(value) && !value.length;
  if (readOnlyReason) issues.push({ page: 1, kind: 'copy', message: 'View-only document: export preserves the original. It will be labeled as a copy, not a flattened final.' });
  const objects = await pdf.getFieldObjects().catch(() => null);
  for (const field of fields) {
    if (field.type === 'signature' && !marks.has(field.name) || !field.readOnly && !['button', 'unsupported'].includes(field.type) && blank(state.values[field.name])) {
      const widgets = objects?.get?.(field.name) ?? objects?.[field.name] ?? [];
      issues.push({ page: widgets.find(widget => widget.page >= 0)?.page + 1 || field.page || 1, kind: field.required ? 'required' : isDateSignedField(field) || field.type === 'signature' ? 'signing' : 'optional', message: `${field.label}: ${field.type === 'signature' ? 'signature missing' : field.required ? 'required field blank' : 'blank (check whether applicable)'}` });
    }
  }
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number), content = await page.getTextContent();
    const annotations = await page.getAnnotations();
    for (const target of [...findFlatInitialTargets(content.items, number), ...findFlatSignatureTargets(content.items, annotations, number)]) {
      if (!marks.has(target.fieldName)) issues.push({ page: number, kind: 'signing', message: `${target.slot ? `Caregiver initials ${target.slot}` : 'Signature line'}: blank` });
      if (target.date && !marks.has(`${target.fieldName}:date`)) issues.push({ page: number, kind: 'signing', message: 'Signing date beside signature line: blank' });
    }
  }
  return issues;
}
