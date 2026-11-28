import { isTileWalkable } from './mapGen';
import {
  BruteState,
  BruteTuningNumbers,
  DifficultyConfig,
  Door,
  PlayerState,
  ShipDeck,
  ShipMap,
} from './types';

export interface OccluderSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'WALL' | 'DOOR';
  segId?: number;
}

const staticWallSegmentsCache = new WeakMap<ShipMap, OccluderSegment[]>();

interface StaticSegmentGrid {
  segments: OccluderSegment[];
  cellTiles: number;
  cols: number;
  rows: number;
  buckets: number[][];
  seenStamp: Int32Array;
  stamp: number;
}

const staticSegmentGridCache = new WeakMap<ShipMap, StaticSegmentGrid>();

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Extracts merged axis-aligned wall boundary segments strictly on the inner faces
 * separating solid/void tiles from walkable floor/deck tiles.
 */
export function getStaticWallSegments(map: ShipMap): OccluderSegment[] {
  const cached = staticWallSegmentsCache.get(map);
  if (cached) return cached;

  const segments: OccluderSegment[] = [];
  const { width, height, tileSize: ts, tiles } = map;

  const isTransparent = (tx: number, ty: number): boolean => {
    if (tx < 0 || tx >= width || ty < 0 || ty >= height) return true;
    return tiles[ty][tx] !== 'WALL';
  };

  // Horizontal boundaries y = 0..height
  for (let y = 0; y <= height; y++) {
    const wy = y * ts;
    let runStart = -1;
    let runMode = 0; // 1 = top-of-wall (open above, wall below), 2 = bottom-of-wall (wall above, open below)

    const flushRun = (endX: number) => {
      if (runStart !== -1 && endX > runStart) {
        segments.push({
          x1: runStart * ts,
          y1: wy,
          x2: endX * ts,
          y2: wy,
          kind: 'WALL',
        });
      }
      runStart = -1;
      runMode = 0;
    };

    for (let x = 0; x < width; x++) {
      const above = isTransparent(x, y - 1);
      const below = isTransparent(x, y);
      const mode = above && !below ? 1 : !above && below ? 2 : 0;
      if (mode !== runMode) {
        flushRun(x);
        if (mode !== 0) {
          runStart = x;
          runMode = mode;
        }
      }
    }
    flushRun(width);
  }

  // Vertical boundaries x = 0..width
  for (let x = 0; x <= width; x++) {
    const wx = x * ts;
    let runStart = -1;
    let runMode = 0; // 1 = left-of-wall (open left, wall right), 2 = right-of-wall (wall left, open right)

    const flushRun = (endY: number) => {
      if (runStart !== -1 && endY > runStart) {
        segments.push({
          x1: wx,
          y1: runStart * ts,
          x2: wx,
          y2: endY * ts,
          kind: 'WALL',
        });
      }
      runStart = -1;
      runMode = 0;
    };

    for (let y = 0; y < height; y++) {
      const left = isTransparent(x - 1, y);
      const right = isTransparent(x, y);
      const mode = left && !right ? 1 : !left && right ? 2 : 0;
      if (mode !== runMode) {
        flushRun(y);
        if (mode !== 0) {
          runStart = y;
          runMode = mode;
        }
      }
    }
    flushRun(height);
  }

  for (let i = 0; i < segments.length; i++) {
    segments[i].segId = i + 1;
  }

  staticWallSegmentsCache.set(map, segments);
  return segments;
}

function getStaticSegmentGrid(map: ShipMap): StaticSegmentGrid {
  const existing = staticSegmentGridCache.get(map);
  if (existing) return existing;

  const segments = getStaticWallSegments(map);
  const cellTiles = 8;
  const cols = Math.max(1, Math.ceil(map.width / cellTiles));
  const rows = Math.max(1, Math.ceil(map.height / cellTiles));
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  const cellPx = cellTiles * map.tileSize;

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const minX = s.x1 < s.x2 ? s.x1 : s.x2;
    const maxX = s.x1 > s.x2 ? s.x1 : s.x2;
    const minY = s.y1 < s.y2 ? s.y1 : s.y2;
    const maxY = s.y1 > s.y2 ? s.y1 : s.y2;
    const c0 = Math.max(0, Math.min(cols - 1, Math.floor(minX / cellPx)));
    const c1 = Math.max(0, Math.min(cols - 1, Math.floor(maxX / cellPx)));
    const r0 = Math.max(0, Math.min(rows - 1, Math.floor(minY / cellPx)));
    const r1 = Math.max(0, Math.min(rows - 1, Math.floor(maxY / cellPx)));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        buckets[r * cols + c].push(i);
      }
    }
  }

  const grid: StaticSegmentGrid = {
    segments,
    cellTiles,
    cols,
    rows,
    buckets,
    seenStamp: new Int32Array(segments.length),
    stamp: 0,
  };
  staticSegmentGridCache.set(map, grid);
  return grid;
}

export function getLocalOccluders(
  map: ShipMap,
  doorsByTile: Map<number, Door>,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  ignoreDoorTileKey?: number
): OccluderSegment[] {
  const grid = getStaticSegmentGrid(map);
  const ts = map.tileSize;
  const cellPx = grid.cellTiles * ts;
  const result: OccluderSegment[] = [];

  const c0 = Math.max(0, Math.min(grid.cols - 1, Math.floor(minX / cellPx)));
  const c1 = Math.max(0, Math.min(grid.cols - 1, Math.floor(maxX / cellPx)));
  const r0 = Math.max(0, Math.min(grid.rows - 1, Math.floor(minY / cellPx)));
  const r1 = Math.max(0, Math.min(grid.rows - 1, Math.floor(maxY / cellPx)));

  grid.stamp++;
  if (grid.stamp >= 0x7fffffff) {
    grid.seenStamp.fill(0);
    grid.stamp = 1;
  }
  const stamp = grid.stamp;

  for (let r = r0; r <= r1; r++) {
    const rowOff = r * grid.cols;
    for (let c = c0; c <= c1; c++) {
      const bucket = grid.buckets[rowOff + c];
      for (let k = 0; k < bucket.length; k++) {
        const segIdx = bucket[k];
        if (grid.seenStamp[segIdx] === stamp) continue;
        grid.seenStamp[segIdx] = stamp;
        const s = grid.segments[segIdx];
        const sMinX = s.x1 < s.x2 ? s.x1 : s.x2;
        const sMaxX = s.x1 > s.x2 ? s.x1 : s.x2;
        const sMinY = s.y1 < s.y2 ? s.y1 : s.y2;
        const sMaxY = s.y1 > s.y2 ? s.y1 : s.y2;
        if (sMaxX < minX || sMinX > maxX || sMaxY < minY || sMinY > maxY) continue;
        result.push(s);
      }
    }
  }

  const minTx = Math.max(0, Math.floor(minX / ts) - 1);
  const maxTx = Math.min(map.width - 1, Math.ceil(maxX / ts) + 1);
  const minTy = Math.max(0, Math.floor(minY / ts) - 1);
  const maxTy = Math.min(map.height - 1, Math.ceil(maxY / ts) + 1);

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const tileKey = ty * map.width + tx;
      if (ignoreDoorTileKey !== undefined && tileKey === ignoreDoorTileKey) continue;
      const door = doorsByTile.get(tileKey);
      if (!door || door.isBroken || door.openProgress > 0.35) continue;

      if (door.orientation === 'H') {
        const cy = (ty + 0.5) * ts;
        result.push({
          x1: tx * ts,
          y1: cy,
          x2: (tx + 1) * ts,
          y2: cy,
          kind: 'DOOR',
          segId: 100000 + tileKey,
        });
      } else {
        const cx = (tx + 0.5) * ts;
        result.push({
          x1: cx,
          y1: ty * ts,
          x2: cx,
          y2: (ty + 1) * ts,
          kind: 'DOOR',
          segId: 100000 + tileKey,
        });
      }
    }
  }

  return result;
}

function intersectRaySegment(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  seg: OccluderSegment
): number | null {
  const sx = seg.x2 - seg.x1;
  const sy = seg.y2 - seg.y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-9) return null;

  const qpx = seg.x1 - ox;
  const qpy = seg.y1 - oy;
  const t = (qpx * sy - qpy * sx) / denom;
  if (t < 0 || t > maxDist) return null;

  const u = (qpx * dy - qpy * dx) / denom;
  if (u < -1e-5 || u > 1 + 1e-5) return null;

  return t;
}

export function isPointBlockedForSight(
  map: ShipMap,
  doorsByTile: Map<number, Door>,
  wx: number,
  wy: number
): boolean {
  const tx = Math.floor(wx / map.tileSize);
  const ty = Math.floor(wy / map.tileSize);
  if (tx < 0 || tx >= map.width || ty < 0 || ty >= map.height) return false;
  if (map.tiles[ty][tx] === 'WALL') return true;

  const door = doorsByTile.get(ty * map.width + tx);
  if (door && door.openProgress <= 0.35 && !door.isBroken) {
    const cx = (tx + 0.5) * map.tileSize;
    const cy = (ty + 0.5) * map.tileSize;
    if (door.orientation === 'H') {
      return Math.abs(wy - cy) < 5;
    }
    return Math.abs(wx - cx) < 5;
  }
  return false;
}

export function castRay(
  map: ShipMap,
  doorsByTile: Map<number, Door>,
  x0: number,
  y0: number,
  angle: number,
  maxDist: number
): { x: number; y: number; dist: number; hit: boolean } {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const pad = map.tileSize;
  const segments = getLocalOccluders(
    map,
    doorsByTile,
    x0 - maxDist - pad,
    y0 - maxDist - pad,
    x0 + maxDist + pad,
    y0 + maxDist + pad
  );

  let bestT = maxDist;
  let hit = false;
  for (let i = 0; i < segments.length; i++) {
    const t = intersectRaySegment(x0, y0, dx, dy, bestT, segments[i]);
    if (t !== null && t < bestT) {
      bestT = t;
      hit = true;
    }
  }

  return {
    x: x0 + dx * bestT,
    y: y0 + dy * bestT,
    dist: bestT,
    hit,
  };
}

/**
 * Exact segment-vs-occluder line-of-sight check. Never skips thin closed doors or clips corners.
 */
export function hasLineOfSight(
  map: ShipMap,
  doorsByTile: Map<number, Door>,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return true;

  const ux = dx / dist;
  const uy = dy / dist;
  const checkDist = Math.max(0, dist - 1);
  const minX = Math.min(x1, x2) - map.tileSize;
  const maxX = Math.max(x1, x2) + map.tileSize;
  const minY = Math.min(y1, y2) - map.tileSize;
  const maxY = Math.max(y1, y2) + map.tileSize;

  const segments = getLocalOccluders(map, doorsByTile, minX, minY, maxX, maxY);
  for (let i = 0; i < segments.length; i++) {
    const t = intersectRaySegment(x1, y1, ux, uy, checkDist, segments[i]);
    if (t !== null && t > 1e-3 && t < checkDist) {
      return false;
    }
  }
  return true;
}

export interface VisibilityVertex {
  x: number;
  y: number;
  segId?: number;
  hitKind?: 'WALL' | 'DOOR';
}

/**
 * Computes an exact corner-targeted visibility polygon clipped strictly to the
 * inner edges of walls and closed door slabs.
 */
export function computeVisibilityPolygon(
  map: ShipMap,
  doorsByTile: Map<number, Door>,
  x: number,
  y: number,
  startAngle: number,
  sweepAngle: number,
  maxDist: number,
  rayCount = 72,
  ignoreDoorTileKey?: number
): VisibilityVertex[] {
  const pad = map.tileSize;
  const segments = getLocalOccluders(
    map,
    doorsByTile,
    x - maxDist - pad,
    y - maxDist - pad,
    x + maxDist + pad,
    y + maxDist + pad,
    ignoreDoorTileKey
  );

  const clampedSweep = Math.min(Math.PI * 2, Math.max(0.01, sweepAngle));
  const TWO_PI = Math.PI * 2;
  const cornerReach = maxDist * 1.18 + pad;
  const deltas: number[] = [0, clampedSweep];

  const stepCount = Math.max(16, rayCount);
  for (let i = 1; i < stepCount; i++) {
    deltas.push((clampedSweep * i) / stepCount);
  }

  const pushCorner = (vx: number, vy: number) => {
    const dist = Math.hypot(vx - x, vy - y);
    if (dist > cornerReach || dist < 1e-4) return;
    const base = Math.atan2(vy - y, vx - x);
    for (let k = -1; k <= 1; k++) {
      const a = base + k * 0.00028;
      const d = (((a - startAngle) % TWO_PI) + TWO_PI) % TWO_PI;
      if (d <= clampedSweep + 1e-5) {
        deltas.push(Math.min(clampedSweep, d));
      }
    }
  };

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    pushCorner(s.x1, s.y1);
    pushCorner(s.x2, s.y2);
  }

  deltas.sort((a, b) => a - b);

  const pts: VisibilityVertex[] = [];
  let lastDelta = -1;

  for (let i = 0; i < deltas.length; i++) {
    const d = deltas[i];
    if (lastDelta >= 0 && d - lastDelta < 1e-5) continue;
    lastDelta = d;

    const a = startAngle + d;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let bestT = maxDist;
    let bestSeg: OccluderSegment | null = null;

    for (let j = 0; j < segments.length; j++) {
      const seg = segments[j];
      const t = intersectRaySegment(x, y, dx, dy, bestT, seg);
      if (t !== null && t < bestT) {
        bestT = t;
        bestSeg = seg;
      }
    }

    pts.push({
      x: x + dx * bestT,
      y: y + dy * bestT,
      segId: bestSeg ? (bestSeg.segId ?? -1) : -1,
      hitKind: bestSeg ? bestSeg.kind : undefined,
    });
  }

  // Collapse collinear sub-pixel slivers on the exact same wall/door segment
  // while preserving every segment endpoint and corner transition.
  if (pts.length > 4) {
    const cleaned: VisibilityVertex[] = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = cleaned[cleaned.length - 1];
      const curr = pts[i];
      const next = pts[i + 1];
      if (
        curr.segId !== undefined &&
        curr.segId > 0 &&
        curr.segId === prev.segId &&
        curr.segId === next.segId &&
        Math.hypot(curr.x - prev.x, curr.y - prev.y) < 12
      ) {
        continue;
      }
      cleaned.push(curr);
    }
    cleaned.push(pts[pts.length - 1]);
    return cleaned;
  }

  return pts;
}

/**
 * Wide, non-gamey Brute Field of View (~152 deg) + peripheral close awareness.
 * Flashlight beam makes the player visible from much farther away!
 */
export function getSensesProfile(
  cfg: DifficultyConfig,
  tuning?: BruteTuningNumbers
): {
  sightMult: number;
  halfFovDeg: number;
  peripheralBase: number;
  peripheralCrouch: number;
  hearingMult: number;
} {
  if (tuning) {
    return {
      sightMult: tuning.sightMult,
      halfFovDeg: tuning.halfFovDeg,
      peripheralBase: tuning.peripheralBase,
      peripheralCrouch: tuning.peripheralCrouch,
      hearingMult: tuning.hearingMult,
    };
  }
  switch (cfg.senses) {
    case 'LOW':
      return {
        sightMult: 0.9,
        halfFovDeg: 70,
        peripheralBase: 86,
        peripheralCrouch: 56,
        hearingMult: 0.9,
      };
    case 'EXTREME':
      return {
        sightMult: 1.54,
        halfFovDeg: 105,
        peripheralBase: 156,
        peripheralCrouch: 105,
        hearingMult: 1.68,
      };
    case 'HIGH':
      return {
        sightMult: 1.3,
        halfFovDeg: 89,
        peripheralBase: 126,
        peripheralCrouch: 84,
        hearingMult: 1.38,
      };
    default:
      return {
        sightMult: 1.1,
        halfFovDeg: 80,
        peripheralBase: 108,
        peripheralCrouch: 70,
        hearingMult: 1.12,
      };
  }
}

export function canBruteSeePlayer(
  brute: BruteState,
  player: PlayerState,
  map: ShipMap,
  doorsByTile: Map<number, Door>,
  difficulty: DifficultyConfig,
  tuning?: BruteTuningNumbers,
  poweredDecks?: Record<ShipDeck, boolean>
): boolean {
  if (brute.state === 'STUNNED') return false;
  if (player.hidingSpotId !== null) return false;

  const dx = player.x - brute.x;
  const dy = player.y - brute.y;
  const dist = Math.hypot(dx, dy);

  const pTx = Math.max(0, Math.min(map.width - 1, Math.floor(player.x / map.tileSize)));
  const pTy = Math.max(0, Math.min(map.height - 1, Math.floor(player.y / map.tileSize)));
  const playerRoomId = map.roomIdGrid[pTy]?.[pTx] ?? 0;
  const playerDeck = map.deckGrid[pTy]?.[pTx];
  const playerInLitRoom =
    Boolean(poweredDecks && playerDeck && poweredDecks[playerDeck]) ||
    map.lightSwitches.some((sw) => sw.roomId === playerRoomId && sw.isOn);

  const senses = getSensesProfile(difficulty, tuning);
  const baseRange =
    player.flashlightOn || playerInLitRoom ? 485 : player.crouching ? 215 : 345;
  const maxRange = baseRange * senses.sightMult;

  if (dist > maxRange) return false;

  const angleToPlayer = Math.atan2(dy, dx);
  const diff = Math.abs(normalizeAngle(angleToPlayer - brute.angle));

  const halfFov = (senses.halfFovDeg * Math.PI) / 180;
  const peripheralRange = player.crouching ? senses.peripheralCrouch : senses.peripheralBase;

  if (diff > halfFov && dist > peripheralRange) {
    return false;
  }

  return hasLineOfSight(map, doorsByTile, brute.x, brute.y, player.x, player.y);
}

/**
 * Checks line of sight stopping slightly before target center so doors/crates
 * do not self-occlude their own tile center.
 */
export function hasLineOfSightToEntity(
  map: ShipMap,
  doorsByTile: Map<number, Door>,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 20) return true;

  const ux = dx / dist;
  const uy = dy / dist;
  const checkDist = Math.max(4, dist - 20);
  const ex = x1 + ux * checkDist;
  const ey = y1 + uy * checkDist;

  const minX = Math.min(x1, ex) - map.tileSize;
  const maxX = Math.max(x1, ex) + map.tileSize;
  const minY = Math.min(y1, ey) - map.tileSize;
  const maxY = Math.max(y1, ey) + map.tileSize;

  const segments = getLocalOccluders(map, doorsByTile, minX, minY, maxX, maxY);
  for (let i = 0; i < segments.length; i++) {
    const t = intersectRaySegment(x1, y1, ux, uy, checkDist, segments[i]);
    if (t !== null && t > 1e-3 && t < checkDist) {
      return false;
    }
  }
  return true;
}

export function canBruteSeePoint(
  brute: BruteState,
  targetX: number,
  targetY: number,
  maxRange: number,
  map: ShipMap,
  doorsByTile: Map<number, Door>,
  halfFovDeg = 76
): boolean {
  if (brute.state === 'STUNNED') return false;
  const dx = targetX - brute.x;
  const dy = targetY - brute.y;
  const dist = Math.hypot(dx, dy);
  if (dist > maxRange) return false;

  const angleToTarget = Math.atan2(dy, dx);
  const diff = Math.abs(normalizeAngle(angleToTarget - brute.angle));
  const halfFov = (halfFovDeg * Math.PI) / 180;
  if (diff > halfFov && dist > 65) return false;

  return hasLineOfSightToEntity(map, doorsByTile, brute.x, brute.y, targetX, targetY);
}

export interface FanMeshData {
  /** Interleaved (wx, -wy, z) positions for Three.js world space */
  positions: Float32Array;
  /** Radial offset (dx, -dy) from light origin for TSL radial falloff */
  radialOffsets: Float32Array;
  vertexCount: number;
  version: number;
}

export interface FanCurtainOptions {
  wallHeight: number;
  doorHeight: number;
  floorZ?: number;
  pushInwardPx?: number;
  curtainOnly?: boolean;
  ceilingCapZ?: number;
  canCapCeiling?: (wx: number, wy: number) => boolean;
}

function isContinuousCurtainEdge(a: VisibilityVertex, b: VisibilityVertex): boolean {
  if (a.segId === undefined || a.segId <= 0 || b.segId === undefined || b.segId <= 0) {
    return false;
  }
  if (a.segId === b.segId) return true;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy <= 144;
}

function clampCeilingVertex(
  ox: number,
  oy: number,
  vx: number,
  vy: number,
  canCapCeiling: (wx: number, wy: number) => boolean
): [number, number] {
  if (canCapCeiling(vx, vy)) return [vx, vy];
  let lo = 0;
  let hi = 1;
  for (let s = 0; s < 6; s++) {
    const mid = (lo + hi) * 0.5;
    if (canCapCeiling(ox + (vx - ox) * mid, oy + (vy - oy) * mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return [ox + (vx - ox) * lo, oy + (vy - oy) * lo];
}

function clampEntryFromOutside(
  ox: number,
  oy: number,
  vx: number,
  vy: number,
  canCapCeiling: (wx: number, wy: number) => boolean
): [number, number] {
  if (!canCapCeiling(vx, vy)) return [vx, vy];
  let lo = 0;
  let hi = 1;
  for (let s = 0; s < 6; s++) {
    const mid = (lo + hi) * 0.5;
    if (canCapCeiling(ox + (vx - ox) * mid, oy + (vy - oy) * mid)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return [ox + (vx - ox) * hi, oy + (vy - oy) * hi];
}

/**
 * Triangulates a visibility polygon into a non-indexed triangle fan centered at (ox, oy)
 * plus optional 3D vertical wall/door illumination curtains and ceiling caps along hit segments.
 */
export function buildVisibilityFanBuffers(
  ox: number,
  oy: number,
  poly: VisibilityVertex[],
  closedLoop: boolean,
  prev?: FanMeshData,
  curtainOpts?: FanCurtainOptions
): FanMeshData {
  const n = poly.length;
  const triCount = n < 2 ? 0 : closedLoop ? n : n - 1;
  const includeFloor = !curtainOpts?.curtainOnly;
  const ceilingCapZ = curtainOpts?.ceilingCapZ;
  const canCapCeiling = curtainOpts?.canCapCeiling;
  const includeCeilingCap = ceilingCapZ !== undefined;
  const originInCapZone = includeCeilingCap && (!canCapCeiling || canCapCeiling(ox, oy));

  let curtainEdges = 0;
  if (curtainOpts && curtainOpts.wallHeight > 0) {
    for (let i = 0; i < triCount; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      if (isContinuousCurtainEdge(a, b)) {
        curtainEdges++;
      }
    }
  }

  let ceilingTris = 0;
  if (includeCeilingCap) {
    if (!canCapCeiling || originInCapZone) {
      ceilingTris = triCount;
    } else {
      for (let i = 0; i < triCount; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        if (canCapCeiling(a.x, a.y) && canCapCeiling(b.x, b.y)) {
          ceilingTris += 2;
        }
      }
    }
  }

  const floorTris = includeFloor ? triCount : 0;
  const vertexCount = (floorTris + ceilingTris + curtainEdges * 2) * 3;
  const neededFloats3 = vertexCount * 3;
  const neededFloats2 = vertexCount * 2;

  const positions =
    prev && prev.positions.length >= neededFloats3
      ? prev.positions
      : new Float32Array(Math.max(neededFloats3, 96 * 3));
  const radialOffsets =
    prev && prev.radialOffsets.length >= neededFloats2
      ? prev.radialOffsets
      : new Float32Array(Math.max(neededFloats2, 96 * 2));

  let pIdx = 0;
  let rIdx = 0;
  const threeOy = -oy;
  const floorZ = curtainOpts?.floorZ ?? 0;

  if (includeFloor) {
    for (let i = 0; i < triCount; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];

      // Vertex 0: center (ox, oy)
      positions[pIdx++] = ox;
      positions[pIdx++] = threeOy;
      positions[pIdx++] = floorZ;
      radialOffsets[rIdx++] = 0;
      radialOffsets[rIdx++] = 0;

      // Vertex 1: a
      positions[pIdx++] = a.x;
      positions[pIdx++] = -a.y;
      positions[pIdx++] = floorZ;
      radialOffsets[rIdx++] = a.x - ox;
      radialOffsets[rIdx++] = -(a.y - oy);

      // Vertex 2: b
      positions[pIdx++] = b.x;
      positions[pIdx++] = -b.y;
      positions[pIdx++] = floorZ;
      radialOffsets[rIdx++] = b.x - ox;
      radialOffsets[rIdx++] = -(b.y - oy);
    }
  }

  if (includeCeilingCap && ceilingCapZ !== undefined) {
    for (let i = 0; i < triCount; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      if (canCapCeiling && !originInCapZone) {
        if (!canCapCeiling(a.x, a.y) || !canCapCeiling(b.x, b.y)) continue;
        const [eax, eay] = clampEntryFromOutside(ox, oy, a.x, a.y, canCapCeiling);
        const [ebx, eby] = clampEntryFromOutside(ox, oy, b.x, b.y, canCapCeiling);

        // Quad (eA, b, a) + (eA, eB, b) facing downward (-Z) strictly inside indoor zone
        positions[pIdx++] = eax; positions[pIdx++] = -eay; positions[pIdx++] = ceilingCapZ;
        radialOffsets[rIdx++] = eax - ox; radialOffsets[rIdx++] = -(eay - oy);

        positions[pIdx++] = b.x; positions[pIdx++] = -b.y; positions[pIdx++] = ceilingCapZ;
        radialOffsets[rIdx++] = b.x - ox; radialOffsets[rIdx++] = -(b.y - oy);

        positions[pIdx++] = a.x; positions[pIdx++] = -a.y; positions[pIdx++] = ceilingCapZ;
        radialOffsets[rIdx++] = a.x - ox; radialOffsets[rIdx++] = -(a.y - oy);

        positions[pIdx++] = eax; positions[pIdx++] = -eay; positions[pIdx++] = ceilingCapZ;
        radialOffsets[rIdx++] = eax - ox; radialOffsets[rIdx++] = -(eay - oy);

        positions[pIdx++] = ebx; positions[pIdx++] = -eby; positions[pIdx++] = ceilingCapZ;
        radialOffsets[rIdx++] = ebx - ox; radialOffsets[rIdx++] = -(eby - oy);

        positions[pIdx++] = b.x; positions[pIdx++] = -b.y; positions[pIdx++] = ceilingCapZ;
        radialOffsets[rIdx++] = b.x - ox; radialOffsets[rIdx++] = -(b.y - oy);
        continue;
      }

      let ax = a.x;
      let ay = a.y;
      let bx = b.x;
      let by = b.y;
      if (canCapCeiling) {
        [ax, ay] = clampCeilingVertex(ox, oy, a.x, a.y, canCapCeiling);
        [bx, by] = clampCeilingVertex(ox, oy, b.x, b.y, canCapCeiling);
      }

      // Downward-facing ceiling cap triangle: center -> b -> a
      positions[pIdx++] = ox;
      positions[pIdx++] = threeOy;
      positions[pIdx++] = ceilingCapZ;
      radialOffsets[rIdx++] = 0;
      radialOffsets[rIdx++] = 0;

      positions[pIdx++] = bx;
      positions[pIdx++] = -by;
      positions[pIdx++] = ceilingCapZ;
      radialOffsets[rIdx++] = bx - ox;
      radialOffsets[rIdx++] = -(by - oy);

      positions[pIdx++] = ax;
      positions[pIdx++] = -ay;
      positions[pIdx++] = ceilingCapZ;
      radialOffsets[rIdx++] = ax - ox;
      radialOffsets[rIdx++] = -(ay - oy);
    }
  }

  if (curtainOpts && curtainEdges > 0) {
    const push = curtainOpts.pushInwardPx ?? 0;
    for (let i = 0; i < triCount; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      if (!isContinuousCurtainEdge(a, b)) continue;

      const ch = a.hitKind === 'DOOR' ? curtainOpts.doorHeight : curtainOpts.wallHeight;
      if (ch <= 0) continue;

      let nx = 0;
      let ny = 0;
      if (push !== 0) {
        const sx = b.x - a.x;
        const sy = b.y - a.y;
        const len = Math.hypot(sx, sy);
        if (len > 1e-4) {
          nx = -sy / len;
          ny = sx / len;
          const dot = nx * (ox - a.x) + ny * (oy - a.y);
          if (dot < 0) {
            nx = -nx;
            ny = -ny;
          }
          nx *= push;
          ny *= push;
        }
      }

      const ax = a.x + nx;
      const ay = -(a.y + ny);
      const bx = b.x + nx;
      const by = -(b.y + ny);
      const rAx = a.x - ox;
      const rAy = -(a.y - oy);
      const rBx = b.x - ox;
      const rBy = -(b.y - oy);

      // Tri 1: (a, 0) -> (b, 0) -> (b, ch)
      positions[pIdx++] = ax; positions[pIdx++] = ay; positions[pIdx++] = floorZ;
      radialOffsets[rIdx++] = rAx; radialOffsets[rIdx++] = rAy;

      positions[pIdx++] = bx; positions[pIdx++] = by; positions[pIdx++] = floorZ;
      radialOffsets[rIdx++] = rBx; radialOffsets[rIdx++] = rBy;

      positions[pIdx++] = bx; positions[pIdx++] = by; positions[pIdx++] = ch;
      radialOffsets[rIdx++] = rBx; radialOffsets[rIdx++] = rBy;

      // Tri 2: (a, 0) -> (b, ch) -> (a, ch)
      positions[pIdx++] = ax; positions[pIdx++] = ay; positions[pIdx++] = floorZ;
      radialOffsets[rIdx++] = rAx; radialOffsets[rIdx++] = rAy;

      positions[pIdx++] = bx; positions[pIdx++] = by; positions[pIdx++] = ch;
      radialOffsets[rIdx++] = rBx; radialOffsets[rIdx++] = rBy;

      positions[pIdx++] = ax; positions[pIdx++] = ay; positions[pIdx++] = ch;
      radialOffsets[rIdx++] = rAx; radialOffsets[rIdx++] = rAy;
    }
  }

  return {
    positions,
    radialOffsets,
    vertexCount,
    version: (prev?.version ?? 0) + 1,
  };
}

interface CachedLightEntry {
  x: number;
  y: number;
  range: number;
  rayCount: number;
  ceilingCapZ?: number;
  curtainCeilingCapZ?: number;
  nearbyDoors: Door[];
  doorHash1: number;
  doorHash2: number;
  poly: VisibilityVertex[];
  fan: FanMeshData;
  curtainFan?: FanMeshData;
  warmFan?: FanMeshData;
  warmCurtainFan?: FanMeshData;
}

/**
 * Caches static 360-degree overhead room/corridor light visibility polygons and GPU triangle-fan
 * buffers, recomputing ONLY when a door within range + margin opens, closes, or breaks.
 * Eliminates Master Fuse deck lag when ~25-35 corridor fixtures are illuminated simultaneously.
 */
export class LightPolygonCache {
  private mapRef: ShipMap | null = null;
  private entries = new Map<string, CachedLightEntry>();

  public clear(): void {
    this.entries.clear();
  }

  private collectNearbyDoors(map: ShipMap, x: number, y: number, padRange: number): Door[] {
    const ts = map.tileSize;
    const nearby: Door[] = [];
    const doors = map.doors;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      const dx = (d.tx + 0.5) * ts - x;
      const dy = (d.ty + 0.5) * ts - y;
      if (dx < -padRange || dx > padRange || dy < -padRange || dy > padRange) continue;
      nearby.push(d);
    }
    return nearby;
  }

  private hashDoors(nearbyDoors: Door[]): [number, number] {
    let h1 = 2166136261;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < nearbyDoors.length; i++) {
      const d = nearbyDoors[i];
      const stateCode = d.isBroken ? 2 : d.openProgress > 0.35 ? 1 : 0;
      const token = ((i + 1) << 2) | stateCode;
      h1 ^= token;
      h1 = Math.imul(h1, 16777619);
      h2 ^= token + i * 31;
      h2 = Math.imul(h2, 2246822519);
    }
    return [h1, h2];
  }

  public getOrCompute(
    key: string,
    map: ShipMap,
    doorsByTile: Map<number, Door>,
    x: number,
    y: number,
    range: number,
    rayCount: number,
    curtainOpts?: FanCurtainOptions,
    warmCurtainOpts?: FanCurtainOptions,
    curtainCeilingCapZ?: number
  ): CachedLightEntry {
    if (this.mapRef !== map) {
      this.mapRef = map;
      this.entries.clear();
    }

    const wantFloorCeilingCap = curtainOpts?.ceilingCapZ;
    const wantCurtainCeilingCap = curtainCeilingCapZ ?? curtainOpts?.ceilingCapZ;

    const existing = this.entries.get(key);
    const sameParams =
      existing !== undefined &&
      existing.x === x &&
      existing.y === y &&
      existing.range === range &&
      existing.rayCount === rayCount &&
      existing.ceilingCapZ === wantFloorCeilingCap;

    const nearbyDoors = sameParams
      ? existing.nearbyDoors
      : this.collectNearbyDoors(map, x, y, range + map.tileSize * 2.5);

    const [h1, h2] = this.hashDoors(nearbyDoors);

    if (sameParams && existing.doorHash1 === h1 && existing.doorHash2 === h2) {
      const curtainMismatch = existing.curtainCeilingCapZ !== wantCurtainCeilingCap;
      if (curtainOpts && (!existing.curtainFan || curtainMismatch)) {
        existing.curtainFan = buildVisibilityFanBuffers(
          x,
          y,
          existing.poly,
          true,
          existing.curtainFan,
          { ...curtainOpts, curtainOnly: true, ceilingCapZ: wantCurtainCeilingCap }
        );
      }
      if (warmCurtainOpts && !existing.warmFan) {
        existing.warmFan = buildVisibilityFanBuffers(
          x,
          y,
          existing.poly,
          true,
          existing.warmFan,
          warmCurtainOpts
        );
      }
      if (warmCurtainOpts && (!existing.warmCurtainFan || curtainMismatch)) {
        existing.warmCurtainFan = buildVisibilityFanBuffers(
          x,
          y,
          existing.poly,
          true,
          existing.warmCurtainFan,
          {
            ...warmCurtainOpts,
            curtainOnly: true,
            ceilingCapZ: curtainCeilingCapZ ?? warmCurtainOpts.ceilingCapZ,
          }
        );
      }
      existing.curtainCeilingCapZ = wantCurtainCeilingCap;
      return existing;
    }

    const poly = computeVisibilityPolygon(map, doorsByTile, x, y, 0, Math.PI * 2, range, rayCount);
    const fan = buildVisibilityFanBuffers(x, y, poly, true, existing?.fan, curtainOpts);
    const curtainFan = curtainOpts
      ? buildVisibilityFanBuffers(
          x,
          y,
          poly,
          true,
          existing?.curtainFan,
          { ...curtainOpts, curtainOnly: true, ceilingCapZ: wantCurtainCeilingCap }
        )
      : undefined;
    const warmFan = warmCurtainOpts
      ? buildVisibilityFanBuffers(x, y, poly, true, existing?.warmFan, warmCurtainOpts)
      : undefined;
    const warmCurtainFan = warmCurtainOpts
      ? buildVisibilityFanBuffers(
          x,
          y,
          poly,
          true,
          existing?.warmCurtainFan,
          {
            ...warmCurtainOpts,
            curtainOnly: true,
            ceilingCapZ: curtainCeilingCapZ ?? warmCurtainOpts.ceilingCapZ,
          }
        )
      : undefined;
    const next: CachedLightEntry = {
      x,
      y,
      range,
      rayCount,
      ceilingCapZ: wantFloorCeilingCap,
      curtainCeilingCapZ: wantCurtainCeilingCap,
      nearbyDoors,
      doorHash1: h1,
      doorHash2: h2,
      poly,
      fan,
      curtainFan,
      warmFan,
      warmCurtainFan,
    };
    this.entries.set(key, next);
    return next;
  }
}

