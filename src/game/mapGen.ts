import {
  BloodStreak,
  Container,
  ContainerType,
  Door,
  FloorMaterial,
  HidingSpot,
  HidingSpotType,
  ItemId,
  PaperMapStand,
  ROOM_CATEGORIES,
  RoomBounds,
  RoomLightSwitch,
  RoomName,
  ShipArchetype,
  ShipDeck,
  ShipMap,
  ShipProp,
  ShipPropKind,
  Stairwell,
  SteamPipe,
  TileType,
} from './types';

function createRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function isTileWalkable(tile: TileType): boolean {
  return tile !== 'VOID' && tile !== 'WALL';
}

const ARCHETYPES: ShipArchetype[] = ['CONTAINER_FREIGHTER', 'BULK_CARRIER', 'ICEBREAKER'];
const CONTAINER_COLORS = ['#6b2d1b', '#1d3b5c', '#6e4e18', '#334155', '#284b3c'];

export function generateCargoShip(inputSeed?: number): ShipMap {
  const seed = inputSeed ?? Math.floor(Math.random() * 900000) + 100000;
  const rng = createRng(seed);

  // 4.5x larger vessel: 3 full decks stacked vertically
  const width = 126;
  const height = 114;
  const tileSize = 44;

  const archetype = ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)];
  const flipY = rng() > 0.5;

  const deckBounds: Record<ShipDeck, { y1: number; y2: number; centerY: number }> = {
    DECK_3: { y1: 0, y2: 37, centerY: 19 },
    DECK_2: { y1: 38, y2: 75, centerY: 57 },
    DECK_1: { y1: 76, y2: 113, centerY: 95 },
  };

  const getDeckForY = (y: number): ShipDeck =>
    y <= deckBounds.DECK_3.y2 ? 'DECK_3' : y <= deckBounds.DECK_2.y2 ? 'DECK_2' : 'DECK_1';

  const tiles: TileType[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'VOID' as TileType)
  );
  const roomGrid: RoomName[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'Corridor' as RoomName)
  );
  const roomIdGrid: number[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 0)
  );
  const deckGrid: ShipDeck[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, () => getDeckForY(y))
  );
  const floorMaterial: FloorMaterial[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'STEEL' as FloorMaterial)
  );

  // Base corridor / circulation roomIds per deck so corridor memory doesn't collide across decks
  const CORRIDOR_ID: Record<ShipDeck, number> = { DECK_3: 1, DECK_2: 2, DECK_1: 3 };
  const CATWALK_ID = 4;
  const WEATHER_ID = 5;
  let nextRoomId = 10;

  const reserved = new Set<number>();
  const protectedCorridorKeys = new Set<number>();
  const key = (tx: number, ty: number) => ty * width + tx;

  const getCirculationId = (room: RoomName, ty: number): number => {
    if (room === 'Catwalk') return CATWALK_ID;
    if (room === 'Weather Deck') return WEATHER_ID;
    return CORRIDOR_ID[getDeckForY(ty)];
  };

  const setTile = (
    tx: number,
    ty: number,
    type: TileType,
    room?: RoomName,
    mat?: FloorMaterial,
    roomId?: number
  ) => {
    if (tx < 0 || tx >= width || ty < 0 || ty >= height) return;
    tiles[ty][tx] = type;
    if (room) {
      roomGrid[ty][tx] = room;
      roomIdGrid[ty][tx] = roomId ?? getCirculationId(room, ty);
    } else if (roomId !== undefined) {
      roomIdGrid[ty][tx] = roomId;
    }
    if (mat) floorMaterial[ty][tx] = mat;
  };

  const fillRect = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    type: TileType,
    room?: RoomName,
    mat?: FloorMaterial,
    roomId?: number
  ) => {
    const ax1 = Math.min(x1, x2);
    const ax2 = Math.max(x1, x2);
    const ay1 = Math.min(y1, y2);
    const ay2 = Math.max(y1, y2);
    for (let y = ay1; y <= ay2; y++) {
      for (let x = ax1; x <= ax2; x++) {
        if (tiles[y]?.[x] === 'VOID') continue;
        setTile(x, y, type, room, mat, roomId);
      }
    }
  };

  const reserveAround = (tx: number, ty: number, radius = 1) => {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          reserved.add(key(nx, ny));
        }
      }
    }
  };

  // --- 1. Curved 3-Deck Hull Silhouettes ---
  const carveHullDeck = (
    deck: ShipDeck,
    sternX: number,
    bowX: number,
    centerY: number,
    maxHalfBeam: number,
    initialTile: TileType,
    initialRoom: RoomName,
    initialMat: FloorMaterial
  ) => {
    const boundsFn = (x: number): { top: number; bot: number } | null => {
      if (x < sternX || x > bowX) return null;
      const u = (x - sternX) / (bowX - sternX);
      let hb = maxHalfBeam;
      if (u < 0.12) {
        const s = u / 0.12;
        hb = Math.round(maxHalfBeam * (0.64 + 0.36 * Math.sin(s * Math.PI * 0.5)));
      } else if (u > 0.74) {
        const t = (u - 0.74) / 0.26;
        hb = Math.max(3, Math.round(maxHalfBeam * Math.pow(1 - t, 0.68)));
      }
      return { top: centerY - hb, bot: centerY + hb };
    };

    let prevHb: number | null = null;
    for (let x = sternX; x <= bowX; x++) {
      const b = boundsFn(x);
      if (!b) continue;
      let hb = Math.floor((b.bot - b.top) / 2);
      if (prevHb !== null && Math.abs(hb - prevHb) > 1) {
        hb = prevHb + Math.sign(hb - prevHb);
      }
      prevHb = hb;
      for (let y = centerY - hb; y <= centerY + hb; y++) {
        setTile(x, y, initialTile, initialRoom, initialMat, getCirculationId(initialRoom, y));
        deckGrid[y][x] = deck;
      }
    }
    return boundsFn;
  };

  const d3CenterY = deckBounds.DECK_3.centerY; // 19
  const d3MaxBeam = archetype === 'ICEBREAKER' ? 15 : 14;
  carveHullDeck('DECK_3', 4, 121, d3CenterY, d3MaxBeam, 'EXTERIOR_DECK', 'Weather Deck', 'WEATHER');

  const d2CenterY = deckBounds.DECK_2.centerY; // 57
  const d2MaxBeam = archetype === 'ICEBREAKER' ? 14 : 13;
  const d2Bounds = carveHullDeck('DECK_2', 7, 118, d2CenterY, d2MaxBeam, 'WALL', 'Corridor', 'STEEL');

  const d1CenterY = deckBounds.DECK_1.centerY; // 95
  const d1MaxBeam = archetype === 'ICEBREAKER' ? 13 : 12;
  carveHullDeck('DECK_1', 10, 115, d1CenterY, d1MaxBeam, 'WALL', 'Corridor', 'STEEL');

  let rooms: RoomBounds[] = [];
  const usedUniqueRooms = new Set<RoomName>();
  const doors: Door[] = [];
  const props: ShipProp[] = [];
  const stairwells: Stairwell[] = [];
  const steamPipes: SteamPipe[] = [];
  let doorSeq = 0;
  let propSeq = 0;

  const isInsideInteriorHull = (
    tx: number,
    ty: number,
    deck: ShipDeck,
    marginFromVoid = 1
  ): boolean => {
    const band = deckBounds[deck];
    if (tx < 1 || tx >= width - 1 || ty <= band.y1 || ty >= band.y2) return false;
    if (tiles[ty][tx] === 'VOID') return false;
    for (let dy = -marginFromVoid; dy <= marginFromVoid; dy++) {
      for (let dx = -marginFromVoid; dx <= marginFromVoid; dx++) {
        const ny = ty + dy;
        const nx = tx + dx;
        if (ny < band.y1 || ny > band.y2 || nx < 0 || nx >= width) return false;
        if (tiles[ny][nx] === 'VOID') return false;
      }
    }
    return true;
  };

  const addDoorway = (
    tx: number,
    ty: number,
    orientation: 'H' | 'V',
    room: RoomName,
    mat: FloorMaterial = 'STEEL',
    options?: { open?: boolean; locked?: boolean; noDoor?: boolean; roomId?: number; watertight?: boolean }
  ) => {
    if (tiles[ty]?.[tx] === 'VOID') return;
    setTile(tx, ty, 'FLOOR', room, mat, options?.roomId);
    reserveAround(tx, ty, 1);
    if (!options?.noDoor) {
      if (doors.some((d) => d.tx === tx && d.ty === ty)) return;
      const open = options?.watertight ? false : (options?.open ?? false);
      doors.push({
        id: `door_${doorSeq++}`,
        tx,
        ty,
        orientation,
        isOpen: open,
        openProgress: open ? 1 : 0,
        swingSpeed: options?.watertight ? 1.75 : 8.5,
        isBroken: false,
        isLocked: options?.locked ?? false,
        isWatertight: options?.watertight,
      });
    }
  };

  const getProtectedDoorFrameKeys = (): Set<number> => {
    const set = new Set<number>();
    for (const d of doors) {
      set.add(key(d.tx, d.ty));
      if (d.orientation === 'H') {
        set.add(key(d.tx - 1, d.ty));
        set.add(key(d.tx + 1, d.ty));
      } else {
        set.add(key(d.tx, d.ty - 1));
        set.add(key(d.tx, d.ty + 1));
      }
    }
    return set;
  };

  const addRoom = (
    name: RoomName,
    deck: ShipDeck,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    tileType: TileType,
    mat: FloorMaterial,
    existingRoomId?: number
  ): number => {
    const category = ROOM_CATEGORIES[name];
    let roomId = existingRoomId;
    if (roomId === undefined) {
      if (category === 'CIRCULATION') {
        roomId = name === 'Catwalk' ? CATWALK_ID : CORRIDOR_ID[deck];
      } else {
        if (category === 'UNIQUE') {
          if (usedUniqueRooms.has(name)) {
            const existing = rooms.find((r) => r.name === name);
            if (existing) roomId = existing.id;
          }
          usedUniqueRooms.add(name);
        }
        if (roomId === undefined) {
          roomId = nextRoomId++;
        }
      }
    }

    const actualX1 = Math.min(x1, x2);
    const actualX2 = Math.max(x1, x2);
    const actualY1 = Math.min(y1, y2);
    const actualY2 = Math.max(y1, y2);
    for (let y = actualY1; y <= actualY2; y++) {
      for (let x = actualX1; x <= actualX2; x++) {
        if (tiles[y]?.[x] === 'VOID') continue;
        setTile(x, y, tileType, name, mat, roomId);
      }
    }
    if (category !== 'CIRCULATION') {
      rooms.push({
        id: roomId,
        name,
        category,
        deck,
        x1: actualX1,
        y1: actualY1,
        x2: actualX2,
        y2: actualY2,
      });
    }
    return roomId;
  };

  const buildDeckhouseShell = (x1: number, y1: number, x2: number, y2: number, deck: ShipDeck) => {
    const cId = CORRIDOR_ID[deck];
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (tiles[y]?.[x] === 'VOID') continue;
        setTile(x, y, 'WALL', 'Corridor', 'STEEL', cId);
      }
    }
  };

  const addProp = (
    kind: ShipPropKind,
    deck: ShipDeck,
    tx: number,
    ty: number,
    tw: number,
    th: number,
    options?: {
      blocking?: boolean;
      color?: string;
      orientation?: 'H' | 'V';
      room?: RoomName;
      roomId?: number;
      force?: boolean;
      keepWalkableBorder?: boolean;
    }
  ): boolean => {
    for (let y = ty; y < ty + th; y++) {
      for (let x = tx; x < tx + tw; x++) {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        if (!options?.force && !isTileWalkable(tiles[y][x])) return false;
        if (!options?.force && reserved.has(key(x, y))) return false;
        if (options?.keepWalkableBorder && options.blocking) {
          // Avoid blocking any tile that has a door within 1 tile
          for (const d of doors) {
            if (Math.abs(d.tx - x) <= 1 && Math.abs(d.ty - y) <= 1) return false;
          }
        }
      }
    }
    for (let y = ty; y < ty + th; y++) {
      for (let x = tx; x < tx + tw; x++) {
        reserved.add(key(x, y));
        if (options?.blocking) {
          setTile(
            x,
            y,
            'WALL',
            options.room ?? roomGrid[y][x],
            floorMaterial[y][x],
            options.roomId ?? roomIdGrid[y][x]
          );
        }
      }
    }
    props.push({
      id: `prop_${propSeq++}`,
      kind,
      deck,
      tx,
      ty,
      tw,
      th,
      color: options?.color,
      orientation: options?.orientation,
      blocking: options?.blocking,
    });
    return true;
  };

  // Helper: carve crisp rectilinear 1- or 2-tile wide hallway legs without overwriting named rooms (>= 10) or their 1-tile perimeter walls
  const carveCorridorTile = (tx: number, ty: number, deck: ShipDeck, protect = false) => {
    if (!isInsideInteriorHull(tx, ty, deck, 1)) return false;
    if (roomIdGrid[ty][tx] >= 10) return false;
    if (
      roomIdGrid[ty - 1]?.[tx] >= 10 ||
      roomIdGrid[ty + 1]?.[tx] >= 10 ||
      roomIdGrid[ty]?.[tx - 1] >= 10 ||
      roomIdGrid[ty]?.[tx + 1] >= 10
    ) {
      return false;
    }
    setTile(tx, ty, 'FLOOR', 'Corridor', 'STEEL', CORRIDOR_ID[deck]);
    if (protect) protectedCorridorKeys.add(key(tx, ty));
    return true;
  };

  const carveExactHallway = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    deck: ShipDeck,
    protect = false
  ) => {
    const ax1 = Math.min(x1, x2);
    const ax2 = Math.max(x1, x2);
    const ay1 = Math.min(y1, y2);
    const ay2 = Math.max(y1, y2);
    for (let y = ay1; y <= ay2; y++) {
      for (let x = ax1; x <= ax2; x++) {
        carveCorridorTile(x, y, deck, protect);
      }
    }
  };

  // Clean rectilinear L/T/Z corridor path (no jagged 1-tile steps or diagonal "fleshy" smears)
  const carveZPath = (
    xStart: number,
    yStart: number,
    xEnd: number,
    yEnd: number,
    deck: ShipDeck,
    corridorW: 1 | 2,
    maxSegLen: number,
    jitterSpan: number
  ) => {
    const band = deckBounds[deck];
    let cx = xStart;
    let cy = yStart;
    const minY = band.y1 + 4;
    const maxY = band.y2 - (corridorW === 2 ? 5 : 4);

    const stampH = (px: number, py: number) => {
      carveCorridorTile(px, py, deck);
      if (corridorW === 2) {
        if (!carveCorridorTile(px, py + 1, deck)) {
          carveCorridorTile(px, py - 1, deck);
        }
      }
    };
    const stampV = (px: number, py: number) => {
      carveCorridorTile(px, py, deck);
      if (corridorW === 2) {
        if (!carveCorridorTile(px + 1, py, deck)) {
          carveCorridorTile(px - 1, py, deck);
        }
      }
    };
    const stampElbow = (px: number, py: number) => {
      stampH(px, py);
      if (corridorW === 2) {
        stampV(px, py);
        carveCorridorTile(px + 1, py + 1, deck);
      }
    };

    stampElbow(cx, cy);
    let safety = 0;
    let lastJogDir = rng() > 0.5 ? 1 : -1;
    const minLeg = corridorW === 2 ? 5 : 4;
    const minZig = corridorW === 2 ? 4 : 3;

    while ((cx !== xEnd || cy !== yEnd) && safety++ < 220) {
      const dxRem = xEnd - cx;
      if (Math.abs(dxRem) > 0) {
        const stepDir = Math.sign(dxRem);
        const segLen =
          Math.abs(dxRem) <= maxSegLen
            ? Math.abs(dxRem)
            : randInt(rng, Math.min(Math.abs(dxRem), minLeg), Math.min(Math.abs(dxRem), maxSegLen));
        for (let i = 0; i < segLen; i++) {
          const nx = cx + stepDir;
          if (isInsideInteriorHull(nx, cy, deck, 1) && roomIdGrid[cy][nx] < 10) {
            cx = nx;
            stampH(cx, cy);
          } else {
            break;
          }
        }
      }

      let targetJogY = yEnd;
      if (Math.abs(xEnd - cx) >= minLeg) {
        const mag = randInt(rng, minZig, Math.max(minZig, jitterSpan));
        lastJogDir = cy >= maxY - 2 ? -1 : cy <= minY + 2 ? 1 : -lastJogDir;
        const biasToEnd = Math.abs(yEnd - cy) > jitterSpan ? Math.sign(yEnd - cy) : lastJogDir;
        const chosenDir = rng() < 0.7 ? biasToEnd : lastJogDir;
        targetJogY = Math.max(minY, Math.min(maxY, cy + chosenDir * mag));
        if (Math.abs(targetJogY - cy) < minZig) {
          targetJogY = Math.max(minY, Math.min(maxY, cy - chosenDir * minZig));
        }
      }

      const dy = targetJogY - cy;
      if (dy !== 0) {
        stampElbow(cx, cy);
        const yDir = Math.sign(dy);
        const ySteps = Math.abs(dy);
        for (let j = 0; j < ySteps; j++) {
          const ny = cy + yDir;
          if (isInsideInteriorHull(cx, ny, deck, 1) && roomIdGrid[ny][cx] < 10) {
            cy = ny;
            stampV(cx, cy);
          } else {
            break;
          }
        }
        stampElbow(cx, cy);
      }

      if (cx !== xEnd && !isInsideInteriorHull(cx + Math.sign(xEnd - cx), cy, deck, 1)) {
        break;
      }
      if (cx !== xEnd && roomIdGrid[cy][cx + Math.sign(xEnd - cx)] >= 10) {
        const escapeDir = cy <= deckBounds[deck].centerY ? -1 : 1;
        let steppedAround = false;
        for (const tryDir of [escapeDir, -escapeDir]) {
          for (let s = 1; s <= 8; s++) {
            const tyTry = cy + tryDir * s;
            if (!isInsideInteriorHull(cx, tyTry, deck, 1)) break;
            if (roomIdGrid[tyTry][cx] >= 10) break;
            stampV(cx, tyTry);
            if (
              isInsideInteriorHull(cx + Math.sign(xEnd - cx), tyTry, deck, 1) &&
              roomIdGrid[tyTry][cx + Math.sign(xEnd - cx)] < 10
            ) {
              cy = tyTry;
              stampElbow(cx, cy);
              steppedAround = true;
              break;
            }
          }
          if (steppedAround) break;
        }
        if (!steppedAround) break;
      }
    }
  };

  // Eliminates fused "fleshy" corridor blobs while keeping all L, T, and 4-way connections intact
  const cleanFleshyCorridors = (deck: ShipDeck, strictOneWide: boolean, avoidNew3x3Walls = false) => {
    const band = deckBounds[deck];
    const doorProtected = new Set<number>();
    for (const d of doors) {
      doorProtected.add(key(d.tx, d.ty));
      if (d.orientation === 'H') {
        doorProtected.add(key(d.tx, d.ty - 1));
        doorProtected.add(key(d.tx, d.ty + 1));
      } else {
        doorProtected.add(key(d.tx - 1, d.ty));
        doorProtected.add(key(d.tx + 1, d.ty));
      }
    }
    const stairSetNow = new Set(stairwells.map((s) => key(s.tx, s.ty)));

    const isCorridorFloor = (tx: number, ty: number) =>
      tx >= 0 &&
      tx < width &&
      ty >= band.y1 &&
      ty <= band.y2 &&
      tiles[ty][tx] === 'FLOOR' &&
      roomGrid[ty][tx] === 'Corridor' &&
      roomIdGrid[ty][tx] < 10;

    const wouldCreate3x3Wall = (rx: number, ry: number): boolean => {
      for (let oy = ry - 2; oy <= ry; oy++) {
        for (let ox = rx - 2; ox <= rx; ox++) {
          let allWall = true;
          let touchesVoid = false;
          for (let dy = 0; dy < 3 && allWall; dy++) {
            for (let dx = 0; dx < 3; dx++) {
              const tx = ox + dx;
              const ty = oy + dy;
              if (tx === rx && ty === ry) continue;
              if (tiles[ty]?.[tx] !== 'WALL') {
                allWall = false;
                break;
              }
            }
          }
          if (!allWall) continue;
          for (let dy = -1; dy <= 3 && !touchesVoid; dy++) {
            for (let dx = -1; dx <= 3; dx++) {
              if (tiles[oy + dy]?.[ox + dx] === 'VOID') {
                touchesVoid = true;
                break;
              }
            }
          }
          if (!touchesVoid) return true;
        }
      }
      return false;
    };

    // Check if removing (rx, ry) keeps all walkable neighbors in a 7x7 window connected & avoids creating new dead-end stubs
    const canSafelyRevertCorridorTile = (rx: number, ry: number): boolean => {
      const rk = key(rx, ry);
      if ((!strictOneWide && protectedCorridorKeys.has(rk)) || doorProtected.has(rk) || stairSetNow.has(rk)) {
        return false;
      }
      if (!isCorridorFloor(rx, ry)) return false;
      if (avoidNew3x3Walls && wouldCreate3x3Wall(rx, ry)) return false;

      const adjWalkable: Array<{ tx: number; ty: number }> = [];
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = rx + dx;
        const ny = ry + dy;
        if (isTileWalkable(tiles[ny]?.[nx] ?? 'VOID')) {
          adjWalkable.push({ tx: nx, ty: ny });
          if (stairSetNow.has(key(nx, ny))) {
            let stairOtherWalk = 0;
            for (const [ox, oy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]) {
              const ax = nx + ox;
              const ay = ny + oy;
              if (ax === rx && ay === ry) continue;
              if (isTileWalkable(tiles[ay]?.[ax] ?? 'VOID')) stairOtherWalk++;
            }
            if (stairOtherWalk < 2) return false;
          }
          if (roomGrid[ny][nx] === 'Corridor') {
            if ((stairSetNow.has(key(nx, ny)) || doorProtected.has(key(nx, ny))) && strictOneWide) {
              // Keep stair/door corridor tiles with at least 1 other neighbor (or 2 for stairs) so they never dead-end
              let nWalk = 0;
              for (const [ox, oy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ]) {
                const ax = nx + ox;
                const ay = ny + oy;
                if (ax === rx && ay === ry) continue;
                if (isTileWalkable(tiles[ay]?.[ax] ?? 'VOID')) nWalk++;
              }
              const minOther = stairSetNow.has(key(nx, ny)) ? 1 : 0;
              if (nWalk <= minOther) return false;
            } else if (!strictOneWide) {
              let nWalk = 0;
              for (const [ox, oy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ]) {
                const ax = nx + ox;
                const ay = ny + oy;
                if (ax === rx && ay === ry) continue;
                if (isTileWalkable(tiles[ay]?.[ax] ?? 'VOID')) nWalk++;
              }
              if (nWalk <= 1) return false;
            }
          }
        }
      }
      if (adjWalkable.length <= 1) return true;

      const r = 4;
      const vis = new Set<number>();
      const start = adjWalkable[0];
      const q: Array<{ tx: number; ty: number }> = [start];
      vis.add(key(start.tx, start.ty));
      let head = 0;
      while (head < q.length) {
        const cur = q[head++];
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cur.tx + dx;
          const ny = cur.ty + dy;
          if (nx === rx && ny === ry) continue;
          if (Math.abs(nx - rx) > r || Math.abs(ny - ry) > r) continue;
          if (ny < band.y1 || ny > band.y2 || nx < 0 || nx >= width) continue;
          const nk = key(nx, ny);
          if (vis.has(nk) || !isTileWalkable(tiles[ny][nx])) continue;
          vis.add(nk);
          q.push({ tx: nx, ty: ny });
        }
      }
      return adjWalkable.every((a) => vis.has(key(a.tx, a.ty)));
    };

    const blockSize = strictOneWide ? 2 : 3;
    let changed = true;
    let iter = 0;
    while (changed && iter++ < 26) {
      changed = false;
      for (let y = band.y1 + 2; y <= band.y2 - blockSize - 1; y++) {
        for (let x = 9; x <= width - 9 - blockSize; x++) {
          let allCor = true;
          for (let dy = 0; dy < blockSize && allCor; dy++) {
            for (let dx = 0; dx < blockSize; dx++) {
              if (!isCorridorFloor(x + dx, y + dy)) {
                allCor = false;
                break;
              }
            }
          }
          if (!allCor) continue;

          // Try reverting a corner/edge tile in the blob to break the fleshy mass into crisp L/T/+ shapes
          const candidates =
            blockSize === 2
              ? [
                  [x, y],
                  [x + 1, y],
                  [x, y + 1],
                  [x + 1, y + 1],
                ]
              : [
                  [x + 1, y + 1],
                  [x, y],
                  [x + 2, y],
                  [x, y + 2],
                  [x + 2, y + 2],
                  [x + 1, y],
                  [x, y + 1],
                  [x + 2, y + 1],
                  [x + 1, y + 2],
                ];
          for (const [cx, cy] of candidates) {
            if (canSafelyRevertCorridorTile(cx, cy)) {
              setTile(cx, cy, 'WALL', 'Corridor', 'STEEL', CORRIDOR_ID[deck]);
              changed = true;
              if (strictOneWide) {
                // Only clean an immediate 1-tile stub directly adjacent to the reverted corner
                for (const [ox, oy] of [
                  [1, 0],
                  [-1, 0],
                  [0, 1],
                  [0, -1],
                ]) {
                  const sx = cx + ox;
                  const sy = cy + oy;
                  if (!isCorridorFloor(sx, sy)) continue;
                  const sk = key(sx, sy);
                  if (doorProtected.has(sk) || stairSetNow.has(sk)) continue;
                  let walkN = 0;
                  if (isTileWalkable(tiles[sy - 1]?.[sx] ?? 'VOID')) walkN++;
                  if (isTileWalkable(tiles[sy + 1]?.[sx] ?? 'VOID')) walkN++;
                  if (isTileWalkable(tiles[sy]?.[sx - 1] ?? 'VOID')) walkN++;
                  if (isTileWalkable(tiles[sy]?.[sx + 1] ?? 'VOID')) walkN++;
                  if (
                    walkN <= 1 &&
                    canSafelyRevertCorridorTile(sx, sy) &&
                    !(avoidNew3x3Walls && wouldCreate3x3Wall(sx, sy))
                  ) {
                    setTile(sx, sy, 'WALL', 'Corridor', 'STEEL', CORRIDOR_ID[deck]);
                  }
                }
              }
              break;
            }
          }
        }
      }
    }
  };

  // =========================================================================
  // --- 2. DECK 3 (TOP): Open Weather Deck, Stepped Superstructure & Cargo Islands ---
  // =========================================================================
  const heliRoomId = addRoom('Helideck', 'DECK_3', 5, 11, 20, 27, 'EXTERIOR_DECK', 'WEATHER');
  const heliTx = 10;
  const heliTy = 19;
  setTile(heliTx, heliTy, 'ESCAPE_HELI', 'Helideck', 'WEATHER', heliRoomId);
  reserveAround(heliTx, heliTy, 2);

  const fcRoomId = addRoom('Forecastle', 'DECK_3', 105, 11, 119, 27, 'EXTERIOR_DECK', 'WEATHER');
  addProp('CAPSTAN', 'DECK_3', 113, 19, 1, 1, { blocking: true, room: 'Forecastle', roomId: fcRoomId });

  const shiftA = randInt(rng, -2, 2);
  const shiftB = randInt(rng, -2, 2);

  let stair32AftTop = { tx: 25, ty: 19, room: 'Weather Deck' as RoomName };
  let stair32MidTop = { tx: 65, ty: 19, room: 'Container Bay' as RoomName };
  const stair32BowTop = { tx: 109, ty: 19, room: 'Forecastle' as RoomName };

  // Staggered cargo islands (non-grid varied H & V containers + asymmetric deck alleys)
  const placeCargoIslandsD3 = (
    xStart: number,
    xEnd: number,
    excludeSpots: Array<{ tx: number; ty: number }>
  ) => {
    const bayId = addRoom('Container Bay', 'DECK_3', xStart, 8, xEnd, 30, 'EXTERIOR_DECK', 'WEATHER');
    addRoom('Catwalk', 'DECK_3', xStart, 6, xEnd, 7, 'EXTERIOR_DECK', 'WEATHER');
    addRoom('Catwalk', 'DECK_3', xStart, 31, xEnd, 32, 'EXTERIOR_DECK', 'WEATHER');

    for (const ex of excludeSpots) reserveAround(ex.tx, ex.ty, 2);

    // Divide span into staggered island zones separated by offset plazas (not straight full-width corridors)
    const span = xEnd - xStart;
    const craneAX = xStart + Math.floor(span * (0.28 + rng() * 0.08));
    const craneBX = xStart + Math.floor(span * (0.66 + rng() * 0.08));
    const craneAY = flipY ? 12 : 24;
    const craneBY = flipY ? 24 : 12;

    addProp('CRANE_PEDESTAL', 'DECK_3', craneAX, craneAY, 2, 2, {
      blocking: true,
      room: 'Container Bay',
      roomId: bayId,
    });
    if (span >= 28) {
      addProp('CRANE_PEDESTAL', 'DECK_3', craneBX, craneBY, 2, 2, {
        blocking: true,
        room: 'Container Bay',
        roomId: bayId,
      });
    }

    // Reserve weaving diagonal-ish exterior walkway across the Container Bay
    let walkY = flipY ? 15 : 22;
    for (let x = xStart; x <= xEnd; x++) {
      reserved.add(key(x, walkY));
      reserved.add(key(x, walkY + 1));
      if (x % 9 === 0) {
        const target = flipY ? 22 : 15;
        const step = Math.sign(target - walkY) || (rng() > 0.5 ? 1 : -1);
        const ny = Math.max(11, Math.min(26, walkY + step * randInt(rng, 2, 4)));
        const yMin = Math.min(walkY, ny);
        const yMax = Math.max(walkY, ny);
        for (let wy = yMin; wy <= yMax + 1; wy++) {
          reserved.add(key(x, wy));
          reserved.add(key(x + 1, wy));
        }
        walkY = ny;
      }
    }

    // Place staggered container clusters mixing horizontal & vertical stacks (greedy fill with 1-tile alleys)
    const shapes: Array<{ tw: number; th: number; ori: 'H' | 'V' }> = [
      { tw: 4, th: 2, ori: 'H' },
      { tw: 3, th: 2, ori: 'H' },
      { tw: 5, th: 2, ori: 'H' },
      { tw: 2, th: 4, ori: 'V' },
      { tw: 2, th: 3, ori: 'V' },
      { tw: 2, th: 2, ori: 'H' },
    ];

    for (let attempt = 0; attempt < 240; attempt++) {
      const shape = shapes[Math.floor(rng() * shapes.length)];
      const cx = randInt(rng, xStart + 1, Math.max(xStart + 1, xEnd - shape.tw - 1));
      const cy = randInt(rng, 9, 29 - shape.th);
      // Ensure 1-tile clearance around each container island so players never get pinched in dead alcoves
      let clear = true;
      for (let py = cy - 1; py <= cy + shape.th && clear; py++) {
        for (let px = cx - 1; px <= cx + shape.tw; px++) {
          if (reserved.has(key(px, py)) || !isTileWalkable(tiles[py]?.[px] ?? 'VOID')) {
            if (px >= cx && px < cx + shape.tw && py >= cy && py < cy + shape.th) {
              clear = false;
              break;
            }
            // Don't touch another blocking prop corner-to-corner tightly
            if (tiles[py]?.[px] === 'WALL') {
              clear = false;
              break;
            }
          }
        }
      }
      if (!clear) continue;
      const color = CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)];
      addProp('SHIPPING_CONTAINER', 'DECK_3', cx, cy, shape.tw, shape.th, {
        blocking: true,
        color,
        orientation: shape.ori,
        room: 'Container Bay',
        roomId: bayId,
      });
    }
  };

  // Compact secondary Deck 3 exterior deckhouse annex (1-tile bulkhead walls strictly separating rooms and central corridor)
  const buildDeck3Annex = (ax1: number, ay1: number, ax2: number, ay2: number) => {
    buildDeckhouseShell(ax1, ay1, ax2, ay2, 'DECK_3');
    const midX = Math.floor((ax1 + ax2) / 2);
    const corY = ay1 + 4;
    const topSepY = ay1 + 3;
    const botSepY = ay1 + 5;

    // Clean central corridor spanning East-West through the annex
    fillRect(ax1 + 1, corY, ax2 - 1, corY, 'FLOOR', 'Corridor', 'STEEL');
    addDoorway(ax1, corY, 'V', 'Corridor', 'STEEL', { open: false });
    addDoorway(ax2, corY, 'V', 'Corridor', 'STEEL', { open: rng() > 0.5 });

    const r1Id = addRoom('Maintenance Bay', 'DECK_3', ax1 + 1, ay1 + 1, midX - 1, topSepY - 1, 'FLOOR', 'STEEL');
    addDoorway(ax1 + 2, topSepY, 'H', 'Maintenance Bay', 'STEEL', { open: true, roomId: r1Id });
    addProp('WORKBENCH', 'DECK_3', ax1 + 2, ay1 + 1, 2, 1, { blocking: true, room: 'Maintenance Bay', roomId: r1Id });

    const r2Id = addRoom('Storage Room', 'DECK_3', midX + 1, ay1 + 1, ax2 - 1, topSepY - 1, 'FLOOR', 'CARGO');
    addDoorway(ax2 - 2, topSepY, 'H', 'Storage Room', 'CARGO', { open: false, roomId: r2Id });

    const r3Id = addRoom('Electrical Room', 'DECK_3', ax1 + 1, botSepY + 1, ax2 - 1, ay2 - 1, 'FLOOR', 'GRATING');
    addDoorway(ax1 + 3, botSepY, 'H', 'Electrical Room', 'GRATING', { open: false, roomId: r3Id });
    addDoorway(ax2 - 3, botSepY, 'H', 'Electrical Room', 'GRATING', { open: rng() > 0.5, roomId: r3Id });
    addProp('SWITCHGEAR', 'DECK_3', ax2 - 3, ay2 - 2, 2, 1, { blocking: true, room: 'Electrical Room', roomId: r3Id });

    for (let y = ay1 - 1; y <= ay2 + 1; y++) {
      for (let x = ax1 - 1; x <= ax2 + 1; x++) {
        reserved.add(key(x, y));
      }
    }
  };

  // Stepped Deck 3 Superstructure (offset wings & jogged interior hallway, zero grid, crisp 1-tile walls)
  const buildSteppedSuperstructure = (dhX1: number, dhX2: number) => {
    const northHeavy = flipY;
    const topY = northHeavy ? 8 : 10;
    const botY = northHeavy ? 28 : 30;
    const upperX1 = dhX1 + 3;
    const upperX2 = dhX2 - 2;

    // Stepped twin footprint: narrower Bridge/Command tier + offset Accommodations tier
    const lowerTopY = northHeavy ? 17 : 18;
    buildDeckhouseShell(upperX1, topY, upperX2, lowerTopY + 1, 'DECK_3');
    buildDeckhouseShell(dhX1, lowerTopY, dhX2, botY, 'DECK_3');
    addRoom('Catwalk', 'DECK_3', dhX1, 6, dhX2, 7, 'EXTERIOR_DECK', 'WEATHER');
    addRoom('Catwalk', 'DECK_3', dhX1, 31, dhX2, 32, 'EXTERIOR_DECK', 'WEATHER');

    // Jogged Z-bend interior hallway (never a full-width straight cross)
    const jogX = Math.floor((dhX1 + dhX2) / 2) + randInt(rng, -1, 1);
    const leftCorY = northHeavy ? 17 : 20;
    const rightCorY = northHeavy ? 21 : 19;
    fillRect(dhX1 + 1, leftCorY, jogX + 1, leftCorY + 1, 'FLOOR', 'Corridor', 'STEEL');
    fillRect(
      jogX,
      Math.min(leftCorY, rightCorY),
      jogX + 1,
      Math.max(leftCorY, rightCorY) + 1,
      'FLOOR',
      'Corridor',
      'STEEL'
    );
    fillRect(jogX, rightCorY, dhX2 - 1, rightCorY + 1, 'FLOOR', 'Corridor', 'STEEL');

    // Exterior doors on stepped faces
    addDoorway(dhX1, leftCorY, 'V', 'Corridor', 'STEEL', { open: false });
    addDoorway(dhX2, rightCorY, 'V', 'Corridor', 'STEEL', { open: true });
    addDoorway(jogX, topY, 'H', 'Corridor', 'STEEL', { open: false });
    addDoorway(jogX + 1, botY, 'H', 'Corridor', 'STEEL', { open: rng() > 0.4 });
    // Connect vertical 2-wide N-S spine cleanly from topY+1 to botY-1 with 1-tile walls flanking both sides
    fillRect(jogX, topY + 1, jogX + 1, botY - 1, 'FLOOR', 'Corridor', 'STEEL');

    // Upper stepped wing compartments: Chart Room & Bridge with crisp 1-tile walls at jogX-1 and jogX+2
    const upperBotY = northHeavy ? 15 : 17;
    const chId = addRoom('Chart Room', 'DECK_3', upperX1 + 1, topY + 1, jogX - 2, upperBotY, 'FLOOR', 'CABIN');
    addDoorway(jogX - 1, topY + 3, 'V', 'Chart Room', 'CABIN', { open: true, roomId: chId });
    addDoorway(upperX1 + 3, upperBotY + 1, 'H', 'Chart Room', 'CABIN', { open: false, roomId: chId });
    addProp('CHART_TABLE', 'DECK_3', upperX1 + 2, topY + 2, 2, 1, { blocking: true, room: 'Chart Room', roomId: chId });

    const brId = addRoom('Bridge', 'DECK_3', jogX + 3, topY + 1, upperX2 - 1, upperBotY, 'FLOOR', 'BRIDGE');
    addDoorway(jogX + 2, topY + 3, 'V', 'Bridge', 'BRIDGE', { open: false, roomId: brId });
    addDoorway(upperX2 - 3, upperBotY + 1, 'H', 'Bridge', 'BRIDGE', { open: rng() > 0.5, roomId: brId });
    addProp('HELM_CONSOLE', 'DECK_3', upperX2 - 2, topY + 2, 1, 3, { blocking: true, room: 'Bridge', roomId: brId });

    // Compact wing room tucked cleanly behind 1-tile walls (never piercing exterior deckhouse wall)
    if (northHeavy) {
      const wingId = addRoom('Electrical Room', 'DECK_3', jogX + 3, 18, dhX2 - 1, 19, 'FLOOR', 'GRATING');
      addDoorway(jogX + 5, 20, 'H', 'Electrical Room', 'GRATING', { open: false, roomId: wingId });
      addDoorway(jogX + 2, 18, 'V', 'Electrical Room', 'GRATING', { open: true, roomId: wingId });
    } else {
      const wingId = addRoom('Electrical Room', 'DECK_3', jogX + 3, 22, dhX2 - 1, 23, 'FLOOR', 'GRATING');
      addDoorway(jogX + 5, 21, 'H', 'Electrical Room', 'GRATING', { open: false, roomId: wingId });
      addDoorway(jogX + 2, 22, 'V', 'Electrical Room', 'GRATING', { open: true, roomId: wingId });
    }

    // Lower stepped wing compartments: Radio Room, Captain's Quarters, Officers Mess, Workshop
    const leftLowerY1 = leftCorY + 3;
    const rightLowerY1 = northHeavy ? rightCorY + 3 : 25;
    const aftMidX = Math.floor((dhX1 + (jogX - 1)) / 2);
    const radId = addRoom('Radio Room', 'DECK_3', dhX1 + 1, leftLowerY1, aftMidX - 1, botY - 1, 'FLOOR', 'BRIDGE');
    addDoorway(dhX1 + 3, leftLowerY1 - 1, 'H', 'Radio Room', 'BRIDGE', { open: false, roomId: radId });
    addProp('SWITCHGEAR', 'DECK_3', dhX1 + 2, botY - 2, 2, 1, { blocking: true, room: 'Radio Room', roomId: radId });

    const capId = addRoom("Captain's Quarters", 'DECK_3', aftMidX + 1, leftLowerY1, jogX - 2, botY - 1, 'FLOOR', 'CABIN');
    addDoorway(aftMidX + 2, leftLowerY1 - 1, 'H', "Captain's Quarters", 'CABIN', { open: false, roomId: capId });
    addDoorway(jogX - 1, botY - 3, 'V', "Captain's Quarters", 'CABIN', { locked: true, roomId: capId });
    addProp('BUNK', 'DECK_3', aftMidX + 2, botY - 2, 2, 1, { blocking: true, room: "Captain's Quarters", roomId: capId });

    const fwdMidX = Math.floor((jogX + 3 + dhX2) / 2);
    const offId = addRoom('Officers Mess', 'DECK_3', jogX + 3, rightLowerY1, fwdMidX - 1, botY - 1, 'FLOOR', 'CABIN');
    addDoorway(jogX + 2, botY - 3, 'V', 'Officers Mess', 'CABIN', { open: true, roomId: offId });
    addProp('MESS_TABLE', 'DECK_3', jogX + 3, botY - 2, 2, 1, { blocking: true, room: 'Officers Mess', roomId: offId });

    const wsId = addRoom('Workshop', 'DECK_3', fwdMidX + 1, rightLowerY1, dhX2 - 1, botY - 1, 'FLOOR', 'STEEL');
    addDoorway(fwdMidX + 2, rightLowerY1 - 1, 'H', 'Workshop', 'STEEL', { open: false, roomId: wsId });
    addProp('WORKBENCH', 'DECK_3', dhX2 - 3, botY - 2, 2, 1, { blocking: true, room: 'Workshop', roomId: wsId });

    return { jogX, leftCorY, rightCorY };
  };

  if (archetype === 'CONTAINER_FREIGHTER') {
    const dhX1 = 22;
    const dhX2 = 46 + shiftA;
    const dh = buildSteppedSuperstructure(dhX1, dhX2);
    stair32AftTop = { tx: dh.jogX, ty: dh.leftCorY, room: 'Corridor' };
    stair32MidTop = { tx: 71 + shiftB, ty: flipY ? 22 : 16, room: 'Container Bay' };
    reserveAround(stair32AftTop.tx, stair32AftTop.ty, 1);
    reserveAround(stair32MidTop.tx, stair32MidTop.ty, 1);
    const annexX1 = 88 + randInt(rng, -2, 2);
    const annexY1 = flipY ? 9 : 21;
    for (let y = annexY1 - 1; y <= annexY1 + 9; y++) {
      for (let x = annexX1 - 1; x <= 102; x++) reserved.add(key(x, y));
    }
    placeCargoIslandsD3(dhX2 + 3, 102, [stair32MidTop]);
    buildDeck3Annex(annexX1, annexY1, 101, annexY1 + 8);
  } else if (archetype === 'BULK_CARRIER') {
    const dhX1 = 50 + shiftA;
    const dhX2 = 76 + shiftA;
    const dh = buildSteppedSuperstructure(dhX1, dhX2);
    stair32AftTop = { tx: 27, ty: flipY ? 21 : 17, room: 'Container Bay' };
    stair32MidTop = { tx: dh.jogX, ty: dh.rightCorY, room: 'Corridor' };
    reserveAround(stair32AftTop.tx, stair32AftTop.ty, 1);
    reserveAround(stair32MidTop.tx, stair32MidTop.ty, 1);
    const annexX1 = 88 + randInt(rng, -2, 2);
    const annexY1 = flipY ? 21 : 9;
    for (let y = annexY1 - 1; y <= annexY1 + 9; y++) {
      for (let x = annexX1 - 1; x <= 101; x++) reserved.add(key(x, y));
    }
    placeCargoIslandsD3(23, dhX1 - 3, [stair32AftTop]);
    placeCargoIslandsD3(dhX2 + 3, 102, []);
    buildDeck3Annex(annexX1, annexY1, 100, annexY1 + 8);
  } else {
    // ICEBREAKER: L-shaped aft deckhouse (1-tile bulkhead walls strictly preserved) + mid utility annex + forward stepped bridge
    const aftX1 = 22;
    const aftX2 = 37 + shiftA;
    buildDeckhouseShell(aftX1, 10, aftX2, 19, 'DECK_3');
    buildDeckhouseShell(aftX1 + 6, 18, aftX2, 27, 'DECK_3');
    const stId = addRoom('Storage Room', 'DECK_3', aftX1 + 1, 11, aftX1 + 6, 15, 'FLOOR', 'CARGO');
    const mbId = addRoom('Maintenance Bay', 'DECK_3', aftX1 + 8, 11, aftX2 - 1, 15, 'FLOOR', 'STEEL');
    const wkId = addRoom('Workshop', 'DECK_3', aftX1 + 7, 19, aftX2 - 1, 26, 'FLOOR', 'STEEL');
    fillRect(aftX1 + 1, 17, aftX2 - 1, 17, 'FLOOR', 'Corridor', 'STEEL');
    addDoorway(aftX1, 17, 'V', 'Corridor', 'STEEL', { open: false });
    addDoorway(aftX2, 17, 'V', 'Corridor', 'STEEL', { open: true });
    addDoorway(aftX1 + 4, 16, 'H', 'Storage Room', 'CARGO', { open: true, roomId: stId });
    addDoorway(aftX1 + 10, 16, 'H', 'Maintenance Bay', 'STEEL', { open: false, roomId: mbId });
    addDoorway(aftX1 + 10, 18, 'H', 'Workshop', 'STEEL', { open: false, roomId: wkId });
    addDoorway(aftX1 + 6, 23, 'V', 'Workshop', 'STEEL', { open: true, roomId: wkId });
    addProp('WORKBENCH', 'DECK_3', aftX2 - 3, 22, 2, 1, { blocking: true, room: 'Workshop', roomId: wkId });

    const fwdX1 = 78 + shiftB;
    const fwdX2 = 102;
    buildSteppedSuperstructure(fwdX1, fwdX2);

    stair32AftTop = { tx: aftX1 + 2, ty: 22, room: 'Weather Deck' };
    setTile(stair32AftTop.tx, stair32AftTop.ty, 'EXTERIOR_DECK', 'Weather Deck', 'WEATHER', WEATHER_ID);
    stair32MidTop = { tx: 56, ty: flipY ? 22 : 16, room: 'Container Bay' };
    const iceAnnexX1 = 44 + randInt(rng, -2, 2);
    const iceAnnexY1 = flipY ? 9 : 21;
    for (let y = iceAnnexY1 - 1; y <= iceAnnexY1 + 9; y++) {
      for (let x = iceAnnexX1 - 1; x <= iceAnnexX1 + 13; x++) reserved.add(key(x, y));
    }
    placeCargoIslandsD3(aftX2 + 3, fwdX1 - 3, [stair32MidTop]);
    buildDeck3Annex(iceAnnexX1, iceAnnexY1, iceAnnexX1 + 12, iceAnnexY1 + 8);
  }

  // Helper for packing small 4x4..6x6 rooms around staggered corridors (Deck 2 & Deck 1)
  const packCompactRooms = (
    deck: ShipDeck,
    roomSpecs: Array<{
      name: RoomName;
      mat: FloorMaterial;
      wRange: [number, number];
      hRange: [number, number];
      propKind?: ShipPropKind;
      propW?: number;
      propH?: number;
      lockedChance?: number;
    }>,
    xMin: number,
    xMax: number
  ) => {
    const band = deckBounds[deck];
    for (const spec of roomSpecs) {
      const rw = randInt(rng, spec.wRange[0], spec.wRange[1]);
      const rh = randInt(rng, spec.hRange[0], spec.hRange[1]);
      let placed = false;

      // Collect candidate anchor boxes where every tile is interior hull WALL and adjacent to >=1 Corridor tile
      const candidates: Array<{ rx: number; ry: number; doorCandidates: Array<{ dx: number; dy: number; ori: 'H' | 'V' }> }> = [];

      for (let ry = band.y1 + 2; ry <= band.y2 - rh - 1; ry++) {
        for (let rx = xMin; rx <= xMax - rw; rx++) {
          let allWall = true;
          for (let y = ry - 1; y <= ry + rh && allWall; y++) {
            for (let x = rx - 1; x <= rx + rw; x++) {
              if (!isInsideInteriorHull(x, y, deck, 0)) {
                allWall = false;
                break;
              }
              if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) {
                // Interior must be untouched WALL (not a corridor or existing room)
                if (tiles[y][x] !== 'WALL' || roomIdGrid[y][x] >= 10) {
                  allWall = false;
                  break;
                }
              } else {
                // 1-tile outer ring must remain WALL so rooms always have a 1-tile bulkhead separating
                // them cleanly from both corridors and neighboring rooms
                if (tiles[y][x] !== 'WALL') {
                  allWall = false;
                  break;
                }
              }
            }
          }
          if (!allWall) continue;

          // Find valid 1-tile bulkhead doorways touching an existing Corridor tile
          const dCands: Array<{ dx: number; dy: number; ori: 'H' | 'V' }> = [];
          for (let x = rx + 1; x < rx + rw - 1; x++) {
            if (tiles[ry - 2]?.[x] === 'FLOOR' && roomGrid[ry - 2]?.[x] === 'Corridor' && tiles[ry - 1][x] === 'WALL') {
              dCands.push({ dx: x, dy: ry - 1, ori: 'H' });
            }
            if (tiles[ry + rh + 1]?.[x] === 'FLOOR' && roomGrid[ry + rh + 1]?.[x] === 'Corridor' && tiles[ry + rh][x] === 'WALL') {
              dCands.push({ dx: x, dy: ry + rh, ori: 'H' });
            }
          }
          for (let y = ry + 1; y < ry + rh - 1; y++) {
            if (tiles[y]?.[rx - 2] === 'FLOOR' && roomGrid[y]?.[rx - 2] === 'Corridor' && tiles[y][rx - 1] === 'WALL') {
              dCands.push({ dx: rx - 1, dy: y, ori: 'V' });
            }
            if (tiles[y]?.[rx + rw + 1] === 'FLOOR' && roomGrid[y]?.[rx + rw + 1] === 'Corridor' && tiles[y][rx + rw] === 'WALL') {
              dCands.push({ dx: rx + rw, dy: y, ori: 'V' });
            }
          }
          if (dCands.length > 0) {
            candidates.push({ rx, ry, doorCandidates: dCands });
          }
        }
      }

      if (candidates.length > 0) {
        // Spread compact rooms evenly across aft/mid/forward hull instead of clustering
        const specIdx = roomSpecs.indexOf(spec);
        const zoneSpan = xMax - xMin;
        const targetZoneX = xMin + ((specIdx * 0.37) % 1) * zoneSpan;
        const scoredCandidates = candidates.map((c) => ({
          cand: c,
          score: Math.abs(c.rx - targetZoneX) + (rng() - 0.5) * 18,
        }));
        scoredCandidates.sort(
          (a, b) => a.score - b.score || a.cand.ry - b.cand.ry || a.cand.rx - b.cand.rx
        );
        const pick = scoredCandidates[Math.floor(rng() * Math.min(4, scoredCandidates.length))].cand;
        const rId = addRoom(spec.name, deck, pick.rx, pick.ry, pick.rx + rw - 1, pick.ry + rh - 1, 'FLOOR', spec.mat);
        const primaryDoor = pick.doorCandidates[Math.floor(rng() * pick.doorCandidates.length)];
        addDoorway(primaryDoor.dx, primaryDoor.dy, primaryDoor.ori, spec.name, spec.mat, {
          open: rng() > 0.72,
          roomId: rId,
        });

        // Encourage multiple entry points (2-3 doors across distinct faces)
        const otherDoors = pick.doorCandidates.filter(
          (dc) => Math.abs(dc.dx - primaryDoor.dx) + Math.abs(dc.dy - primaryDoor.dy) >= 3
        );
        if (otherDoors.length > 0 && rng() < 0.85) {
          const sec = otherDoors[Math.floor(rng() * otherDoors.length)];
          addDoorway(sec.dx, sec.dy, sec.ori, spec.name, spec.mat, {
            open: false,
            locked: rng() < (spec.lockedChance ?? 0.2),
            roomId: rId,
          });
          const thirdDoors = otherDoors.filter(
            (dc) => Math.abs(dc.dx - sec.dx) + Math.abs(dc.dy - sec.dy) >= 4
          );
          if (thirdDoors.length > 0 && rw * rh >= 20 && rng() < 0.42) {
            const thr = thirdDoors[Math.floor(rng() * thirdDoors.length)];
            addDoorway(thr.dx, thr.dy, thr.ori, spec.name, spec.mat, {
              open: rng() > 0.5,
              roomId: rId,
            });
          }
        }

        // Optional compact interior prop tucked cleanly inside away from door tile
        if (spec.propKind && spec.propW && spec.propH && rw >= spec.propW + 2 && rh >= spec.propH + 2) {
          const ptx = pick.rx + (primaryDoor.dx > pick.rx + rw / 2 ? 1 : rw - spec.propW - 1);
          const pty = pick.ry + (primaryDoor.dy > pick.ry + rh / 2 ? 1 : rh - spec.propH - 1);
          addProp(spec.propKind, deck, ptx, pty, spec.propW, spec.propH, {
            blocking: true,
            room: spec.name,
            roomId: rId,
            keepWalkableBorder: true,
          });
        }
        placed = true;
      }

      // If tight pocket didn't touch corridor directly, don't force an invalid box
      void placed;
    }
  };

  // Greedy second-pass pocket filler: fits 2x3..5x4 compact utility rooms into remaining unused wall pockets
  // (can bridge either Corridor or an adjacent unlocked FLOOR room with a bulkhead door)
  const fillGreedyPocketRooms = (
    deck: ShipDeck,
    xMin: number,
    xMax: number,
    maxExtraRooms: number,
    includeTinyClosets = false
  ) => {
    const band = deckBounds[deck];
    const pocketPool: Array<{ name: RoomName; mat: FloorMaterial }> = [
      { name: 'Storage Room', mat: 'CARGO' },
      { name: 'Maintenance Bay', mat: 'STEEL' },
      { name: 'Electrical Room', mat: 'GRATING' },
      { name: 'Crew Quarters', mat: 'CABIN' },
      { name: 'Workshop', mat: 'STEEL' },
    ];
    const sizeDims: Array<[number, number]> = [
      [5, 4],
      [4, 5],
      [5, 3],
      [3, 5],
      [4, 4],
      [4, 3],
      [3, 4],
      [3, 3],
      [3, 2],
      [2, 3],
      ...(includeTinyClosets ? ([[2, 2]] as Array<[number, number]>) : []),
    ];
    let added = 0;
    for (const [rw, rh] of sizeDims) {
      if (added >= maxExtraRooms) break;
      let foundMore = true;
      while (foundMore && added < maxExtraRooms) {
        foundMore = false;
        const cands: Array<{ rx: number; ry: number; doorCandidates: Array<{ dx: number; dy: number; ori: 'H' | 'V' }> }> = [];
        for (let ry = band.y1 + 2; ry <= band.y2 - rh - 1; ry++) {
          for (let rx = xMin; rx <= xMax - rw; rx++) {
            let ok = true;
            for (let y = ry - 1; y <= ry + rh && ok; y++) {
              for (let x = rx - 1; x <= rx + rw; x++) {
                if (!isInsideInteriorHull(x, y, deck, 0)) {
                  ok = false;
                  break;
                }
                if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) {
                  if (tiles[y][x] !== 'WALL' || roomIdGrid[y][x] >= 10) {
                    ok = false;
                    break;
                  }
                } else if (tiles[y][x] !== 'WALL') {
                  // Outer 1-tile ring must be WALL (permits wall sharing between rooms, never floor-to-floor bleeding)
                  ok = false;
                  break;
                }
              }
            }
            if (!ok) continue;

            const dCands: Array<{ dx: number; dy: number; ori: 'H' | 'V' }> = [];
            for (let x = rx + 1; x < rx + rw - 1; x++) {
              if (
                isTileWalkable(tiles[ry - 2]?.[x] ?? 'VOID') &&
                tiles[ry - 1][x] === 'WALL' &&
                tiles[ry - 1][x - 1] === 'WALL' &&
                tiles[ry - 1][x + 1] === 'WALL'
              ) {
                dCands.push({ dx: x, dy: ry - 1, ori: 'H' });
              }
              if (
                isTileWalkable(tiles[ry + rh + 1]?.[x] ?? 'VOID') &&
                tiles[ry + rh][x] === 'WALL' &&
                tiles[ry + rh][x - 1] === 'WALL' &&
                tiles[ry + rh][x + 1] === 'WALL'
              ) {
                dCands.push({ dx: x, dy: ry + rh, ori: 'H' });
              }
            }
            for (let y = ry + 1; y < ry + rh - 1; y++) {
              if (
                isTileWalkable(tiles[y]?.[rx - 2] ?? 'VOID') &&
                tiles[y][rx - 1] === 'WALL' &&
                tiles[y - 1]?.[rx - 1] === 'WALL' &&
                tiles[y + 1]?.[rx - 1] === 'WALL'
              ) {
                dCands.push({ dx: rx - 1, dy: y, ori: 'V' });
              }
              if (
                isTileWalkable(tiles[y]?.[rx + rw + 1] ?? 'VOID') &&
                tiles[y][rx + rw] === 'WALL' &&
                tiles[y - 1]?.[rx + rw] === 'WALL' &&
                tiles[y + 1]?.[rx + rw] === 'WALL'
              ) {
                dCands.push({ dx: rx + rw, dy: y, ori: 'V' });
              }
            }
            if (dCands.length > 0) {
              cands.push({ rx, ry, doorCandidates: dCands });
            }
          }
        }
        if (cands.length > 0) {
          const pick = cands[Math.floor(rng() * cands.length)];
          const spec = pocketPool[added % pocketPool.length];
          const rId = addRoom(spec.name, deck, pick.rx, pick.ry, pick.rx + rw - 1, pick.ry + rh - 1, 'FLOOR', spec.mat);
          const dc = pick.doorCandidates[Math.floor(rng() * pick.doorCandidates.length)];
          addDoorway(dc.dx, dc.dy, dc.ori, spec.name, spec.mat, { open: rng() > 0.7, roomId: rId });
          const secPool = pick.doorCandidates.filter(
            (cand) => Math.abs(cand.dx - dc.dx) + Math.abs(cand.dy - dc.dy) >= 3
          );
          if (secPool.length > 0 && rng() < 0.68) {
            const sec = secPool[Math.floor(rng() * secPool.length)];
            addDoorway(sec.dx, sec.dy, sec.ori, spec.name, spec.mat, {
              open: false,
              locked: rng() < 0.12,
              roomId: rId,
            });
          }
          added++;
          foundMore = true;
        }
      }
    }
  };

  // Post-greedy pass: converts 2-3 generic compact rooms per deck into clean rectilinear hallways
  const replaceRoomsWithHallways = (deck: ShipDeck, minReplace: number, maxReplace: number) => {
    const count = randInt(rng, minReplace, maxReplace);
    const eligible = rooms.filter((rb) => {
      if (rb.deck !== deck || rb.category !== 'GENERIC') return false;
      if (rb.name === 'Cargo Hold' || rb.name === 'Container Bay') return false;
      const rw = rb.x2 - rb.x1 + 1;
      const rh = rb.y2 - rb.y1 + 1;
      if (rw < 3 || rh < 3 || rw * rh > 32) return false;
      return true;
    });
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }

    let replaced = 0;
    for (const rb of eligible) {
      if (replaced >= count) break;
      const corridorW: 1 | 2 = deck === 'DECK_2' && rb.x2 - rb.x1 >= 3 && rb.y2 - rb.y1 >= 3 && rng() < 0.55 ? 2 : 1;

      // Collect existing doors touching this room's perimeter & adjacent exterior corridors
      const touchingDoors = doors.filter(
        (d) => d.tx >= rb.x1 - 1 && d.tx <= rb.x2 + 1 && d.ty >= rb.y1 - 1 && d.ty <= rb.y2 + 1
      );
      const entryAnchors: Array<{ tx: number; ty: number; fromOtherRoom: boolean; door?: Door }> = [];
      for (const d of touchingDoors) {
        // Check if the far side of the door is another named room (>= 10) vs Corridor
        const sides =
          d.orientation === 'H'
            ? [
                { tx: d.tx, ty: d.ty - 1 },
                { tx: d.tx, ty: d.ty + 1 },
              ]
            : [
                { tx: d.tx - 1, ty: d.ty },
                { tx: d.tx + 1, ty: d.ty },
              ];
        const farSide = sides.find((s) => roomIdGrid[s.ty]?.[s.tx] !== rb.id);
        const fromOtherRoom = Boolean(farSide && roomIdGrid[farSide.ty]?.[farSide.tx] >= 10);
        entryAnchors.push({ tx: d.tx, ty: d.ty, fromOtherRoom, door: d });
      }
      if (entryAnchors.length === 0) continue;

      // Remove any non-essential props placed inside the room
      for (let i = props.length - 1; i >= 0; i--) {
        const pr = props[i];
        if (pr.deck === deck && pr.tx >= rb.x1 && pr.tx <= rb.x2 && pr.ty >= rb.y1 && pr.ty <= rb.y2) {
          props.splice(i, 1);
        }
      }

      // Reset room interior to WALL
      for (let y = rb.y1; y <= rb.y2; y++) {
        for (let x = rb.x1; x <= rb.x2; x++) {
          setTile(x, y, 'WALL', 'Corridor', 'STEEL', CORRIDOR_ID[deck]);
        }
      }

      // Remove doors into corridors (and reset their tile ownership back to Corridor!) while keeping doors to other named rooms
      for (const ea of entryAnchors) {
        if (!ea.fromOtherRoom && ea.door) {
          const idx = doors.indexOf(ea.door);
          if (idx !== -1) doors.splice(idx, 1);
          setTile(ea.door.tx, ea.door.ty, 'WALL', 'Corridor', 'STEEL', CORRIDOR_ID[deck]);
        } else if (ea.fromOtherRoom && ea.door) {
          const sides =
            ea.door.orientation === 'H'
              ? [
                  { tx: ea.door.tx, ty: ea.door.ty - 1 },
                  { tx: ea.door.tx, ty: ea.door.ty + 1 },
                ]
              : [
                  { tx: ea.door.tx - 1, ty: ea.door.ty },
                  { tx: ea.door.tx + 1, ty: ea.door.ty },
                ];
          const otherSide = sides.find((s) => roomIdGrid[s.ty]?.[s.tx] >= 10 && roomIdGrid[s.ty]?.[s.tx] !== rb.id);
          if (otherSide) {
            setTile(
              ea.door.tx,
              ea.door.ty,
              'FLOOR',
              roomGrid[otherSide.ty][otherSide.tx],
              floorMaterial[otherSide.ty][otherSide.tx],
              roomIdGrid[otherSide.ty][otherSide.tx]
            );
          }
        }
      }

      const cx = Math.floor((rb.x1 + rb.x2) / 2);
      const cy = Math.floor((rb.y1 + rb.y2) / 2);

      // Look for an additional corridor 1 tile outside the opposite wall so the hallway becomes a true connector
      const extraOutsideTargets: Array<{ tx: number; ty: number }> = [];
      for (let x = rb.x1 + 1; x < rb.x2; x++) {
        if (tiles[rb.y1 - 2]?.[x] === 'FLOOR' && roomGrid[rb.y1 - 2]?.[x] === 'Corridor') {
          extraOutsideTargets.push({ tx: x, ty: rb.y1 - 1 });
          break;
        }
      }
      for (let x = rb.x1 + 1; x < rb.x2; x++) {
        if (tiles[rb.y2 + 2]?.[x] === 'FLOOR' && roomGrid[rb.y2 + 2]?.[x] === 'Corridor') {
          extraOutsideTargets.push({ tx: x, ty: rb.y2 + 1 });
          break;
        }
      }
      for (let y = rb.y1 + 1; y < rb.y2; y++) {
        if (tiles[y]?.[rb.x1 - 2] === 'FLOOR' && roomGrid[y]?.[rb.x1 - 2] === 'Corridor') {
          extraOutsideTargets.push({ tx: rb.x1 - 1, ty: y });
          break;
        }
      }
      for (let y = rb.y1 + 1; y < rb.y2; y++) {
        if (tiles[y]?.[rb.x2 + 2] === 'FLOOR' && roomGrid[y]?.[rb.x2 + 2] === 'Corridor') {
          extraOutsideTargets.push({ tx: rb.x2 + 1, ty: y });
          break;
        }
      }

      const connectTargets = [
        ...entryAnchors.map((a) => ({ tx: a.tx, ty: a.ty, isDoor: a.fromOtherRoom })),
        ...(extraOutsideTargets.length > 0 ? [{ ...extraOutsideTargets[0], isDoor: false }] : []),
      ];

      // Carve clean orthogonal L/T/+ hallway spine inside the former room connecting all entries without piercing neighboring room walls
      const carveCell = (px: number, py: number, allowRoomEdge = false) => {
        if (!isInsideInteriorHull(px, py, deck, 1)) return;
        if (roomIdGrid[py][px] >= 10) return;
        if (
          !allowRoomEdge &&
          (roomIdGrid[py - 1]?.[px] >= 10 ||
            roomIdGrid[py + 1]?.[px] >= 10 ||
            roomIdGrid[py]?.[px - 1] >= 10 ||
            roomIdGrid[py]?.[px + 1] >= 10)
        ) {
          return;
        }
        setTile(px, py, 'FLOOR', 'Corridor', 'STEEL', CORRIDOR_ID[deck]);
      };
      const stampCor = (px: number, py: number) => {
        carveCell(px, py);
        if (corridorW === 2) {
          if (px + 1 <= rb.x2) carveCell(px + 1, py);
          if (py + 1 <= rb.y2) carveCell(px, py + 1);
          if (px + 1 <= rb.x2 && py + 1 <= rb.y2) carveCell(px + 1, py + 1);
        }
      };

      stampCor(cx, cy);
      for (const tgt of connectTargets) {
        // Breach perimeter wall tile cleanly (only allow touching neighbor room if it has an intact door)
        carveCell(tgt.tx, tgt.ty, tgt.isDoor);
        // Step from perimeter entry inward to hub (cx, cy) orthogonally
        let wx = Math.max(rb.x1, Math.min(rb.x2, tgt.tx));
        let wy = Math.max(rb.y1, Math.min(rb.y2, tgt.ty));
        stampCor(wx, wy);
        while (wx !== cx) {
          wx += Math.sign(cx - wx);
          stampCor(wx, wy);
        }
        while (wy !== cy) {
          wy += Math.sign(cy - wy);
          stampCor(wx, wy);
        }
      }

      const rIdx = rooms.indexOf(rb);
      if (rIdx !== -1) rooms.splice(rIdx, 1);
      replaced++;
    }
  };

  // Multi-entry loop pass: ensures single-door rooms get a 2nd entry point whenever a valid wall face exists
  const expandRoomEntryPoints = (deck: ShipDeck) => {
    const protectedFrames = getProtectedDoorFrameKeys();
    for (const rb of rooms) {
      if (rb.deck !== deck || rb.category === 'CIRCULATION') continue;
      if (rb.name === 'Helideck' || rb.name === 'Lifeboat Davit' || rb.name === 'Weather Deck' || rb.name === 'Container Bay' || rb.name === 'Forecastle') {
        continue;
      }
      const existingDoors = doors.filter(
        (d) => d.tx >= rb.x1 - 1 && d.tx <= rb.x2 + 1 && d.ty >= rb.y1 - 1 && d.ty <= rb.y2 + 1
      );
      if (existingDoors.length >= 2) continue;

      const cands: Array<{ dx: number; dy: number; ori: 'H' | 'V'; touchesCorridor: boolean }> = [];
      // North & South walls
      for (let x = rb.x1 + 1; x <= rb.x2 - 1; x++) {
        for (const [wallY, outY, inY] of [
          [rb.y1 - 1, rb.y1 - 2, rb.y1],
          [rb.y2 + 1, rb.y2 + 2, rb.y2],
        ]) {
          if (!isInsideInteriorHull(x, wallY, deck, 1)) continue;
          if (tiles[wallY]?.[x] !== 'WALL') continue;
          if (tiles[wallY]?.[x - 1] !== 'WALL' || tiles[wallY]?.[x + 1] !== 'WALL') continue;
          if (protectedFrames.has(key(x, wallY)) || protectedFrames.has(key(x - 1, wallY)) || protectedFrames.has(key(x + 1, wallY))) continue;
          if (!isTileWalkable(tiles[inY]?.[x] ?? 'VOID') || roomIdGrid[inY]?.[x] !== rb.id) continue;
          if (!isTileWalkable(tiles[outY]?.[x] ?? 'VOID') || roomIdGrid[outY]?.[x] === rb.id) continue;
          if (existingDoors.some((ed) => Math.abs(ed.tx - x) + Math.abs(ed.ty - wallY) < 3)) continue;
          cands.push({ dx: x, dy: wallY, ori: 'H', touchesCorridor: roomGrid[outY][x] === 'Corridor' });
        }
      }
      // West & East walls
      for (let y = rb.y1 + 1; y <= rb.y2 - 1; y++) {
        for (const [wallX, outX, inX] of [
          [rb.x1 - 1, rb.x1 - 2, rb.x1],
          [rb.x2 + 1, rb.x2 + 2, rb.x2],
        ]) {
          if (!isInsideInteriorHull(wallX, y, deck, 1)) continue;
          if (tiles[y]?.[wallX] !== 'WALL') continue;
          if (tiles[y - 1]?.[wallX] !== 'WALL' || tiles[y + 1]?.[wallX] !== 'WALL') continue;
          if (protectedFrames.has(key(wallX, y)) || protectedFrames.has(key(wallX, y - 1)) || protectedFrames.has(key(wallX, y + 1))) continue;
          if (!isTileWalkable(tiles[y]?.[inX] ?? 'VOID') || roomIdGrid[y]?.[inX] !== rb.id) continue;
          if (!isTileWalkable(tiles[y]?.[outX] ?? 'VOID') || roomIdGrid[y]?.[outX] === rb.id) continue;
          if (existingDoors.some((ed) => Math.abs(ed.tx - wallX) + Math.abs(ed.ty - y) < 3)) continue;
          cands.push({ dx: wallX, dy: y, ori: 'V', touchesCorridor: roomGrid[y][outX] === 'Corridor' });
        }
      }

      if (cands.length > 0) {
        cands.sort((a, b) => Number(b.touchesCorridor) - Number(a.touchesCorridor));
        const topPool = cands.filter((c) => c.touchesCorridor === cands[0].touchesCorridor);
        const pick = topPool[Math.floor(rng() * topPool.length)];
        addDoorway(pick.dx, pick.dy, pick.ori, rb.name, floorMaterial[rb.y1]?.[rb.x1] ?? 'STEEL', {
          open: false,
          locked: (rb.name === 'Storage Room' || rb.name === 'Workshop') && rng() < 0.2,
          roomId: rb.id,
        });
        protectedFrames.add(key(pick.dx, pick.dy));
        if (pick.ori === 'H') {
          protectedFrames.add(key(pick.dx - 1, pick.dy));
          protectedFrames.add(key(pick.dx + 1, pick.dy));
        } else {
          protectedFrames.add(key(pick.dx, pick.dy - 1));
          protectedFrames.add(key(pick.dx, pick.dy + 1));
        }
      }
    }
  };

  // =========================================================================
  // --- 3. DECK 2 (MIDDLE): Staggered Offset Hallways, Small Rooms & 3 Anchor Bays ---
  // =========================================================================
  // Anchor Bay 1: Relocated Deck 2 Lifeboat Davit open-ocean rail bay
  const davitSideTop = !flipY;
  const davitAnchorX = 83 + randInt(rng, -3, 3);
  const davitX1 = davitAnchorX - 4;
  const davitX2 = davitAnchorX + 4;
  const davitHullEdge = d2Bounds(davitAnchorX) ?? { top: 44, bot: 70 };
  const lifeboatTx = davitAnchorX;
  const lifeboatTy = davitSideTop ? davitHullEdge.top + 1 : davitHullEdge.bot - 1;
  const davitY1 = davitSideTop ? lifeboatTy : Math.max(59, davitHullEdge.bot - 6);
  const davitY2 = davitSideTop ? Math.min(55, davitHullEdge.top + 6) : lifeboatTy;

  for (let dx = davitX1; dx <= davitX2; dx++) {
    const outVoidY = davitSideTop ? lifeboatTy - 1 : lifeboatTy + 1;
    if (davitSideTop) {
      for (let vy = deckBounds.DECK_2.y1; vy <= outVoidY; vy++) tiles[vy][dx] = 'VOID';
    } else {
      for (let vy = outVoidY; vy <= deckBounds.DECK_2.y2; vy++) tiles[vy][dx] = 'VOID';
    }
  }
  const lifeboatRoomId = addRoom('Lifeboat Davit', 'DECK_2', davitX1, davitY1, davitX2, davitY2, 'EXTERIOR_DECK', 'WEATHER');
  setTile(lifeboatTx, lifeboatTy, 'ESCAPE_LIFEBOAT', 'Lifeboat Davit', 'WEATHER', lifeboatRoomId);
  reserveAround(lifeboatTx, lifeboatTy, 1);

  // Anchor Bay 2: Main Cargo Hold (Deck 2 large anchor room ~10x7)
  const d2CargoY1 = flipY ? 50 : 57;
  const d2CargoId = addRoom('Cargo Hold', 'DECK_2', 14, d2CargoY1, 23, d2CargoY1 + 6, 'FLOOR', 'CARGO');
  addProp('SHIPPING_CONTAINER', 'DECK_2', 16, d2CargoY1 + 1, 3, 2, {
    blocking: true,
    color: '#57422a',
    room: 'Cargo Hold',
    roomId: d2CargoId,
  });
  addProp('SHIPPING_CONTAINER', 'DECK_2', 19, d2CargoY1 + 4, 3, 2, {
    blocking: true,
    color: '#1d3b5c',
    room: 'Cargo Hold',
    roomId: d2CargoId,
  });

  // Anchor Bay 3: Galley & Mess (Deck 2 Unique central anchor room ~9x5, cleanly clear of North/South long hallways)
  const galX1 = 45 + randInt(rng, -2, 2);
  const galY1 = flipY ? 55 : 54;
  const galId = addRoom('Galley & Mess', 'DECK_2', galX1, galY1, galX1 + 8, galY1 + 4, 'FLOOR', 'CABIN');
  addProp('GALLEY_COUNTER', 'DECK_2', galX1 + 1, galY1 + 1, 3, 1, { blocking: true, room: 'Galley & Mess', roomId: galId });
  addProp('MESS_TABLE', 'DECK_2', galX1 + 5, galY1 + 2, 3, 1, { blocking: true, room: 'Galley & Mess', roomId: galId });

  // Deck 2 Guaranteed Twin Long 2-Wide Hallways (~34% of ship length each, opposite wings & opposite halves — never back-to-back!)
  // Place Long Hallway A on the Davit side in Aft-Mid (x: 25..62 = 38 tiles, ends 17 tiles aft of Davit!)
  // Place Long Hallway B on the OPPOSITE side in Mid-Fwd (x: 56..94 = 39 tiles, completely opposite Davit & Hallway A!)
  const longA_Y = davitSideTop ? 47 : 65;
  const longB_Y = davitSideTop ? 65 : 47;
  carveExactHallway(25, longA_Y, 62, longA_Y + 1, 'DECK_2', true);
  carveExactHallway(56, longB_Y, 94, longB_Y + 1, 'DECK_2', true);

  // More 2-wide sub-hallways forming crisp L, T, and 4-way intersections across Deck 2
  carveExactHallway(59, 47, 60, 66, 'DECK_2', true); // 2-wide Central Cross-Hallway linking Long Hall A & B
  carveExactHallway(25, 47, 26, 66, 'DECK_2', true); // 2-wide Aft Cross-Hallway linking Cargo Hold & wings
  carveExactHallway(38, Math.min(longA_Y, 55), 39, Math.max(longA_Y + 1, 58), 'DECK_2'); // 2-wide Aft-Mid spur
  carveExactHallway(73, Math.min(longB_Y, 55), 74, Math.max(longB_Y + 1, 58), 'DECK_2'); // 2-wide Fwd-Mid spur
  // 2-wide Lifeboat Davit L-approach from Long Hallway B
  const davitApproachY = davitSideTop ? davitY2 + 2 : davitY1 - 3;
  carveExactHallway(74, davitApproachY, 85, davitApproachY + 1, 'DECK_2');
  carveExactHallway(82, Math.min(longB_Y, davitApproachY), 83, Math.max(longB_Y + 1, davitApproachY + 1), 'DECK_2');
  // 2-wide Aft & Bow extension sub-hallways (clear of Deck 2 Cargo Hold!)
  const d2AftSpurY = flipY ? 60 : 51;
  carveExactHallway(12, d2AftSpurY, 26, d2AftSpurY + 1, 'DECK_2');
  carveExactHallway(93, 56, 108, 57, 'DECK_2');
  carveExactHallway(93, Math.min(longB_Y, 56), 94, Math.max(longB_Y + 1, 57), 'DECK_2');

  // Crisp 1-wide service sub-hallways connecting bow/aft pockets cleanly
  carveZPath(13, d2AftSpurY, 25, d2AftSpurY, 'DECK_2', 1, 8, 2);
  carveZPath(28, longB_Y, 44, 56, 'DECK_2', 1, 6, 3);
  carveZPath(61, 56, 73, 56, 'DECK_2', 1, 6, 2);
  carveExactHallway(108, 56, 112, 57, 'DECK_2');
  carveZPath(100, flipY ? 51 : 62, 111, flipY ? 51 : 62, 'DECK_2', 1, 6, 2);
  carveExactHallway(107, Math.min(flipY ? 51 : 62, 56), 107, Math.max(flipY ? 51 : 62, 57), 'DECK_2');

  // Connect Deck 2 Anchor Bays cleanly to adjacent corridors
  addDoorway(24, d2CargoY1 + 3, 'V', 'Cargo Hold', 'CARGO', { open: false, roomId: d2CargoId });
  addDoorway(19, flipY ? d2CargoY1 + 7 : d2CargoY1 - 1, 'H', 'Cargo Hold', 'CARGO', { open: true, roomId: d2CargoId });

  addDoorway(galX1 - 1, galY1 + 2, 'V', 'Galley & Mess', 'CABIN', { open: true, roomId: galId });
  addDoorway(galX1 + 4, flipY ? galY1 - 1 : galY1 + 5, 'H', 'Galley & Mess', 'CABIN', { open: false, roomId: galId });
  // Ensure Galley's West & North/South doorways meet walkable corridor
  carveExactHallway(39, galY1 + 2, galX1 - 2, galY1 + 2, 'DECK_2');

  // Connect Lifeboat Davit to Deck 2 corridor
  const davitDoorY = davitSideTop ? davitY2 + 1 : davitY1 - 1;
  fillRect(davitX1 + 1, davitDoorY + (davitSideTop ? 1 : -1), davitX2 - 1, davitDoorY + (davitSideTop ? 1 : -1), 'FLOOR', 'Corridor', 'STEEL');
  addDoorway(lifeboatTx, davitDoorY, 'H', 'Lifeboat Davit', 'WEATHER', { open: true, roomId: lifeboatRoomId });
  addDoorway(davitX1 - 1, davitSideTop ? davitY2 : davitY1, 'V', 'Lifeboat Davit', 'WEATHER', { open: false, roomId: lifeboatRoomId });

  // Clean any fused 3x3 corridor blobs on Deck 2 before room packing
  cleanFleshyCorridors('DECK_2', false);

  // Pack mostly 4x4..6x6 small rooms into Deck 2 pockets + less-greedy second fill
  packCompactRooms(
    'DECK_2',
    [
      { name: 'Infirmary', mat: 'CABIN', wRange: [5, 6], hRange: [4, 5], propKind: 'MED_BED', propW: 2, propH: 1 },
      { name: 'Crew Quarters', mat: 'CABIN', wRange: [4, 6], hRange: [4, 5], propKind: 'BUNK', propW: 2, propH: 1 },
      { name: 'Crew Quarters', mat: 'CABIN', wRange: [4, 5], hRange: [4, 5], propKind: 'BUNK', propW: 2, propH: 1 },
      { name: 'Storage Room', mat: 'CARGO', wRange: [4, 5], hRange: [4, 5], lockedChance: 0.3 },
      { name: 'Storage Room', mat: 'CARGO', wRange: [4, 6], hRange: [4, 5] },
      { name: 'Workshop', mat: 'STEEL', wRange: [4, 6], hRange: [4, 5], propKind: 'WORKBENCH', propW: 2, propH: 1 },
      { name: 'Electrical Room', mat: 'GRATING', wRange: [4, 5], hRange: [4, 5], propKind: 'SWITCHGEAR', propW: 2, propH: 1 },
      { name: 'Maintenance Bay', mat: 'STEEL', wRange: [4, 6], hRange: [4, 5], propKind: 'WORKBENCH', propW: 2, propH: 1 },
      { name: 'Crew Quarters', mat: 'CABIN', wRange: [4, 5], hRange: [4, 5], propKind: 'BUNK', propW: 2, propH: 1 },
      { name: 'Storage Room', mat: 'CARGO', wRange: [4, 5], hRange: [4, 5] },
      { name: 'Maintenance Bay', mat: 'STEEL', wRange: [4, 5], hRange: [4, 5] },
      { name: 'Electrical Room', mat: 'GRATING', wRange: [4, 5], hRange: [4, 4] },
      { name: 'Crew Quarters', mat: 'CABIN', wRange: [4, 5], hRange: [4, 4] },
      { name: 'Workshop', mat: 'STEEL', wRange: [4, 5], hRange: [4, 4] },
      { name: 'Storage Room', mat: 'CARGO', wRange: [4, 5], hRange: [4, 4] },
    ],
    10,
    113
  );
  fillGreedyPocketRooms('DECK_2', 9, 115, 22);
  replaceRoomsWithHallways('DECK_2', 2, 3);
  expandRoomEntryPoints('DECK_2');

  // Enforce unbroken outer steel skin around Deck 2 interior (except Lifeboat Davit ocean rail!)
  for (let y = deckBounds.DECK_2.y1 + 1; y < deckBounds.DECK_2.y2; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (deckGrid[y][x] !== 'DECK_2' || tiles[y][x] === 'VOID') continue;
      if (roomIdGrid[y][x] === lifeboatRoomId) continue;
      const touchesVoid =
        tiles[y - 1][x] === 'VOID' ||
        tiles[y + 1][x] === 'VOID' ||
        tiles[y][x - 1] === 'VOID' ||
        tiles[y][x + 1] === 'VOID';
      if (touchesVoid && tiles[y][x] !== 'WALL') {
        setTile(x, y, 'WALL', 'Corridor', 'STEEL', CORRIDOR_ID.DECK_2);
      }
    }
  }

  // =========================================================================
  // --- 4. DECK 1 (BOTTOM): Winding Z-Bend Labyrinth, Compact Rooms & 3 Anchor Bays ---
  // =========================================================================
  // Anchor Bay 1: Aft Engine Room (Unique ~11x9)
  const engId = addRoom('Engine Room', 'DECK_1', 15, 91, 25, 99, 'FLOOR', 'GRATING');
  addProp('TURBINE', 'DECK_1', 17, 93, 3, 2, { blocking: true, room: 'Engine Room', roomId: engId });
  addProp('TURBINE', 'DECK_1', 21, 96, 3, 2, { blocking: true, room: 'Engine Room', roomId: engId });
  addProp('PIPE_RUN', 'DECK_1', 16, 91, 8, 1, { blocking: false });

  // Anchor Bay 2: Mid Cargo Hold (Generic ~9x6)
  const d1CargoY1 = flipY ? 86 : 98;
  const d1CargoX1 = 50 + randInt(rng, -3, 3);
  const d1CargoId = addRoom('Cargo Hold', 'DECK_1', d1CargoX1, d1CargoY1, d1CargoX1 + 8, d1CargoY1 + 5, 'FLOOR', 'CARGO');
  addProp('SHIPPING_CONTAINER', 'DECK_1', d1CargoX1 + 2, d1CargoY1 + 2, 3, 2, {
    blocking: true,
    color: '#57422a',
    room: 'Cargo Hold',
    roomId: d1CargoId,
  });

  // Anchor Bay 3: Moonpool Submarine Bay (Unique ~12x10, forward bilge)
  const subId = addRoom('Submarine Bay', 'DECK_1', 94, 90, 105, 99, 'FLOOR', 'GRATING');
  const subTx = 99;
  const subTy = 95;
  setTile(subTx, subTy, 'ESCAPE_SUBMARINE', 'Submarine Bay', 'GRATING', subId);
  reserveAround(subTx, subTy, 2);
  const subLeverTx = 96;
  const subLeverTy = 92;
  addProp('SUBMARINE_HULL', 'DECK_1', 101, 92, 4, 6, { blocking: true, room: 'Submarine Bay', roomId: subId });
  addProp('FLOODGATE_LEVER', 'DECK_1', subLeverTx, subLeverTy, 1, 1, { blocking: true, room: 'Submarine Bay', roomId: subId });
  reserveAround(subLeverTx, subLeverTy, 1);

  // Crisp 1-Wide Claustrophobic Labyrinth Corridors on Deck 1 (clean L, T, and 4-way shapes, zero fleshy blobs!)
  const d1SpinePoints: Array<[number, number]> = [
    [27, 94],
    [34, flipY ? 88 : 101],
    [43, flipY ? 98 : 91],
    [49, flipY ? 94 : 96],
    [61, flipY ? 99 : 90],
    [69, flipY ? 89 : 100],
    [79, flipY ? 97 : 92],
    [87, flipY ? 91 : 98],
    [92, 95],
  ];
  for (let i = 0; i < d1SpinePoints.length - 1; i++) {
    carveZPath(
      d1SpinePoints[i][0],
      d1SpinePoints[i][1],
      d1SpinePoints[i + 1][0],
      d1SpinePoints[i + 1][1],
      'DECK_1',
      1,
      7,
      4
    );
  }
  // Interlocking 1-wide bilge branches & hull-hugging aft/fwd flanks
  carveZPath(28, flipY ? 102 : 87, 45, flipY ? 99 : 90, 'DECK_1', 1, 7, 3);
  carveZPath(62, flipY ? 86 : 103, 84, flipY ? 89 : 100, 'DECK_1', 1, 7, 3);
  carveZPath(74, 88, 91, 93, 'DECK_1', 1, 6, 3);
  carveZPath(39, 86, 43, 103, 'DECK_1', 1, 6, 2);
  carveZPath(71, 86, 75, 103, 'DECK_1', 1, 6, 2);
  carveZPath(14, 88, 28, 88, 'DECK_1', 1, 6, 2);
  carveZPath(14, 101, 28, 102, 'DECK_1', 1, 6, 2);
  carveZPath(90, 87, 107, 87, 'DECK_1', 1, 6, 2);
  carveZPath(90, 102, 107, 102, 'DECK_1', 1, 6, 2);
  carveExactHallway(107, 87, 107, 102, 'DECK_1');
  cleanFleshyCorridors('DECK_1', true);

  // Connect Deck 1 Anchor Bays via doors
  addDoorway(26, 94, 'V', 'Engine Room', 'GRATING', { open: false, roomId: engId });
  addDoorway(26, 91, 'V', 'Engine Room', 'GRATING', { open: true, roomId: engId });
  addDoorway(d1CargoX1 - 1, d1CargoY1 + 2, 'V', 'Cargo Hold', 'CARGO', { open: false, roomId: d1CargoId });
  addDoorway(d1CargoX1 + 4, flipY ? d1CargoY1 + 6 : d1CargoY1 - 1, 'H', 'Cargo Hold', 'CARGO', { open: false, roomId: d1CargoId });
  addDoorway(93, 95, 'V', 'Submarine Bay', 'GRATING', { open: false, roomId: subId });
  addDoorway(93, 92, 'V', 'Submarine Bay', 'GRATING', { open: true, roomId: subId });

  // Pack dense 4x4..6x6 small bilge compartments into Deck 1 pockets!
  packCompactRooms(
    'DECK_1',
    [
      { name: 'Boiler Room', mat: 'GRATING', wRange: [5, 6], hRange: [4, 5], propKind: 'BOILER', propW: 2, propH: 2 },
      { name: 'Pump Room', mat: 'GRATING', wRange: [5, 6], hRange: [4, 5], propKind: 'PUMP_UNIT', propW: 2, propH: 2 },
      { name: 'Maintenance Bay', mat: 'STEEL', wRange: [4, 5], hRange: [4, 5], propKind: 'WORKBENCH', propW: 2, propH: 1 },
      { name: 'Electrical Room', mat: 'GRATING', wRange: [4, 5], hRange: [4, 5], propKind: 'SWITCHGEAR', propW: 2, propH: 1 },
      { name: 'Storage Room', mat: 'CARGO', wRange: [4, 5], hRange: [4, 5], lockedChance: 0.3 },
      { name: 'Crew Quarters', mat: 'CABIN', wRange: [4, 6], hRange: [4, 5], propKind: 'BUNK', propW: 2, propH: 1 },
      { name: 'Workshop', mat: 'STEEL', wRange: [4, 5], hRange: [4, 5], propKind: 'WORKBENCH', propW: 2, propH: 1 },
      { name: 'Storage Room', mat: 'CARGO', wRange: [4, 5], hRange: [4, 4] },
      { name: 'Electrical Room', mat: 'GRATING', wRange: [4, 5], hRange: [4, 4], propKind: 'SWITCHGEAR', propW: 2, propH: 1 },
      { name: 'Maintenance Bay', mat: 'STEEL', wRange: [4, 5], hRange: [4, 5] },
      { name: 'Storage Room', mat: 'CARGO', wRange: [4, 5], hRange: [4, 4] },
      { name: 'Crew Quarters', mat: 'CABIN', wRange: [4, 5], hRange: [4, 4] },
      { name: 'Workshop', mat: 'STEEL', wRange: [4, 5], hRange: [4, 4] },
      { name: 'Maintenance Bay', mat: 'STEEL', wRange: [4, 5], hRange: [4, 4] },
    ],
    13,
    109
  );
  // Greedy fill compact room pockets on Deck 1, then replace 2-3 rooms with clean hallways & add extra entry points
  fillGreedyPocketRooms('DECK_1', 11, 113, 24, true);
  replaceRoomsWithHallways('DECK_1', 2, 3);
  cleanFleshyCorridors('DECK_1', true);
  expandRoomEntryPoints('DECK_1');
  expandRoomEntryPoints('DECK_3');

  // Enforce unbroken outer steel skin around Deck 1 hull boundary
  for (let y = deckBounds.DECK_1.y1 + 1; y < deckBounds.DECK_1.y2; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (deckGrid[y][x] !== 'DECK_1' || tiles[y][x] === 'VOID') continue;
      const touchesVoid =
        tiles[y - 1][x] === 'VOID' ||
        tiles[y + 1][x] === 'VOID' ||
        tiles[y][x - 1] === 'VOID' ||
        tiles[y][x + 1] === 'VOID';
      if (touchesVoid && tiles[y][x] !== 'WALL') {
        setTile(x, y, 'WALL', 'Corridor', 'STEEL', CORRIDOR_ID.DECK_1);
      }
    }
  }

  // =========================================================================
  // --- 5. Offset 3-Stairwell Vertical Topology (DECK_3 <-> DECK_2 <-> DECK_1) ---
  // =========================================================================
  const pickCorridorStairTile = (
    deck: ShipDeck,
    targetX: number,
    existingXs: number[],
    minSepX = 12
  ): { tx: number; ty: number; room: RoomName } => {
    const band = deckBounds[deck];
    let best: { tx: number; ty: number; score: number; room: RoomName } | null = null;
    for (let y = band.y1 + 4; y <= band.y2 - 4; y++) {
      for (let x = 14; x < width - 14; x++) {
        if (!isInsideInteriorHull(x, y, deck, 1)) continue;
        if (!isTileWalkable(tiles[y][x])) continue;
        if (tiles[y][x] === 'ESCAPE_HELI' || tiles[y][x] === 'ESCAPE_LIFEBOAT' || tiles[y][x] === 'ESCAPE_SUBMARINE') {
          continue;
        }
        if (reserved.has(key(x, y))) continue;
        const rName = roomGrid[y][x];
        if (deck !== 'DECK_3' && rName !== 'Corridor') continue;
        if (existingXs.some((ex) => Math.abs(ex - x) < minSepX)) continue;
        // Prefer interior walkway tiles not pinned inside 3-wall dead ends
        let openAdj = 0;
        if (isTileWalkable(tiles[y - 1][x])) openAdj++;
        if (isTileWalkable(tiles[y + 1][x])) openAdj++;
        if (isTileWalkable(tiles[y][x - 1])) openAdj++;
        if (isTileWalkable(tiles[y][x + 1])) openAdj++;
        if (openAdj < 2) continue;
        const hullMarginPenalty = isInsideInteriorHull(x, y, deck, 2) ? 0 : 8;
        const score = Math.abs(x - targetX) + Math.abs(y - band.centerY) * 0.25 + hullMarginPenalty;
        if (!best || score < best.score) {
          best = { tx: x, ty: y, score, room: rName };
        }
      }
    }
    if (best) return { tx: best.tx, ty: best.ty, room: best.room };
    // Fallback any interior-safe walkable non-escape tile on deck with at least 1 walkable neighbor
    for (let y = band.y1 + 4; y <= band.y2 - 4; y++) {
      for (let x = 14; x < width - 14; x++) {
        if (!isInsideInteriorHull(x, y, deck, 1)) continue;
        if (isTileWalkable(tiles[y][x]) && !reserved.has(key(x, y))) {
          return { tx: x, ty: y, room: roomGrid[y][x] };
        }
      }
    }
    return { tx: Math.max(20, Math.min(100, targetX)), ty: band.centerY, room: 'Corridor' };
  };

  const linkStairs = (
    idA: string,
    deckA: ShipDeck,
    posA: { tx: number; ty: number; room: RoomName },
    idB: string,
    deckB: ShipDeck,
    posB: { tx: number; ty: number; room: RoomName },
    label: string,
    dirA: 'UP' | 'DOWN'
  ) => {
    const rIdA = roomIdGrid[posA.ty][posA.tx] || getCirculationId(posA.room, posA.ty);
    const rIdB = roomIdGrid[posB.ty][posB.tx] || getCirculationId(posB.room, posB.ty);
    const matA = floorMaterial[posA.ty][posA.tx] || 'STEEL';
    const matB = floorMaterial[posB.ty][posB.tx] || 'STEEL';
    const tA: TileType =
      deckA === 'DECK_3' && (posA.room === 'Container Bay' || posA.room === 'Forecastle' || posA.room === 'Weather Deck')
        ? 'EXTERIOR_DECK'
        : 'FLOOR';
    setTile(posA.tx, posA.ty, tA, posA.room, matA, rIdA);
    setTile(posB.tx, posB.ty, 'FLOOR', posB.room, matB, rIdB);
    reserveAround(posA.tx, posA.ty, 1);
    reserveAround(posB.tx, posB.ty, 1);
    protectedCorridorKeys.add(key(posA.tx, posA.ty));
    protectedCorridorKeys.add(key(posB.tx, posB.ty));

    stairwells.push(
      {
        id: idA,
        deck: deckA,
        tx: posA.tx,
        ty: posA.ty,
        x: (posA.tx + 0.5) * tileSize,
        y: (posA.ty + 0.5) * tileSize,
        targetStairId: idB,
        targetDeck: deckB,
        targetRoom: posB.room,
        targetRoomId: rIdB,
        room: posA.room,
        roomId: rIdA,
        label,
        direction: dirA,
      },
      {
        id: idB,
        deck: deckB,
        tx: posB.tx,
        ty: posB.ty,
        x: (posB.tx + 0.5) * tileSize,
        y: (posB.ty + 0.5) * tileSize,
        targetStairId: idA,
        targetDeck: deckA,
        targetRoom: posA.room,
        targetRoomId: rIdA,
        room: posB.room,
        roomId: rIdB,
        label,
        direction: dirA === 'DOWN' ? 'UP' : 'DOWN',
      }
    );
  };

  // Upper 3 Stairs (DECK_3 <-> DECK_2)
  const d2StairXs: number[] = [];
  const stair32AftBot = pickCorridorStairTile('DECK_2', stair32AftTop.tx, d2StairXs);
  d2StairXs.push(stair32AftBot.tx);
  const stair32MidBot = pickCorridorStairTile('DECK_2', stair32MidTop.tx, d2StairXs);
  d2StairXs.push(stair32MidBot.tx);
  const stair32BowBot = pickCorridorStairTile('DECK_2', 102, d2StairXs);
  d2StairXs.push(stair32BowBot.tx);

  linkStairs('stair_32_aft_top', 'DECK_3', stair32AftTop, 'stair_32_aft_bot', 'DECK_2', stair32AftBot, 'Aft Companionway (3 ↔ 2)', 'DOWN');
  linkStairs('stair_32_mid_top', 'DECK_3', stair32MidTop, 'stair_32_mid_bot', 'DECK_2', stair32MidBot, 'Midships Companionway (3 ↔ 2)', 'DOWN');
  linkStairs('stair_32_bow_top', 'DECK_3', stair32BowTop, 'stair_32_bow_bot', 'DECK_2', stair32BowBot, 'Forecastle Hatch (3 ↔ 2)', 'DOWN');

  // Lower 3 Stairs (DECK_2 <-> DECK_1) OFFSET longitudinally so players transit Deck 2!
  const stair21AftTop = pickCorridorStairTile('DECK_2', 39, d2StairXs, 10);
  d2StairXs.push(stair21AftTop.tx);
  const stair21MidTop = pickCorridorStairTile('DECK_2', 76, d2StairXs, 10);
  d2StairXs.push(stair21MidTop.tx);
  const stair21FwdTop = pickCorridorStairTile('DECK_2', 93, d2StairXs, 7);
  d2StairXs.push(stair21FwdTop.tx);

  const d1StairXs: number[] = [];
  const stair21AftBot = pickCorridorStairTile('DECK_1', 36, d1StairXs, 14);
  d1StairXs.push(stair21AftBot.tx);
  const stair21MidBot = pickCorridorStairTile('DECK_1', 69, d1StairXs, 14);
  d1StairXs.push(stair21MidBot.tx);
  const stair21FwdBot = pickCorridorStairTile('DECK_1', 90, d1StairXs, 10);
  d1StairXs.push(stair21FwdBot.tx);

  linkStairs('stair_21_aft_top', 'DECK_2', stair21AftTop, 'stair_21_aft_bot', 'DECK_1', stair21AftBot, 'Bilge Descent Aft (2 ↔ 1)', 'DOWN');
  linkStairs('stair_21_mid_top', 'DECK_2', stair21MidTop, 'stair_21_mid_bot', 'DECK_1', stair21MidBot, 'Mid-Hull Access Shaft (2 ↔ 1)', 'DOWN');
  linkStairs('stair_21_fwd_top', 'DECK_2', stair21FwdTop, 'stair_21_fwd_bot', 'DECK_1', stair21FwdBot, 'Submarine Bay Hatch (2 ↔ 1)', 'DOWN');

  // =========================================================================
  // --- 5b. Post-Carve Door Validation & Zero-Enclosed-Room Repair Pass ---
  // =========================================================================
  const stairKeys = new Set(stairwells.map((s) => key(s.tx, s.ty)));

  // Protect only doorway tiles and their immediate passage tiles before stub pruning
  for (const d of doors) {
    protectedCorridorKeys.add(key(d.tx, d.ty));
    if (d.orientation === 'H') {
      protectedCorridorKeys.add(key(d.tx, d.ty - 1));
      protectedCorridorKeys.add(key(d.tx, d.ty + 1));
    } else {
      protectedCorridorKeys.add(key(d.tx - 1, d.ty));
      protectedCorridorKeys.add(key(d.tx + 1, d.ty));
    }
  }

  let prunedAny = true;
  while (prunedAny) {
    prunedAny = false;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (tiles[y][x] !== 'FLOOR' || roomGrid[y][x] !== 'Corridor') continue;
        const k = key(x, y);
        if (stairKeys.has(k) || protectedCorridorKeys.has(k)) continue;
        let wallCount = 0;
        if (!isTileWalkable(tiles[y - 1][x])) wallCount++;
        if (!isTileWalkable(tiles[y + 1][x])) wallCount++;
        if (!isTileWalkable(tiles[y][x - 1])) wallCount++;
        if (!isTileWalkable(tiles[y][x + 1])) wallCount++;
        if (wallCount >= 3) {
          // Never drop an adjacent stairwell below 2 walkable neighbors
          let dropsStair = false;
          for (const [ox, oy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const sx = x + ox;
            const sy = y + oy;
            if (stairKeys.has(key(sx, sy))) {
              let sWalk = 0;
              for (const [ax, ay] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ]) {
                const nx = sx + ax;
                const ny = sy + ay;
                if (nx === x && ny === y) continue;
                if (isTileWalkable(tiles[ny]?.[nx] ?? 'VOID')) sWalk++;
              }
              if (sWalk < 2) {
                dropsStair = true;
                break;
              }
            }
          }
          if (dropsStair) continue;
          setTile(x, y, 'WALL', 'Corridor', 'STEEL', CORRIDOR_ID[getDeckForY(y)]);
          prunedAny = true;
        }
      }
    }
  }

  const isDoorGeometryValid = (d: Door): boolean => {
    if (!isTileWalkable(tiles[d.ty]?.[d.tx] ?? 'VOID')) return false;
    if (d.orientation === 'H') {
      return (
        tiles[d.ty]?.[d.tx - 1] === 'WALL' &&
        tiles[d.ty]?.[d.tx + 1] === 'WALL' &&
        isTileWalkable(tiles[d.ty - 1]?.[d.tx] ?? 'VOID') &&
        isTileWalkable(tiles[d.ty + 1]?.[d.tx] ?? 'VOID')
      );
    }
    return (
      tiles[d.ty - 1]?.[d.tx] === 'WALL' &&
      tiles[d.ty + 1]?.[d.tx] === 'WALL' &&
      isTileWalkable(tiles[d.ty]?.[d.tx - 1] ?? 'VOID') &&
      isTileWalkable(tiles[d.ty]?.[d.tx + 1] ?? 'VOID')
    );
  };

  const pruneInvalidDoors = () => {
    const valid: Door[] = [];
    for (const d of doors) {
      if (isDoorGeometryValid(d)) {
        valid.push(d);
      } else if (tiles[d.ty]?.[d.tx] === 'FLOOR' && !stairKeys.has(key(d.tx, d.ty))) {
        const touchesRoom =
          roomIdGrid[d.ty]?.[d.tx] >= 10 ||
          roomIdGrid[d.ty - 1]?.[d.tx] >= 10 ||
          roomIdGrid[d.ty + 1]?.[d.tx] >= 10 ||
          roomIdGrid[d.ty]?.[d.tx - 1] >= 10 ||
          roomIdGrid[d.ty]?.[d.tx + 1] >= 10;
        if (touchesRoom) {
          // Seal orphaned door tiles on room perimeters back to WALL so they never leave a hole in the wall!
          setTile(d.tx, d.ty, 'WALL', 'Corridor', 'STEEL', CORRIDOR_ID[getDeckForY(d.ty)]);
        }
      }
    }
    doors.length = 0;
    doors.push(...valid);
  };
  pruneInvalidDoors();

  const runReachabilityBfs = (startTx: number, startTy: number, allowLocked: boolean): Uint8Array => {
    const doorLookup = new Map<number, Door>();
    for (const d of doors) doorLookup.set(key(d.tx, d.ty), d);
    const stairLookup = new Map<number, Stairwell>();
    for (const s of stairwells) stairLookup.set(key(s.tx, s.ty), s);

    const vis = new Uint8Array(width * height);
    if (!isTileWalkable(tiles[startTy]?.[startTx] ?? 'VOID')) return vis;
    const q: Array<{ tx: number; ty: number }> = [{ tx: startTx, ty: startTy }];
    vis[key(startTx, startTy)] = 1;
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      const nbrs: Array<{ nx: number; ny: number }> = [
        { nx: cur.tx + 1, ny: cur.ty },
        { nx: cur.tx - 1, ny: cur.ty },
        { nx: cur.tx, ny: cur.ty + 1 },
        { nx: cur.tx, ny: cur.ty - 1 },
      ];
      const st = stairLookup.get(key(cur.tx, cur.ty));
      if (st) {
        const target = stairwells.find((o) => o.id === st.targetStairId);
        if (target) nbrs.push({ nx: target.tx, ny: target.ty });
      }
      for (const { nx, ny } of nbrs) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nk = key(nx, ny);
        if (vis[nk]) continue;
        if (!isTileWalkable(tiles[ny][nx])) continue;
        const d = doorLookup.get(nk);
        if (d?.isLocked && !allowLocked) continue;
        vis[nk] = 1;
        q.push({ tx: nx, ty: ny });
      }
    }
    return vis;
  };

  // Prune any room whose interior was completely consumed; keep accurate RoomBounds
  const activeRooms: RoomBounds[] = [];
  for (const rb of rooms) {
    let hasWalkable = false;
    for (let y = rb.y1; y <= rb.y2 && !hasWalkable; y++) {
      for (let x = rb.x1; x <= rb.x2; x++) {
        if (roomIdGrid[y]?.[x] === rb.id && isTileWalkable(tiles[y]?.[x] ?? 'VOID')) {
          hasWalkable = true;
          break;
        }
      }
    }
    if (hasWalkable) activeRooms.push(rb);
  }
  rooms = activeRooms;

  // Repair any unreachable/enclosed room on every deck until ZERO enclosed rooms remain!
  const rootTx = 14;
  const rootTy = 19;
  for (let pass = 0; pass < 36; pass++) {
    const visAll = runReachabilityBfs(rootTx, rootTy, true);
    let repairedOne = false;

    for (const rb of rooms) {
      const roomTiles: Array<{ tx: number; ty: number }> = [];
      let anyReached = false;
      for (let y = rb.y1; y <= rb.y2; y++) {
        for (let x = rb.x1; x <= rb.x2; x++) {
          if (roomIdGrid[y]?.[x] === rb.id && isTileWalkable(tiles[y]?.[x] ?? 'VOID')) {
            roomTiles.push({ tx: x, ty: y });
            if (visAll[key(x, y)] === 1) anyReached = true;
          }
        }
      }
      if (roomTiles.length === 0 || anyReached) continue;

      const band = deckBounds[rb.deck];
      const parent = new Int32Array(width * height).fill(-1);
      const dist = new Int32Array(width * height).fill(-1);
      const bq: number[] = [];
      for (const rt of roomTiles) {
        const rk = key(rt.tx, rt.ty);
        dist[rk] = 0;
        bq.push(rk);
      }

      let foundTargetKey = -1;
      let bHead = 0;
      while (bHead < bq.length && foundTargetKey === -1) {
        const ck = bq[bHead++];
        const cx = ck % width;
        const cy = Math.floor(ck / width);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx <= 1 || nx >= width - 2 || ny <= band.y1 || ny >= band.y2) continue;
          if (!isInsideInteriorHull(nx, ny, rb.deck, 1)) continue;
          const nk = key(nx, ny);
          if (dist[nk] !== -1) continue;
          dist[nk] = dist[ck] + 1;
          parent[nk] = ck;
          if (visAll[nk] === 1) {
            foundTargetKey = nk;
            break;
          }
          bq.push(nk);
        }
      }

      if (foundTargetKey !== -1) {
        const pathKeys: number[] = [];
        let trace = foundTargetKey;
        while (trace !== -1) {
          pathKeys.push(trace);
          trace = parent[trace];
        }
        pathKeys.reverse();

        let placedBreachDoor = false;
        for (let i = 1; i < pathKeys.length - 1; i++) {
          const pk = pathKeys[i];
          const px = pk % width;
          const py = Math.floor(pk / width);
          if (!isTileWalkable(tiles[py][px])) {
            setTile(px, py, 'FLOOR', 'Corridor', 'STEEL', CORRIDOR_ID[rb.deck]);
            protectedCorridorKeys.add(key(px, py));
            if (!placedBreachDoor) {
              const prevX = pathKeys[i - 1] % width;
              const ori: 'H' | 'V' = prevX === px ? 'H' : 'V';
              if (
                (ori === 'H' && tiles[py][px - 1] === 'WALL' && tiles[py][px + 1] === 'WALL') ||
                (ori === 'V' && tiles[py - 1][px] === 'WALL' && tiles[py + 1][px] === 'WALL')
              ) {
                addDoorway(px, py, ori, 'Corridor', 'STEEL', { open: false });
                placedBreachDoor = true;
              }
            }
          }
        }
        repairedOne = true;
        break;
      }
    }

    if (!repairedOne) break;
  }

  // Ensure every stairwell, escape bay, and non-locked room is reachable WITHOUT Bolt Cutters
  for (const d of doors) {
    if (!d.isLocked) continue;
    const visUnlocked = runReachabilityBfs(rootTx, rootTy, false);
    const adj = [
      key(d.tx - 1, d.ty),
      key(d.tx + 1, d.ty),
      key(d.tx, d.ty - 1),
      key(d.tx, d.ty + 1),
    ];
    const reachesBothSides = adj.filter((k) => {
      const tx = k % width;
      const ty = Math.floor(k / width);
      return isTileWalkable(tiles[ty]?.[tx] ?? 'VOID') && visUnlocked[k] === 1;
    }).length >= 2;
    if (!reachesBothSides) {
      d.isLocked = false;
    }
  }
  pruneInvalidDoors();

  // =========================================================================
  // --- 5c. Post-Pruning Anti-Thicc-Wall Pass (Deck 1 Zero-Thicc Guarantee + Door-Frame Safe) ---
  // =========================================================================
  const runAntiThiccWallPass = (deck: ShipDeck, allowCorridorCarve: boolean) => {
    const band = deckBounds[deck];
    const skippedThickCores = new Set<number>();
    const maxPasses = allowCorridorCarve ? 520 : 120;

    for (let pass = 0; pass < maxPasses; pass++) {
      let thickCore: { tx: number; ty: number } | null = null;
      for (let y = band.y1 + 1; y <= band.y2 - 1 && !thickCore; y++) {
        for (let x = 8; x < width - 8 && !thickCore; x++) {
          if (skippedThickCores.has(key(x, y))) continue;
          if (!isInsideInteriorHull(x, y, deck, 1)) continue;
          let allNineWall = true;
          let touchesVoid2 = false;
          for (let dy = -1; dy <= 1 && allNineWall; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (tiles[y + dy]?.[x + dx] !== 'WALL') {
                allNineWall = false;
                break;
              }
            }
          }
          if (!allNineWall) continue;
          for (let dy = -2; dy <= 2 && !touchesVoid2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (tiles[y + dy]?.[x + dx] === 'VOID') {
                touchesVoid2 = true;
                break;
              }
            }
          }
          if (!touchesVoid2) {
            thickCore = { tx: x, ty: y };
          }
        }
      }
      if (!thickCore) break;

      const protectedFrames = getProtectedDoorFrameKeys();

      // Step 1: Expand an adjacent room 1 tile into the thick wall mass without touching any door frame
      let expanded = false;
      for (const rb of rooms) {
        if (rb.deck !== deck || rb.name === 'Submarine Bay' || rb.name === 'Lifeboat Davit') continue;
        const trySides: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
        const yOverlap = rb.y2 >= thickCore.ty - 1 && rb.y1 <= thickCore.ty + 1;
        const xOverlap = rb.x2 >= thickCore.tx - 1 && rb.x1 <= thickCore.tx + 1;
        if (yOverlap && rb.x1 - 1 >= thickCore.tx - 1 && rb.x1 - 1 <= thickCore.tx + 2) {
          trySides.push({ x1: rb.x1 - 1, y1: rb.y1, x2: rb.x1 - 1, y2: rb.y2 });
        }
        if (yOverlap && rb.x2 + 1 >= thickCore.tx - 2 && rb.x2 + 1 <= thickCore.tx + 1) {
          trySides.push({ x1: rb.x2 + 1, y1: rb.y1, x2: rb.x2 + 1, y2: rb.y2 });
        }
        if (xOverlap && rb.y1 - 1 >= thickCore.ty - 1 && rb.y1 - 1 <= thickCore.ty + 2) {
          trySides.push({ x1: rb.x1, y1: rb.y1 - 1, x2: rb.x2, y2: rb.y1 - 1 });
        }
        if (xOverlap && rb.y2 + 1 >= thickCore.ty - 2 && rb.y2 + 1 <= thickCore.ty + 1) {
          trySides.push({ x1: rb.x1, y1: rb.y2 + 1, x2: rb.x2, y2: rb.y2 + 1 });
        }

        for (const s of trySides) {
          let canExpand = true;
          for (let ey = s.y1 - 1; ey <= s.y2 + 1 && canExpand; ey++) {
            for (let ex = s.x1 - 1; ex <= s.x2 + 1; ex++) {
              if (!isInsideInteriorHull(ex, ey, deck, 0)) {
                canExpand = false;
                break;
              }
              if (protectedFrames.has(key(ex, ey))) {
                canExpand = false;
                break;
              }
              if (ex >= s.x1 && ex <= s.x2 && ey >= s.y1 && ey <= s.y2) {
                if (tiles[ey][ex] !== 'WALL') {
                  canExpand = false;
                  break;
                }
              } else {
                const insideExistingRb = ex >= rb.x1 && ex <= rb.x2 && ey >= rb.y1 && ey <= rb.y2;
                if (!insideExistingRb && tiles[ey][ex] !== 'WALL') {
                  canExpand = false;
                  break;
                }
              }
            }
          }
          if (canExpand) {
            let mat: FloorMaterial = 'STEEL';
            for (let ry = rb.y1; ry <= rb.y2; ry++) {
              for (let rx = rb.x1; rx <= rb.x2; rx++) {
                if (roomIdGrid[ry][rx] === rb.id && isTileWalkable(tiles[ry][rx])) {
                  mat = floorMaterial[ry][rx];
                  break;
                }
              }
            }
            for (let ey = s.y1; ey <= s.y2; ey++) {
              for (let ex = s.x1; ex <= s.x2; ex++) {
                setTile(ex, ey, 'FLOOR', rb.name, mat, rb.id);
              }
            }
            rb.x1 = Math.min(rb.x1, s.x1);
            rb.y1 = Math.min(rb.y1, s.y1);
            rb.x2 = Math.max(rb.x2, s.x2);
            rb.y2 = Math.max(rb.y2, s.y2);
            expanded = true;
            break;
          }
        }
        if (expanded) break;
      }
      // Step 1b: Partial 2..4-tile alcove expansion (strictly orthogonally attached to walkable room tiles!)
      if (!expanded) {
        for (const rb of rooms) {
          if (rb.deck !== deck || rb.name === 'Submarine Bay' || rb.name === 'Lifeboat Davit') continue;
          const partialBoxes: Array<{ x1: number; y1: number; x2: number; y2: number; attachDx: number; attachDy: number }> = [];
          const px1 = Math.max(rb.x1, thickCore.tx - 1);
          const px2 = Math.min(rb.x2, thickCore.tx + 1);
          const py1 = Math.max(rb.y1, thickCore.ty - 1);
          const py2 = Math.min(rb.y2, thickCore.ty + 1);
          if (px2 - px1 >= 1) {
            if (rb.y1 - 1 >= thickCore.ty - 1 && rb.y1 - 1 <= thickCore.ty + 2) {
              partialBoxes.push({ x1: px1, y1: rb.y1 - 1, x2: px2, y2: rb.y1 - 1, attachDx: 0, attachDy: 1 });
            }
            if (rb.y2 + 1 >= thickCore.ty - 2 && rb.y2 + 1 <= thickCore.ty + 1) {
              partialBoxes.push({ x1: px1, y1: rb.y2 + 1, x2: px2, y2: rb.y2 + 1, attachDx: 0, attachDy: -1 });
            }
          }
          if (py2 - py1 >= 1) {
            if (rb.x1 - 1 >= thickCore.tx - 1 && rb.x1 - 1 <= thickCore.tx + 2) {
              partialBoxes.push({ x1: rb.x1 - 1, y1: py1, x2: rb.x1 - 1, y2: py2, attachDx: 1, attachDy: 0 });
            }
            if (rb.x2 + 1 >= thickCore.tx - 2 && rb.x2 + 1 <= thickCore.tx + 1) {
              partialBoxes.push({ x1: rb.x2 + 1, y1: py1, x2: rb.x2 + 1, y2: py2, attachDx: -1, attachDy: 0 });
            }
          }
          for (const s of partialBoxes) {
            let canExpand = true;
            // Every cell of s must directly orthogonally attach to a walkable tile belonging to rb.id
            for (let ey = s.y1; ey <= s.y2 && canExpand; ey++) {
              for (let ex = s.x1; ex <= s.x2; ex++) {
                const ax = ex + s.attachDx;
                const ay = ey + s.attachDy;
                if (roomIdGrid[ay]?.[ax] !== rb.id || !isTileWalkable(tiles[ay]?.[ax] ?? 'VOID')) {
                  canExpand = false;
                  break;
                }
              }
            }
            for (let ey = s.y1 - 1; ey <= s.y2 + 1 && canExpand; ey++) {
              for (let ex = s.x1 - 1; ex <= s.x2 + 1; ex++) {
                if (!isInsideInteriorHull(ex, ey, deck, 0) || protectedFrames.has(key(ex, ey))) {
                  canExpand = false;
                  break;
                }
                if (ex >= s.x1 && ex <= s.x2 && ey >= s.y1 && ey <= s.y2) {
                  if (tiles[ey][ex] !== 'WALL') {
                    canExpand = false;
                    break;
                  }
                } else {
                  const isAttachNeighbor =
                    ex >= s.x1 + s.attachDx &&
                    ex <= s.x2 + s.attachDx &&
                    ey >= s.y1 + s.attachDy &&
                    ey <= s.y2 + s.attachDy;
                  if (!isAttachNeighbor && tiles[ey][ex] !== 'WALL') {
                    canExpand = false;
                    break;
                  }
                }
              }
            }
            if (canExpand) {
              const mat = floorMaterial[rb.y1]?.[rb.x1] ?? 'STEEL';
              for (let ey = s.y1; ey <= s.y2; ey++) {
                for (let ex = s.x1; ex <= s.x2; ex++) {
                  setTile(ex, ey, 'FLOOR', rb.name, mat, rb.id);
                }
              }
              rb.x1 = Math.min(rb.x1, s.x1);
              rb.y1 = Math.min(rb.y1, s.y1);
              rb.x2 = Math.max(rb.x2, s.x2);
              rb.y2 = Math.max(rb.y2, s.y2);
              expanded = true;
              break;
            }
          }
          if (expanded) break;
        }
      }
      if (expanded) continue;

      if (!allowCorridorCarve) {
        skippedThickCores.add(key(thickCore.tx, thickCore.ty));
        continue;
      }

      // Step 2: Weighted Dijkstra through pure WALL cores; breaching into a room requires valid door jambs (never leaves a hole!)
      const runWeightedCarve = (margin: number): number[] => {
        const startK = key(thickCore!.tx, thickCore!.ty);
        const distMap = new Int32Array(width * height).fill(1e9);
        const parent = new Int32Array(width * height).fill(-1);
        distMap[startK] = 0;
        const pq: Array<{ k: number; d: number }> = [{ k: startK, d: 0 }];
        const hits: number[] = [];

        while (pq.length > 0 && hits.length < 2) {
          let bestIdx = 0;
          for (let i = 1; i < pq.length; i++) {
            if (pq[i].d < pq[bestIdx].d) bestIdx = i;
          }
          const cur = pq.splice(bestIdx, 1)[0];
          if (cur.d > distMap[cur.k]) continue;
          const cx = cur.k % width;
          const cy = Math.floor(cur.k / width);

          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (!isInsideInteriorHull(nx, ny, deck, margin)) continue;
            if (
              tiles[ny - 1]?.[nx] === 'VOID' ||
              tiles[ny + 1]?.[nx] === 'VOID' ||
              tiles[ny]?.[nx - 1] === 'VOID' ||
              tiles[ny]?.[nx + 1] === 'VOID'
            ) {
              continue;
            }
            const nk = key(nx, ny);
            if (isTileWalkable(tiles[ny][nx])) {
              // If breaking into a named room, verify (cx, cy) can legally hold a framed Door (never leave a raw wall hole)
              if (roomIdGrid[ny][nx] >= 10) {
                const ori: 'H' | 'V' = nx === cx ? 'H' : 'V';
                const canFrameDoor =
                  (ori === 'H' && tiles[cy]?.[cx - 1] === 'WALL' && tiles[cy]?.[cx + 1] === 'WALL') ||
                  (ori === 'V' && tiles[cy - 1]?.[cx] === 'WALL' && tiles[cy + 1]?.[cx] === 'WALL');
                if (!canFrameDoor || protectedFrames.has(key(cx, cy))) continue;
              }
              const farEnough = hits.every((hk) => {
                const hx = hk % width;
                const hy = Math.floor(hk / width);
                return Math.abs(hx - nx) + Math.abs(hy - ny) >= 3;
              });
              if (farEnough && !hits.includes(nk)) {
                parent[nk] = cur.k;
                hits.push(nk);
              }
              continue;
            }
            if (protectedFrames.has(nk)) continue;
            // If (nx, ny) is a room's perimeter WALL, allow breaking straight through it into that room ONLY as a valid framed Door!
            if (
              roomIdGrid[ny - 1]?.[nx] >= 10 ||
              roomIdGrid[ny + 1]?.[nx] >= 10 ||
              roomIdGrid[ny]?.[nx - 1] >= 10 ||
              roomIdGrid[ny]?.[nx + 1] >= 10
            ) {
              const rx = nx + dx;
              const ry = ny + dy;
              const rk = key(rx, ry);
              if (
                isInsideInteriorHull(rx, ry, deck, 1) &&
                isTileWalkable(tiles[ry]?.[rx] ?? 'VOID') &&
                roomIdGrid[ry]?.[rx] >= 10
              ) {
                const ori: 'H' | 'V' = dx === 0 ? 'H' : 'V';
                const canFrameDoor =
                  (ori === 'H' && tiles[ny]?.[nx - 1] === 'WALL' && tiles[ny]?.[nx + 1] === 'WALL') ||
                  (ori === 'V' && tiles[ny - 1]?.[nx] === 'WALL' && tiles[ny + 1]?.[nx] === 'WALL');
                const farEnough = hits.every((hk) => {
                  const hx = hk % width;
                  const hy = Math.floor(hk / width);
                  return Math.abs(hx - rx) + Math.abs(hy - ry) >= 3;
                });
                if (canFrameDoor && farEnough && !hits.includes(rk)) {
                  parent[nk] = cur.k;
                  parent[rk] = nk;
                  hits.push(rk);
                }
              }
              continue;
            }
            let perpWalkable = 0;
            if (dx !== 0) {
              if (isTileWalkable(tiles[ny - 1]?.[nx] ?? 'VOID')) perpWalkable++;
              if (isTileWalkable(tiles[ny + 1]?.[nx] ?? 'VOID')) perpWalkable++;
            } else {
              if (isTileWalkable(tiles[ny]?.[nx - 1] ?? 'VOID')) perpWalkable++;
              if (isTileWalkable(tiles[ny]?.[nx + 1] ?? 'VOID')) perpWalkable++;
            }
            // On Deck 1 (allowCorridorCarve=true), strongly penalize forming any 2x2 corridor block
            let twoByTwoPenalty = 0;
            if (allowCorridorCarve) {
              for (const [ox, oy] of [
                [-1, -1],
                [0, -1],
                [-1, 0],
                [0, 0],
              ]) {
                let adjFloor = 0;
                for (let py = 0; py < 2; py++) {
                  for (let px = 0; px < 2; px++) {
                    const tx2 = nx + ox + px;
                    const ty2 = ny + oy + py;
                    if (tx2 === nx && ty2 === ny) continue;
                    if (isTileWalkable(tiles[ty2]?.[tx2] ?? 'VOID')) adjFloor++;
                  }
                }
                if (adjFloor >= 3) twoByTwoPenalty += 120;
              }
            }
            const stepCost = 1 + perpWalkable * 14 + twoByTwoPenalty;
            const nd = cur.d + stepCost;
            if (nd < distMap[nk]) {
              distMap[nk] = nd;
              parent[nk] = cur.k;
              pq.push({ k: nk, d: nd });
            }
          }
        }

        if (hits.length === 0) return [];
        const targets = hits.length >= 2 ? [hits[0], hits[1]] : [hits[0]];
        for (const hk of targets) {
          let cur = parent[hk];
          const htx = hk % width;
          const hty = Math.floor(hk / width);
          const wallEdgeX = cur % width;
          const wallEdgeY = Math.floor(cur / width);
          const brokeIntoRoom = roomIdGrid[hty][htx] >= 10;

          while (cur !== -1) {
            const px = cur % width;
            const py = Math.floor(cur / width);
            setTile(px, py, 'FLOOR', 'Corridor', 'STEEL', CORRIDOR_ID[deck]);
            protectedCorridorKeys.add(key(px, py));
            cur = parent[cur];
          }

          if (brokeIntoRoom) {
            const ori: 'H' | 'V' = htx === wallEdgeX ? 'H' : 'V';
            if (
              (ori === 'H' && tiles[wallEdgeY][wallEdgeX - 1] === 'WALL' && tiles[wallEdgeY][wallEdgeX + 1] === 'WALL') ||
              (ori === 'V' && tiles[wallEdgeY - 1][wallEdgeX] === 'WALL' && tiles[wallEdgeY + 1][wallEdgeX] === 'WALL')
            ) {
              addDoorway(wallEdgeX, wallEdgeY, ori, 'Corridor', 'STEEL', { open: false });
            }
          }
        }
        return targets;
      };

      let carved = runWeightedCarve(1);
      if (carved.length === 0) {
        carved = runWeightedCarve(0);
      }
      if (carved.length === 0) {
        skippedThickCores.add(key(thickCore.tx, thickCore.ty));
      }
    }

    // Only remove 1x1 isolated wall pinholes when all 4 orthogonal neighbors share the same room/corridor ID
    for (let y = band.y1 + 2; y <= band.y2 - 2; y++) {
      for (let x = 9; x < width - 9; x++) {
        if (tiles[y][x] !== 'WALL') continue;
        if (getProtectedDoorFrameKeys().has(key(x, y))) continue;
        const nIds = [
          roomIdGrid[y - 1][x],
          roomIdGrid[y + 1][x],
          roomIdGrid[y][x - 1],
          roomIdGrid[y][x + 1],
        ];
        if (
          isTileWalkable(tiles[y - 1][x]) &&
          isTileWalkable(tiles[y + 1][x]) &&
          isTileWalkable(tiles[y][x - 1]) &&
          isTileWalkable(tiles[y][x + 1]) &&
          nIds.every((id) => id === nIds[0])
        ) {
          const targetId = nIds[0];
          const targetRoom = roomGrid[y - 1][x];
          if (allowCorridorCarve && targetRoom === 'Corridor') continue;
          setTile(x, y, 'FLOOR', targetRoom, floorMaterial[y - 1][x], targetId);
        }
      }
    }
  };

  cleanFleshyCorridors('DECK_1', true);
  cleanFleshyCorridors('DECK_2', false);
  runAntiThiccWallPass('DECK_2', false);
  runAntiThiccWallPass('DECK_1', true);
  cleanFleshyCorridors('DECK_1', true, true);
  cleanFleshyCorridors('DECK_2', false);
  pruneInvalidDoors();

  // Re-enforce unbroken outer steel skin around Deck 2 & Deck 1 hull boundaries after final carving
  for (const deck of ['DECK_2', 'DECK_1'] as const) {
    const band = deckBounds[deck];
    for (let y = band.y1 + 1; y < band.y2; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (deckGrid[y][x] !== deck || tiles[y][x] === 'VOID') continue;
        if (deck === 'DECK_2' && roomIdGrid[y][x] === lifeboatRoomId) continue;
        if (stairKeys.has(key(x, y))) continue;
        const touchesVoid =
          tiles[y - 1][x] === 'VOID' ||
          tiles[y + 1][x] === 'VOID' ||
          tiles[y][x - 1] === 'VOID' ||
          tiles[y][x + 1] === 'VOID';
        if (touchesVoid && tiles[y][x] !== 'WALL') {
          setTile(x, y, 'WALL', 'Corridor', 'STEEL', CORRIDOR_ID[deck]);
        }
      }
    }
  }
  pruneInvalidDoors();

  // =========================================================================
  // --- 5d. Room Wall-Hole Bug Repair & Deck 1 Watertight Corridor Doors ---
  // =========================================================================
  // Guarantees ZERO un-doored holes where an enclosed room meets a Corridor or another room
  const openExteriorRooms = new Set<RoomName>([
    'Helideck',
    'Lifeboat Davit',
    'Weather Deck',
    'Container Bay',
    'Forecastle',
  ]);
  const repairRoomWallHoles = (allowBreakingBridge = false) => {
    for (let pass = 0; pass < 4; pass++) {
      let fixedAny = false;
      const doorSetNow = new Set(doors.map((d) => key(d.tx, d.ty)));
      for (let y = 2; y < height - 2; y++) {
        for (let x = 2; x < width - 2; x++) {
          const idA = roomIdGrid[y][x];
          if (idA < 10 || !isTileWalkable(tiles[y][x])) continue;
          const nameA = roomGrid[y][x];
          if (openExteriorRooms.has(nameA)) continue;

          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = x + dx;
            const ny = y + dy;
            if (!isTileWalkable(tiles[ny][nx])) continue;
            const idB = roomIdGrid[ny][nx];
            if (idB === idA) continue;
            const nameB = roomGrid[ny][nx];
            if (openExteriorRooms.has(nameB)) continue;
            if (doorSetNow.has(key(x, y)) || doorSetNow.has(key(nx, ny))) continue;

            // Found an un-doored hole between room A and room/corridor B!
            const ori: 'H' | 'V' = dx === 0 ? 'H' : 'V';
            const tryPlaceDoorAt = (tx: number, ty: number): boolean => {
              const validPass =
                ori === 'H'
                  ? tiles[ty]?.[tx - 1] === 'WALL' &&
                    tiles[ty]?.[tx + 1] === 'WALL' &&
                    isTileWalkable(tiles[ty - 1]?.[tx] ?? 'VOID') &&
                    isTileWalkable(tiles[ty + 1]?.[tx] ?? 'VOID')
                  : tiles[ty - 1]?.[tx] === 'WALL' &&
                    tiles[ty + 1]?.[tx] === 'WALL' &&
                    isTileWalkable(tiles[ty]?.[tx - 1] ?? 'VOID') &&
                    isTileWalkable(tiles[ty]?.[tx + 1] ?? 'VOID');
              if (validPass) {
                addDoorway(tx, ty, ori, roomGrid[ty][tx], floorMaterial[ty][tx], {
                  open: false,
                  roomId: roomIdGrid[ty][tx],
                });
                doorSetNow.add(key(tx, ty));
                return true;
              }
              return false;
            };

            if (tryPlaceDoorAt(x, y) || tryPlaceDoorAt(nx, ny)) {
              fixedAny = true;
              continue;
            }

            // Cannot legally frame a door here -> seal the corridor/leak tile (never overwrite stairs)
            const sealX = idB < 10 ? nx : x;
            const sealY = idB < 10 ? ny : y;
            if (stairKeys.has(key(sealX, sealY))) continue;
            const prevTile = tiles[sealY][sealX];
            const prevRoom = roomGrid[sealY][sealX];
            const prevMat = floorMaterial[sealY][sealX];
            const prevId = roomIdGrid[sealY][sealX];
            const visBefore = allowBreakingBridge ? null : runReachabilityBfs(rootTx, rootTy, true);
            setTile(sealX, sealY, 'WALL', 'Corridor', 'STEEL', CORRIDOR_ID[getDeckForY(sealY)]);
            if (!allowBreakingBridge && visBefore) {
              const visCheck = runReachabilityBfs(rootTx, rootTy, true);
              let breaksRoom = false;
              for (const rb of rooms) {
                if (rb.deck !== getDeckForY(sealY)) continue;
                let wasReached = false;
                let nowReached = false;
                for (let ry = rb.y1; ry <= rb.y2; ry++) {
                  for (let rx = rb.x1; rx <= rb.x2; rx++) {
                    if (roomIdGrid[ry][rx] === rb.id && isTileWalkable(tiles[ry][rx])) {
                      if (visBefore[key(rx, ry)] === 1) wasReached = true;
                      if (visCheck[key(rx, ry)] === 1) nowReached = true;
                    }
                  }
                }
                if (wasReached && !nowReached) {
                  breaksRoom = true;
                  break;
                }
              }
              if (breaksRoom) {
                setTile(sealX, sealY, prevTile, prevRoom, prevMat, prevId);
              } else {
                fixedAny = true;
              }
            } else {
              fixedAny = true;
            }
          }
        }
      }
      if (!fixedAny) break;
    }
  };
  repairRoomWallHoles(true);
  pruneInvalidDoors();

  // Final post-repair reachability guarantee: ensure zero unreachable rooms, multi-room pockets, or corridor fragments
  // Processes DECK_3 -> DECK_2 -> DECK_1 in order so stairs into each lower deck are already reachable!
  for (let pass = 0; pass < 72; pass++) {
    const visAll = runReachabilityBfs(rootTx, rootTy, true);
    let fixedUnreach = false;

    for (const targetDeck of ['DECK_3', 'DECK_2', 'DECK_1'] as const) {
      const band = deckBounds[targetDeck];
      // Find an unreachable seed tile on this deck (prefer a room first, else any unreachable walkable pocket)
      let seedTiles: Array<{ tx: number; ty: number }> = [];
      let seedFromRoom = false;

      for (const rb of rooms) {
        if (rb.deck !== targetDeck) continue;
        const rTiles: Array<{ tx: number; ty: number }> = [];
        let anyReached = false;
        for (let y = rb.y1; y <= rb.y2; y++) {
          for (let x = rb.x1; x <= rb.x2; x++) {
            if (roomIdGrid[y]?.[x] === rb.id && isTileWalkable(tiles[y]?.[x] ?? 'VOID')) {
              rTiles.push({ tx: x, ty: y });
              if (visAll[key(x, y)] === 1) anyReached = true;
            }
          }
        }
        if (rTiles.length > 0 && !anyReached) {
          seedTiles = rTiles;
          seedFromRoom = true;
          break;
        }
      }

      if (seedTiles.length === 0) {
        for (let y = band.y1 + 1; y < band.y2 && seedTiles.length === 0; y++) {
          for (let x = 1; x < width - 1; x++) {
            if (isTileWalkable(tiles[y][x]) && visAll[key(x, y)] === 0) {
              seedTiles = [{ tx: x, ty: y }];
              break;
            }
          }
        }
      }

      if (seedTiles.length === 0) continue;

      // Expand to full unreachable walkable component on targetDeck (catches multi-room pockets as a unit!)
      const compSet = new Set<number>();
      const compQueue: Array<{ tx: number; ty: number }> = [];
      for (const st of seedTiles) {
        const sk = key(st.tx, st.ty);
        if (!compSet.has(sk)) {
          compSet.add(sk);
          compQueue.push(st);
        }
      }
      for (let qIdx = 0; qIdx < compQueue.length; qIdx++) {
        const cur = compQueue[qIdx];
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cur.tx + dx;
          const ny = cur.ty + dy;
          if (nx <= 0 || nx >= width - 1 || ny <= band.y1 || ny >= band.y2) continue;
          if (!isTileWalkable(tiles[ny]?.[nx] ?? 'VOID')) continue;
          const nk = key(nx, ny);
          if (visAll[nk] === 1 || compSet.has(nk)) continue;
          compSet.add(nk);
          compQueue.push({ tx: nx, ty: ny });
        }
      }

      // Weighted Dijkstra from the entire isolated component through walls to visAll === 1 on targetDeck,
      // requiring valid WALL door jambs whenever stepping between a named room and a wall!
      const runReconnectSearch = (requireDoorJambs: boolean): number[] | null => {
        const dist = new Int32Array(width * height).fill(1e9);
        const parent = new Int32Array(width * height).fill(-1);
        const pq: Array<{ k: number; d: number }> = [];
        for (const ck of compSet) {
          dist[ck] = 0;
          pq.push({ k: ck, d: 0 });
        }
        let foundTargetKey = -1;
        while (pq.length > 0 && foundTargetKey === -1) {
          let bestIdx = 0;
          for (let i = 1; i < pq.length; i++) {
            if (pq[i].d < pq[bestIdx].d) bestIdx = i;
          }
          const cur = pq.splice(bestIdx, 1)[0];
          if (cur.d > dist[cur.k]) continue;
          const cx = cur.k % width;
          const cy = Math.floor(cur.k / width);

          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (!isInsideInteriorHull(nx, ny, targetDeck, 1) || ny <= band.y1 || ny >= band.y2) continue;
            const nk = key(nx, ny);
            if (compSet.has(nk)) continue;

            const curWalk = isTileWalkable(tiles[cy][cx]);
            const nextWalk = isTileWalkable(tiles[ny][nx]);
            const ori: 'H' | 'V' = dx === 0 ? 'H' : 'V';

            if (requireDoorJambs) {
              // If cur is a wall tile just stepped into from a named room, continue straight so the doorframe isn't turned on a corner
              if (!curWalk && parent[cur.k] !== -1) {
                const pk = parent[cur.k];
                const px = pk % width;
                const py = Math.floor(pk / width);
                if (roomIdGrid[py]?.[px] >= 10 && !openExteriorRooms.has(roomGrid[py][px])) {
                  if (dx !== cx - px || dy !== cy - py) continue;
                }
              }
              // If stepping from a named room into a wall, (nx, ny) must hold valid WALL jambs
              if (!nextWalk && curWalk && roomIdGrid[cy][cx] >= 10 && !openExteriorRooms.has(roomGrid[cy][cx])) {
                const canFrame =
                  (ori === 'H' && tiles[ny]?.[nx - 1] === 'WALL' && tiles[ny]?.[nx + 1] === 'WALL') ||
                  (ori === 'V' && tiles[ny - 1]?.[nx] === 'WALL' && tiles[ny + 1]?.[nx] === 'WALL');
                if (!canFrame) continue;
              }
              // If stepping from a carved wall into a named room, (cx, cy) must hold valid WALL jambs
              if (nextWalk && !curWalk && roomIdGrid[ny][nx] >= 10 && !openExteriorRooms.has(roomGrid[ny][nx])) {
                const canFrame =
                  (ori === 'H' && tiles[cy]?.[cx - 1] === 'WALL' && tiles[cy]?.[cx + 1] === 'WALL') ||
                  (ori === 'V' && tiles[cy - 1]?.[cx] === 'WALL' && tiles[cy + 1]?.[cx] === 'WALL');
                if (!canFrame) continue;
              }
              // Never carve a wall tile that grazes the perpendicular side of an enclosed room (creates an un-doored corner hole),
              // or approaches an enclosed room straight ahead without valid perpendicular WALL jambs
              if (!nextWalk) {
                const pdx = dy;
                const pdy = dx;
                const p1x = nx + pdx;
                const p1y = ny + pdy;
                const p2x = nx - pdx;
                const p2y = ny - pdy;
                const touchesPerpRoom =
                  (isTileWalkable(tiles[p1y]?.[p1x] ?? 'VOID') &&
                    roomIdGrid[p1y]?.[p1x] >= 10 &&
                    !openExteriorRooms.has(roomGrid[p1y][p1x])) ||
                  (isTileWalkable(tiles[p2y]?.[p2x] ?? 'VOID') &&
                    roomIdGrid[p2y]?.[p2x] >= 10 &&
                    !openExteriorRooms.has(roomGrid[p2y][p2x]));
                if (touchesPerpRoom) continue;
                const ax = nx + dx;
                const ay = ny + dy;
                if (
                  isTileWalkable(tiles[ay]?.[ax] ?? 'VOID') &&
                  roomIdGrid[ay]?.[ax] >= 10 &&
                  !openExteriorRooms.has(roomGrid[ay][ax]) &&
                  (tiles[p1y]?.[p1x] !== 'WALL' || tiles[p2y]?.[p2x] !== 'WALL')
                ) {
                  continue;
                }
              }
            }

            // Prefer piercing walls from Corridor tiles rather than punching extra holes in rooms
            let stepCost = nextWalk ? 1 : 20;
            if (!curWalk && !nextWalk) {
              const adjRoom =
                roomIdGrid[ny - 1]?.[nx] >= 10 ||
                roomIdGrid[ny + 1]?.[nx] >= 10 ||
                roomIdGrid[ny]?.[nx - 1] >= 10 ||
                roomIdGrid[ny]?.[nx + 1] >= 10;
              if (adjRoom) stepCost += 15;
            }
            if (curWalk && roomIdGrid[cy][cx] >= 10) stepCost += 8;

            const nd = cur.d + stepCost;
            if (nd < dist[nk]) {
              dist[nk] = nd;
              parent[nk] = cur.k;
              if (visAll[nk] === 1) {
                foundTargetKey = nk;
                break;
              }
              pq.push({ k: nk, d: nd });
            }
          }
        }
        if (foundTargetKey === -1) return null;
        const pathKeys: number[] = [];
        let trace = foundTargetKey;
        while (trace !== -1) {
          pathKeys.push(trace);
          trace = parent[trace];
        }
        pathKeys.reverse();
        return pathKeys;
      };

      const pathKeys = runReconnectSearch(true) ?? runReconnectSearch(false);
      if (pathKeys && pathKeys.length >= 2) {
        const doorSetNow = new Set(doors.map((d) => key(d.tx, d.ty)));
        for (let i = 1; i < pathKeys.length - 1; i++) {
          const pk = pathKeys[i];
          const px = pk % width;
          const py = Math.floor(pk / width);
          if (!isTileWalkable(tiles[py][px])) {
            setTile(px, py, 'FLOOR', 'Corridor', 'STEEL', CORRIDOR_ID[targetDeck]);
            const prevK = pathKeys[i - 1];
            const nextK = pathKeys[i + 1];
            const prevX = prevK % width;
            const prevY = Math.floor(prevK / width);
            const nextX = nextK % width;
            const nextY = Math.floor(nextK / width);
            const touchesNamedRoom =
              (roomIdGrid[prevY]?.[prevX] >= 10 && !openExteriorRooms.has(roomGrid[prevY][prevX])) ||
              (roomIdGrid[nextY]?.[nextX] >= 10 && !openExteriorRooms.has(roomGrid[nextY][nextX]));
            if (touchesNamedRoom && !doorSetNow.has(pk)) {
              const ori: 'H' | 'V' = prevX === px && nextX === px ? 'H' : 'V';
              if (
                (ori === 'H' && tiles[py]?.[px - 1] === 'WALL' && tiles[py]?.[px + 1] === 'WALL') ||
                (ori === 'V' && tiles[py - 1]?.[px] === 'WALL' && tiles[py + 1]?.[px] === 'WALL')
              ) {
                addDoorway(px, py, ori, 'Corridor', 'STEEL', { open: false });
                doorSetNow.add(pk);
              }
            }
          }
        }
        fixedUnreach = true;
        break;
      }

      // If no path existed at all on targetDeck and it's only a tiny dead corridor pocket (no rooms/stairs), seal it
      if (!seedFromRoom) {
        let hasProtected = false;
        for (const ck of compSet) {
          const cx = ck % width;
          const cy = Math.floor(ck / width);
          if (roomIdGrid[cy][cx] >= 10 || stairKeys.has(ck)) {
            hasProtected = true;
            break;
          }
        }
        if (!hasProtected) {
          for (const ck of compSet) {
            const cx = ck % width;
            const cy = Math.floor(ck / width);
            setTile(cx, cy, 'WALL', 'Corridor', 'STEEL', CORRIDOR_ID[targetDeck]);
          }
          fixedUnreach = true;
          break;
        }
      }
    }

    if (!fixedUnreach) break;
  }
  repairRoomWallHoles(false);
  pruneInvalidDoors();

  // Final Deck 1 anti-thicc-wall cleanup + stray unreachable corridor pocket sweep
  runAntiThiccWallPass('DECK_1', true);
  cleanFleshyCorridors('DECK_1', true, true);
  repairRoomWallHoles(false);
  pruneInvalidDoors();
  {
    const visFinal = runReachabilityBfs(rootTx, rootTy, true);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (isTileWalkable(tiles[y][x]) && visFinal[key(x, y)] === 0 && roomIdGrid[y][x] < 10 && !stairKeys.has(key(x, y))) {
          setTile(x, y, 'WALL', 'Corridor', 'STEEL', CORRIDOR_ID[getDeckForY(y)]);
        }
      }
    }
  }

  // Unlock any locked door that blocks ANY non-locked room, corridor, or stairwell (check true opposite passage tiles!)
  for (const d of doors) {
    if (!d.isLocked) continue;
    const visUnlocked = runReachabilityBfs(rootTx, rootTy, false);
    const passTiles =
      d.orientation === 'H'
        ? [
            { tx: d.tx, ty: d.ty - 1 },
            { tx: d.tx, ty: d.ty + 1 },
          ]
        : [
            { tx: d.tx - 1, ty: d.ty },
            { tx: d.tx + 1, ty: d.ty },
          ];
    const reachesBothSides = passTiles.every(
      (pt) => isTileWalkable(tiles[pt.ty]?.[pt.tx] ?? 'VOID') && visUnlocked[key(pt.tx, pt.ty)] === 1
    );
    if (!reachesBothSides) {
      d.isLocked = false;
    }
  }

  // Split Deck 1 1-wide hallways with heavy, slow, loud watertight bulkhead doors
  const placeWatertightCorridorDoors = () => {
    const band = deckBounds.DECK_1;
    const stairSetNow = new Set(stairwells.map((s) => key(s.tx, s.ty)));
    const doorSetNow = new Set(doors.map((d) => key(d.tx, d.ty)));
    const wtCands: Array<{ tx: number; ty: number; ori: 'H' | 'V' }> = [];

    for (let y = band.y1 + 3; y <= band.y2 - 3; y++) {
      for (let x = 14; x <= width - 14; x++) {
        if (tiles[y][x] !== 'FLOOR' || roomGrid[y][x] !== 'Corridor') continue;
        if (stairSetNow.has(key(x, y)) || doorSetNow.has(key(x, y))) continue;
        // Avoid placing adjacent to existing doors or stairs
        let nearSpecial = false;
        for (let dy = -1; dy <= 1 && !nearSpecial; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nk = key(x + dx, y + dy);
            if (stairSetNow.has(nk) || doorSetNow.has(nk)) {
              nearSpecial = true;
              break;
            }
          }
        }
        if (nearSpecial) continue;

        const isH =
          tiles[y][x - 1] === 'WALL' &&
          tiles[y][x + 1] === 'WALL' &&
          tiles[y - 1][x] === 'FLOOR' &&
          tiles[y + 1][x] === 'FLOOR' &&
          roomGrid[y - 1][x] === 'Corridor' &&
          roomGrid[y + 1][x] === 'Corridor';
        const isV =
          tiles[y - 1][x] === 'WALL' &&
          tiles[y + 1][x] === 'WALL' &&
          tiles[y][x - 1] === 'FLOOR' &&
          tiles[y][x + 1] === 'FLOOR' &&
          roomGrid[y][x - 1] === 'Corridor' &&
          roomGrid[y][x + 1] === 'Corridor';

        if (isH) wtCands.push({ tx: x, ty: y, ori: 'H' });
        else if (isV) wtCands.push({ tx: x, ty: y, ori: 'V' });
      }
    }

    for (let i = wtCands.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [wtCands[i], wtCands[j]] = [wtCands[j], wtCands[i]];
    }

    const placedWt: Array<{ tx: number; ty: number }> = [];
    for (const cand of wtCands) {
      if (placedWt.length >= 8) break;
      if (placedWt.some((p) => Math.hypot(p.tx - cand.tx, p.ty - cand.ty) < 9)) continue;
      addDoorway(cand.tx, cand.ty, cand.ori, 'Corridor', 'STEEL', {
        open: false,
        watertight: true,
        roomId: CORRIDOR_ID.DECK_1,
      });
      placedWt.push({ tx: cand.tx, ty: cand.ty });
    }
  };
  placeWatertightCorridorDoors();

  // =========================================================================
  // --- 6. Wall-Mounted Broken Steam Pipes Along Deck 1 Winding Corridors ---
  // =========================================================================
  const doorKeys = new Set(doors.map((d) => key(d.tx, d.ty)));
  const collectPipeCandidates = (minClear: number) => {
    const cands: Array<{
      wallTx: number;
      wallTy: number;
      nozzleTx: number;
      nozzleTy: number;
      dirX: number;
      dirY: number;
      rangeTiles: number;
    }> = [];
    for (let y = deckBounds.DECK_1.y1 + 2; y <= deckBounds.DECK_1.y2 - 2; y++) {
      for (let x = 12; x < width - 12; x++) {
        if (tiles[y][x] !== 'FLOOR' || roomGrid[y][x] !== 'Corridor') continue;
        if (stairKeys.has(key(x, y)) || doorKeys.has(key(x, y))) continue;

        const cardinals = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const;

        for (const [dx, dy] of cardinals) {
          const wallTx = x - dx;
          const wallTy = y - dy;
          if (tiles[wallTy]?.[wallTx] !== 'WALL') continue;
          let clearTiles = 0;
          for (let step = 0; step < 4; step++) {
            const cx = x + dx * step;
            const cy = y + dy * step;
            if (!isTileWalkable(tiles[cy]?.[cx] ?? 'VOID')) break;
            if (doorKeys.has(key(cx, cy))) break;
            clearTiles++;
          }
          if (clearTiles >= minClear) {
            cands.push({
              wallTx,
              wallTy,
              nozzleTx: x,
              nozzleTy: y,
              dirX: dx,
              dirY: dy,
              rangeTiles: clearTiles,
            });
          }
        }
      }
    }
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cands[i], cands[j]] = [cands[j], cands[i]];
    }
    return cands;
  };

  let pipeSeq = 0;
  for (const minClear of [3, 2]) {
    const cands = collectPipeCandidates(minClear);
    for (const pc of cands) {
      if (steamPipes.length >= 9) break;
      const tooClose = steamPipes.some(
        (p) => Math.hypot(p.nozzleTx - pc.nozzleTx, p.nozzleTy - pc.nozzleTy) < 9
      );
      if (tooClose) continue;
      const wx = (pc.nozzleTx + 0.5 - pc.dirX * 0.42) * tileSize;
      const wy = (pc.nozzleTy + 0.5 - pc.dirY * 0.42) * tileSize;
      const nextInterval = 6.5 + rng() * 5.0;
      steamPipes.push({
        id: `pipe_${pipeSeq++}`,
        deck: 'DECK_1',
        wallTx: pc.wallTx,
        wallTy: pc.wallTy,
        nozzleTx: pc.nozzleTx,
        nozzleTy: pc.nozzleTy,
        x: wx,
        y: wy,
        dirX: pc.dirX,
        dirY: pc.dirY,
        rangeTiles: Math.min(4, pc.rangeTiles),
        cycleTimer: 2.5 + rng() * 6.5,
        warningTimer: 0,
        activeTimer: 0,
        nextInterval,
      });
    }
  }

  // =========================================================================
  // --- 7. Stationary Per-Deck Paper Map Stands (1 per deck, non-portable) ---
  // =========================================================================
  const paperMaps: PaperMapStand[] = [];
  const preferredMapLocations: Array<{ deck: ShipDeck; targetTx: number; targetTy: number }> = [
    { deck: 'DECK_3', targetTx: stair32MidTop.tx + 2, targetTy: stair32MidTop.ty },
    { deck: 'DECK_2', targetTx: 58, targetTy: deckBounds.DECK_2.centerY },
    { deck: 'DECK_1', targetTx: 58, targetTy: deckBounds.DECK_1.centerY },
  ];

  for (const loc of preferredMapLocations) {
    let bestTile: { tx: number; ty: number; dist: number } | null = null;
    const band = deckBounds[loc.deck];
    for (let y = band.y1 + 2; y <= band.y2 - 2; y++) {
      for (let x = 8; x < width - 8; x++) {
        if (!isTileWalkable(tiles[y][x])) continue;
        if (reserved.has(key(x, y)) || doorKeys.has(key(x, y)) || stairKeys.has(key(x, y))) continue;
        if (roomGrid[y][x] === 'Helideck' || roomGrid[y][x] === 'Lifeboat Davit' || roomGrid[y][x] === 'Submarine Bay') continue;
        const hasWallAdj =
          tiles[y - 1][x] === 'WALL' ||
          tiles[y + 1][x] === 'WALL' ||
          tiles[y][x - 1] === 'WALL' ||
          tiles[y][x + 1] === 'WALL';
        if (!hasWallAdj) continue;
        const d = Math.hypot(x - loc.targetTx, y - loc.targetTy);
        if (!bestTile || d < bestTile.dist) {
          bestTile = { tx: x, ty: y, dist: d };
        }
      }
    }
    if (bestTile) {
      reserved.add(key(bestTile.tx, bestTile.ty));
      paperMaps.push({
        id: `map_${loc.deck.toLowerCase()}`,
        deck: loc.deck,
        tx: bestTile.tx,
        ty: bestTile.ty,
        x: (bestTile.tx + 0.5) * tileSize,
        y: (bestTile.ty + 0.5) * tileSize,
        room: roomGrid[bestTile.ty][bestTile.tx],
        roomId: roomIdGrid[bestTile.ty][bestTile.tx],
      });
    }
  }

  // =========================================================================
  // --- 8. Room-Scoped Light Switches, Hiding Spots & Searchable Containers ---
  // =========================================================================
  const findFreeTilesInRoomId = (rId: number): Array<{ tx: number; ty: number }> => {
    const res: Array<{ tx: number; ty: number }> = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (roomIdGrid[y][x] === rId && isTileWalkable(tiles[y][x]) && !reserved.has(key(x, y))) {
          res.push({ tx: x, ty: y });
        }
      }
    }
    return res;
  };

  const findFreeTilesOnDeckRoom = (
    roomName: RoomName,
    deck?: ShipDeck
  ): Array<{ tx: number; ty: number }> => {
    const res: Array<{ tx: number; ty: number }> = [];
    for (let y = 0; y < height; y++) {
      if (deck && deckGrid[y][0] !== deck) continue;
      for (let x = 0; x < width; x++) {
        if (roomGrid[y][x] === roomName && isTileWalkable(tiles[y][x]) && !reserved.has(key(x, y))) {
          res.push({ tx: x, ty: y });
        }
      }
    }
    return res;
  };

  const pickWallAdjacentTile = (candidates: Array<{ tx: number; ty: number }>) => {
    const scored = candidates.map((c) => {
      let wallNeighbors = 0;
      if (!isTileWalkable(tiles[c.ty - 1]?.[c.tx] ?? 'VOID')) wallNeighbors++;
      if (!isTileWalkable(tiles[c.ty + 1]?.[c.tx] ?? 'VOID')) wallNeighbors++;
      if (!isTileWalkable(tiles[c.ty]?.[c.tx - 1] ?? 'VOID')) wallNeighbors++;
      if (!isTileWalkable(tiles[c.ty]?.[c.tx + 1] ?? 'VOID')) wallNeighbors++;
      // Slight penalty if adjacent to a door so doorways stay uncluttered
      const nearDoor =
        doorKeys.has(key(c.tx - 1, c.ty)) ||
        doorKeys.has(key(c.tx + 1, c.ty)) ||
        doorKeys.has(key(c.tx, c.ty - 1)) ||
        doorKeys.has(key(c.tx, c.ty + 1))
          ? 1
          : 0;
      return { c, score: wallNeighbors - nearDoor * 2, tie: rng() };
    });
    scored.sort((a, b) => b.score - a.score || a.tie - b.tie);
    return scored[0]?.c ?? null;
  };

  const noSwitchRooms = new Set<RoomName>([
    'Helideck',
    'Lifeboat Davit',
    'Weather Deck',
    'Container Bay',
    'Forecastle',
    'Corridor',
    'Catwalk',
  ]);
  const lightSwitches: RoomLightSwitch[] = [];
  let switchSeq = 0;

  for (const rb of rooms) {
    if (noSwitchRooms.has(rb.name)) continue;
    const free = findFreeTilesInRoomId(rb.id);
    const chosen = pickWallAdjacentTile(free);
    if (!chosen) continue;
    reserved.add(key(chosen.tx, chosen.ty));
    lightSwitches.push({
      id: `light_${switchSeq++}`,
      roomId: rb.id,
      room: rb.name,
      tx: chosen.tx,
      ty: chosen.ty,
      x: (chosen.tx + 0.5) * tileSize,
      y: (chosen.ty + 0.5) * tileSize,
      isOn: false,
    });
  }

  const hidingSpots: HidingSpot[] = [];
  let hideSeq = 0;
  const spotTypeForRoom = (r: RoomName): HidingSpotType => {
    if (r === 'Container Bay' || r === 'Cargo Hold' || r === 'Storage Room') return 'CARGO_CRATE';
    if (r === 'Chart Room' || r === 'Officers Mess' || r === 'Galley & Mess' || r === 'Radio Room') {
      return 'UNDER_DESK';
    }
    return 'LOCKER';
  };
  const spotCountForRoom = (rb: RoomBounds): number => {
    if (rb.name === 'Helideck' || rb.name === 'Lifeboat Davit' || rb.name === 'Weather Deck' || rb.name === 'Forecastle') {
      return 0;
    }
    const area = (rb.x2 - rb.x1 + 1) * (rb.y2 - rb.y1 + 1);
    if (rb.name === 'Container Bay') return 3;
    if (area >= 48) return 2;
    return 1;
  };

  for (const rb of rooms) {
    const count = spotCountForRoom(rb);
    const sType = spotTypeForRoom(rb.name);
    for (let i = 0; i < count; i++) {
      const free = findFreeTilesInRoomId(rb.id);
      const chosen = pickWallAdjacentTile(free);
      if (!chosen) break;
      reserved.add(key(chosen.tx, chosen.ty));
      hidingSpots.push({
        id: `hide_${hideSeq++}`,
        tx: chosen.tx,
        ty: chosen.ty,
        x: (chosen.tx + 0.5) * tileSize,
        y: (chosen.ty + 0.5) * tileSize,
        type: sType,
        room: rb.name,
        roomId: rb.id,
        deck: rb.deck,
        angle: rng() * Math.PI * 2,
        checkedFlash: 0,
      });
    }
  }

  // Corridor lockers spread across all 3 decks for chase counterplay
  for (const d of ['DECK_3', 'DECK_2', 'DECK_1'] as const) {
    const cCount = d === 'DECK_1' ? 4 : 3;
    for (let i = 0; i < cCount; i++) {
      const free = findFreeTilesOnDeckRoom('Corridor', d);
      const chosen = pickWallAdjacentTile(free);
      if (!chosen) break;
      reserved.add(key(chosen.tx, chosen.ty));
      hidingSpots.push({
        id: `hide_${hideSeq++}`,
        tx: chosen.tx,
        ty: chosen.ty,
        x: (chosen.tx + 0.5) * tileSize,
        y: (chosen.ty + 0.5) * tileSize,
        type: 'LOCKER',
        room: 'Corridor',
        roomId: CORRIDOR_ID[d],
        deck: d,
        angle: rng() * Math.PI * 2,
        checkedFlash: 0,
      });
    }
  }

  // Searchable Containers distributed across every room & exterior deck
  const containerTypeForRoom = (r: RoomName): ContainerType => {
    if (r === 'Bridge' || r === 'Chart Room' || r === 'Radio Room' || r === "Captain's Quarters") {
      return 'DESK';
    }
    if (r === 'Workshop' || r === 'Engine Room' || r === 'Boiler Room' || r === 'Pump Room' || r === 'Electrical Room' || r === 'Maintenance Bay') {
      return 'TOOLBOX';
    }
    if (r === 'Container Bay' || r === 'Cargo Hold' || r === 'Storage Room' || r === 'Forecastle' || r === 'Weather Deck' || r === 'Submarine Bay') {
      return 'SUPPLY_CRATE';
    }
    return 'CABINET';
  };
  const containerCountForRoom = (rb: RoomBounds): number => {
    if (rb.name === 'Helideck' || rb.name === 'Lifeboat Davit') return 0;
    if (rb.name === 'Container Bay') return 6;
    const area = (rb.x2 - rb.x1 + 1) * (rb.y2 - rb.y1 + 1);
    if (area >= 48) return 3;
    return area >= 22 ? 2 : 1;
  };

  const containerCoords: Array<{
    tx: number;
    ty: number;
    type: ContainerType;
    room: RoomName;
    roomId: number;
  }> = [];

  for (const rb of rooms) {
    const count = containerCountForRoom(rb);
    const cType = containerTypeForRoom(rb.name);
    for (let i = 0; i < count; i++) {
      const free = findFreeTilesInRoomId(rb.id);
      const chosen = pickWallAdjacentTile(free);
      if (!chosen) break;
      reserved.add(key(chosen.tx, chosen.ty));
      containerCoords.push({
        tx: chosen.tx,
        ty: chosen.ty,
        type: cType,
        room: rb.name,
        roomId: rb.id,
      });
    }
  }

  // =========================================================================
  // --- 8b. Non-Interactable Deck-Appropriate Environmental Furniture ---
  // =========================================================================
  const entityClearanceKeys = new Set<number>(reserved);
  for (const d of doors) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        entityClearanceKeys.add(key(d.tx + dx, d.ty + dy));
      }
    }
  }
  for (const s of stairwells) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        entityClearanceKeys.add(key(s.tx + dx, s.ty + dy));
      }
    }
  }

  // Verify placing a blocking prop inside room rb leaves EVERY walkable tile, door, switch, hiding spot & container connected
  const isRoomStillPassableWithBlock = (rb: RoomBounds, bx: number, by: number, bw: number, bh: number): boolean => {
    const importantPts: Array<{ tx: number; ty: number }> = [];
    for (const d of doors) {
      if (d.tx >= rb.x1 - 1 && d.tx <= rb.x2 + 1 && d.ty >= rb.y1 - 1 && d.ty <= rb.y2 + 1) {
        importantPts.push({ tx: d.tx, ty: d.ty });
      }
    }
    for (let y = rb.y1; y <= rb.y2; y++) {
      for (let x = rb.x1; x <= rb.x2; x++) {
        if (x >= bx && x < bx + bw && y >= by && y < by + bh) continue;
        if (roomIdGrid[y][x] !== rb.id || !isTileWalkable(tiles[y][x])) continue;
        importantPts.push({ tx: x, ty: y });
        if (reserved.has(key(x, y))) {
          let adjFree = false;
          for (const [ox, oy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx >= bx && nx < bx + bw && ny >= by && ny < by + bh) continue;
            if (isTileWalkable(tiles[ny]?.[nx] ?? 'VOID')) {
              adjFree = true;
              break;
            }
          }
          if (!adjFree) return false;
        }
      }
    }
    if (importantPts.length <= 1) return true;

    const vis = new Set<number>();
    const q: Array<{ tx: number; ty: number }> = [importantPts[0]];
    vis.add(key(importantPts[0].tx, importantPts[0].ty));
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cur.tx + dx;
        const ny = cur.ty + dy;
        if (nx < rb.x1 - 1 || nx > rb.x2 + 1 || ny < rb.y1 - 1 || ny > rb.y2 + 1) continue;
        if (nx >= bx && nx < bx + bw && ny >= by && ny < by + bh) continue;
        if (!isTileWalkable(tiles[ny]?.[nx] ?? 'VOID')) continue;
        const inScope =
          roomIdGrid[ny][nx] === rb.id || doors.some((d) => d.tx === nx && d.ty === ny);
        if (!inScope) continue;
        const nk = key(nx, ny);
        if (vis.has(nk)) continue;
        vis.add(nk);
        q.push({ tx: nx, ty: ny });
      }
    }
    return importantPts.every((pt) => vis.has(key(pt.tx, pt.ty)));
  };

  const tryPlaceRoomBlockingFurniture = (
    rb: RoomBounds,
    kind: ShipPropKind,
    tw: number,
    th: number,
    color?: string
  ): boolean => {
    const cands: Array<{ tx: number; ty: number }> = [];
    for (let y = rb.y1; y <= rb.y2 - th + 1; y++) {
      for (let x = rb.x1; x <= rb.x2 - tw + 1; x++) {
        let ok = true;
        for (let py = y; py < y + th && ok; py++) {
          for (let px = x; px < x + tw; px++) {
            if (
              roomIdGrid[py][px] !== rb.id ||
              !isTileWalkable(tiles[py][px]) ||
              entityClearanceKeys.has(key(px, py))
            ) {
              ok = false;
              break;
            }
          }
        }
        if (ok && rb.deck === 'DECK_1') {
          for (let cy = y - 1; cy <= y + th && ok; cy++) {
            for (let cx = x - 1; cx <= x + tw && ok; cx++) {
              let allW = true;
              for (let dy = -1; dy <= 1 && allW; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  const tx2 = cx + dx;
                  const ty2 = cy + dy;
                  const isProp = tx2 >= x && tx2 < x + tw && ty2 >= y && ty2 < y + th;
                  if (!isProp && tiles[ty2]?.[tx2] !== 'WALL') {
                    allW = false;
                    break;
                  }
                }
              }
              if (allW) ok = false;
            }
          }
        }
        if (ok && isRoomStillPassableWithBlock(rb, x, y, tw, th)) {
          cands.push({ tx: x, ty: y });
        }
      }
    }
    if (cands.length === 0) return false;
    const pick = cands[Math.floor(rng() * cands.length)];
    const addedOk = addProp(kind, rb.deck, pick.tx, pick.ty, tw, th, {
      blocking: true,
      color,
      room: rb.name,
      roomId: rb.id,
      keepWalkableBorder: true,
    });
    if (addedOk) {
      for (let py = pick.ty; py < pick.ty + th; py++) {
        for (let px = pick.tx; px < pick.tx + tw; px++) {
          entityClearanceKeys.add(key(px, py));
        }
      }
    }
    return addedOk;
  };

  // A. Room-specific blocking centerpieces (mixed with walkable clutter below)
  for (const rb of rooms) {
    const area = (rb.x2 - rb.x1 + 1) * (rb.y2 - rb.y1 + 1);
    if (area < 12) continue;
    if (rb.name === 'Crew Quarters' || rb.name === "Captain's Quarters") {
      tryPlaceRoomBlockingFurniture(rb, 'CABIN_WARDROBE', 1, 1);
    } else if (rb.name === 'Galley & Mess' || rb.name === 'Officers Mess') {
      tryPlaceRoomBlockingFurniture(rb, 'GALLEY_FRIDGE', 1, 1);
      tryPlaceRoomBlockingFurniture(rb, 'DINING_BOOTH', 2, 1);
    } else if (rb.name === 'Infirmary') {
      tryPlaceRoomBlockingFurniture(rb, 'MED_CART', 1, 1);
    } else if (rb.name === 'Cargo Hold' || rb.name === 'Storage Room') {
      tryPlaceRoomBlockingFurniture(rb, 'CARGO_RACK', 2, 1);
    } else if (rb.name === 'Engine Room' || rb.name === 'Boiler Room') {
      tryPlaceRoomBlockingFurniture(rb, 'GENERATOR_SKID', 2, 1);
      tryPlaceRoomBlockingFurniture(rb, 'COMPRESSED_AIR_TANK', 1, 1);
    } else if (rb.name === 'Pump Room' || rb.name === 'Maintenance Bay' || rb.name === 'Workshop') {
      tryPlaceRoomBlockingFurniture(rb, 'VALVE_MANIFOLD', 1, 1);
      tryPlaceRoomBlockingFurniture(rb, 'COMPRESSED_AIR_TANK', 1, 1);
    } else if (rb.name === 'Submarine Bay') {
      tryPlaceRoomBlockingFurniture(rb, 'DIVE_GEAR_RACK', 2, 1);
      tryPlaceRoomBlockingFurniture(rb, 'COMPRESSED_AIR_TANK', 1, 1);
    } else if (rb.name === 'Bridge' || rb.name === 'Chart Room' || rb.name === 'Radio Room') {
      tryPlaceRoomBlockingFurniture(rb, 'CABIN_WARDROBE', 1, 1);
    }
  }

  // B. Walkable deck-appropriate floor clutter (blocking: false — zero movement or sight obstruction)
  const tryPlaceWalkableClutter = (
    deck: ShipDeck,
    tx: number,
    ty: number,
    tw: number,
    th: number,
    kind: ShipPropKind,
    color?: string
  ) => {
    for (let y = ty; y < ty + th; y++) {
      for (let x = tx; x < tx + tw; x++) {
        if (!isTileWalkable(tiles[y]?.[x] ?? 'VOID')) return false;
        if (entityClearanceKeys.has(key(x, y)) || doorKeys.has(key(x, y)) || stairKeys.has(key(x, y))) {
          return false;
        }
      }
    }
    return addProp(kind, deck, tx, ty, tw, th, { blocking: false, color });
  };

  for (const rb of rooms) {
    const area = (rb.x2 - rb.x1 + 1) * (rb.y2 - rb.y1 + 1);
    if (area < 9) continue;
    const cx = Math.floor((rb.x1 + rb.x2) / 2);
    const cy = Math.floor((rb.y1 + rb.y2) / 2);
    if (
      rb.name === 'Crew Quarters' ||
      rb.name === "Captain's Quarters" ||
      rb.name === 'Officers Mess' ||
      rb.name === 'Bridge' ||
      rb.name === 'Chart Room'
    ) {
      tryPlaceWalkableClutter(rb.deck, cx, cy, rb.x2 - rb.x1 >= 3 ? 2 : 1, 1, 'RUG_MAT', rb.name === "Captain's Quarters" ? 'rgba(127, 29, 29, 0.56)' : 'rgba(30, 58, 95, 0.52)');
    } else if (rb.name === 'Engine Room' || rb.name === 'Boiler Room' || rb.name === 'Pump Room' || rb.name === 'Submarine Bay') {
      tryPlaceWalkableClutter(rb.deck, cx, cy, 1, 1, 'FLOOR_GRATE');
      if (rng() < 0.75) tryPlaceWalkableClutter(rb.deck, rb.x1 + 1, rb.y1 + 1, 1, 1, 'OIL_DRIP_TRAY');
    } else if (rb.name === 'Workshop' || rb.name === 'Maintenance Bay' || rb.name === 'Electrical Room' || rb.name === 'Container Bay') {
      tryPlaceWalkableClutter(rb.deck, cx, cy, 1, 1, 'CABLE_COIL');
      if (rb.deck !== 'DECK_3' && rng() < 0.6) tryPlaceWalkableClutter(rb.deck, rb.x1 + 1, rb.y2 - 1, 1, 1, 'CAUTION_MAT');
    }
  }

  // Deck-appropriate corridor & exterior walkway floor clutter
  for (const deck of ['DECK_3', 'DECK_2', 'DECK_1'] as const) {
    const band = deckBounds[deck];
    let placedCorClutter = 0;
    const targetCount = deck === 'DECK_2' ? 16 : deck === 'DECK_1' ? 18 : 10;
    for (let attempt = 0; attempt < 180 && placedCorClutter < targetCount; attempt++) {
      const tx = randInt(rng, 10, width - 12);
      const ty = randInt(rng, band.y1 + 2, band.y2 - 2);
      if (!isTileWalkable(tiles[ty][tx])) continue;
      if (deck !== 'DECK_3' && roomGrid[ty][tx] !== 'Corridor') continue;
      if (deck === 'DECK_3' && roomGrid[ty][tx] !== 'Weather Deck' && roomGrid[ty][tx] !== 'Container Bay' && roomGrid[ty][tx] !== 'Corridor') continue;

      if (deck === 'DECK_2') {
        const horizRun = roomGrid[ty][tx + 1] === 'Corridor' && isTileWalkable(tiles[ty][tx + 1]);
        const kind: ShipPropKind = horizRun && rng() < 0.58 ? 'RUBBER_RUNNER' : rng() < 0.5 ? 'FLOOR_GRATE' : 'CAUTION_MAT';
        if (tryPlaceWalkableClutter(deck, tx, ty, kind === 'RUBBER_RUNNER' ? 2 : 1, 1, kind)) {
          placedCorClutter++;
        }
      } else if (deck === 'DECK_1') {
        const kind: ShipPropKind = rng() < 0.42 ? 'FLOOR_GRATE' : rng() < 0.72 ? 'OIL_DRIP_TRAY' : 'CAUTION_MAT';
        if (tryPlaceWalkableClutter(deck, tx, ty, 1, 1, kind)) {
          placedCorClutter++;
        }
      } else {
        const kind: ShipPropKind = rng() < 0.55 ? 'CABLE_COIL' : 'FLOOR_GRATE';
        if (tryPlaceWalkableClutter(deck, tx, ty, 1, 1, kind)) {
          placedCorClutter++;
        }
      }
    }
  }

  // =========================================================================
  // --- 9. Player & Brute Spawns Across 3-Deck Vessel ---
  // =========================================================================
  const playerSpawnChoices = [
    { tx: 14, ty: 19 }, // Deck 3 Helideck edge
    { tx: 111, ty: 19 }, // Deck 3 Forecastle
    { tx: stair32AftBot.tx, ty: stair32AftBot.ty }, // Deck 2 Aft stair plaza
  ].filter((c) => isTileWalkable(tiles[c.ty]?.[c.tx] ?? 'VOID'));
  const pStart = playerSpawnChoices[Math.floor(rng() * playerSpawnChoices.length)] ?? { tx: 14, ty: 19 };

  const playerDeck = deckGrid[pStart.ty][pStart.tx];
  const bruteChoices = [
    { tx: 19, ty: 95 }, // Deck 1 Engine Room
    { tx: stair21MidBot.tx, ty: stair21MidBot.ty }, // Deck 1 Mid-hull corridor
    { tx: stair21MidTop.tx, ty: stair21MidTop.ty }, // Deck 2 Midships corridor
    { tx: 90, ty: 19 }, // Deck 3 Forward Container Bay
  ].filter(
    (c) =>
      isTileWalkable(tiles[c.ty]?.[c.tx] ?? 'VOID') &&
      (deckGrid[c.ty][c.tx] !== playerDeck ||
        Math.abs(c.tx - pStart.tx) + Math.abs(c.ty - pStart.ty) >= 34)
  );
  const bStart = bruteChoices[Math.floor(rng() * bruteChoices.length)] ?? { tx: 19, ty: 95 };

  // =========================================================================
  // --- 10. Final Reachability Filter & Escape Item Assignment ---
  // =========================================================================
  const visited = runReachabilityBfs(pStart.tx, pStart.ty, false);
  const stairByTile = new Map<number, Stairwell>();
  for (const s of stairwells) stairByTile.set(key(s.tx, s.ty), s);
  const finalDoorByTile = new Map<number, Door>();
  for (const d of doors) finalDoorByTile.set(key(d.tx, d.ty), d);

  const reachableContainerCoords = containerCoords.filter((c) => visited[key(c.tx, c.ty)] === 1);
  const reachableSpots = hidingSpots.filter((s) => visited[key(s.tx, s.ty)] === 1);
  const reachableSwitches = lightSwitches.filter((sw) => visited[key(sw.tx, sw.ty)] === 1);

  const guaranteedItems: ItemId[] = [
    // Deck 2 Lifeboat parts
    'WINCH_CRANK',
    'MARINE_BATTERY',
    'HULL_PATCH',
    // Deck 3 Helicopter parts
    'AVIATION_FUEL',
    'IGNITION_KEY',
    'ROTOR_FUSE',
    // Deck 1 Submarine parts
    'SUB_BATTERY',
    'BALLAST_PUMP',
    'DIVE_KEY',
    // Tools & upgrades scaled for 4.5x map
    'BACKPACK',
    'BOLT_CUTTERS',
    'BOLT_CUTTERS',
    'BOLT_CUTTERS',
    'FIRE_EXTINGUISHER',
    'FIRE_EXTINGUISHER',
    'FIRE_EXTINGUISHER',
    'FLARE',
    'FLARE',
    'FLARE',
    'FLARE',
    'GLOWSTICK',
    'GLOWSTICK',
    'GLOWSTICK',
    'GLOWSTICK',
    'BATTERY_PACK',
    'BATTERY_PACK',
    'BATTERY_PACK',
    'BATTERY_PACK',
    'BATTERY_PACK',
    'BATTERY_PACK',
  ];

  const indices = reachableContainerCoords.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const assignedItems: Array<ItemId | null> = Array(reachableContainerCoords.length).fill(null);
  for (let i = 0; i < guaranteedItems.length && i < indices.length; i++) {
    assignedItems[indices[i]] = guaranteedItems[i];
  }

  const reachableContainers: Container[] = reachableContainerCoords.map((bp, idx) => ({
    id: `cont_${idx}`,
    tx: bp.tx,
    ty: bp.ty,
    x: (bp.tx + 0.5) * tileSize,
    y: (bp.ty + 0.5) * tileSize,
    type: bp.type,
    room: bp.room,
    roomId: bp.roomId,
    searched: false,
    item: assignedItems[idx],
  }));

  // =========================================================================
  // --- 11. Deterministic Crew Blood Streaks (Drag Smears, Bootprints & Splatter) ---
  // =========================================================================
  const bloodStreaks: BloodStreak[] = [];
  let bloodSeq = 0;
  const isPointOnWalkable = (wx: number, wy: number): boolean => {
    const tx = Math.floor(wx / tileSize);
    const ty = Math.floor(wy / tileSize);
    if (tx < 0 || tx >= width || ty < 0 || ty >= height) return false;
    return isTileWalkable(tiles[ty][tx]);
  };
  const tryPushBlood = (
    kind: BloodStreak['kind'],
    x: number,
    y: number,
    angle: number,
    length: number,
    widthPx: number,
    intensity: number,
    room: RoomName,
    roomId?: number
  ) => {
    const midX = x + Math.cos(angle) * (length * 0.5);
    const midY = y + Math.sin(angle) * (length * 0.5);
    const endX = x + Math.cos(angle) * length;
    const endY = y + Math.sin(angle) * length;
    if (!isPointOnWalkable(x, y) || !isPointOnWalkable(midX, midY) || !isPointOnWalkable(endX, endY)) {
      return;
    }
    bloodStreaks.push({
      id: `blood_${bloodSeq++}`,
      kind,
      x,
      y,
      angle,
      length,
      width: widthPx,
      intensity,
      seed: Math.floor(rng() * 100000),
      room,
      roomId,
    });
  };

  for (const spot of reachableSpots) {
    if (rng() > 0.36) continue;
    const offsets = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [ox, oy] of offsets) {
      const ntx = spot.tx + ox;
      const nty = spot.ty + oy;
      if (isTileWalkable(tiles[nty]?.[ntx] ?? 'VOID')) {
        const ang = Math.atan2(oy, ox) + (rng() - 0.5) * 0.55;
        const kind = rng() < 0.62 ? 'DRAG_SMEAR' : 'BOOTPRINTS';
        tryPushBlood(
          kind,
          spot.x + ox * 10,
          spot.y + oy * 10,
          ang,
          28 + rng() * 24,
          10 + rng() * 5,
          0.62 + rng() * 0.25,
          spot.room,
          spot.roomId
        );
        if (rng() < 0.5) {
          tryPushBlood(
            'SPLATTER',
            spot.x + ox * 6 + (rng() - 0.5) * 10,
            spot.y + oy * 6 + (rng() - 0.5) * 10,
            ang,
            16 + rng() * 10,
            14 + rng() * 6,
            0.58 + rng() * 0.24,
            spot.room,
            spot.roomId
          );
        }
        break;
      }
    }
  }

  const bloodRooms = new Set<RoomName>([
    'Infirmary',
    'Crew Quarters',
    'Galley & Mess',
    'Officers Mess',
    'Engine Room',
    'Boiler Room',
    'Workshop',
    'Cargo Hold',
    'Bridge',
    'Chart Room',
    'Radio Room',
    'Pump Room',
    'Container Bay',
    'Maintenance Bay',
    'Submarine Bay',
  ]);
  for (const rb of rooms) {
    if (!bloodRooms.has(rb.name) || rng() > 0.52) continue;
    const candidates: Array<{ tx: number; ty: number }> = [];
    for (let y = rb.y1; y <= rb.y2; y++) {
      for (let x = rb.x1; x <= rb.x2; x++) {
        if (
          isTileWalkable(tiles[y]?.[x] ?? 'VOID') &&
          roomIdGrid[y]?.[x] === rb.id &&
          !finalDoorByTile.has(key(x, y)) &&
          !stairByTile.has(key(x, y))
        ) {
          candidates.push({ tx: x, ty: y });
        }
      }
    }
    if (candidates.length === 0) continue;
    const pick = candidates[Math.floor(rng() * candidates.length)];
    const px = (pick.tx + 0.5) * tileSize + (rng() - 0.5) * 8;
    const py = (pick.ty + 0.5) * tileSize + (rng() - 0.5) * 8;
    const ang = rng() * Math.PI * 2;
    const roll = rng();
    if (roll < 0.45) {
      tryPushBlood('DRAG_SMEAR', px, py, ang, 34 + rng() * 28, 12 + rng() * 5, 0.65 + rng() * 0.25, rb.name, rb.id);
      tryPushBlood('SPLATTER', px - Math.cos(ang) * 4, py - Math.sin(ang) * 4, ang, 18, 16, 0.72, rb.name, rb.id);
    } else if (roll < 0.78) {
      tryPushBlood('SPLATTER', px, py, ang, 20 + rng() * 10, 16 + rng() * 6, 0.68 + rng() * 0.22, rb.name, rb.id);
    } else {
      tryPushBlood('BOOTPRINTS', px, py, ang, 40 + rng() * 24, 12, 0.56 + rng() * 0.22, rb.name, rb.id);
    }
  }

  for (const d of doors) {
    if (rng() > 0.22) continue;
    const cx = (d.tx + 0.5) * tileSize;
    const cy = (d.ty + 0.5) * tileSize;
    const dir = rng() > 0.5 ? 1 : -1;
    const ang = d.orientation === 'H' ? (dir > 0 ? Math.PI * 0.5 : -Math.PI * 0.5) : dir > 0 ? 0 : Math.PI;
    const jitter = (rng() - 0.5) * 0.35;
    const kind = rng() < 0.55 ? 'BOOTPRINTS' : 'DRAG_SMEAR';
    tryPushBlood(
      kind,
      cx - Math.cos(ang + jitter) * 14,
      cy - Math.sin(ang + jitter) * 14,
      ang + jitter,
      36 + rng() * 22,
      11,
      0.52 + rng() * 0.24,
      roomGrid[d.ty][d.tx],
      roomIdGrid[d.ty][d.tx]
    );
  }

  return {
    width,
    height,
    tileSize,
    archetype,
    tiles,
    roomGrid,
    roomIdGrid,
    deckGrid,
    deckBounds,
    floorMaterial,
    rooms,
    doors,
    stairwells,
    props,
    hidingSpots: reachableSpots,
    containers: reachableContainers,
    steamPipes,
    paperMaps,
    lightSwitches: reachableSwitches,
    bloodStreaks,
    playerSpawn: { x: (pStart.tx + 0.5) * tileSize, y: (pStart.ty + 0.5) * tileSize },
    bruteSpawn: { x: (bStart.tx + 0.5) * tileSize, y: (bStart.ty + 0.5) * tileSize },
    lifeboatPos: {
      x: (lifeboatTx + 0.5) * tileSize,
      y: (lifeboatTy + 0.5) * tileSize,
      tx: lifeboatTx,
      ty: lifeboatTy,
    },
    heliPos: {
      x: (heliTx + 0.5) * tileSize,
      y: (heliTy + 0.5) * tileSize,
      tx: heliTx,
      ty: heliTy,
    },
    submarinePos: {
      x: (subTx + 0.5) * tileSize,
      y: (subTy + 0.5) * tileSize,
      tx: subTx,
      ty: subTy,
      leverX: (subLeverTx + 0.5) * tileSize,
      leverY: (subLeverTy + 0.5) * tileSize,
      leverTx: subLeverTx,
      leverTy: subLeverTy,
    },
    seed,
  };
}
