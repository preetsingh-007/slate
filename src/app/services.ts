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
import { FormalizedStore } from '../core/stores/formalized';
import { MemoryGymFiles, type GymFiles } from '../core/gym/files';
import { LibraryStore } from '../core/stores/library';
import { SettingsStore } from '../core/stores/settings';

export interface Services {
  db: SlateDB;
  docs: DocStore;
  assets: AssetStore;
  settings: SettingsStore;
  canvases: CanvasStore;
  library: LibraryStore;
  formalized: FormalizedStore;
  /** gym's files for the gym reader, revision list and topic picker (offline mirror, set up by sync) */
  gymFiles: GymFiles;
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
  const formalized = await FormalizedStore.open(db);
  const gymFiles: GymFiles = new MemoryGymFiles({}, '');
  return { db, docs, assets, settings, canvases, library, formalized, gymFiles, device };
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
