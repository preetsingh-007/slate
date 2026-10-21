/** `journal/README.md` (derived): what the folder is and the list of canvases. */
import type { CanvasMeta } from '../../model/types';

const cell = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').replace(/([[\]])/g, '\\$1').trim();

export function journalReadme(canvases: readonly { meta: CanvasMeta; months: string[] }[], hasFormalized: boolean): string {
  const out = [
    '# Journal',
    '',
    'Written by [Slate](https://github.com/preetsingh-007/slate). Do not edit these files, except to append to `formalized.md`; the app regenerates the derived files on every sync.',
    '',
    '- [queue.md](queue.md): marks waiting to be formalized.',
    '- [todos.md](todos.md): open to-dos from the To-dos page and the canvases.',
    hasFormalized ? '- [formalized.md](formalized.md): marks handled in gym (written in gym).' : '- `formalized.md`: marks handled in gym (written in gym).',
    '',
    '## Canvases',
    '',
    '| Canvas | Title | Months |',
    '| --- | --- | --- |',
  ];
  for (const { meta, months } of [...canvases].sort((a, b) => a.meta.slug.localeCompare(b.meta.slug))) {
    out.push(`| [${meta.slug}](${meta.slug}/canvas.json) | ${cell(meta.title)} | ${months.join(', ')} |`);
  }
  return out.join('\n') + '\n';
}
