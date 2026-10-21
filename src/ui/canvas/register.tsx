/**
 * The canvas area's wiring that needs the app services: the source opener for clips taken from
 * a canvas (S6). Mounted once by the app shell.
 */
import { useEffect } from 'react';
import type { CanvasLocator } from '../../core/model/types';
import { useServices } from '../../app/services';
import { isNarrowScreen, useApp } from '../app/store';
import { canvasApi, registerSourceOpener } from '../common/registries';
import { toast } from '../common/toast';

export function CanvasMount() {
  const services = useServices();
  useEffect(() => {
    // S6: a clip from a canvas opens that canvas at the region and flashes it for 2 s: in the
    // side pane, or on the main canvas when it is the main one
    registerSourceOpener('canvas', async (link) => {
      const loc = link.locator.type === 'canvas' ? (link.locator as CanvasLocator) : null;
      const slug = loc?.canvas || link.id;
      if (!services.canvases.meta(slug)) return void toast('That canvas no longer exists (source deleted).');
      const app = useApp.getState();
      if (slug === app.canvas) {
        if (app.layout === 'pane' && app.paneOpen) app.setLayout(isNarrowScreen() ? 'canvas' : 'split');
      } else app.openTab({ kind: 'canvas', slug });
      if (!loc) return;
      // a canvas opened just now registers its API once mounted
      for (let i = 0; i < 80; i++) {
        const api = canvasApi(slug);
        if (api) return api.revealRegion(loc.region);
        await new Promise((r) => setTimeout(r, 50));
      }
      toast('The canvas is not available.');
    });
  }, [services]);
  return null;
}
