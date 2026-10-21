/**
 * Optional enrichment of book metadata from a DOI or arXiv id (L1), only through the fetch
 * helper: the app contacts no other site.
 */
import type { BookBib } from '../library/pdfTypes';
import { lookupArxiv } from './arxiv';
import { lookupDoi } from './crossref';

/**
 * Looks the identifiers up (DOI first, then arXiv) and returns the found metadata, or null.
 * `fetchViaHelper` must route requests through the fetch helper (see helperAsFetch).
 */
export async function lookupBib(ids: { doi?: string; arxiv?: string }, fetchViaHelper: typeof fetch, signal?: AbortSignal): Promise<BookBib | null> {
  if (ids.doi) {
    try {
      const m = await lookupDoi(ids.doi, { fetch: fetchViaHelper, signal });
      if (m) return m;
    } catch {
      /* fall through to arXiv */
    }
  }
  if (ids.arxiv) return lookupArxiv(ids.arxiv, { fetch: fetchViaHelper, signal });
  return null;
}
