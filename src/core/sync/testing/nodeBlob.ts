/**
 * happy-dom's Blob does not survive IndexedDB's structured clone (fake-indexeddb), so tests that
 * store files use Node's Blob, which does. Call before creating any Blob.
 */
export async function useNodeBlob(): Promise<void> {
  const mod = 'node:buffer';
  const { Blob } = (await import(/* @vite-ignore */ mod)) as { Blob: typeof globalThis.Blob };
  globalThis.Blob = Blob;
}
