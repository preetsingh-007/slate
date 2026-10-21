/**
 * The main canvas, and a second canvas in the side pane (P1).
 */
import { CanvasView } from './CanvasView';
import { registerPane } from '../panes/registry';
import { canvasTitles } from './CanvasSwitcher';

export function CanvasPane({ slug }: { slug: string }) {
  return <CanvasView key={slug} slug={slug} />;
}

registerPane('canvas', {
  component: ({ tab }) => <CanvasView key={tab.slug} slug={tab.slug} embedded />,
  title: (tab) => canvasTitles.get(tab.slug) ?? tab.slug,
});
