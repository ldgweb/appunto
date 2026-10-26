/** Geometry for the eraser: bounding boxes and distance to a stroke. */

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of x, y, pressure triples, grown by `pad` on every side. */
export function pointsBox(points: readonly number[], pad: number): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 3) {
    const x = points[i] ?? 0;
    const y = points[i + 1] ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function boxesTouch(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** Squared distance from point p to the segment a-b. */
export function segmentDistanceSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** Whether a circle of `radius` at (x, y) touches a stroke of the given half width. */
export function strokeHit(points: readonly number[], halfWidth: number, x: number, y: number, radius: number): boolean {
  const reach = radius + halfWidth;
  const reachSq = reach * reach;
  if (points.length < 3) return false;
  if (points.length < 6) {
    const dx = (points[0] ?? 0) - x;
    const dy = (points[1] ?? 0) - y;
    return dx * dx + dy * dy <= reachSq;
  }
  for (let i = 0; i + 5 < points.length; i += 3) {
    const distance = segmentDistanceSq(
      x,
      y,
      points[i] ?? 0,
      points[i + 1] ?? 0,
      points[i + 3] ?? 0,
      points[i + 4] ?? 0,
    );
    if (distance <= reachSq) return true;
  }
  return false;
}
