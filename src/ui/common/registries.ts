/**
 * Small registries that let one area of the UI call into another without importing it:
 *
 * - source openers (S6): a clip's badge asks the area that owns the source type to open it
 *   in the side pane at the locator and flash it;
 * - selection actions (C15, G2, G3): areas add actions to the canvas selection menu;
 * - topic picker (G1): the gym area supplies a picker for gym topic and problem paths;
 * - canvas API (S3, S6, G4): other areas insert captures, reveal objects and regions.
 */
import type { ComponentType } from 'react';
import type { Capture } from '../../core/model/capture';
import type { CanvasObject, Rect, SourceLink, SourceType } from '../../core/model/types';

// ---------------------------------------------------------------- source openers

export type SourceOpener = (link: SourceLink) => void | Promise<void>;
const openers = new Map<SourceType, SourceOpener>();

export function registerSourceOpener(type: SourceType, fn: SourceOpener) {
  openers.set(type, fn);
}

export async function openSource(link: SourceLink): Promise<boolean> {
  const fn = openers.get(link.type);
  if (!fn) return false;
  await fn(link);
  return true;
}

// ---------------------------------------------------------------- selection actions

export interface SelectionContext {
  canvas: string;
  objects: CanvasObject[];
  /** bounds of the selection in canvas units */
  bounds: Rect;
}

export interface SelectionAction {
  id: string;
  label: string;
  icon?: ComponentType<{ size?: number }>;
  /** shown only when this returns true (default: always) */
  when?(ctx: SelectionContext): boolean;
  run(ctx: SelectionContext): void;
}

const selectionActions: SelectionAction[] = [];

export function registerSelectionAction(a: SelectionAction) {
  const i = selectionActions.findIndex((x) => x.id === a.id);
  if (i >= 0) selectionActions[i] = a;
  else selectionActions.push(a);
}

export function getSelectionActions(): readonly SelectionAction[] {
  return selectionActions;
}

// ---------------------------------------------------------------- topic picker

export interface TopicPickerProps {
  /** 'topic' picks a topic or variant path; 'problem' picks a problem file path */
  kind: 'topic' | 'problem';
  value: string;
  onChange(value: string): void;
  /** restrict problems to this topic */
  topic?: string;
  label?: string;
  autoFocus?: boolean;
}

let topicPicker: ComponentType<TopicPickerProps> | null = null;

export function registerTopicPicker(c: ComponentType<TopicPickerProps>) {
  topicPicker = c;
}

export function getTopicPicker(): ComponentType<TopicPickerProps> | null {
  return topicPicker;
}

// ---------------------------------------------------------------- canvas API

export interface CanvasApi {
  /** Places captures as clips: at a canvas point, or below the latest content (S3). Keeps order. */
  insertCaptures(captures: Capture[], at?: { x: number; y: number }): Promise<string[]>;
  /** Scrolls to an object, selects it briefly and flashes it. */
  revealObject(id: string): void;
  /** Scrolls to a region of the canvas and flashes it. */
  revealRegion(rect: Rect): void;
  /** Converts a client (screen) point to canvas coordinates, or null when outside the canvas. */
  clientToCanvas(x: number, y: number): { x: number; y: number } | null;
}

const canvasApis = new Map<string, CanvasApi>();

export function registerCanvasApi(slug: string, api: CanvasApi | null) {
  if (api) canvasApis.set(slug, api);
  else canvasApis.delete(slug);
}

export function canvasApi(slug: string): CanvasApi | undefined {
  return canvasApis.get(slug);
}
