/**
 * Test-build hooks (SLATE_E2E=1) for Playwright: seed gym's files, reach the app store and
 * the registries, and mount the topic picker in isolation. Absent from production builds.
 */
import { createRoot } from 'react-dom/client';
import { useState, type ComponentType } from 'react';
import { ServicesContext, type Services } from '../../app/services';
import { MemoryGymFiles } from '../../core/gym/files';
import type { SourceLink } from '../../core/model/types';
import { useApp } from '../app/store';
import { canvasApi, getTopicPicker, openSource, registerCanvasApi, type CanvasApi, type TopicPickerProps } from '../common/registries';
import { gymIndexFor } from './useGym';

type Seed = Record<string, string | { base64: string; type?: string }>;

export function installGymTestHooks() {
  if (!import.meta.env.VITE_SLATE_E2E || typeof window === 'undefined') return;
  const services = () => (window as unknown as { __slate: Services }).__slate;
  (window as unknown as { __slateGym: unknown }).__slateGym = {
    /** Replaces gym's files (the mirror) with `files`, as after a pull. */
    seed(files: Seed, commit = 'test') {
      const map: Record<string, string | Blob> = {};
      for (const [p, v] of Object.entries(files)) {
        map[p] = typeof v === 'string' ? v : new Blob([Uint8Array.from(atob(v.base64), (c) => c.charCodeAt(0))], { type: v.type ?? '' });
      }
      const s = services();
      const mirror = new MemoryGymFiles(map, commit);
      s.gymFiles = mirror;
      gymIndexFor(s).setFiles(mirror);
    },
    /** Changes one file (undefined deletes it), as a pull would. */
    set(path: string, content: string | undefined, commit?: string) {
      const f = services().gymFiles;
      if (f instanceof MemoryGymFiles) f.set(path, content, commit);
    },
    app: useApp,
    openSource: (link: SourceLink) => openSource(link),
    registerCanvasApi: (slug: string, api: CanvasApi | null) => registerCanvasApi(slug, api),
    canvasApi,
    /** Mounts the registered topic picker in a test panel; its value shows in `#picker-value`. */
    mountPicker(kind: 'topic' | 'problem', topic?: string) {
      const registered = getTopicPicker();
      if (!registered) throw new Error('no topic picker registered');
      const Picker: ComponentType<TopicPickerProps> = registered;
      document.getElementById('picker-harness')?.remove();
      const host = document.createElement('div');
      host.id = 'picker-harness';
      host.style.cssText = 'position:fixed;left:16px;top:60px;width:420px;z-index:300;padding:12px;background:var(--bg-elev);border:1px solid var(--border);border-radius:8px';
      document.body.appendChild(host);
      function Harness() {
        const [value, setValue] = useState('');
        return (
          <>
            <Picker kind={kind} value={value} onChange={setValue} topic={topic} label={kind === 'problem' ? 'Problem' : 'Topic'} />
            <output id="picker-value">{value}</output>
          </>
        );
      }
      createRoot(host).render(
        <ServicesContext.Provider value={services()}>
          <Harness />
        </ServicesContext.Provider>,
      );
    },
  };
}
