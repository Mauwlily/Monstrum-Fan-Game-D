import { isTileWalkable } from './mapGen';
import { Door, ShipMap, Stairwell } from './types';

interface PathNode {
  tx: number;
  ty: number;
  g: number;
  f: number;
}

export function findPath(
  map: ShipMap,
  startTx: number,
  startTy: number,
  goalTx: number,
  goalTy: number,
  doors: Door[],
  canSmashLocked = false
): Array<{ tx: number; ty: number }> {
  const { width, height, tiles, deckGrid, stairwells } = map;

  if (
    startTx < 0 ||
    startTx >= width ||
    startTy < 0 ||
    startTy >= height ||
    goalTx < 0 ||
    goalTx >= width ||
    goalTy < 0 ||
    goalTy >= height ||
    !isTileWalkable(tiles[goalTy][goalTx])
  ) {
    return [];
  }

  if (startTx === goalTx && startTy === goalTy) {
    return [{ tx: goalTx, ty: goalTy }];
  }

  const doorMap = new Map<number, Door>();
  for (const d of doors) {
    doorMap.set(d.ty * width + d.tx, d);
  }

  const stairByTile = new Map<number, Stairwell>();
  const stairById = new Map<string, Stairwell>();
  for (const s of stairwells) {
    stairByTile.set(s.ty * width + s.tx, s);
    stairById.set(s.id, s);
  }

  const goalDeck = deckGrid[goalTy][goalTx];
  const calcHeuristic = (tx: number, ty: number): number => {
    if (deckGrid[ty][tx] === goalDeck) {
      return Math.hypot(goalTx - tx, goalTy - ty);
    }
    let best = Infinity;
    const curDeck = deckGrid[ty][tx];
    for (const s of stairwells) {
      if (s.deck !== curDeck) continue;
      const target = stairById.get(s.targetStairId);
      if (!target) continue;
      const d =
        Math.hypot(s.tx - tx, s.ty - ty) + 3.5 + Math.hypot(goalTx - target.tx, goalTy - target.ty);
      if (d < best) best = d;
    }
    return Number.isFinite(best) ? best : Math.hypot(goalTx - tx, goalTy - ty);
  };

  const total = width * height;
  const gScore = new Float32Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);

  const startIdx = startTy * width + startTx;
  const goalIdx = goalTy * width + goalTx;
  gScore[startIdx] = 0;

  const open: PathNode[] = [
    {
      tx: startTx,
      ty: startTy,
      g: 0,
      f: calcHeuristic(startTx, startTy),
    },
  ];

  const dirs = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [1, -1, 1.414],
    [-1, 1, 1.414],
    [-1, -1, 1.414],
  ];

  while (open.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    const currKey = current.ty * width + current.tx;

    if (currKey === goalIdx) {
      const path: Array<{ tx: number; ty: number }> = [];
      let k = goalIdx;
      while (k !== -1 && k !== startIdx) {
        path.push({ tx: k % width, ty: Math.floor(k / width) });
        k = cameFrom[k];
      }
      path.reverse();
      return path;
    }

    if (closed[currKey]) continue;
    closed[currKey] = 1;

    for (const [dx, dy, baseCost] of dirs) {
      const nx = current.tx + dx;
      const ny = current.ty + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (!isTileWalkable(tiles[ny][nx])) continue;

      // Prevent diagonal corner-cutting through walls
      if (dx !== 0 && dy !== 0) {
        if (!isTileWalkable(tiles[current.ty][nx]) || !isTileWalkable(tiles[ny][current.tx])) {
          continue;
        }
      }

      const nKey = ny * width + nx;
      if (closed[nKey]) continue;

      let moveCost = baseCost;
      const door = doorMap.get(nKey);
      if (door && !door.isOpen && !door.isBroken) {
        if (door.isLocked && !canSmashLocked) continue;
        moveCost += door.isLocked ? 6 : 2.2;
      }

      const tentativeG = gScore[currKey] + moveCost;
      if (tentativeG < gScore[nKey]) {
        cameFrom[nKey] = currKey;
        gScore[nKey] = tentativeG;
        open.push({ tx: nx, ty: ny, g: tentativeG, f: tentativeG + calcHeuristic(nx, ny) });
      }
    }

    // Cross-deck stairwell portal edge
    const stair = stairByTile.get(currKey);
    if (stair) {
      const target = stairById.get(stair.targetStairId);
      if (target) {
        const tKey = target.ty * width + target.tx;
        if (!closed[tKey] && isTileWalkable(tiles[target.ty][target.tx])) {
          const tentativeG = gScore[currKey] + 3.5;
          if (tentativeG < gScore[tKey]) {
            cameFrom[tKey] = currKey;
            gScore[tKey] = tentativeG;
            open.push({
              tx: target.tx,
              ty: target.ty,
              g: tentativeG,
              f: tentativeG + calcHeuristic(target.tx, target.ty),
            });
          }
        }
      }
    }
  }

  return [];
}

export function getAllWalkableTiles(map: ShipMap): Array<{ tx: number; ty: number }> {
  const result: Array<{ tx: number; ty: number }> = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (isTileWalkable(map.tiles[y][x])) {
        result.push({ tx: x, ty: y });
      }
    }
  }
  return result;
}
