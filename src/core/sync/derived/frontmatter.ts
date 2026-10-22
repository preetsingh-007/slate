/**
 * YAML front matter for derived files (G5, G9). Every value is written on one line (gym's
 * check.py reads front matter line by line), as a plain scalar when that is unambiguous and as
 * a double-quoted scalar otherwise. Lists are flow sequences: `topics: [a/b, c/d]`.
 */

export type FrontMatterValue = string | string[];

const RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;

/**
 * Characters that end a line for check.py: Python's `str.splitlines()` (after `read_text` turned
 * '\r' into '\n'). A value containing one would spill into a line of its own (G9).
 */
const PY_LINE_BREAKS = /\s*[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]+\s*/g;

/** `value` on one line as check.py splits lines. */
export function oneLine(value: string): string {
  return value.replace(PY_LINE_BREAKS, ' ');
}

/** One-line YAML scalar for a string. */
export function yamlScalar(value: string): string {
  const v = value.replace(PY_LINE_BREAKS, ' ').trim();
  if (v === '') return '';
  const plain = /^[A-Za-z0-9_./(][^\n]*$/.test(v) && !/: |\s#|:$|[[\]{},"'`]/.test(v) && !RESERVED.test(v) && !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v);
  return plain ? v : JSON.stringify(v);
}

function flowItem(value: string): string {
  const v = yamlScalar(value);
  return /[,[\]]/.test(v) && !v.startsWith('"') ? JSON.stringify(v) : v;
}

export function yamlValue(value: FrontMatterValue): string {
  if (Array.isArray(value)) return `[${value.filter((x) => x.trim()).map(flowItem).join(', ')}]`;
  return yamlScalar(value);
}

export function frontMatter(fields: [string, FrontMatterValue][]): string {
  const lines = fields.map(([k, v]) => {
    const s = yamlValue(v);
    return s ? `${k}: ${s}` : `${k}:`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

/** Splits front matter (as written above) from the body. Values are returned as strings. */
export function parseFrontMatter(text: string): { fields: Record<string, string>; body: string } {
  if (!text.startsWith('---\n')) return { fields: {}, body: text };
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of text.slice(4, end).split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if (v.startsWith('"')) {
      try {
        v = JSON.parse(v) as string;
      } catch {
        // keep as written
      }
    }
    fields[line.slice(0, i).trim()] = v;
  }
  return { fields, body: text.slice(end + 5).replace(/^\n/, '') };
}
