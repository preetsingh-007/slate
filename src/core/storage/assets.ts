/**
 * Content-addressed files (R7): images, clip images, snapshot resources and book files are
 * stored once, named by the SHA-256 of their bytes, in the IndexedDB `blobs` store.
 */
import { sha256Hex } from '../util/ids';
import type { SlateDB } from './idb';

/** Refuse files over this size unless Git LFS mode is on (R7). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'text/css': 'css',
  'text/html': 'html',
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  // snapshot resources (L8)
  'text/javascript': 'js',
  'image/x-icon': 'ico',
  'image/bmp': 'bmp',
};

/** File extension for a MIME type (`bin` when unknown). */
export function extFor(mime: string): string {
  return EXT[mime.split(';')[0].trim().toLowerCase()] ?? 'bin';
}

/** MIME type for a file name's extension. */
export function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  for (const [mime, e] of Object.entries(EXT)) if (e === ext) return mime;
  if (ext === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

/** `<hash>.<ext>`: the file name of an asset in the repository. */
export function assetFileName(hash: string, mime: string): string {
  return `${hash}.${extFor(mime)}`;
}

export class FileTooLargeError extends Error {
  constructor(readonly size: number) {
    super(`File is ${(size / 1024 / 1024).toFixed(1)} MB; the limit is 50 MB unless Git LFS mode is on.`);
  }
}

export class AssetStore {
  private urls = new Map<string, string>();

  constructor(
    private db: SlateDB,
    private allowLarge: () => boolean = () => false,
  ) {}

  /** Stores a file and returns its hash. Storing the same bytes twice is a no-op. */
  async put(blob: Blob, opts: { allowLarge?: boolean } = {}): Promise<string> {
    if (blob.size > MAX_FILE_BYTES && !(opts.allowLarge ?? this.allowLarge())) throw new FileTooLargeError(blob.size);
    const hash = await sha256Hex(blob);
    if (!(await this.db.hasBlob(hash))) await this.db.putBlob(hash, blob);
    return hash;
  }

  /** Stores a file under a known hash (downloaded from the repository). */
  async putWithHash(hash: string, blob: Blob): Promise<void> {
    if (!(await this.db.hasBlob(hash))) await this.db.putBlob(hash, blob);
  }

  get(hash: string): Promise<Blob | undefined> {
    return this.db.getBlob(hash);
  }

  has(hash: string): Promise<boolean> {
    return this.db.hasBlob(hash);
  }

  /** Object URL for an asset, cached for the session; null when the asset is missing. */
  async url(hash: string): Promise<string | null> {
    const hit = this.urls.get(hash);
    if (hit) return hit;
    const blob = await this.get(hash);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.urls.set(hash, url);
    return url;
  }

  /** Synchronous lookup of an already-created URL. */
  cachedUrl(hash: string): string | undefined {
    return this.urls.get(hash);
  }
}
