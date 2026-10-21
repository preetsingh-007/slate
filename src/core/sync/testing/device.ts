/** A simulated device for sync tests: its own IndexedDB, stores and sync engine (not used by the app). */
import { AssetStore } from '../../storage/assets';
import { DocStore } from '../../storage/docstore';
import { SlateDB } from '../../storage/idb';
import { CanvasStore } from '../../stores/canvases';
import { FormalizedStore } from '../../stores/formalized';
import { LibraryStore } from '../../stores/library';
import { SettingsStore } from '../../stores/settings';
import { IdbGymFiles } from '../../gym/mirror';
import { SyncEngine, type SyncTimings } from '../engine';
import type { FakeGitHub } from '../git/fakeGitHub';
import { stubRasterizer } from './stubRasterizer';
import type { CanvasObject, Mark } from '../../model/types';
import { isoMonth } from '../../util/time';

export const API = 'https://api.github.test';

let n = 0;

export interface TestDevice {
  name: string;
  db: SlateDB;
  docs: DocStore;
  assets: AssetStore;
  settings: SettingsStore;
  canvases: CanvasStore;
  library: LibraryStore;
  formalized: FormalizedStore;
  mirror: IdbGymFiles;
  sync: SyncEngine;
  /** adds objects (and marks) to a canvas, loading the months they belong to */
  draw(objects: CanvasObject[], marks?: Mark[], slug?: string): Promise<void>;
  close(): Promise<void>;
}

export async function device(
  gh: FakeGitHub,
  name: string,
  opts: { token?: string; repo?: string; connect?: boolean; timings?: Partial<SyncTimings>; now?: () => number } = {},
): Promise<TestDevice> {
  const db = await SlateDB.open(`sync-test-${name}-${Date.now()}-${n++}`);
  const docs = new DocStore(db);
  const settings = await SettingsStore.open(db);
  const assets = new AssetStore(db, () => !!settings.get().lfs);
  const canvases = await CanvasStore.open(db, docs, name);
  const library = await LibraryStore.open(db);
  const formalized = await FormalizedStore.open(db);
  const mirror = await IdbGymFiles.open(db);
  if (opts.connect !== false) await settings.setSecrets({ token: opts.token ?? 'tok', repo: opts.repo ?? 'me/gym', branch: 'main' });
  const sync = new SyncEngine(
    { db, docs, assets, settings, canvases, library, formalized, mirror, rasterize: stubRasterizer, fetch: gh.fetch, now: opts.now },
    { apiBase: API, timings: { ensureTimeoutMs: 5000, ...(opts.timings ?? {}) } },
  );
  canvases.setRemoteFetcher((id) => sync.ensureDoc(id));
  await sync.whenReady();
  return {
    name,
    db,
    docs,
    assets,
    settings,
    canvases,
    library,
    formalized,
    mirror,
    sync,
    async draw(objects, marks = [], slug = 'main') {
      const model = canvases.model(slug);
      const months = new Set([...objects.map((o) => isoMonth(o.created)), ...marks.map((m) => isoMonth(m.created))]);
      await model.load(months);
      model.transact((tx) => {
        for (const o of objects) tx.add(o);
        for (const m of marks) tx.setMark(m);
      });
      await canvases.recordSegmentBounds(slug, model.segmentBounds());
    },
    async close() {
      sync.destroy();
      await docs.destroy();
      db.close();
    },
  };
}

export const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);
