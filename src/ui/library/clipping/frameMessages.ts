/**
 * What the app tells the snapshot frame about annotations (L8, S7). The frame may run the saved
 * page's own scripts, which could send anything the frame knows to their site, so it gets only
 * what it needs to draw: ranges, colours and whether a note exists, never the owner's note text.
 */
export interface FrameHighlight {
  id: string;
  start: number;
  end: number;
  color: string;
  /** the note's text, kept in the app; the frame only learns that there is one */
  note?: string;
}

export interface FrameMark {
  key: string;
  start: number;
  end: number;
  label: string;
}

export function decorateMessage(highlights: readonly FrameHighlight[], marks: readonly FrameMark[]) {
  return {
    type: 'decorate' as const,
    highlights: highlights.map((h) => ({ id: h.id, start: h.start, end: h.end, color: h.color, note: h.note !== undefined })),
    marks: marks.map((m) => ({ key: m.key, start: m.start, end: m.end, label: m.label })),
  };
}
