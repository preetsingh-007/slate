/**
 * Front matter of gym's Markdown files (G1, G7, G8): topic and variant READMEs carry
 * `status`, `started`, `completed`; problems carry `source`, `difficulty`, `status`, `date`;
 * marimo notebooks carry `title`, `marimo-version`, `width`.
 *
 * Parsed like gym's `scripts/check.py`: the file starts with `---`, the block ends at the next
 * `---` line, and each `key: value` line is one field (values are flat strings; quotes and
 * trailing ` # comments` are dropped).
 */

export interface FrontMatter {
  /** null when the file has no front matter */
  fields: Record<string, string> | null;
  /** the text after the front matter */
  body: string;
  /** offset of `body` in the file */
  bodyStart: number;
}

export function parseFrontMatter(text: string): FrontMatter {
  const none = { fields: null, body: text, bodyStart: 0 };
  if (!/^---[ \t]*(\n|$)/.test(text)) return none;
  // scan line by line for the closing `---`
  let pos = text.indexOf('\n') + 1;
  if (pos === 0) return none;
  const lines: string[] = [];
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const line = text.slice(pos, nl < 0 ? text.length : nl);
    const next = nl < 0 ? text.length : nl + 1;
    if (/^---[ \t]*$/.test(line)) {
      const fields: Record<string, string> = {};
      for (const l of lines) {
        const i = l.indexOf(':');
        if (i <= 0 || /^\s/.test(l) || l.startsWith('#')) continue;
        let value = l.slice(i + 1).replace(/\s+#.*$/, '').trim();
        if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) value = value.slice(1, -1);
        fields[l.slice(0, i).trim()] = value;
      }
      return { fields, body: text.slice(next), bodyStart: next };
    }
    lines.push(line);
    if (nl < 0) break;
    pos = next;
  }
  return none;
}

/** The first `# Title` of a Markdown body (outside code fences), without inline Markdown. */
export function firstHeading(body: string): string | null {
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) return plainInline(m[1]);
  }
  return null;
}

/** Strips the most common inline Markdown (links, emphasis, code ticks) for titles. */
export function plainInline(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|`)(.+?)\1/g, '$2')
    .trim();
}

/** Normalises line endings so offsets agree everywhere (renderer, quotes, search). */
export function normalizeNewlines(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}
