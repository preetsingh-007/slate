/** The minimal stroke shape the ink modules work on. Canvas strokes extend it. */
export interface InkStroke {
  id: string;
  /** flattened [x, y, pressure, x, y, pressure, ...] in canvas units */
  pts: number[];
  color: string;
  size: number;
  tool: 'pen' | 'highlighter';
}
