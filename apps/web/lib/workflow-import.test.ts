import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowDocument } from '@workflow/shared-types';
import { remapWorkflow } from './workflow-import';

function document(config: Record<string, unknown> = {}, type = 'expression'): WorkflowDocument {
  return { id: 'saved-workflow', name: 'Imported research', description: 'Keep this prose s unchanged', active: true, nodes: [
    { id: 's', name: 'Source', type: 'manualTrigger', position: { x: 0, y: 0 }, config: { sampleData: { id: 's', note: 'Reference s as ordinary data' } } },
    { id: 'transform', name: 'Transform', type, position: { x: 300, y: 0 }, config },
  ], edges: [{ id: 'old-edge', source: 's', target: 'transform', sourceHandle: 'true', targetHandle: 'in' }] };
}

test('workflow import regenerates identifiers, preserves topology, and leaves the original intact', () => {
  const original = document();
  const snapshot = structuredClone(original);
  const imported = remapWorkflow(original);
  assert.equal(imported.id, undefined);
  assert.equal(imported.active, false);
  assert.equal(imported.name, original.name);
  assert.equal(imported.description, original.description);
  assert.notEqual(imported.nodes[0].id, 's');
  assert.notEqual(imported.nodes[1].id, 'transform');
  assert.equal(imported.edges[0].source, imported.nodes[0].id);
  assert.equal(imported.edges[0].target, imported.nodes[1].id);
  assert.notEqual(imported.edges[0].id, 'old-edge');
  assert.equal(imported.edges[0].sourceHandle, 'true');
  assert.equal(imported.edges[0].targetHandle, 'in');
  assert.deepEqual(original, snapshot);
  imported.nodes[0].position.x = 99;
  assert.equal(original.nodes[0].position.x, 0);
});

test('workflow import remaps quoted, bracket, backtick, plain-path and lookup JSONata references', () => {
  const source = '$nodes."s".value + $nodes[\'s\'].value + $nodes.`s`.value + $nodes.s.value + $lookup($nodes, "s").value + $lookup ( /* note */ $nodes , \'s\' ).value';
  const imported = remapWorkflow(document({ expression: source }));
  const id = imported.nodes[0].id;
  assert.equal(imported.nodes[1].config.expression, `$nodes."${id}".value + $nodes['${id}'].value + $nodes.\`${id}\`.value + $nodes."${id}".value + $lookup($nodes, "${id}").value + $lookup ( /* note */ $nodes , '${id}' ).value`);
});

test('workflow import remaps nested templates and filter predicates without changing literals or array shape', () => {
  const config = { predicate: '$item.price < $nodes."s".budget', field: 'items', nested: {
    url: 'https://example.com/{{ $nodes["s"].slug }}/?kind=s',
    body: ['s', 0, false, null, { id: 's', amount: '{{ $lookup($nodes, "s").amount }}' }],
    exactObject: '{{ {"amount": $nodes."s".amount} }}',
  } };
  const imported = remapWorkflow(document(config, 'filter'));
  const id = imported.nodes[0].id;
  assert.deepEqual(imported.nodes[1].config, { predicate: `$item.price < $nodes."${id}".budget`, field: 'items', nested: {
    url: `https://example.com/{{ $nodes["${id}"].slug }}/?kind=s`,
    body: ['s', 0, false, null, { id: 's', amount: `{{ $lookup($nodes, "${id}").amount }}` }],
    exactObject: `{{ {"amount": $nodes."${id}".amount} }}`,
  } });
  assert.deepEqual(imported.nodes[0].config, { sampleData: { id: 's', note: 'Reference s as ordinary data' } });
});

test('workflow import leaves ordinary prose, JSONata string literals, regexes, comments and unrelated fields unchanged', () => {
  const expression = '($literal := "$nodes.\\"s\\""; /* $nodes."s" */ $regex := /\\$nodes\\."s"/; {"id":"s", "other": $other."s", "nested": $nodes.*."s", "value": $nodes."s".value / $nodes."s".total})';
  const imported = remapWorkflow(document({ expression, prose: 's is a source. $nodes."s" is shown as prose.', id: 's', nested: { expression: '$nodes."s" is literal Actor input' } }));
  const id = imported.nodes[0].id;
  assert.equal(imported.nodes[1].config.expression, expression.replace('"value": $nodes."s".value / $nodes."s".total', `"value": $nodes."${id}".value / $nodes."${id}".total`));
  assert.equal(imported.nodes[1].config.prose, 's is a source. $nodes."s" is shown as prose.');
  assert.equal(imported.nodes[1].config.id, 's');
  assert.deepEqual(imported.nodes[1].config.nested, { expression: '$nodes."s" is literal Actor input' });
});

test('workflow import remaps whole UUID reference tokens without rewriting matching source data', () => {
  const uuid = '6b861d08-a937-4a8c-988c-0f8db488f5ff';
  const original = document({ expression: `$nodes."${uuid}".value`, literal: uuid, url: `https://example.com/${uuid}`, mapping: `Copied ${uuid}: {{ $nodes."${uuid}".value }}` });
  original.nodes[0].id = uuid;
  original.edges[0].source = uuid;
  const imported = remapWorkflow(original);
  const id = imported.nodes[0].id;
  assert.equal(imported.nodes[1].config.expression, `$nodes."${id}".value`);
  assert.equal(imported.nodes[1].config.literal, uuid);
  assert.equal(imported.nodes[1].config.url, `https://example.com/${uuid}`);
  assert.equal(imported.nodes[1].config.mapping, `Copied ${uuid}: {{ $nodes."${id}".value }}`);
});

test('workflow import respects exact IDs and does not repeatedly remap a replacement', () => {
  const original = document({ expression: '$nodes."source".value + $nodes."s".value + $nodes."transform".value' });
  const imported = remapWorkflow(original);
  assert.equal(imported.nodes[1].config.expression, `$nodes."source".value + $nodes."${imported.nodes[0].id}".value + $nodes."${imported.nodes[1].id}".value`);
});

test('workflow import preserves literal expression subtrees in Actor input, matching runtime templating rules', () => {
  const input = { expression: [{ literal: '{{ $nodes."s".value }}' }], mapping: '{{ $nodes."s".value }}', plain: { expression: '$nodes."s"' } };
  const imported = remapWorkflow(document({ input }, 'apifyActor'));
  assert.deepEqual(imported.nodes[1].config.input, { ...input, mapping: `{{ $nodes."${imported.nodes[0].id}".value }}` });
});

test('workflow import rejects invalid topology and bounds deeply nested configuration', () => {
  const missing = document();
  missing.edges[0].target = 'missing';
  assert.throws(() => remapWorkflow(missing), /missing node/);
  const duplicate = document(); duplicate.nodes[1].id = 's';
  assert.throws(() => remapWorkflow(duplicate), /duplicate node IDs/);
  let nested: unknown = {};
  for (let i = 0; i < 70; i++) nested = { value: nested };
  assert.throws(() => remapWorkflow(document({ nested })), /deeply nested/);
});
