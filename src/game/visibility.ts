import { isTileWalkable } from './mapGen';
import {
  BruteState,
  BruteTuningNumbers,
  DifficultyConfig,
  Door,
  PlayerState,
  ShipMap,
} from './types';

export interface OccluderSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'WALL' | 'DOOR';
}

const staticWallSegmentsCache = new WeakMap<ShipMap, OccluderSegment[]>();

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

  staticWallSegmentsCache.set(map, segments);
  return segments;
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
  const allWalls = getStaticWallSegments(map);
  const result: OccluderSegment[] = [];

  for (let i = 0; i < allWalls.length; i++) {
    const s = allWalls[i];
    const sMinX = s.x1 < s.x2 ? s.x1 : s.x2;
    const sMaxX = s.x1 > s.x2 ? s.x1 : s.x2;
    const sMinY = s.y1 < s.y2 ? s.y1 : s.y2;
    const sMaxY = s.y1 > s.y2 ? s.y1 : s.y2;
    if (sMaxX < minX || sMinX > maxX || sMaxY < minY || sMinY > maxY) continue;
    result.push(s);
  }

  const ts = map.tileSize;
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
        });
      } else {
        const cx = (tx + 0.5) * ts;
        result.push({
          x1: cx,
          y1: ty * ts,
          x2: cx,
          y2: (ty + 1) * ts,
          kind: 'DOOR',
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
): Array<{ x: number; y: number }> {
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

  const pts: Array<{ x: number; y: number }> = [];
  let lastDelta = -1;

  for (let i = 0; i < deltas.length; i++) {
    const d = deltas[i];
    if (lastDelta >= 0 && d - lastDelta < 1e-5) continue;
    lastDelta = d;

    const a = startAngle + d;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let bestT = maxDist;

    for (let j = 0; j < segments.length; j++) {
      const t = intersectRaySegment(x, y, dx, dy, bestT, segments[j]);
      if (t !== null && t < bestT) {
        bestT = t;
      }
    }

    pts.push({
      x: x + dx * bestT,
      y: y + dy * bestT,
    });
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
        sightMult: 0.82,
        halfFovDeg: 66,
        peripheralBase: 76,
        peripheralCrouch: 50,
        hearingMult: 0.8,
      };
    case 'EXTREME':
      return {
        sightMult: 1.42,
        halfFovDeg: 100,
        peripheralBase: 140,
        peripheralCrouch: 94,
        hearingMult: 1.52,
      };
    case 'HIGH':
      return {
        sightMult: 1.18,
        halfFovDeg: 84,
        peripheralBase: 112,
        peripheralCrouch: 74,
        hearingMult: 1.25,
      };
    default:
      return {
        sightMult: 1.0,
        halfFovDeg: 76,
        peripheralBase: 95,
        peripheralCrouch: 62,
        hearingMult: 1.0,
      };
  }
}

export function canBruteSeePlayer(
  brute: BruteState,
  player: PlayerState,
  map: ShipMap,
  doorsByTile: Map<number, Door>,
  difficulty: DifficultyConfig,
  tuning?: BruteTuningNumbers
): boolean {
  if (brute.state === 'STUNNED') return false;
  if (player.hidingSpotId !== null) return false;

  const dx = player.x - brute.x;
  const dy = player.y - brute.y;
  const dist = Math.hypot(dx, dy);

  const pTx = Math.max(0, Math.min(map.width - 1, Math.floor(player.x / map.tileSize)));
  const pTy = Math.max(0, Math.min(map.height - 1, Math.floor(player.y / map.tileSize)));
  const playerRoom = map.roomGrid[pTy][pTx];
  const playerInLitRoom = map.lightSwitches.some((sw) => sw.room === playerRoom && sw.isOn);

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
