import test from 'node:test';
import assert from 'node:assert/strict';
import { datasetCsv } from './dataset';

test('CSV exports every field, preserves Unicode, multiline text, quotes and typed values', () => {
  const csv = datasetCsv([{ title: 'A "book", £20', price: 20, note: 'First\nsecond' }, { title: 'Café', price: null, url: 'https://example.com/book' }]);
  assert.equal(csv, '\uFEFF"title","price","note","url"\r\n"A ""book"", £20","20","First\nsecond",""\r\n"Café","","","https://example.com/book"\r\n');
});

test('CSV neutralizes untrusted spreadsheet formulas while preserving numeric negatives', () => {
  const csv = datasetCsv([{ '=header': '=HYPERLINK("https://example.com")', plus: '+SUM(1,2)', leading: '\t @value', negative: -12.5 }]);
  assert.match(csv, /"'=header"/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example.com""\)"/);
  assert.match(csv, /"'\+SUM\(1,2\)"/);
  assert.match(csv, /"'\t @value"/);
  assert.match(csv, /"-12.5"/);
});

test('CSV supports primitive records and an empty dataset without losing array values', () => {
  assert.equal(datasetCsv([0, false, null, 'a,b']), '\uFEFF"value"\r\n"0"\r\n"false"\r\n""\r\n"a,b"\r\n');
  assert.equal(datasetCsv([]), '\uFEFF\r\n');
});
