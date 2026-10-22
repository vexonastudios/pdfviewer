import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBulk, suggestMapping, previewRecord } from '../src/lib/bulk.mjs';

const fields = [
  { name: 'full_name', label: 'Full name', type: 'text', value: '' },
  { name: 'contact.email', label: 'Email address', type: 'text', value: '' },
  { name: 'updates', label: 'Send updates', type: 'checkbox', value: false },
  { name: 'method', label: 'Contact method', type: 'dropdown', options: ['Email', 'Phone'], value: '' },
  { name: 'locked', label: 'Reference', type: 'text', readOnly: true, value: '42' },
];
test('accepts colon values, fenced JSON and wrapped assistant output', () => {
  assert.deepEqual(parseBulk('Full name: Jamie Parker\nWebsite: https://example.com').rows[0], { 'Full name': 'Jamie Parker', Website: 'https://example.com' });
  assert.deepEqual(parseBulk('```json\n{"fields":{"full_name":"Jamie"}}\n```').rows, [{ full_name: 'Jamie' }]);
});
test('parses quoted CSV, tabs, multiline values and preserves leading zeros', () => {
  const { rows } = parseBulk('Name,ZIP,Notes\n"Parker, Jamie",00123,"Line one\nLine two"\nTaylor,00456,OK');
  assert.equal(rows.length, 2); assert.equal(rows[0].ZIP, '00123'); assert.equal(rows[0].Notes, 'Line one\nLine two');
  assert.equal(parseBulk('Name\tEmail\nJamie\tjamie@example.com').rows[0].Email, 'jamie@example.com');
});
test('requires unique headers and valid row structures', () => {
  assert.throws(() => parseBulk('name: A\nname: B'), /more than once/);
  assert.throws(() => parseBulk('name,name\nA,B'), /unique/);
  assert.throws(() => parseBulk('["Jamie"]'), /object/);
  assert.throws(() => parseBulk('{"name":{"first":"Jamie"}}'), /Nested/);
  assert.throws(() => parseBulk(JSON.stringify(Array(201).fill({ name: 'A' }))), /200/);
});
test('maps exact names and conservative aliases, leaves ambiguous or unknown names for review', () => {
  assert.deepEqual(suggestMapping(['Name', 'Email', 'Unknown', 'Reference'], fields), { Name: 'full_name', Email: 'contact.email', Unknown: '', Reference: '' });
  assert.equal(suggestMapping(['Email'], [...fields, { name: 'other', label: 'Email', type: 'text' }]).Email, 'other');
  assert.equal(suggestMapping(['Email'], [...fields, { name: 'other', label: 'Email address', type: 'text' }]).Email, '');
});
test('validates checkboxes, choice options, duplicate targets and readonly fields before applying', () => {
  const ok = previewRecord({ updates: 'no', method: 'phone' }, { updates: 'updates', method: 'method' }, fields);
  assert.deepEqual({ ...ok.values }, { updates: false, method: 'Phone' }); assert.deepEqual(ok.errors, []);
  const bad = previewRecord({ a: 'unknown', b: 'maybe', c: 'x', d: 'y' }, { a: 'method', b: 'updates', c: 'full_name', d: 'full_name' }, fields);
  assert.equal(bad.errors.length, 3);
  assert.equal(previewRecord({ a: '123' }, { a: 'locked' }, fields).errors.length, 1);
});
test('keeps missing values separate from explicit empty values', () => {
  const mapping = { name: 'full_name', email: 'contact.email' };
  assert.deepEqual({ ...previewRecord({ name: '' }, mapping, fields).values }, { full_name: '' });
});
test('handles hostile object keys as data without prototype mutation', () => {
  const parsed = parseBulk('{"__proto__":"safe","constructor":"safe"}');
  const result = previewRecord(parsed.rows[0], Object.fromEntries([['__proto__', 'full_name']]), fields);
  assert.equal(result.values.full_name, 'safe'); assert.equal({}.safe, undefined);
});
