/**
 * Gym-file source links (S5, S6): repository path, the commit the mirror reflected, and a
 * text quote over the file's Markdown source (its exact words plus 32 characters of context
 * on each side), so the link survives edits to the file in gym.
 */
import type { GymLocator, SourceLink } from '../model/types';
import { findQuote, makeQuote, type QuoteMatch } from '../locators/textQuote';

export function gymLocator(path: string, commit: string, source: string, start: number, end: number): GymLocator {
  return { type: 'gym', path, commit, quote: makeQuote(source, start, end) };
}

export function gymSourceLink(opts: { path: string; title: string; commit: string; sha: string; source: string; start: number; end: number; now?: number }): SourceLink {
  return {
    type: 'gym',
    id: opts.path,
    title: opts.title,
    locator: gymLocator(opts.path, opts.commit, opts.source, opts.start, opts.end),
    capturedAt: opts.now ?? Date.now(),
    contentHash: opts.sha,
  };
}

/** Finds a gym locator's quote in the file's current source: exact, else the closest match. */
export function findGymQuote(source: string, locator: GymLocator): QuoteMatch | null {
  return findQuote(source, locator.quote);
}
