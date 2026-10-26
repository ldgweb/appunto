/** Freehand drawing over the text. Strokes live in board coordinates, so they
 *  scroll with the text. Two canvases: `base` holds the finished strokes and
 *  is redrawn only when something changes; `live` shows the stroke being drawn
 *  and the eraser ring, and receives the pointer in drawing mode. */

import { getStroke } from 'perfect-freehand';
import type { Stroke } from '../lib/board.ts';
import { boxesTouch, pointsBox, strokeHit, type Box } from '../lib/geometry.ts';
import { themeById, type Palette } from '../lib/palette.ts';
import { DEFAULT_UI } from '../lib/ui-settings.ts';

export type InkTool = 'pen' | 'eraser';

type Change =
  { kind: 'add'; stroke: Stroke } | { kind: 'erase'; removed: Removal[] } | { kind: 'clear'; strokes: Stroke[] };

interface Removal {
  stroke: Stroke;
  index: number;
}

interface Shape {
  path: Path2D;
  box: Box;
}

interface Gesture {
  pointerId: number;
  stroke: Stroke | null;
  removed: Removal[] | null;
  lastX: number;
  lastY: number;
}

const ERASER_RADIUS = 10;
const HISTORY_LIMIT = 200;

export class Ink {
  /** Palette slot and width of the next strokes. */
  color = DEFAULT_UI.penColor;
  size = DEFAULT_UI.penSize;

  private currentTool: InkTool = 'pen';
  private strokes: Stroke[] = [];
  private readonly shapes = new WeakMap<Stroke, Shape>();
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];
  private palette: Palette = themeById(DEFAULT_UI.theme).palette;
  private width = 0;
  private height = 0;
  private ratio = 1;
  private gesture: Gesture | null = null;
  private cursor: { x: number; y: number } | null = null;
  private baseFrame = 0;
  private liveFrame = 0;

  constructor(
    private readonly base: HTMLCanvasElement,
    private readonly live: HTMLCanvasElement,
    private readonly scroller: HTMLElement,
    private readonly onChange: () => void,
  ) {
    live.addEventListener('pointerdown', this.onPointerDown);
    live.addEventListener('pointermove', this.onPointerMove);
    live.addEventListener('pointerup', this.onPointerUp);
    live.addEventListener('pointercancel', this.onPointerUp);
    // The window can hide in the middle of a stroke, and then no pointerup comes.
    live.addEventListener('lostpointercapture', this.onPointerUp);
    live.addEventListener('pointerleave', () => {
      this.cursor = null;
      this.requestLive();
    });
    live.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  /** Replaces every stroke, for example when the board is loaded. Clears history. */
  load(strokes: Stroke[]): void {
    this.strokes = strokes.slice();
    this.undoStack = [];
    this.redoStack = [];
    this.requestBase();
  }

  get all(): readonly Stroke[] {
    return this.strokes;
  }

  /** Lowest point of the drawing, in board coordinates (0 when empty). */
  get bottom(): number {
    let bottom = 0;
    for (const stroke of this.strokes) bottom = Math.max(bottom, this.shape(stroke).box.maxY);
    return bottom;
  }

  /** True while a stroke or an erase is in progress. */
  get busy(): boolean {
    return this.gesture !== null;
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.requestBase();
    this.requestLive();
  }

  get tool(): InkTool {
    return this.currentTool;
  }

  setTool(tool: InkTool): void {
    this.currentTool = tool;
    this.requestLive();
  }

  resize(width: number, height: number): void {
    const ratio = window.devicePixelRatio || 1;
    if (width === this.width && height === this.height && ratio === this.ratio) return;
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    for (const canvas of [this.base, this.live]) {
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
    }
    this.drawBase();
    this.drawLive();
  }

  /** The text scrolled: redraw at the new offset on the next frame. */
  scrolled(): void {
    this.requestBase();
    this.requestLive();
  }

  undo(): boolean {
    const change = this.undoStack.pop();
    if (!change) return false;
    this.revert(change);
    this.redoStack.push(change);
    this.changed();
    return true;
  }

  redo(): boolean {
    const change = this.redoStack.pop();
    if (!change) return false;
    this.apply(change);
    this.undoStack.push(change);
    this.changed();
    return true;
  }

  /** Removes every stroke. Returns a function that brings them back, valid as
   *  long as nothing else was drawn in the meantime. */
  clear(): (() => void) | null {
    if (this.strokes.length === 0) return null;
    const change: Change = { kind: 'clear', strokes: this.strokes.slice() };
    this.apply(change);
    this.record(change);
    this.changed();
    return () => {
      if (this.undoStack[this.undoStack.length - 1] === change) this.undo();
    };
  }

  private apply(change: Change): void {
    if (change.kind === 'add') {
      this.strokes.push(change.stroke);
    } else if (change.kind === 'erase') {
      for (const { stroke } of change.removed) {
        const index = this.strokes.indexOf(stroke);
        if (index >= 0) this.strokes.splice(index, 1);
      }
    } else {
      this.strokes = [];
    }
  }

  private revert(change: Change): void {
    if (change.kind === 'add') {
      const index = this.strokes.lastIndexOf(change.stroke);
      if (index >= 0) this.strokes.splice(index, 1);
    } else if (change.kind === 'erase') {
      // Put strokes back in reverse order of removal, at their old positions.
      for (let i = change.removed.length - 1; i >= 0; i--) {
        const { stroke, index } = change.removed[i] as Removal;
        this.strokes.splice(Math.min(index, this.strokes.length), 0, stroke);
      }
    } else {
      this.strokes = change.strokes.slice();
    }
  }

  private record(change: Change): void {
    this.undoStack.push(change);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  private changed(): void {
    this.requestBase();
    this.onChange();
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.gesture) return;
    // Right button, or the eraser end of a pen, erases whatever the tool.
    const erasing = this.tool === 'eraser' || event.button === 2 || event.button === 5 || (event.buttons & 32) !== 0;
    if (event.button !== 0 && !erasing) return;
    event.preventDefault();
    this.live.setPointerCapture(event.pointerId);
    const { x, y } = this.toBoard(event);
    this.cursor = this.toView(event);
    if (erasing) {
      this.gesture = { pointerId: event.pointerId, stroke: null, removed: [], lastX: x, lastY: y };
      this.eraseAlong(x, y, x, y);
    } else {
      const stroke: Stroke = {
        color: this.color,
        size: this.size,
        points: [x, y, pressureOf(event)],
        pressure: event.pointerType === 'pen',
      };
      this.gesture = { pointerId: event.pointerId, stroke, removed: null, lastX: x, lastY: y };
    }
    this.requestLive();
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    this.cursor = this.toView(event);
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) {
      if (this.tool === 'eraser') this.requestLive();
      return;
    }
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const sample of coalesced.length > 0 ? coalesced : [event]) {
      const { x, y } = this.toBoard(sample);
      if (gesture.stroke) gesture.stroke.points.push(x, y, pressureOf(sample));
      else this.eraseAlong(gesture.lastX, gesture.lastY, x, y);
      gesture.lastX = x;
      gesture.lastY = y;
    }
    this.requestLive();
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    this.gesture = null;
    if (this.live.hasPointerCapture(event.pointerId)) this.live.releasePointerCapture(event.pointerId);
    if (gesture.stroke) {
      this.strokes.push(gesture.stroke);
      this.record({ kind: 'add', stroke: gesture.stroke });
      this.changed();
    } else if (gesture.removed && gesture.removed.length > 0) {
      this.record({ kind: 'erase', removed: gesture.removed });
      this.onChange();
    }
    this.requestLive();
  };

  /** Erases every stroke the eraser touches between two points. */
  private eraseAlong(x0: number, y0: number, x1: number, y1: number): void {
    const removed = this.gesture?.removed;
    if (!removed) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (ERASER_RADIUS / 2)));
    let any = false;
    for (let step = 0; step <= steps; step++) {
      const x = x0 + ((x1 - x0) * step) / steps;
      const y = y0 + ((y1 - y0) * step) / steps;
      const area: Box = {
        minX: x - ERASER_RADIUS,
        minY: y - ERASER_RADIUS,
        maxX: x + ERASER_RADIUS,
        maxY: y + ERASER_RADIUS,
      };
      for (let index = this.strokes.length - 1; index >= 0; index--) {
        const stroke = this.strokes[index] as Stroke;
        if (!boxesTouch(this.shape(stroke).box, area)) continue;
        if (strokeHit(stroke.points, stroke.size / 2, x, y, ERASER_RADIUS)) {
          this.strokes.splice(index, 1);
          removed.push({ stroke, index });
          any = true;
        }
      }
    }
    if (any) this.requestBase();
  }

  private toBoard(event: { clientX: number; clientY: number }) {
    const box = this.live.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top + this.scroller.scrollTop };
  }

  private toView(event: { clientX: number; clientY: number }) {
    const box = this.live.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  private shape(stroke: Stroke): Shape {
    let shape = this.shapes.get(stroke);
    if (!shape) {
      shape = buildShape(stroke, true);
      this.shapes.set(stroke, shape);
    }
    return shape;
  }

  private colorOf(stroke: Stroke): string {
    return this.palette[stroke.color] ?? this.palette[0];
  }

  private requestBase(): void {
    if (this.baseFrame) return;
    this.baseFrame = requestAnimationFrame(() => {
      this.baseFrame = 0;
      this.drawBase();
    });
  }

  private requestLive(): void {
    if (this.liveFrame) return;
    this.liveFrame = requestAnimationFrame(() => {
      this.liveFrame = 0;
      this.drawLive();
    });
  }

  /** Clears a canvas and maps board coordinates onto it at the current scroll. */
  private prepare(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(this.ratio, 0, 0, this.ratio, 0, -this.scroller.scrollTop * this.ratio);
    return context;
  }

  private drawBase(): void {
    const context = this.prepare(this.base);
    if (!context) return;
    const top = this.scroller.scrollTop;
    const bottom = top + this.height;
    for (const stroke of this.strokes) {
      const { path, box } = this.shape(stroke);
      if (box.maxY < top || box.minY > bottom) continue;
      context.fillStyle = this.colorOf(stroke);
      context.fill(path);
    }
  }

  private drawLive(): void {
    const context = this.prepare(this.live);
    if (!context) return;
    const stroke = this.gesture?.stroke;
    if (stroke) {
      context.fillStyle = this.colorOf(stroke);
      context.fill(buildShape(stroke, false).path);
    }
    const erasing = this.tool === 'eraser' || (this.gesture !== null && this.gesture.stroke === null);
    if (this.cursor && erasing) {
      context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
      context.beginPath();
      context.arc(this.cursor.x, this.cursor.y, ERASER_RADIUS, 0, Math.PI * 2);
      context.lineWidth = 1.25;
      context.strokeStyle = this.palette[0];
      context.globalAlpha = 0.75;
      context.stroke();
      context.globalAlpha = 1;
    }
  }
}

function pressureOf(event: PointerEvent): number {
  return event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : 0.5;
}

/** Outline of a stroke as a filled shape, smoothed by perfect-freehand. */
function buildShape(stroke: Stroke, complete: boolean): Shape {
  const input: number[][] = [];
  const points = stroke.points;
  for (let i = 0; i + 2 < points.length; i += 3) {
    input.push([points[i] as number, points[i + 1] as number, points[i + 2] as number]);
  }
  const outline = getStroke(input, {
    size: stroke.size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: !stroke.pressure,
    last: complete,
  });
  return { path: toPath(outline), box: pointsBox(points, stroke.size) };
}

/** Same smoothing as perfect-freehand's SVG helper, as a canvas path. */
function toPath(outline: number[][]): Path2D {
  const path = new Path2D();
  const count = outline.length;
  if (count < 2) return path;
  const first = outline[0] as number[];
  path.moveTo(first[0] ?? 0, first[1] ?? 0);
  for (let i = 0; i < count; i++) {
    const a = outline[i] as number[];
    const b = outline[(i + 1) % count] as number[];
    const ax = a[0] ?? 0;
    const ay = a[1] ?? 0;
    path.quadraticCurveTo(ax, ay, (ax + (b[0] ?? 0)) / 2, (ay + (b[1] ?? 0)) / 2);
  }
  path.closePath();
  return path;
}
