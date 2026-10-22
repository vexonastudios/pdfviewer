import Papa from 'papaparse';

export const normalize = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = [
  ['fullname', 'name', 'yourname'], ['firstname', 'givenname'], ['lastname', 'surname', 'familyname'],
  ['email', 'emailaddress'], ['phone', 'phonenumber', 'telephone', 'mobile'],
  ['address', 'streetaddress', 'addressline1'], ['zip', 'zipcode', 'postalcode'],
  ['dob', 'dateofbirth', 'birthdate'], ['company', 'companyname', 'organization'],
];

export function parseBulk(input) {
  let text = input.trim().replace(/^```(?:json|csv|tsv)?\s*\n?/i, '').replace(/\n?```$/, '').trim();
  if (!text) throw new Error('Paste field values, JSON, or a table with a header row first.');
  let rows;
  if (/^[\[{]/.test(text)) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('The JSON could not be read. Check commas, quotes, and brackets.'); }
    if (parsed && !Array.isArray(parsed) && parsed.fields && typeof parsed.fields === 'object') parsed = parsed.fields;
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } else {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.every(line => /^[^:\t]+:\s*/.test(line))) {
      const pairs = lines.map(line => { const i = line.indexOf(':'); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; });
      if (new Set(pairs.map(([key]) => key)).size !== pairs.length) throw new Error('A field name appears more than once. For several people, paste CSV or a JSON array.');
      rows = [Object.fromEntries(pairs)];
    } else {
      const result = Papa.parse(text, { header: true, skipEmptyLines: 'greedy', transformHeader: header => header.trim() });
      if (result.errors.length) throw new Error(`The table could not be read: ${result.errors[0].message}`);
      if (result.meta.renamedHeaders && Object.keys(result.meta.renamedHeaders).length) throw new Error('Each table column needs a unique header.');
      if (!result.meta.fields?.length) throw new Error('Use “Field: value” lines, JSON, or CSV / tab-separated data with a header row.');
      rows = result.data;
    }
  }
  if (!rows.length || rows.length > 200) throw new Error('Paste between 1 and 200 records per batch.');
  if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Each record must be an object with field names and values.');
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  if (!keys.length) throw new Error('No field values were found.');
  if (keys.some(key => !key.trim())) throw new Error('Each value needs a field name.');
  if (rows.some(row => Object.values(row).some(value => value !== null && typeof value === 'object' && !Array.isArray(value)))) throw new Error('Nested objects are not supported. Use a flat object of field values.');
  return { rows, keys };
}

export function suggestMapping(keys, fields) {
  const available = fields.filter(field => !field.readOnly && !['signature', 'button', 'unsupported'].includes(field.type));
  const mapping = {};
  const used = new Set();
  for (const key of keys) {
    const normalized = normalize(key);
    let matches = available.filter(field => field.name === key);
    if (!matches.length) matches = available.filter(field => [field.name, field.label].some(name => normalize(name) === normalized));
    if (!matches.length) {
      const group = aliases.find(group => group.includes(normalized));
      if (group) matches = available.filter(field => [field.name, field.label].some(name => group.includes(normalize(name))));
    }
    if (matches.length === 1 && !used.has(matches[0].name)) { mapping[key] = matches[0].name; used.add(matches[0].name); }
    else mapping[key] = '';
  }
  return mapping;
}

export function coerceValue(field, raw) {
  if (field.readOnly) throw new Error('This field is read-only.');
  if (field.type === 'checkbox') {
    if (typeof raw === 'boolean') return raw;
    if (['true', 'yes', '1', 'on', 'checked', 'x'].includes(String(raw).trim().toLowerCase())) return true;
    if (raw == null || ['false', 'no', '0', 'off', 'unchecked', ''].includes(String(raw).trim().toLowerCase())) return false;
    throw new Error('Use true / false or yes / no for a checkbox.');
  }
  if (['dropdown', 'radio', 'list'].includes(field.type)) {
    const values = Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')];
    if (values.length === 1 && values[0] === '') return field.type === 'list' ? [] : '';
    if (field.type !== 'list' && values.length > 1) throw new Error('Select only one option.');
    if (field.type === 'list' && !field.multiselect && values.length > 1) throw new Error('This list allows only one option.');
    const selected = values.map(value => {
      const exact = field.options.find(option => option === value);
      if (exact !== undefined) return exact;
      const matches = field.options.filter(option => option.toLowerCase() === value.toLowerCase());
      if (matches.length === 1) return matches[0];
      if (field.editable) return value;
      throw new Error(`Choose ${field.options.join(', ')}.`);
    });
    return field.type === 'list' ? selected : selected[0];
  }
  if (field.type !== 'text') throw new Error('This field cannot be filled.');
  if (Array.isArray(raw)) throw new Error('Use a text value for this field.');
  const value = String(raw ?? '');
  if (field.maxLength && value.length > field.maxLength) throw new Error(`Maximum ${field.maxLength} characters (received ${value.length}).`);
  return value;
}

export function previewRecord(row, mapping, fields) {
  const values = Object.create(null);
  const errors = [];
  const used = new Set();
  for (const [key, target] of Object.entries(mapping)) {
    if (!target || !Object.hasOwn(row, key)) continue;
    const field = fields.find(field => field.name === target);
    if (!field) { errors.push(`${key}: field no longer exists.`); continue; }
    if (used.has(target)) { errors.push(`${key}: two columns are mapped to ${target}.`); continue; }
    used.add(target);
    try { values[target] = coerceValue(field, row[key]); } catch (error) { errors.push(`${key}: ${error.message}`); }
  }
  return { values, errors };
}
