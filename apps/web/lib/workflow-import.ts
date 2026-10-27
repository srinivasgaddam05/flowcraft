import type { WorkflowDocument } from '@workflow/shared-types';

type Token = { value: string; start: number; end: number; kind: 'name' | 'literal' | 'punctuation'; quote?: string };
const expressionPrefixes = new Set(['(', '[', '{', ',', ':', ';', '=', '!', '?', '+', '-', '*', '%', '&', '|', '<', '>', '~']);

/** Tokenize only enough JSONata to distinguish references from quoted data and regexes. */
function tokens(source: string): Token[] {
  const result: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const start = index;
    const character = source[index];
    if (/\s/.test(character)) { index++; continue; }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      const quote = character;
      let value = '';
      index++;
      while (index < source.length && source[index] !== quote) {
        if (source[index] !== '\\') { value += source[index++]; continue; }
        index++;
        const escaped = source[index++];
        const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' };
        if (escaped === 'u' && /^[\da-fA-F]{4}$/.test(source.slice(index, index + 4))) { value += String.fromCharCode(parseInt(source.slice(index, index + 4), 16)); index += 4; }
        else value += escapes[escaped] ?? escaped ?? '';
      }
      if (index >= source.length) break;
      index++;
      result.push({ value, start, end: index, kind: 'literal', quote });
      continue;
    }
    if (character === '/') {
      const previous = result.at(-1);
      const couldBeRegex = !previous || expressionPrefixes.has(previous.value) || ['and', 'or', 'in'].includes(previous.value);
      if (couldBeRegex) {
        let end = index + 1;
        let insideClass = false;
        while (end < source.length) {
          if (source[end] === '\\') { end += 2; continue; }
          if (source[end] === '[') insideClass = true;
          else if (source[end] === ']') insideClass = false;
          else if (source[end] === '/' && !insideClass) break;
          end++;
        }
        if (end < source.length) {
          index = end + 1;
          while (/[a-z]/i.test(source[index] ?? '')) index++;
          result.push({ value: source.slice(start, index), start, end: index, kind: 'literal' });
          continue;
        }
      }
    }
    if (/[\w$]/.test(character)) {
      index++;
      while (/[\w$]/.test(source[index] ?? '')) index++;
      result.push({ value: source.slice(start, index), start, end: index, kind: 'name' });
    } else {
      index++;
      result.push({ value: character, start, end: index, kind: 'punctuation' });
    }
  }
  return result;
}

/** Only direct lookups into $nodes refer to graph node IDs; ordinary string values do not. */
function remapExpression(source: string, ids: ReadonlyMap<string, string>): string {
  const parsed = tokens(source);
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const replace = (token: Token | undefined, allowName = false) => {
    if (!token || !(token.quote || allowName && token.kind === 'name')) return;
    const id = ids.get(token.value);
    if (!id) return;
    const quote = token.quote ?? '"';
    replacements.push({ start: token.start, end: token.end, value: `${quote}${id}${quote}` });
  };
  for (let index = 0; index < parsed.length; index++) {
    const token = parsed[index];
    if (token.kind !== 'name') continue;
    if (token.value === '$nodes') {
      if (parsed[index + 1]?.value === '.') replace(parsed[index + 2], true);
      else if (parsed[index + 1]?.value === '[' && parsed[index + 3]?.value === ']') replace(parsed[index + 2]);
    }
    if (token.value === '$lookup' && parsed[index + 1]?.value === '(' && parsed[index + 2]?.kind === 'name' && parsed[index + 2].value === '$nodes' && parsed[index + 3]?.value === ',' && parsed[index + 5]?.value === ')') replace(parsed[index + 4]);
  }
  let result = '';
  let offset = 0;
  for (const replacement of replacements.sort((a, b) => a.start - b.start)) {
    result += source.slice(offset, replacement.start) + replacement.value;
    offset = replacement.end;
  }
  return result + source.slice(offset);
}

function remapTemplates(source: string, ids: ReadonlyMap<string, string>): string {
  // Match the runtime's exact-template behavior first, including object expressions.
  const exact = source.match(/^(\s*\{\{)([\s\S]*?)(\}\}\s*)$/);
  if (exact) return exact[1] + remapExpression(exact[2], ids) + exact[3];
  let result = '';
  let offset = 0;
  while (offset < source.length) {
    const start = source.indexOf('{{', offset);
    if (start < 0) break;
    const end = source.indexOf('}}', start + 2);
    if (end < 0) break;
    result += source.slice(offset, start + 2) + remapExpression(source.slice(start + 2, end), ids) + '}}';
    offset = end + 2;
  }
  return result + source.slice(offset);
}

/** Create an independent import while preserving references to the imported node outputs. */
export function remapWorkflow(document: WorkflowDocument): WorkflowDocument {
  if (document.nodes.length > 10_000 || document.edges.length > 50_000) throw new Error('Workflow is too large to import');
  const ids = new Map(document.nodes.map((node) => [node.id, crypto.randomUUID()]));
  if (ids.size !== document.nodes.length) throw new Error('Workflow contains duplicate node IDs');
  let values = 0;
  let characters = 0;
  const cloneConfig = (value: unknown, nodeType: string, key = '', depth = 0, literalSubtree = false): unknown => {
    if (++values > 100_000 || depth > 64) throw new Error('Workflow configuration is too large or deeply nested to import');
    const codeField = depth === 1 && (nodeType === 'expression' && key === 'expression' || nodeType === 'filter' && key === 'predicate');
    // The runtime skips every entire expression-valued property except the Code node's code.
    const literal = literalSubtree || key === 'expression' && !codeField;
    if (typeof value === 'string') {
      characters += value.length;
      if (characters > 1_000_000) throw new Error('Workflow configuration exceeds the 1 MB import limit');
      if (literal) return value;
      return codeField ? remapExpression(value, ids) : remapTemplates(value, ids);
    }
    if (Array.isArray(value)) return value.map((entry) => cloneConfig(entry, nodeType, '', depth + 1, literal));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [entryKey, cloneConfig(entry, nodeType, entryKey, depth + 1, literal)]));
    return value;
  };
  return {
    ...document,
    id: undefined,
    active: false,
    nodes: document.nodes.map((node) => ({ ...node, id: ids.get(node.id)!, position: { ...node.position }, config: cloneConfig(node.config, node.type) as Record<string, unknown> })),
    edges: document.edges.map((edge) => {
      const source = ids.get(edge.source);
      const target = ids.get(edge.target);
      if (!source || !target) throw new Error('Workflow connection refers to a missing node');
      return { ...edge, id: crypto.randomUUID(), source, target };
    }),
  };
}
