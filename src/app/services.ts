/**
 * Long-lived services, created once at startup and shared through React context.
 * Each area of the app adds its service here.
 */
import { createContext, useContext } from 'react';
import { AssetStore } from '../core/storage/assets';
import { DocStore } from '../core/storage/docstore';
import { SlateDB } from '../core/storage/idb';
import { getDeviceId } from '../core/util/ids';
import { CanvasStore } from '../core/stores/canvases';
import { LibraryStore } from '../core/stores/library';
import { SettingsStore } from '../core/stores/settings';

export interface Services {
  db: SlateDB;
  docs: DocStore;
  assets: AssetStore;
  settings: SettingsStore;
  canvases: CanvasStore;
  library: LibraryStore;
  device: string;
}

export async function createServices(dbName = 'slate'): Promise<Services> {
  const db = await SlateDB.open(dbName);
  const docs = new DocStore(db);
  const device = getDeviceId();
  const settings = await SettingsStore.open(db);
  const assets = new AssetStore(db, () => !!settings.get().lfs);
  const canvases = await CanvasStore.open(db, docs, device);
  const library = await LibraryStore.open(db);
  return { db, docs, assets, settings, canvases, library, device };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('useServices outside ServicesContext');
  return s;
}

/** Ask the browser not to evict our storage (R10). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
