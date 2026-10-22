/**
 * Read access to the gym repository's files (G1, G7, G8). The sync engine keeps a local
 * mirror of gym's Markdown and small assets so the gym reader works offline; tests use the
 * in-memory implementation.
 */

export interface GymEntry {
  /** repository path, e.g. `math/linear-algebra/eigenvalues/notes.md` */
  path: string;
  /** git blob sha */
  sha: string;
  size: number;
}

export interface GymFiles {
  /** Commit the mirror reflects ('' before the first pull). */
  commit(): string;
  /** Every file in the repository (paths and blob shas), from the last pull. */
  list(): GymEntry[];
  /** Text content of a file, or null when it is not available offline. */
  readText(path: string): Promise<string | null>;
  /** Binary content (images), or null when not available. */
  readBlob(path: string): Promise<Blob | null>;
  /** Subscribe to mirror updates (after a pull). Returns an unsubscribe function. */
  onChange(fn: () => void): () => void;
}

export class MemoryGymFiles implements GymFiles {
  private listeners = new Set<() => void>();

  constructor(
    private files: Record<string, string | Blob>,
    private head = 'memory',
  ) {}

  commit() {
    return this.head;
  }

  list(): GymEntry[] {
    return Object.entries(this.files).map(([path, v]) => ({
      path,
      sha: `sha-${path}`,
      size: typeof v === 'string' ? v.length : v.size,
    }));
  }

  async readText(path: string) {
    const v = this.files[path];
    if (v === undefined) return null;
    return typeof v === 'string' ? v : await v.text();
  }

  async readBlob(path: string) {
    const v = this.files[path];
    if (v === undefined) return null;
    return typeof v === 'string' ? new Blob([v]) : v;
  }

  set(path: string, content: string | Blob | undefined, head?: string) {
    if (content === undefined) delete this.files[path];
    else this.files[path] = content;
    if (head) this.head = head;
    for (const fn of this.listeners) fn();
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
