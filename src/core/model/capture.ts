import type { SourceLink } from './types';

/**
 * Content lassoed from a source (S2), waiting to be dropped on the canvas: in the drag
 * preview, or in the carry tray (S4). Dropping it creates a clip object.
 */
export interface Capture {
  id: string;
  /** image of the region; PDF regions at twice the screen resolution */
  image?: Blob;
  imageSize?: { w: number; h: number };
  /** the region's text as Markdown ('' when there is none) */
  text: string;
  source: SourceLink;
  created: number;
}
