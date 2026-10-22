/**
 * New from clipboard (L7): turns what was copied (HTML and/or plain text) into a clipping's
 * Markdown, its default view (Markdown or Plain text), a title and an optional source label.
 * Chatbot answers (ChatGPT, Claude) are the main input.
 */
import { htmlToMarkdown } from '../html/toMarkdown';

export interface ClipboardInput {
  html?: string;
  text?: string;
}

export interface ClipboardClipping {
  markdown: string;
  format: 'markdown' | 'plain';
  title: string;
  sourceLabel?: string;
}

/** Splits text into code (fenced or inline) and prose parts so prose rules skip code. */
function mapProse(text: string, fn: (prose: string) => string): string {
  return text
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join('');
}

/** ChatGPT's own copy button writes `\( … \)` and `\[ … \]`; Slate's Markdown uses `$` and `$$`. */
export function normalizeMathDelimiters(text: string): string {
  return mapProse(text, (p) =>
    p.replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, (_m, tex: string) => `\n$$\n${tex.trim()}\n$$\n`).replace(/\\\(\s*([\s\S]+?)\s*\\\)/g, (_m, tex: string) => `$${tex.trim()}$`),
  ).replace(/\n{3,}/g, '\n\n');
}

/** Detects whether text is Markdown (rendered by default) or plain text. */
export function detectFormat(text: string): 'markdown' | 'plain' {
  const t = text.trim();
  if (!t) return 'plain';
  let strong = 0;
  let weak = 0;
  if (/^```|^~~~/m.test(t)) strong++;
  if (/^#{1,6}\s+\S/m.test(t)) strong++;
  if (/^\|.*\|\s*\n\|\s*:?-{3,}/m.test(t)) strong++;
  if (/\$\$[\s\S]+?\$\$/.test(t) || /(^|[^\\$\w])\$(?=\S)[^$\n]+?(?<=\S)\$(?!\d)/.test(t)) strong++;
  if (/\[[^\]\n]+\]\((https?:|mailto:)[^)\s]+\)/.test(t)) strong++;
  if ((t.match(/^\s*([-*+]|\d+[.)])\s+\S/gm) ?? []).length >= 2) weak++;
  if (/\*\*[^*\n]+\*\*|__[^_\n]+__/.test(t)) weak++;
  if (/^>\s/m.test(t)) weak++;
  if (/`[^`\n]+`/.test(t)) weak++;
  return strong >= 1 || weak >= 2 ? 'markdown' : 'plain';
}

/** Title = first heading, else the first line, without Markdown, at most 80 characters (L7). */
export function titleFrom(text: string): string {
  const lines = text.split('\n').map((l) => l.trim());
  const heading = lines.find((l) => /^#{1,6}\s+\S/.test(l));
  const first = heading ?? lines.find((l) => l && !/^(```|~~~|\$\$|---|\|)/.test(l)) ?? '';
  let t = first
    .replace(/^#{1,6}\s+/, '')
    .replace(/^([-*+>]|\d+[.)])\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`|~~)/g, '')
    .replace(/\\([\\`*_[\]$<#>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > 80) t = `${t.slice(0, 80).replace(/\s+\S*$/, '')}…`;
  return t || 'Untitled clipping';
}

/** "ChatGPT" or "Claude" when the copied HTML carries their markup. */
export function detectSourceLabel(html: string | undefined): string | undefined {
  if (!html) return undefined;
  if (/font-claude-(message|response)|data-is-streaming|claude\.ai/i.test(html)) return 'Claude';
  if (/data-message-author-role|markdown prose|text-token-|chatgpt\.com|chat\.openai\.com/i.test(html)) return 'ChatGPT';
  return undefined;
}

/** Builds the clipping content from the clipboard; null when the clipboard has no text. */
export function fromClipboard(input: ClipboardInput): ClipboardClipping | null {
  const html = input.html?.trim();
  const text = input.text?.replace(/\r\n?/g, '\n').trim();
  let markdown = '';
  let format: 'markdown' | 'plain' = 'plain';
  if (html) {
    markdown = htmlToMarkdown(html);
    // copied rich text of a plain paragraph converts to the same plain text: keep it plain
    format = markdown && (detectFormat(markdown) === 'markdown' || !text) ? 'markdown' : 'plain';
    if (format === 'plain' && text) markdown = text;
  }
  if (!markdown && text) {
    markdown = normalizeMathDelimiters(text);
    format = detectFormat(markdown);
  }
  if (!markdown.trim()) return null;
  const out: ClipboardClipping = { markdown, format, title: titleFrom(markdown) };
  const label = detectSourceLabel(html);
  if (label) out.sourceLabel = label;
  return out;
}
