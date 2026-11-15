import { isTileWalkable } from './mapGen';
import { Door, RoomName, ShipArchetype, ShipMap } from './types';

export interface StrayDoorIssue {
  doorId: string;
  tx: number;
  ty: number;
  orientation: 'H' | 'V';
  room: RoomName;
  reason: string;
}

export interface TileCoordIssue {
  tx: number;
  ty: number;
  room: RoomName;
}

export interface ShipAuditReport {
  seed: number;
  archetype: ShipArchetype;
  totalDoors: number;
  strayDoors: StrayDoorIssue[];
  corridorStubs: TileCoordIssue[];
  roomDeadEnds: TileCoordIssue[];
  unreachableImportant: number;
  lifeboatPartsCount: number;
  heliPartsCount: number;
  roomCounts: Record<string, number>;
}

export function analyzeShipMap(map: ShipMap): ShipAuditReport {
  const { width, height, tiles, roomGrid, doors, stairwells } = map;
  const key = (tx: number, ty: number) => ty * width + tx;

  const doorSet = new Map<number, Door>();
  for (const d of doors) doorSet.set(key(d.tx, d.ty), d);

  const stairSet = new Set<number>();
  for (const s of stairwells) stairSet.add(key(s.tx, s.ty));

  const isWallOrVoid = (tx: number, ty: number): boolean => {
    if (tx < 0 || tx >= width || ty < 0 || ty >= height) return true;
    return !isTileWalkable(tiles[ty][tx]);
  };

  const strayDoors: StrayDoorIssue[] = [];
  for (const d of doors) {
    if (!isTileWalkable(tiles[d.ty]?.[d.tx] ?? 'VOID')) {
      strayDoors.push({
        doorId: d.id,
        tx: d.tx,
        ty: d.ty,
        orientation: d.orientation,
        room: roomGrid[d.ty]?.[d.tx] ?? 'Corridor',
        reason: 'door tile itself is not walkable',
      });
      continue;
    }

    if (d.orientation === 'H') {
      const leftWall = tiles[d.ty]?.[d.tx - 1] === 'WALL';
      const rightWall = tiles[d.ty]?.[d.tx + 1] === 'WALL';
      const upWalkable = isTileWalkable(tiles[d.ty - 1]?.[d.tx] ?? 'VOID');
      const downWalkable = isTileWalkable(tiles[d.ty + 1]?.[d.tx] ?? 'VOID');
      if (!leftWall || !rightWall || !upWalkable || !downWalkable) {
        strayDoors.push({
          doorId: d.id,
          tx: d.tx,
          ty: d.ty,
          orientation: d.orientation,
          room: roomGrid[d.ty]?.[d.tx] ?? 'Corridor',
          reason: `H-door invalid framing (L=${tiles[d.ty]?.[d.tx - 1]}, R=${tiles[d.ty]?.[d.tx + 1]}, U=${tiles[d.ty - 1]?.[d.tx]}, D=${tiles[d.ty + 1]?.[d.tx]})`,
        });
      }
    } else {
      const upWall = tiles[d.ty - 1]?.[d.tx] === 'WALL';
      const downWall = tiles[d.ty + 1]?.[d.tx] === 'WALL';
      const leftWalkable = isTileWalkable(tiles[d.ty]?.[d.tx - 1] ?? 'VOID');
      const rightWalkable = isTileWalkable(tiles[d.ty]?.[d.tx + 1] ?? 'VOID');
      if (!upWall || !downWall || !leftWalkable || !rightWalkable) {
        strayDoors.push({
          doorId: d.id,
          tx: d.tx,
          ty: d.ty,
          orientation: d.orientation,
          room: roomGrid[d.ty]?.[d.tx] ?? 'Corridor',
          reason: `V-door invalid framing (U=${tiles[d.ty - 1]?.[d.tx]}, D=${tiles[d.ty + 1]?.[d.tx]}, L=${tiles[d.ty]?.[d.tx - 1]}, R=${tiles[d.ty]?.[d.tx + 1]})`,
        });
      }
    }
  }

  // Detect 1-tile stubs / dead ends (interior walkable tile walled on >=3 sides, excluding functional props/stairs/doors)
  const corridorStubs: TileCoordIssue[] = [];
  const roomDeadEnds: TileCoordIssue[] = [];
  const hidingKeys = new Set(map.hidingSpots.map((h) => key(h.tx, h.ty)));
  const containerKeys = new Set(map.containers.map((c) => key(c.tx, c.ty)));

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (tiles[y][x] !== 'FLOOR') continue;
      const k = key(x, y);
      if (doorSet.has(k) || stairSet.has(k)) continue;
      let walls = 0;
      if (isWallOrVoid(x + 1, y)) walls++;
      if (isWallOrVoid(x - 1, y)) walls++;
      if (isWallOrVoid(x, y + 1)) walls++;
      if (isWallOrVoid(x, y - 1)) walls++;
      if (walls >= 3) {
        const rm = roomGrid[y][x];
        if (rm === 'Corridor') {
          corridorStubs.push({ tx: x, ty: y, room: rm });
        } else if (!hidingKeys.has(k) && !containerKeys.has(k)) {
          roomDeadEnds.push({ tx: x, ty: y, room: rm });
        }
      }
    }
  }

  // Verify BFS reachability across both decks (including cuttable locked doors)
  const pTx = Math.floor(map.playerSpawn.x / map.tileSize);
  const pTy = Math.floor(map.playerSpawn.y / map.tileSize);
  const visited = new Uint8Array(width * height);
  const q: Array<{ tx: number; ty: number }> = [{ tx: pTx, ty: pTy }];
  visited[key(pTx, pTy)] = 1;
  while (q.length > 0) {
    const cur = q.shift()!;
    const nbrs: Array<{ nx: number; ny: number }> = [
      { nx: cur.tx + 1, ny: cur.ty },
      { nx: cur.tx - 1, ny: cur.ty },
      { nx: cur.tx, ny: cur.ty + 1 },
      { nx: cur.tx, ny: cur.ty - 1 },
    ];
    if (stairSet.has(key(cur.tx, cur.ty))) {
      const st = stairwells.find((s) => s.tx === cur.tx && s.ty === cur.ty);
      const target = st ? stairwells.find((o) => o.id === st.targetStairId) : undefined;
      if (target) nbrs.push({ nx: target.tx, ny: target.ty });
    }
    for (const { nx, ny } of nbrs) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nk = key(nx, ny);
      if (visited[nk] || !isTileWalkable(tiles[ny][nx])) continue;
      visited[nk] = 1;
      q.push({ tx: nx, ty: ny });
    }
  }

  let unreachableImportant = 0;
  for (const c of map.containers) {
    if (!visited[key(c.tx, c.ty)]) unreachableImportant++;
  }
  for (const h of map.hidingSpots) {
    if (!visited[key(h.tx, h.ty)]) unreachableImportant++;
  }
  if (!visited[key(map.lifeboatPos.tx, map.lifeboatPos.ty)]) unreachableImportant++;
  if (!visited[key(map.heliPos.tx, map.heliPos.ty)]) unreachableImportant++;

  let lifeboatPartsCount = 0;
  let heliPartsCount = 0;
  for (const c of map.containers) {
    if (c.item === 'WINCH_CRANK' || c.item === 'MARINE_BATTERY' || c.item === 'HULL_PATCH') {
      lifeboatPartsCount++;
    } else if (c.item === 'AVIATION_FUEL' || c.item === 'IGNITION_KEY' || c.item === 'ROTOR_FUSE') {
      heliPartsCount++;
    }
  }

  const roomCounts: Record<string, number> = {};
  for (const r of map.rooms) {
    roomCounts[r.name] = (roomCounts[r.name] ?? 0) + 1;
  }

  return {
    seed: map.seed,
    archetype: map.archetype,
    totalDoors: doors.length,
    strayDoors,
    corridorStubs,
    roomDeadEnds,
    unreachableImportant,
    lifeboatPartsCount,
    heliPartsCount,
    roomCounts,
  };
}

export function renderShipAscii(map: ShipMap, audit: ShipAuditReport): string {
  const straySet = new Set(audit.strayDoors.map((d) => d.ty * map.width + d.tx));
  const doorSet = new Map<number, Door>();
  for (const d of map.doors) doorSet.set(d.ty * map.width + d.tx, d);
  const stairSet = new Set(map.stairwells.map((s) => s.ty * map.width + s.tx));
  const hideSet = new Set(map.hidingSpots.map((h) => h.ty * map.width + h.tx));
  const stubSet = new Set(audit.corridorStubs.map((c) => c.ty * map.width + c.tx));
  const pTx = Math.floor(map.playerSpawn.x / map.tileSize);
  const pTy = Math.floor(map.playerSpawn.y / map.tileSize);
  const bTx = Math.floor(map.bruteSpawn.x / map.tileSize);
  const bTy = Math.floor(map.bruteSpawn.y / map.tileSize);

  const lines: string[] = [];
  for (let y = 0; y < map.height; y++) {
    let row = `${String(y).padStart(2, '0')} `;
    for (let x = 0; x < map.width; x++) {
      const k = y * map.width + x;
      const t = map.tiles[y][x];
      if (x === pTx && y === pTy) {
        row += 'P';
      } else if (x === bTx && y === bTy) {
        row += 'B';
      } else if (straySet.has(k)) {
        row += '!';
      } else if (doorSet.has(k)) {
        const d = doorSet.get(k)!;
        row += d.isLocked ? 'X' : d.orientation === 'H' ? '-' : '|';
      } else if (stairSet.has(k)) {
        row += 'S';
      } else if (stubSet.has(k)) {
        row += '?';
      } else if (hideSet.has(k)) {
        row += 'h';
      } else if (t === 'VOID') {
        row += ' ';
      } else if (t === 'WALL') {
        row += '#';
      } else if (t === 'EXTERIOR_DECK') {
        row += ':';
      } else if (t === 'ESCAPE_HELI') {
        row += 'H';
      } else if (t === 'ESCAPE_LIFEBOAT') {
        row += 'L';
      } else {
        row += '.';
      }
    }
    lines.push(row);
  }
  return lines.join('\n');
}
