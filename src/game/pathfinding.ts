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
  const { width, height, tiles, deckGrid, stairwells, props } = map;
  const subPool = props.find((p) => p.kind === 'SUBMARINE_HULL');
  const isPassableTile = (tx: number, ty: number): boolean => {
    if (!isTileWalkable(tiles[ty][tx])) return false;
    if (
      subPool &&
      tx >= subPool.tx &&
      tx < subPool.tx + subPool.tw &&
      ty >= subPool.ty &&
      ty < subPool.ty + subPool.th
    ) {
      return false;
    }
    return true;
  };

  if (
    startTx < 0 ||
    startTx >= width ||
    startTy < 0 ||
    startTy >= height ||
    goalTx < 0 ||
    goalTx >= width ||
    goalTy < 0 ||
    goalTy >= height ||
    !isPassableTile(goalTx, goalTy)
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
  // Precompute shortest stair-to-goal cost for every stairwell on any non-goal deck (supports 1-hop and 2-hop 3-deck routing)
  const stairToGoalCost = new Map<string, number>();
  // Pass 1: direct 1-hop stairs reaching goalDeck
  for (const s of stairwells) {
    if (s.targetDeck !== goalDeck) continue;
    const target = stairById.get(s.targetStairId);
    if (!target) continue;
    stairToGoalCost.set(s.id, 3.5 + Math.hypot(goalTx - target.tx, goalTy - target.ty));
  }
  // Pass 2: 2-hop stairs (e.g. DECK_3 -> DECK_2 -> DECK_1 or DECK_1 -> DECK_2 -> DECK_3)
  for (const s of stairwells) {
    if (s.deck === goalDeck || stairToGoalCost.has(s.id)) continue;
    const midLanding = stairById.get(s.targetStairId);
    if (!midLanding) continue;
    let bestRest = Infinity;
    for (const s2 of stairwells) {
      if (s2.deck !== midLanding.deck) continue;
      const c2 = stairToGoalCost.get(s2.id);
      if (c2 === undefined) continue;
      const total = 3.5 + Math.hypot(s2.tx - midLanding.tx, s2.ty - midLanding.ty) + c2;
      if (total < bestRest) bestRest = total;
    }
    if (Number.isFinite(bestRest)) {
      stairToGoalCost.set(s.id, bestRest);
    }
  }

  const calcHeuristic = (tx: number, ty: number): number => {
    const curDeck = deckGrid[ty][tx];
    if (curDeck === goalDeck) {
      return Math.hypot(goalTx - tx, goalTy - ty);
    }
    let best = Infinity;
    for (const s of stairwells) {
      if (s.deck !== curDeck) continue;
      const rest = stairToGoalCost.get(s.id);
      if (rest === undefined) continue;
      const d = Math.hypot(s.tx - tx, s.ty - ty) + rest;
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

  const pushNode = (node: PathNode) => {
    open.push(node);
    let idx = open.length - 1;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (open[parent].f <= open[idx].f) break;
      const tmp = open[parent];
      open[parent] = open[idx];
      open[idx] = tmp;
      idx = parent;
    }
  };

  const popMinNode = (): PathNode => {
    const top = open[0];
    const last = open.pop()!;
    if (open.length > 0) {
      open[0] = last;
      let idx = 0;
      const len = open.length;
      while (true) {
        const left = idx * 2 + 1;
        const right = left + 1;
        let smallest = idx;
        if (left < len && open[left].f < open[smallest].f) smallest = left;
        if (right < len && open[right].f < open[smallest].f) smallest = right;
        if (smallest === idx) break;
        const tmp = open[idx];
        open[idx] = open[smallest];
        open[smallest] = tmp;
        idx = smallest;
      }
    }
    return top;
  };

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
    const current = popMinNode();
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
      if (!isPassableTile(nx, ny)) continue;

      // Prevent diagonal corner-cutting through walls OR closed/locked door frames
      if (dx !== 0 && dy !== 0) {
        if (!isPassableTile(nx, current.ty) || !isPassableTile(current.tx, ny)) {
          continue;
        }
        const adjDoorA = doorMap.get(current.ty * width + nx);
        const adjDoorB = doorMap.get(ny * width + current.tx);
        if (
          (adjDoorA && !adjDoorA.isOpen && !adjDoorA.isBroken) ||
          (adjDoorB && !adjDoorB.isOpen && !adjDoorB.isBroken)
        ) {
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
      } else if (!door && nKey !== goalIdx) {
        // Gentle clearance penalty so wide 16px-radius Brute hugs hall centers instead of corner edges
        let wallAdj = 0;
        if (nx > 0 && !isTileWalkable(tiles[ny][nx - 1])) wallAdj++;
        if (nx + 1 < width && !isTileWalkable(tiles[ny][nx + 1])) wallAdj++;
        if (ny > 0 && !isTileWalkable(tiles[ny - 1][nx])) wallAdj++;
        if (ny + 1 < height && !isTileWalkable(tiles[ny + 1][nx])) wallAdj++;
        if (wallAdj >= 2) moveCost += 0.22;
        else if (wallAdj === 1) moveCost += 0.08;
      }

      const tentativeG = gScore[currKey] + moveCost;
      if (tentativeG < gScore[nKey]) {
        cameFrom[nKey] = currKey;
        gScore[nKey] = tentativeG;
        pushNode({ tx: nx, ty: ny, g: tentativeG, f: tentativeG + calcHeuristic(nx, ny) });
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
            pushNode({
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
