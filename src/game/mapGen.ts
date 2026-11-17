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
    options?: { open?: boolean; locked?: boolean; noDoor?: boolean; roomId?: number }
  ) => {
    if (tiles[ty]?.[tx] === 'VOID') return;
    setTile(tx, ty, 'FLOOR', room, mat, options?.roomId);
    reserveAround(tx, ty, 1);
    if (!options?.noDoor) {
      const open = options?.open ?? false;
      doors.push({
        id: `door_${doorSeq++}`,
        tx,
        ty,
        orientation,
        isOpen: open,
        openProgress: open ? 1 : 0,
        swingSpeed: 8.5,
        isBroken: false,
        isLocked: options?.locked ?? false,
      });
    }
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

  // Helper: carve Z-bent / staggered 1- or 2-tile wide hallway without overwriting named rooms (>= 10)
  const carveCorridorTile = (tx: number, ty: number, deck: ShipDeck) => {
    if (!isInsideInteriorHull(tx, ty, deck, 1)) return false;
    if (roomIdGrid[ty][tx] >= 10) return false;
    setTile(tx, ty, 'FLOOR', 'Corridor', 'STEEL', CORRIDOR_ID[deck]);
    return true;
  };

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
    const minY = band.y1 + 5;
    const maxY = band.y2 - 5;

    const stamp = (px: number, py: number) => {
      carveCorridorTile(px, py, deck);
      if (corridorW === 2) {
        if (!carveCorridorTile(px, py + 1, deck)) {
          carveCorridorTile(px, py - 1, deck);
        }
      }
    };

    stamp(cx, cy);
    let safety = 0;
    let lastJogDir = rng() > 0.5 ? 1 : -1;
    const minZig = corridorW === 2 ? 3 : 2;
    while ((cx !== xEnd || cy !== yEnd) && safety++ < 260) {
      const dxRem = xEnd - cx;
      if (Math.abs(dxRem) > 0) {
        const stepDir = Math.sign(dxRem);
        const minSeg = Math.max(3, Math.floor(maxSegLen * 0.5));
        const segLen = Math.min(Math.abs(dxRem), randInt(rng, minSeg, maxSegLen));
        for (let i = 0; i < segLen; i++) {
          const nx = cx + stepDir;
          if (isInsideInteriorHull(nx, cy, deck, 1) && roomIdGrid[cy][nx] < 10) {
            cx = nx;
            stamp(cx, cy);
          } else {
            break;
          }
        }
      }

      // Mandatory vertical Z-jog whenever horizontal travel remains so straight lines never chain across decks
      let targetJogY = yEnd;
      if (Math.abs(xEnd - cx) > 3) {
        const mag = randInt(rng, minZig, Math.max(minZig, jitterSpan));
        lastJogDir = cy >= maxY - 2 ? -1 : cy <= minY + 2 ? 1 : -lastJogDir;
        const biasToEnd = Math.abs(yEnd - cy) > jitterSpan ? Math.sign(yEnd - cy) : lastJogDir;
        const chosenDir = rng() < 0.65 ? biasToEnd : lastJogDir;
        targetJogY = Math.max(minY, Math.min(maxY, cy + chosenDir * mag));
        if (Math.abs(targetJogY - cy) < minZig) {
          targetJogY = Math.max(minY, Math.min(maxY, cy - chosenDir * minZig));
        }
      }
      const dy = targetJogY - cy;
      if (dy !== 0) {
        const yDir = Math.sign(dy);
        const ySteps = Math.abs(dy);
        for (let j = 0; j < ySteps; j++) {
          const ny = cy + yDir;
          if (isInsideInteriorHull(cx, ny, deck, 1) && roomIdGrid[ny][cx] < 10) {
            cy = ny;
            stamp(cx, cy);
          } else {
            break;
          }
        }
      }

      // If blocked by an anchor bay while heading horizontally, jog around it vertically
      if (cx !== xEnd && !isInsideInteriorHull(cx + Math.sign(xEnd - cx), cy, deck, 1)) {
        break;
      }
      if (cx !== xEnd && roomIdGrid[cy][cx + Math.sign(xEnd - cx)] >= 10) {
        const escapeDir = cy <= deckBounds[deck].centerY ? -1 : 1;
        let steppedAround = false;
        for (const tryDir of [escapeDir, -escapeDir]) {
          for (let s = 1; s <= 7; s++) {
            const tyTry = cy + tryDir * s;
            if (!isInsideInteriorHull(cx, tyTry, deck, 1)) break;
            if (roomIdGrid[tyTry][cx] >= 10) break;
            stamp(cx, tyTry);
            if (
              isInsideInteriorHull(cx + Math.sign(xEnd - cx), tyTry, deck, 1) &&
              roomIdGrid[tyTry][cx + Math.sign(xEnd - cx)] < 10
            ) {
              cy = tyTry;
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

  // Compact secondary Deck 3 exterior deckhouse annex (adds extra hallways/rooms while keeping Deck 3 open)
  const buildDeck3Annex = (ax1: number, ay1: number, ax2: number, ay2: number) => {
    buildDeckhouseShell(ax1, ay1, ax2, ay2, 'DECK_3');
    const midX = Math.floor((ax1 + ax2) / 2);
    const midY = Math.floor((ay1 + ay2) / 2);
    // Short jogged hallway cutting through annex
    fillRect(ax1 + 1, midY, midX, midY, 'FLOOR', 'Corridor', 'STEEL');
    fillRect(midX, midY - 1, midX, midY + 1, 'FLOOR', 'Corridor', 'STEEL');
    fillRect(midX, midY - 1, ax2 - 1, midY - 1, 'FLOOR', 'Corridor', 'STEEL');
    addDoorway(ax1, midY, 'V', 'Corridor', 'STEEL', { open: false });
    addDoorway(ax2, midY - 1, 'V', 'Corridor', 'STEEL', { open: rng() > 0.5 });

    const r1Id = addRoom('Maintenance Bay', 'DECK_3', ax1 + 1, ay1 + 1, midX - 1, midY - 1, 'FLOOR', 'STEEL');
    addDoorway(ax1 + 2, midY, 'H', 'Maintenance Bay', 'STEEL', { open: true, roomId: r1Id });
    addProp('WORKBENCH', 'DECK_3', ax1 + 2, ay1 + 1, 2, 1, { blocking: true, room: 'Maintenance Bay', roomId: r1Id });

    const r2Id = addRoom('Storage Room', 'DECK_3', midX + 1, ay1 + 1, ax2 - 1, midY - 2, 'FLOOR', 'CARGO');
    addDoorway(ax2 - 2, midY - 1, 'H', 'Storage Room', 'CARGO', { open: false, roomId: r2Id });

    const r3Id = addRoom('Electrical Room', 'DECK_3', ax1 + 2, midY + 1, ax2 - 1, ay2 - 1, 'FLOOR', 'GRATING');
    addDoorway(midX, midY + 1, 'H', 'Electrical Room', 'GRATING', { open: false, roomId: r3Id });
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
    // Connect vertical corridor stub from topY to jog
    fillRect(jogX, topY + 1, jogX + 1, Math.max(leftCorY, rightCorY), 'FLOOR', 'Corridor', 'STEEL');

    // Upper stepped wing compartments: Chart Room & Bridge with 1-tile walls
    const upperBotY = northHeavy ? 15 : 17;
    const chId = addRoom('Chart Room', 'DECK_3', upperX1 + 1, topY + 1, jogX - 1, upperBotY, 'FLOOR', 'CABIN');
    addDoorway(jogX, topY + 3, 'V', 'Chart Room', 'CABIN', { open: true, roomId: chId });
    addDoorway(upperX1 + 3, upperBotY + 1, 'H', 'Chart Room', 'CABIN', { open: false, roomId: chId });
    addProp('CHART_TABLE', 'DECK_3', upperX1 + 2, topY + 2, 2, 1, { blocking: true, room: 'Chart Room', roomId: chId });

    const brId = addRoom('Bridge', 'DECK_3', jogX + 2, topY + 1, upperX2 - 1, upperBotY, 'FLOOR', 'BRIDGE');
    addDoorway(jogX + 1, topY + 3, 'V', 'Bridge', 'BRIDGE', { open: false, roomId: brId });
    addDoorway(upperX2 - 3, upperBotY + 1, 'H', 'Bridge', 'BRIDGE', { open: rng() > 0.5, roomId: brId });
    addProp('HELM_CONSOLE', 'DECK_3', upperX2 - 2, topY + 2, 1, 3, { blocking: true, room: 'Bridge', roomId: brId });

    // Compact wing room tucked cleanly next to stepped corridor (spans full width to dhX2 - 1)
    if (northHeavy) {
      const wingId = addRoom('Electrical Room', 'DECK_3', jogX + 2, 17, dhX2 - 1, 19, 'FLOOR', 'GRATING');
      addDoorway(jogX + 4, 20, 'H', 'Electrical Room', 'GRATING', { open: false, roomId: wingId });
    } else {
      const wingId = addRoom('Electrical Room', 'DECK_3', jogX + 2, 22, dhX2 - 1, 23, 'FLOOR', 'GRATING');
      addDoorway(jogX + 4, 21, 'H', 'Electrical Room', 'GRATING', { open: false, roomId: wingId });
    }

    // Lower stepped wing compartments: Radio Room, Captain's Quarters, Officers Mess, Workshop
    const leftLowerY1 = leftCorY + 3;
    const rightLowerY1 = northHeavy ? rightCorY + 3 : 25;
    const aftMidX = Math.floor((dhX1 + jogX) / 2);
    const radId = addRoom('Radio Room', 'DECK_3', dhX1 + 1, leftLowerY1, aftMidX - 1, botY - 1, 'FLOOR', 'BRIDGE');
    addDoorway(dhX1 + 3, leftLowerY1 - 1, 'H', 'Radio Room', 'BRIDGE', { open: false, roomId: radId });
    addProp('SWITCHGEAR', 'DECK_3', dhX1 + 2, botY - 2, 2, 1, { blocking: true, room: 'Radio Room', roomId: radId });

    const capId = addRoom("Captain's Quarters", 'DECK_3', aftMidX + 1, leftLowerY1, jogX - 1, botY - 1, 'FLOOR', 'CABIN');
    addDoorway(aftMidX + 3, leftLowerY1 - 1, 'H', "Captain's Quarters", 'CABIN', { open: false, roomId: capId });
    addDoorway(jogX, botY - 3, 'V', "Captain's Quarters", 'CABIN', { locked: true, roomId: capId });
    addProp('BUNK', 'DECK_3', aftMidX + 2, botY - 2, 2, 1, { blocking: true, room: "Captain's Quarters", roomId: capId });

    const fwdMidX = Math.floor((jogX + 2 + dhX2) / 2) + 1;
    const offId = addRoom('Officers Mess', 'DECK_3', jogX + 2, rightLowerY1, fwdMidX - 1, botY - 1, 'FLOOR', 'CABIN');
    addDoorway(jogX + 1, botY - 3, 'V', 'Officers Mess', 'CABIN', { open: true, roomId: offId });
    addProp('MESS_TABLE', 'DECK_3', jogX + 4, botY - 2, 2, 1, { blocking: true, room: 'Officers Mess', roomId: offId });

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
    const annexX1 = 88 + randInt(rng, -2, 2);
    const annexY1 = flipY ? 21 : 9;
    for (let y = annexY1 - 1; y <= annexY1 + 9; y++) {
      for (let x = annexX1 - 1; x <= 101; x++) reserved.add(key(x, y));
    }
    placeCargoIslandsD3(23, dhX1 - 3, [stair32AftTop]);
    placeCargoIslandsD3(dhX2 + 3, 102, []);
    buildDeck3Annex(annexX1, annexY1, 100, annexY1 + 8);
  } else {
    // ICEBREAKER: L-shaped aft deckhouse (zero dead solid slab) + mid utility annex + forward stepped bridge
    const aftX1 = 22;
    const aftX2 = 37 + shiftA;
    buildDeckhouseShell(aftX1, 10, aftX2, 19, 'DECK_3');
    buildDeckhouseShell(aftX1 + 6, 18, aftX2, 27, 'DECK_3');
    const stId = addRoom('Storage Room', 'DECK_3', aftX1 + 1, 11, aftX1 + 6, 16, 'FLOOR', 'CARGO');
    const mbId = addRoom('Maintenance Bay', 'DECK_3', aftX1 + 8, 11, aftX2 - 1, 16, 'FLOOR', 'STEEL');
    const wkId = addRoom('Workshop', 'DECK_3', aftX1 + 7, 20, aftX2 - 1, 26, 'FLOOR', 'STEEL');
    fillRect(aftX1 + 1, 17, aftX2 - 1, 18, 'FLOOR', 'Corridor', 'STEEL');
    addDoorway(aftX1, 17, 'V', 'Corridor', 'STEEL', { open: false });
    addDoorway(aftX2, 18, 'V', 'Corridor', 'STEEL', { open: true });
    addDoorway(aftX1 + 4, 16, 'H', 'Storage Room', 'CARGO', { open: true, roomId: stId });
    addDoorway(aftX1 + 10, 16, 'H', 'Maintenance Bay', 'STEEL', { open: false, roomId: mbId });
    addDoorway(aftX1 + 10, 19, 'H', 'Workshop', 'STEEL', { open: false, roomId: wkId });
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
        candidates.sort((a, b) => {
          const da = Math.abs(a.rx - targetZoneX) + (rng() - 0.5) * 18;
          const db = Math.abs(b.rx - targetZoneX) + (rng() - 0.5) * 18;
          return da - db;
        });
        const pick = candidates[Math.floor(rng() * Math.min(4, candidates.length))];
        const rId = addRoom(spec.name, deck, pick.rx, pick.ry, pick.rx + rw - 1, pick.ry + rh - 1, 'FLOOR', spec.mat);
        const primaryDoor = pick.doorCandidates[Math.floor(rng() * pick.doorCandidates.length)];
        addDoorway(primaryDoor.dx, primaryDoor.dy, primaryDoor.ori, spec.name, spec.mat, {
          open: rng() > 0.72,
          roomId: rId,
        });

        // Optional second shortcut door on a different wall face (may be padlocked)
        const otherDoors = pick.doorCandidates.filter(
          (dc) => Math.abs(dc.dx - primaryDoor.dx) + Math.abs(dc.dy - primaryDoor.dy) >= 4
        );
        if (otherDoors.length > 0 && rng() < 0.48) {
          const sec = otherDoors[Math.floor(rng() * otherDoors.length)];
          addDoorway(sec.dx, sec.dy, sec.ori, spec.name, spec.mat, {
            open: false,
            locked: rng() < (spec.lockedChance ?? 0.25),
            roomId: rId,
          });
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
          added++;
          foundMore = true;
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

  // Anchor Bay 3: Galley & Mess (Deck 2 Unique large anchor room ~10x6)
  const galX1 = 47 + randInt(rng, -3, 3);
  const galY1 = flipY ? 60 : 48;
  const galId = addRoom('Galley & Mess', 'DECK_2', galX1, galY1, galX1 + 9, galY1 + 5, 'FLOOR', 'CABIN');
  addProp('GALLEY_COUNTER', 'DECK_2', galX1 + 1, galY1 + 1, 3, 1, { blocking: true, room: 'Galley & Mess', roomId: galId });
  addProp('MESS_TABLE', 'DECK_2', galX1 + 5, galY1 + 3, 3, 1, { blocking: true, room: 'Galley & Mess', roomId: galId });

  // Staggered Offset Z-Bend Hallways on Deck 2 (broken every 6-10 tiles, zero cross-ship line!)
  const d2Waypoints: Array<[number, number]> = [
    [25, flipY ? 61 : 53],
    [37, flipY ? 52 : 62],
    [45, flipY ? 56 : 58],
    [61, flipY ? 51 : 62],
    [75, flipY ? 60 : 53],
    [90, davitSideTop ? davitY2 + 2 : davitY1 - 2],
    [104, flipY ? 55 : 59],
  ];
  for (let i = 0; i < d2Waypoints.length - 1; i++) {
    carveZPath(
      d2Waypoints[i][0],
      d2Waypoints[i][1],
      d2Waypoints[i + 1][0],
      d2Waypoints[i + 1][1],
      'DECK_2',
      2,
      10,
      4
    );
  }
  // Secondary offset bypass loops & greedy aft/mid/bow branches on Deck 2
  carveZPath(28, flipY ? 51 : 63, 44, flipY ? 54 : 60, 'DECK_2', 1, 7, 3);
  carveZPath(42, flipY ? 64 : 50, 62, flipY ? 63 : 51, 'DECK_2', 1, 7, 3);
  carveZPath(60, flipY ? 63 : 51, 80, flipY ? 61 : 54, 'DECK_2', 1, 7, 3);
  carveZPath(74, flipY ? 51 : 63, 98, flipY ? 53 : 61, 'DECK_2', 1, 7, 3);
  carveZPath(13, flipY ? 62 : 51, 25, flipY ? 60 : 54, 'DECK_2', 1, 6, 2);
  carveZPath(12, flipY ? 50 : 64, 29, flipY ? 51 : 63, 'DECK_2', 1, 6, 2);
  carveZPath(10, 56, 26, flipY ? 49 : 65, 'DECK_2', 1, 5, 2);
  carveZPath(88, flipY ? 54 : 60, 113, 57, 'DECK_2', 1, 5, 2);
  carveZPath(94, flipY ? 64 : 50, 112, 57, 'DECK_2', 1, 5, 2);

  // Connect Deck 2 Anchor Bays cleanly to adjacent corridors
  addDoorway(24, d2CargoY1 + 3, 'V', 'Cargo Hold', 'CARGO', { open: false, roomId: d2CargoId });
  addDoorway(19, flipY ? d2CargoY1 + 7 : d2CargoY1 - 1, 'H', 'Cargo Hold', 'CARGO', { open: true, roomId: d2CargoId });

  addDoorway(galX1 - 1, galY1 + 2, 'V', 'Galley & Mess', 'CABIN', { open: true, roomId: galId });
  addDoorway(galX1 + 5, flipY ? galY1 - 1 : galY1 + 6, 'H', 'Galley & Mess', 'CABIN', { open: false, roomId: galId });

  // Connect Lifeboat Davit to Deck 2 corridor
  const davitDoorY = davitSideTop ? davitY2 + 1 : davitY1 - 1;
  fillRect(davitX1 + 1, davitDoorY + (davitSideTop ? 1 : -1), davitX2 - 1, davitDoorY + (davitSideTop ? 1 : -1), 'FLOOR', 'Corridor', 'STEEL');
  addDoorway(lifeboatTx, davitDoorY, 'H', 'Lifeboat Davit', 'WEATHER', { open: true, roomId: lifeboatRoomId });
  addDoorway(davitX1 - 1, davitSideTop ? davitY2 : davitY1, 'V', 'Lifeboat Davit', 'WEATHER', { open: false, roomId: lifeboatRoomId });

  // Pack mostly 4x4..6x6 small rooms into Deck 2 pockets + greedy second fill!
  packCompactRooms(
    'DECK_2',
    [
      { name: 'Infirmary', mat: 'CABIN', wRange: [5, 6], hRange: [4, 5], propKind: 'MED_BED', propW: 2, propH: 1 },
      { name: 'Crew Quarters', mat: 'CABIN', wRange: [4, 6], hRange: [4, 5], propKind: 'BUNK', propW: 2, propH: 1 },
      { name: 'Crew Quarters', mat: 'CABIN', wRange: [4, 5], hRange: [4, 5], propKind: 'BUNK', propW: 2, propH: 1 },
      { name: 'Storage Room', mat: 'CARGO', wRange: [4, 5], hRange: [4, 5], lockedChance: 0.35 },
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
  fillGreedyPocketRooms('DECK_2', 9, 115, 34);

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

  // Winding Z-Bend Labyrinth Corridors on Deck 1 (max straight run <= 9 tiles, zero grid!)
  const d1SpinePoints: Array<[number, number]> = [
    [27, 94],
    [34, flipY ? 88 : 101],
    [42, flipY ? 98 : 91],
    [49, flipY ? 93 : 96],
    [60, flipY ? 99 : 90],
    [69, flipY ? 89 : 100],
    [78, flipY ? 97 : 92],
    [86, flipY ? 91 : 98],
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
      6,
      4
    );
  }
  // Interlocking Z-bend bilge branches & hull-hugging aft/fwd flanks
  carveZPath(28, flipY ? 102 : 87, 45, flipY ? 99 : 90, 'DECK_1', 1, 6, 3);
  carveZPath(62, flipY ? 86 : 103, 84, flipY ? 89 : 100, 'DECK_1', 1, 6, 3);
  carveZPath(74, 88, 91, 93, 'DECK_1', 1, 5, 3);
  carveZPath(40, 86, 44, 103, 'DECK_1', 1, 5, 2);
  carveZPath(70, 86, 74, 103, 'DECK_1', 1, 5, 2);
  // Aft flank loops hugging outside Engine Room & bow flank reaching forward of Submarine Bay
  carveZPath(14, 88, 28, 88, 'DECK_1', 1, 5, 2);
  carveZPath(14, 101, 28, 102, 'DECK_1', 1, 5, 2);
  carveZPath(92, 87, 107, 94, 'DECK_1', 1, 5, 2);
  carveZPath(92, 102, 107, 96, 'DECK_1', 1, 5, 2);

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
      { name: 'Storage Room', mat: 'CARGO', wRange: [4, 5], hRange: [4, 5], lockedChance: 0.35 },
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
  // Greedy fill any remaining compact 2x2..5x4 room pockets on Deck 1 before stairwell & stub validation
  fillGreedyPocketRooms('DECK_1', 11, 113, 30, true);

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
        const score = Math.abs(x - targetX) + Math.abs(y - band.centerY) * 0.25;
        if (!best || score < best.score) {
          best = { tx: x, ty: y, score, room: rName };
        }
      }
    }
    if (best) return { tx: best.tx, ty: best.ty, room: best.room };
    // Fallback any walkable non-escape tile on deck
    for (let y = band.y1 + 4; y <= band.y2 - 4; y++) {
      for (let x = 14; x < width - 14; x++) {
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

  // Mark corridor tiles adjacent to doors or non-corridor rooms as protected before stub pruning
  for (const d of doors) {
    protectedCorridorKeys.add(key(d.tx, d.ty));
    protectedCorridorKeys.add(key(d.tx - 1, d.ty));
    protectedCorridorKeys.add(key(d.tx + 1, d.ty));
    protectedCorridorKeys.add(key(d.tx, d.ty - 1));
    protectedCorridorKeys.add(key(d.tx, d.ty + 1));
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
    const valid = doors.filter(isDoorGeometryValid);
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

      // Also check if another tile in same deck is visited (anchor breach search)
      const band = deckBounds[rb.deck];
      // Multi-source BFS through WALLs (ignoring VOID) from this enclosed room's walkable tiles to nearest visAll===1 tile on same deck!
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

        // Carve breach tiles as FLOOR (first bulkhead tile becomes a valid Door if possible)
        let placedBreachDoor = false;
        for (let i = 1; i < pathKeys.length - 1; i++) {
          const pk = pathKeys[i];
          const px = pk % width;
          const py = Math.floor(pk / width);
          if (!isTileWalkable(tiles[py][px])) {
            setTile(px, py, 'FLOOR', 'Corridor', 'STEEL', CORRIDOR_ID[rb.deck]);
            if (!placedBreachDoor) {
              const prevX = pathKeys[i - 1] % width;
              const ori: 'H' | 'V' = prevX === px ? 'H' : 'V';
              const doorCand: Door = {
                id: `door_${doorSeq++}`,
                tx: px,
                ty: py,
                orientation: ori,
                isOpen: false,
                openProgress: 0,
                swingSpeed: 8.5,
                isBroken: false,
                isLocked: false,
              };
              // Only place hinged door if flanking wall tiles exist; otherwise leave clean open passage
              if (
                (ori === 'H' && tiles[py][px - 1] === 'WALL' && tiles[py][px + 1] === 'WALL') ||
                (ori === 'V' && tiles[py - 1][px] === 'WALL' && tiles[py + 1][px] === 'WALL')
              ) {
                doors.push(doorCand);
                reserveAround(px, py, 1);
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
  // (Locked doors only exist as optional shortcut/bonus entries)
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
  // --- 5c. Post-Pruning Anti-Thicc-Wall Pass (Deck 1 Zero-Thicc Guarantee + Deck 2 Greedy Trim) ---
  // =========================================================================
  // After dead-end corridor stub pruning, fill any reopened pockets and eliminate ALL 3x3 interior WALL cores on Deck 1
  fillGreedyPocketRooms('DECK_2', 9, 115, 10);
  fillGreedyPocketRooms('DECK_1', 10, 114, 14, true);

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
          // Match exact thick-wall interior definition (3x3 WALL with no VOID within 2 tiles)
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

      // Step 1: Expand an adjacent room 1 tile into the thick wall mass whenever it overlaps the 3x3 block
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
      if (expanded) continue;

      if (!allowCorridorCarve) {
        skippedThickCores.add(key(thickCore.tx, thickCore.ty));
        continue;
      }

      // Step 2: Weighted Dijkstra through pure WALL cores so passages stay centered inside thick walls
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
            // Never pierce the outer 1-tile steel hull skin
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
            let perpWalkable = 0;
            if (dx !== 0) {
              if (isTileWalkable(tiles[ny - 1]?.[nx] ?? 'VOID')) perpWalkable++;
              if (isTileWalkable(tiles[ny + 1]?.[nx] ?? 'VOID')) perpWalkable++;
            } else {
              if (isTileWalkable(tiles[ny]?.[nx - 1] ?? 'VOID')) perpWalkable++;
              if (isTileWalkable(tiles[ny]?.[nx + 1] ?? 'VOID')) perpWalkable++;
            }
            const stepCost = 1 + perpWalkable * 14;
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

    // Remove any accidental 1x1 isolated wall pinholes surrounded on all 4 sides by walkable floor
    for (let y = band.y1 + 2; y <= band.y2 - 2; y++) {
      for (let x = 9; x < width - 9; x++) {
        if (tiles[y][x] !== 'WALL') continue;
        if (
          isTileWalkable(tiles[y - 1][x]) &&
          isTileWalkable(tiles[y + 1][x]) &&
          isTileWalkable(tiles[y][x - 1]) &&
          isTileWalkable(tiles[y][x + 1])
        ) {
          setTile(x, y, 'FLOOR', 'Corridor', 'STEEL', CORRIDOR_ID[deck]);
          protectedCorridorKeys.add(key(x, y));
        }
      }
    }
  };

  runAntiThiccWallPass('DECK_2', false);
  runAntiThiccWallPass('DECK_1', true);
  pruneInvalidDoors();

  // Re-enforce unbroken outer steel skin around Deck 2 & Deck 1 hull boundaries after final carving
  for (const deck of ['DECK_2', 'DECK_1'] as const) {
    const band = deckBounds[deck];
    for (let y = band.y1 + 1; y < band.y2; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (deckGrid[y][x] !== deck || tiles[y][x] === 'VOID') continue;
        if (deck === 'DECK_2' && roomIdGrid[y][x] === lifeboatRoomId) continue;
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
