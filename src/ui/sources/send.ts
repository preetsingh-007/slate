/**
 * Moving captures to the canvas (S3, S4): "Send to canvas" places them below the latest
 * content when the canvas is on screen; otherwise (narrow screens, canvas hidden) they wait
 * in the carry tray. Several captures keep their order.
 */
import type { Capture } from '../../core/model/capture';
import { useApp } from '../app/store';
import { canvasApi } from '../common/registries';
import { toast } from '../common/toast';

/**
 * True when the main canvas is on screen: next to the side pane, full screen, or (on a narrow
 * screen, P2) switched to. Only a side pane shown full screen hides it.
 */
export function canvasVisible(): boolean {
  const s = useApp.getState();
  const paneShown = s.paneOpen && s.tabs.length > 0;
  return !(paneShown && s.layout === 'pane');
}

export async function sendToCanvas(captures: Capture[]): Promise<void> {
  if (!captures.length) return;
  const s = useApp.getState();
  const api = canvasApi(s.canvas);
  if (api && canvasVisible()) {
    await api.insertCaptures(captures);
    toast(captures.length === 1 ? 'Sent to canvas' : `Sent ${captures.length} clips to canvas`);
    return;
  }
  for (const c of captures) s.addToCarry(c);
  toast(captures.length === 1 ? 'Added to the carry tray' : `Added ${captures.length} clips to the carry tray`);
}

/** Drops captures at a client point if it is over the canvas; returns false otherwise. */
export async function dropOnCanvas(captures: Capture[], clientX: number, clientY: number): Promise<boolean> {
  const api = canvasApi(useApp.getState().canvas);
  const at = api?.clientToCanvas(clientX, clientY);
  if (!api || !at) return false;
  await api.insertCaptures(captures, at);
  return true;
}
