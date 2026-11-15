import {
  Container,
  ContainerType,
  Door,
  FloorMaterial,
  HidingSpot,
  HidingSpotType,
  ItemId,
  RoomBounds,
  RoomLightSwitch,
  RoomName,
  ShipArchetype,
  ShipDeck,
  ShipMap,
  ShipProp,
  ShipPropKind,
  Stairwell,
  SteamVent,
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

  const width = 64;
  const height = 58;
  const tileSize = 44;

  const archetype = ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)];
  const flipY = rng() > 0.5;

  const tiles: TileType[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'VOID' as TileType)
  );
  const roomGrid: RoomName[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'Corridor' as RoomName)
  );
  const deckGrid: ShipDeck[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, () => (y < 29 ? 'MAIN' : 'LOWER'))
  );
  const floorMaterial: FloorMaterial[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'STEEL' as FloorMaterial)
  );

  const reserved = new Set<number>();
  const key = (tx: number, ty: number) => ty * width + tx;

  const setTile = (
    tx: number,
    ty: number,
    type: TileType,
    room?: RoomName,
    mat?: FloorMaterial
  ) => {
    if (tx < 0 || tx >= width || ty < 0 || ty >= height) return;
    tiles[ty][tx] = type;
    if (room) roomGrid[ty][tx] = room;
    if (mat) floorMaterial[ty][tx] = mat;
  };

  const fillRect = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    type: TileType,
    room?: RoomName,
    mat?: FloorMaterial
  ) => {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        setTile(x, y, type, room, mat);
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

  // --- 1. Curved Hull Silhouettes ---
  // Main Weather Deck (y = 2..26, centerline = 14)
  const mainCenterY = 14;
  const mainSternX = 3;
  const mainBowX = 60;
  const mainMaxBeam = archetype === 'ICEBREAKER' ? 11 : 10;

  const mainBounds = (x: number): { top: number; bot: number } | null => {
    if (x < mainSternX || x > mainBowX) return null;
    const u = (x - mainSternX) / (mainBowX - mainSternX);
    let hb = mainMaxBeam;
    if (u < 0.13) {
      const s = u / 0.13;
      hb = Math.round(mainMaxBeam * (0.65 + 0.35 * Math.sin(s * Math.PI * 0.5)));
    } else if (u > 0.72) {
      const t = (u - 0.72) / 0.28;
      hb = Math.max(1, Math.round(mainMaxBeam * Math.pow(1 - t, 0.68)));
    }
    return { top: mainCenterY - hb, bot: mainCenterY + hb };
  };

  for (let x = mainSternX; x <= mainBowX; x++) {
    const b = mainBounds(x);
    if (!b) continue;
    for (let y = b.top; y <= b.bot; y++) {
      setTile(x, y, 'EXTERIOR_DECK', 'Weather Deck', 'WEATHER');
      deckGrid[y][x] = 'MAIN';
    }
  }

  // Lower Hull Deck (y = 32..55, centerline = 44)
  const lowerCenterY = 44;
  const lowerSternX = 6;
  const lowerBowX = 58;
  const lowerMaxBeam = archetype === 'ICEBREAKER' ? 10 : 9;

  const lowerBounds = (x: number): { top: number; bot: number } | null => {
    if (x < lowerSternX || x > lowerBowX) return null;
    const u = (x - lowerSternX) / (lowerBowX - lowerSternX);
    let hb = lowerMaxBeam;
    if (u < 0.14) {
      const s = u / 0.14;
      hb = Math.round(lowerMaxBeam * (0.65 + 0.35 * Math.sin(s * Math.PI * 0.5)));
    } else if (u > 0.72) {
      const t = (u - 0.72) / 0.28;
      hb = Math.max(2, Math.round(lowerMaxBeam * Math.pow(1 - t, 0.7)));
    }
    return { top: lowerCenterY - hb, bot: lowerCenterY + hb };
  };

  let prevLowerHb: number | null = null;
  for (let x = lowerSternX; x <= lowerBowX; x++) {
    const b = lowerBounds(x);
    if (!b) continue;
    let hb = (b.bot - b.top) / 2;
    if (prevLowerHb !== null && Math.abs(hb - prevLowerHb) > 1) {
      hb = prevLowerHb + Math.sign(hb - prevLowerHb);
    }
    prevLowerHb = hb;
    for (let y = lowerCenterY - hb; y <= lowerCenterY + hb; y++) {
      setTile(x, y, 'WALL', 'Corridor', 'STEEL');
      deckGrid[y][x] = 'LOWER';
    }
  }

  const rooms: RoomBounds[] = [];
  const doors: Door[] = [];
  const props: ShipProp[] = [];
  const stairwells: Stairwell[] = [];
  const steamVents: SteamVent[] = [];
  let doorSeq = 0;
  let propSeq = 0;

  const addDoorway = (
    tx: number,
    ty: number,
    orientation: 'H' | 'V',
    room: RoomName,
    mat: FloorMaterial = 'STEEL',
    options?: { open?: boolean; locked?: boolean; noDoor?: boolean }
  ) => {
    if (tiles[ty]?.[tx] === 'VOID') return;
    setTile(tx, ty, 'FLOOR', room, mat);
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
    mat: FloorMaterial
  ) => {
    const actualX1 = Math.min(x1, x2);
    const actualX2 = Math.max(x1, x2);
    const actualY1 = Math.min(y1, y2);
    const actualY2 = Math.max(y1, y2);
    for (let y = actualY1; y <= actualY2; y++) {
      for (let x = actualX1; x <= actualX2; x++) {
        if (tiles[y]?.[x] === 'VOID') continue;
        setTile(x, y, tileType, name, mat);
      }
    }
    rooms.push({ name, deck, x1: actualX1, y1: actualY1, x2: actualX2, y2: actualY2 });
  };

  const buildDeckhouseShell = (x1: number, y1: number, x2: number, y2: number) => {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (tiles[y]?.[x] === 'VOID') continue;
        setTile(x, y, 'WALL', 'Corridor', 'STEEL');
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
    }
  ): boolean => {
    for (let y = ty; y < ty + th; y++) {
      for (let x = tx; x < tx + tw; x++) {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        if (!isTileWalkable(tiles[y][x])) return false;
        if (reserved.has(key(x, y))) return false;
      }
    }
    for (let y = ty; y < ty + th; y++) {
      for (let x = tx; x < tx + tw; x++) {
        reserved.add(key(x, y));
        if (options?.blocking) {
          setTile(x, y, 'WALL', options.room ?? roomGrid[y][x], floorMaterial[y][x]);
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

  // --- 2. MAIN DECK ZONES BY ARCHETYPE ---
  // Stern Helideck (always outdoor at stern)
  const heliX1 = 4;
  const heliX2 = 12;
  const heliY1 = 9;
  const heliY2 = 19;
  addRoom('Helideck', 'MAIN', heliX1, heliY1, heliX2, heliY2, 'EXTERIOR_DECK', 'WEATHER');
  const heliTx = 6;
  const heliTy = 14;
  setTile(heliTx, heliTy, 'ESCAPE_HELI', 'Helideck', 'WEATHER');
  reserveAround(heliTx, heliTy, 2);

  // Forecastle at bow
  addRoom('Forecastle', 'MAIN', 52, 8, 59, 20, 'EXTERIOR_DECK', 'WEATHER');
  addProp('CAPSTAN', 'MAIN', 56, 14, 1, 1, { blocking: true, room: 'Forecastle' });

  // Lifeboat Davit relocated far forward along the Forecastle Port or Starboard rail (always >= 45 tiles from Helideck!)
  const davitOnPort = !flipY;
  const lifeboatTx = 52;
  const bowBounds = mainBounds(lifeboatTx) ?? { top: 8, bot: 20 };
  // Guarantee an unbroken 4x3 deck bay flush against the ocean void edge for the hydraulic davit crane
  const lifeboatTy = davitOnPort ? bowBounds.top : bowBounds.bot;
  const davitY1 = davitOnPort ? lifeboatTy : Math.max(15, lifeboatTy - 2);
  const davitY2 = davitOnPort ? Math.min(13, lifeboatTy + 2) : lifeboatTy;
  // Carve flat hull edge at tx=51..54 so outboard rail runs horizontally behind the davit
  for (let dx = 51; dx <= 54; dx++) {
    for (let dy = davitY1; dy <= davitY2; dy++) {
      setTile(dx, dy, 'EXTERIOR_DECK', 'Lifeboat Davit', 'WEATHER');
    }
    const outVoidY = davitOnPort ? lifeboatTy - 1 : lifeboatTy + 1;
    if (outVoidY >= 0 && outVoidY < height) {
      tiles[outVoidY][dx] = 'VOID';
    }
  }
  addRoom('Lifeboat Davit', 'MAIN', 51, davitY1, 54, davitY2, 'EXTERIOR_DECK', 'WEATHER');
  setTile(lifeboatTx, lifeboatTy, 'ESCAPE_LIFEBOAT', 'Lifeboat Davit', 'WEATHER');
  reserveAround(lifeboatTx, lifeboatTy, 1);

  // Deckhouse & Container Bay positions depend on Archetype + Seed Shifts
  const shiftA = randInt(rng, -1, 1);
  const shiftB = randInt(rng, -1, 1);

  let aftStairMain = { tx: 16, ty: 14, room: 'Corridor' as RoomName };
  let midStairMain = { tx: 37, ty: 14, room: 'Container Bay' as RoomName };
  const bowStairMain = { tx: 54, ty: 14, room: 'Forecastle' as RoomName };

  const placeContainerYard = (
    xStart: number,
    xEnd: number,
    yTop: number,
    yBot: number,
    excludeSpots: Array<{ tx: number; ty: number }>
  ) => {
    addRoom('Container Bay', 'MAIN', xStart, yTop, xEnd, yBot, 'EXTERIOR_DECK', 'WEATHER');
    // Catwalks flanking container bay
    addRoom('Catwalk', 'MAIN', xStart, yTop - 2, xEnd, yTop - 1, 'EXTERIOR_DECK', 'WEATHER');
    addRoom('Catwalk', 'MAIN', xStart, yBot + 1, xEnd, yBot + 2, 'EXTERIOR_DECK', 'WEATHER');

    // Reserve walkways & central cross alley
    const crossAlleyX = randInt(rng, xStart + 4, Math.max(xStart + 4, xEnd - 4));
    for (let y = yTop; y <= yBot; y++) {
      reserved.add(key(crossAlleyX, y));
      reserved.add(key(crossAlleyX + 1, y));
    }
    for (const ex of excludeSpots) {
      reserveAround(ex.tx, ex.ty, 2);
    }

    // Place a crane pedestal in or near the cross alley
    const craneY = flipY ? yTop + 1 : yBot - 2;
    addProp('CRANE_PEDESTAL', 'MAIN', crossAlleyX, craneY, 2, 2, {
      blocking: true,
      room: 'Container Bay',
    });

    // Staggered 20ft (3x2) and 40ft (5x2) shipping containers separated by >= 2 tile alleys!
    const laneYs: number[] = [];
    for (let ly = yTop + 1; ly <= yBot - 3; ly += 4) {
      laneYs.push(ly);
    }
    for (const ly of laneYs) {
      let cx = xStart + 1 + randInt(rng, 0, 1);
      while (cx + 3 <= xEnd - 1) {
        const cw = rng() > 0.45 && cx + 5 <= xEnd - 1 ? 5 : 3;
        const color = CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)];
        const placed = addProp('SHIPPING_CONTAINER', 'MAIN', cx, ly, cw, 2, {
          blocking: true,
          color,
          orientation: 'H',
          room: 'Container Bay',
        });
        cx += placed ? cw + randInt(rng, 2, 3) : 2;
      }
    }
  };

  if (archetype === 'CONTAINER_FREIGHTER') {
    // Aft Superstructure Deckhouse (x = 14..26+shiftA, y = 6..22)
    const dhX1 = 14;
    const dhX2 = 25 + shiftA;
    buildDeckhouseShell(dhX1, 6, dhX2, 22);
    // Exterior catwalks outside deckhouse
    addRoom('Catwalk', 'MAIN', dhX1, 4, dhX2, 5, 'EXTERIOR_DECK', 'WEATHER');
    addRoom('Catwalk', 'MAIN', dhX1, 23, dhX2, 24, 'EXTERIOR_DECK', 'WEATHER');

    // Interior gangway inside deckhouse
    const gangY = flipY ? 12 : 15;
    fillRect(dhX1 + 1, gangY, dhX2 - 1, gangY + 1, 'FLOOR', 'Corridor', 'STEEL');
    fillRect(dhX1 + 1, 7, dhX1 + 2, 21, 'FLOOR', 'Corridor', 'STEEL');

    // Bridge (forward side of superstructure looking out over container bay)
    const brX1 = dhX1 + 4;
    const brX2 = dhX2 - 1;
    if (!flipY) {
      addRoom('Bridge', 'MAIN', brX1, 7, brX2, 13, 'FLOOR', 'BRIDGE');
      addRoom('Chart Room', 'MAIN', brX1, 18, dhX1 + 7, 21, 'FLOOR', 'CABIN');
      addRoom('Officers Mess', 'MAIN', dhX1 + 9, 18, brX2, 21, 'FLOOR', 'CABIN');
      addDoorway(brX1 + 2, 14, 'H', 'Bridge', 'BRIDGE', { open: rng() > 0.5 });
      addDoorway(brX2 - 1, 14, 'H', 'Bridge', 'BRIDGE', { open: false });
      addDoorway(brX1 + 1, 17, 'H', 'Chart Room', 'CABIN', { open: false });
      addDoorway(dhX1 + 10, 17, 'H', 'Officers Mess', 'CABIN', { open: rng() > 0.5 });
      addProp('HELM_CONSOLE', 'MAIN', brX2 - 2, 9, 1, 3, { blocking: true, room: 'Bridge' });
      addProp('CHART_TABLE', 'MAIN', brX1 + 1, 19, 2, 1, { blocking: true, room: 'Chart Room' });
      addProp('MESS_TABLE', 'MAIN', dhX1 + 9, 20, 2, 1, { blocking: true, room: 'Officers Mess' });
    } else {
      addRoom('Bridge', 'MAIN', brX1, 15, brX2, 21, 'FLOOR', 'BRIDGE');
      addRoom('Chart Room', 'MAIN', brX1, 7, dhX1 + 7, 10, 'FLOOR', 'CABIN');
      addRoom('Officers Mess', 'MAIN', dhX1 + 9, 7, brX2, 10, 'FLOOR', 'CABIN');
      addDoorway(brX1 + 2, 14, 'H', 'Bridge', 'BRIDGE', { open: rng() > 0.5 });
      addDoorway(brX2 - 1, 14, 'H', 'Bridge', 'BRIDGE', { open: false });
      addDoorway(brX1 + 1, 11, 'H', 'Chart Room', 'CABIN', { open: false });
      addDoorway(dhX1 + 10, 11, 'H', 'Officers Mess', 'CABIN', { open: rng() > 0.5 });
      addProp('HELM_CONSOLE', 'MAIN', brX2 - 2, 17, 1, 3, { blocking: true, room: 'Bridge' });
      addProp('CHART_TABLE', 'MAIN', brX1 + 1, 8, 2, 1, { blocking: true, room: 'Chart Room' });
      addProp('MESS_TABLE', 'MAIN', dhX1 + 9, 8, 2, 1, { blocking: true, room: 'Officers Mess' });
    }

    // Exterior doors out of deckhouse (stern, fwd, port, starboard)
    addDoorway(dhX1, gangY, 'V', 'Corridor', 'STEEL', { open: false });
    addDoorway(dhX2, gangY, 'V', 'Corridor', 'STEEL', { open: true });
    addDoorway(dhX1 + 2, 6, 'H', 'Corridor', 'STEEL', { open: rng() > 0.4 });
    addDoorway(dhX1 + 2, 22, 'H', 'Corridor', 'STEEL', { open: false });

    aftStairMain = { tx: dhX1 + 1, ty: flipY ? 19 : 9, room: 'Corridor' };
    midStairMain = { tx: 39 + shiftB, ty: 14, room: 'Container Bay' };
    placeContainerYard(dhX2 + 2, 50, 7, 21, [midStairMain]);
  } else if (archetype === 'BULK_CARRIER') {
    // Midships Superstructure Island (x = 28..40, y = 6..22) + Fore & Aft Container Bays
    const dhX1 = 28 + shiftA;
    const dhX2 = 40 + shiftA;
    buildDeckhouseShell(dhX1, 6, dhX2, 22);
    addRoom('Catwalk', 'MAIN', dhX1, 4, dhX2, 5, 'EXTERIOR_DECK', 'WEATHER');
    addRoom('Catwalk', 'MAIN', dhX1, 23, dhX2, 24, 'EXTERIOR_DECK', 'WEATHER');

    const gangY = flipY ? 11 : 16;
    fillRect(dhX1 + 1, gangY, dhX2 - 1, gangY + 1, 'FLOOR', 'Corridor', 'STEEL');
    fillRect(dhX1 + 5, 7, dhX1 + 6, 21, 'FLOOR', 'Corridor', 'STEEL');

    if (!flipY) {
      addRoom('Bridge', 'MAIN', dhX1 + 7, 7, dhX2 - 1, 14, 'FLOOR', 'BRIDGE');
      addRoom('Chart Room', 'MAIN', dhX1 + 1, 7, dhX1 + 4, 14, 'FLOOR', 'CABIN');
      addRoom('Officers Mess', 'MAIN', dhX1 + 1, 19, dhX2 - 1, 21, 'FLOOR', 'CABIN');
      addDoorway(dhX1 + 9, 15, 'H', 'Bridge', 'BRIDGE', { open: false });
      addDoorway(dhX1 + 3, 15, 'H', 'Chart Room', 'CABIN', { open: true });
      addDoorway(dhX1 + 8, 18, 'H', 'Officers Mess', 'CABIN', { open: false });
      addProp('HELM_CONSOLE', 'MAIN', dhX2 - 2, 9, 1, 3, { blocking: true, room: 'Bridge' });
      addProp('CHART_TABLE', 'MAIN', dhX1 + 2, 9, 1, 2, { blocking: true, room: 'Chart Room' });
      addProp('MESS_TABLE', 'MAIN', dhX1 + 9, 20, 2, 1, { blocking: true, room: 'Officers Mess' });
    } else {
      addRoom('Bridge', 'MAIN', dhX1 + 7, 14, dhX2 - 1, 21, 'FLOOR', 'BRIDGE');
      addRoom('Chart Room', 'MAIN', dhX1 + 1, 14, dhX1 + 4, 21, 'FLOOR', 'CABIN');
      addRoom('Officers Mess', 'MAIN', dhX1 + 1, 7, dhX2 - 1, 9, 'FLOOR', 'CABIN');
      addDoorway(dhX1 + 9, 13, 'H', 'Bridge', 'BRIDGE', { open: false });
      addDoorway(dhX1 + 3, 13, 'H', 'Chart Room', 'CABIN', { open: true });
      addDoorway(dhX1 + 8, 10, 'H', 'Officers Mess', 'CABIN', { open: false });
      addProp('HELM_CONSOLE', 'MAIN', dhX2 - 2, 16, 1, 3, { blocking: true, room: 'Bridge' });
      addProp('CHART_TABLE', 'MAIN', dhX1 + 2, 17, 1, 2, { blocking: true, room: 'Chart Room' });
      addProp('MESS_TABLE', 'MAIN', dhX1 + 9, 8, 2, 1, { blocking: true, room: 'Officers Mess' });
    }

    addDoorway(dhX1, gangY, 'V', 'Corridor', 'STEEL', { open: true });
    addDoorway(dhX2, gangY, 'V', 'Corridor', 'STEEL', { open: false });
    addDoorway(dhX1 + 5, 6, 'H', 'Corridor', 'STEEL', { open: false });
    addDoorway(dhX1 + 5, 22, 'H', 'Corridor', 'STEEL', { open: rng() > 0.5 });

    aftStairMain = { tx: 16, ty: 14, room: 'Container Bay' };
    midStairMain = { tx: dhX1 + 5, ty: flipY ? 19 : 9, room: 'Corridor' };
    placeContainerYard(14, dhX1 - 2, 7, 21, [aftStairMain]);
    placeContainerYard(dhX2 + 2, 50, 7, 21, []);
  } else {
    // ICEBREAKER: Aft Deckhouse/Workshop + Midships Supply Yard + Forward Bridge
    const aftX1 = 14;
    const aftX2 = 21 + shiftA;
    buildDeckhouseShell(aftX1, 8, aftX2, 20);
    addRoom('Workshop', 'MAIN', aftX1 + 1, 9, aftX2 - 1, 19, 'FLOOR', 'STEEL');
    addDoorway(aftX1, 14, 'V', 'Workshop', 'STEEL', { open: false });
    addDoorway(aftX2, 14, 'V', 'Workshop', 'STEEL', { open: true });
    addDoorway(aftX1 + 3, 8, 'H', 'Workshop', 'STEEL', { open: false });
    addProp('WORKBENCH', 'MAIN', aftX1 + 2, 10, 2, 1, { blocking: true, room: 'Workshop' });

    const fwdX1 = 39 + shiftB;
    const fwdX2 = 50;
    buildDeckhouseShell(fwdX1, 6, fwdX2, 22);
    addRoom('Catwalk', 'MAIN', fwdX1, 4, fwdX2, 5, 'EXTERIOR_DECK', 'WEATHER');
    addRoom('Catwalk', 'MAIN', fwdX1, 23, fwdX2, 24, 'EXTERIOR_DECK', 'WEATHER');
    fillRect(fwdX1 + 1, 14, fwdX2 - 1, 15, 'FLOOR', 'Corridor', 'STEEL');
    fillRect(fwdX1 + 1, 7, fwdX1 + 2, 21, 'FLOOR', 'Corridor', 'STEEL');
    addRoom('Bridge', 'MAIN', fwdX1 + 4, 7, fwdX2 - 1, 12, 'FLOOR', 'BRIDGE');
    addRoom('Chart Room', 'MAIN', fwdX1 + 4, 17, fwdX1 + 6, 21, 'FLOOR', 'CABIN');
    addRoom('Officers Mess', 'MAIN', fwdX1 + 8, 17, fwdX2 - 1, 21, 'FLOOR', 'CABIN');
    addDoorway(fwdX1 + 6, 13, 'H', 'Bridge', 'BRIDGE', { open: false });
    addDoorway(fwdX1 + 5, 16, 'H', 'Chart Room', 'CABIN', { open: true });
    addDoorway(fwdX1 + 9, 16, 'H', 'Officers Mess', 'CABIN', { open: false });
    addDoorway(fwdX1, 14, 'V', 'Corridor', 'STEEL', { open: true });
    addDoorway(fwdX2, 14, 'V', 'Corridor', 'STEEL', { open: false });
    addDoorway(fwdX1 + 2, 6, 'H', 'Corridor', 'STEEL', { open: false });
    addDoorway(fwdX1 + 2, 22, 'H', 'Corridor', 'STEEL', { open: false });
    addProp('HELM_CONSOLE', 'MAIN', fwdX2 - 2, 8, 1, 3, { blocking: true, room: 'Bridge' });
    addProp('CHART_TABLE', 'MAIN', fwdX1 + 4, 19, 2, 1, { blocking: true, room: 'Chart Room' });
    addProp('MESS_TABLE', 'MAIN', fwdX1 + 9, 19, 2, 1, { blocking: true, room: 'Officers Mess' });

    aftStairMain = { tx: aftX1 + 2, ty: 17, room: 'Workshop' };
    midStairMain = { tx: 30, ty: 14, room: 'Container Bay' };
    placeContainerYard(aftX2 + 2, fwdX1 - 2, 7, 21, [midStairMain]);
  }

  // --- 3. LOWER HULL DECK (Asymmetric compartments with true bulkhead partitions) ---
  // Longitudinal gangway (2 tiles wide) separated from every compartment by 1-tile steel bulkheads
  const gangLowerY = flipY ? 41 : 46;
  fillRect(8, gangLowerY, 48, gangLowerY + 1, 'FLOOR', 'Corridor', 'STEEL');

  // Aft Machinery Wing (x = 8..engSplitX)
  const engSplitX = 20 + randInt(rng, -1, 1);
  if (!flipY) {
    // Upper wing stops at y=44 (leaving row 45 as bulkhead wall); Lower wing starts at y=49 (wall at 48)
    addRoom('Engine Room', 'LOWER', 8, 38, engSplitX, 44, 'FLOOR', 'GRATING');
    addRoom('Boiler Room', 'LOWER', 9, 49, 16, 51, 'FLOOR', 'GRATING');
    if (archetype !== 'ICEBREAKER') {
      addRoom('Workshop', 'LOWER', 18, 49, engSplitX + 2, 51, 'FLOOR', 'STEEL');
      addDoorway(19, 48, 'H', 'Workshop', 'STEEL', { open: false });
      addProp('WORKBENCH', 'LOWER', 18, 51, 2, 1, { blocking: true, room: 'Workshop' });
    } else {
      addRoom('Boiler Room', 'LOWER', 9, 49, engSplitX + 2, 51, 'FLOOR', 'GRATING');
      addDoorway(19, 48, 'H', 'Boiler Room', 'GRATING', { open: true });
    }
    addDoorway(12, 45, 'H', 'Engine Room', 'GRATING', { open: false });
    addDoorway(engSplitX - 2, 45, 'H', 'Engine Room', 'GRATING', { open: rng() > 0.5 });
    addDoorway(12, 48, 'H', 'Boiler Room', 'GRATING', { open: false });
    addProp('TURBINE', 'LOWER', 11, 40, 3, 2, { blocking: true, room: 'Engine Room' });
    addProp('TURBINE', 'LOWER', 16, 40, 3, 2, { blocking: true, room: 'Engine Room' });
    addProp('PIPE_RUN', 'LOWER', 9, 38, 8, 1, { blocking: false });
    addProp('BOILER', 'LOWER', 9, 51, 2, 1, { blocking: true, room: 'Boiler Room' });
    steamVents.push(
      { id: 'vent_0', tx: 14, ty: 43, x: 14.5 * tileSize, y: 43.5 * tileSize, timer: 4, activeTimer: 0 },
      { id: 'vent_1', tx: 14, ty: 50, x: 14.5 * tileSize, y: 50.5 * tileSize, timer: 9, activeTimer: 0 }
    );
  } else {
    // Upper wing stops at y=39 (wall at 40); Lower wing starts at y=44 (leaving row 43 as bulkhead wall)
    addRoom('Engine Room', 'LOWER', 8, 44, engSplitX, 50, 'FLOOR', 'GRATING');
    addRoom('Boiler Room', 'LOWER', 9, 37, 16, 39, 'FLOOR', 'GRATING');
    if (archetype !== 'ICEBREAKER') {
      addRoom('Workshop', 'LOWER', 18, 37, engSplitX + 2, 39, 'FLOOR', 'STEEL');
      addDoorway(19, 40, 'H', 'Workshop', 'STEEL', { open: false });
      addProp('WORKBENCH', 'LOWER', 18, 37, 2, 1, { blocking: true, room: 'Workshop' });
    } else {
      addRoom('Boiler Room', 'LOWER', 9, 37, engSplitX + 2, 39, 'FLOOR', 'GRATING');
      addDoorway(19, 40, 'H', 'Boiler Room', 'GRATING', { open: true });
    }
    addDoorway(12, 43, 'H', 'Engine Room', 'GRATING', { open: false });
    addDoorway(engSplitX - 2, 43, 'H', 'Engine Room', 'GRATING', { open: rng() > 0.5 });
    addDoorway(12, 40, 'H', 'Boiler Room', 'GRATING', { open: false });
    addProp('TURBINE', 'LOWER', 11, 46, 3, 2, { blocking: true, room: 'Engine Room' });
    addProp('TURBINE', 'LOWER', 16, 46, 3, 2, { blocking: true, room: 'Engine Room' });
    addProp('PIPE_RUN', 'LOWER', 9, 50, 8, 1, { blocking: false });
    addProp('BOILER', 'LOWER', 9, 37, 2, 1, { blocking: true, room: 'Boiler Room' });
    steamVents.push(
      { id: 'vent_0', tx: 14, ty: 44, x: 14.5 * tileSize, y: 44.5 * tileSize, timer: 4, activeTimer: 0 },
      { id: 'vent_1', tx: 14, ty: 38, x: 14.5 * tileSize, y: 38.5 * tileSize, timer: 9, activeTimer: 0 }
    );
  }

  // Midships Lower Cargo Hold & Cross Passage (holdStartX = engSplitX + 2 .. holdEndX)
  const holdStartX = engSplitX + 2;
  const holdEndX = 37 + randInt(rng, -2, 2);
  // Trimmed cross-corridor connecting Engine Room, Hold, and Gangway without dead-end vertical stubs
  fillRect(
    holdStartX,
    flipY ? 41 : 40,
    holdStartX + 1,
    47,
    'FLOOR',
    'Corridor',
    'STEEL'
  );
  addDoorway(engSplitX + 1, flipY ? 47 : 41, 'V', 'Engine Room', 'GRATING', { open: false });

  if (!flipY) {
    addRoom('Lower Cargo Hold', 'LOWER', holdStartX + 3, 37, holdEndX, 44, 'FLOOR', 'CARGO');
    addRoom('Infirmary', 'LOWER', holdStartX + 3, 49, holdEndX, 51, 'FLOOR', 'CABIN');
    addDoorway(holdStartX + 2, 41, 'V', 'Lower Cargo Hold', 'CARGO', { open: true });
    addDoorway(holdStartX + 6, 45, 'H', 'Lower Cargo Hold', 'CARGO', { open: false });
    addDoorway(holdEndX - 2, 45, 'H', 'Lower Cargo Hold', 'CARGO', { locked: true });
    addDoorway(holdStartX + 6, 48, 'H', 'Infirmary', 'CABIN', { open: false });
    addProp('SHIPPING_CONTAINER', 'LOWER', holdStartX + 5, 39, 3, 2, {
      blocking: true,
      color: '#57422a',
      room: 'Lower Cargo Hold',
    });
    addProp('SHIPPING_CONTAINER', 'LOWER', holdEndX - 4, 41, 3, 2, {
      blocking: true,
      color: '#3f362a',
      room: 'Lower Cargo Hold',
    });
    addProp('MED_BED', 'LOWER', holdStartX + 3, 51, 2, 1, { blocking: true, room: 'Infirmary' });
    addProp('MED_BED', 'LOWER', holdEndX - 1, 51, 2, 1, { blocking: true, room: 'Infirmary' });
  } else {
    addRoom('Lower Cargo Hold', 'LOWER', holdStartX + 3, 44, holdEndX, 51, 'FLOOR', 'CARGO');
    addRoom('Infirmary', 'LOWER', holdStartX + 3, 37, holdEndX, 39, 'FLOOR', 'CABIN');
    addDoorway(holdStartX + 2, 47, 'V', 'Lower Cargo Hold', 'CARGO', { open: true });
    addDoorway(holdStartX + 6, 43, 'H', 'Lower Cargo Hold', 'CARGO', { open: false });
    addDoorway(holdEndX - 2, 43, 'H', 'Lower Cargo Hold', 'CARGO', { locked: true });
    addDoorway(holdStartX + 6, 40, 'H', 'Infirmary', 'CABIN', { open: false });
    addProp('SHIPPING_CONTAINER', 'LOWER', holdStartX + 5, 45, 3, 2, {
      blocking: true,
      color: '#57422a',
      room: 'Lower Cargo Hold',
    });
    addProp('SHIPPING_CONTAINER', 'LOWER', holdEndX - 4, 47, 3, 2, {
      blocking: true,
      color: '#3f362a',
      room: 'Lower Cargo Hold',
    });
    addProp('MED_BED', 'LOWER', holdStartX + 3, 37, 2, 1, { blocking: true, room: 'Infirmary' });
    addProp('MED_BED', 'LOWER', holdEndX - 1, 37, 2, 1, { blocking: true, room: 'Infirmary' });
  }

  // Forward Living Wing: Crew Quarters & Galley & Mess (holdEndX+2 .. 48)
  const crewStartX = holdEndX + 2;
  const crewEndX = 48;
  fillRect(crewStartX, 41, crewStartX + 1, 47, 'FLOOR', 'Corridor', 'STEEL');
  if (!flipY) {
    addRoom('Crew Quarters', 'LOWER', crewStartX + 3, 38, crewEndX, 44, 'FLOOR', 'CABIN');
    addRoom('Galley & Mess', 'LOWER', crewStartX + 3, 49, crewEndX, 50, 'FLOOR', 'CABIN');
    addDoorway(crewStartX + 2, 42, 'V', 'Crew Quarters', 'CABIN', { open: false });
    addDoorway(crewStartX + 5, 45, 'H', 'Crew Quarters', 'CABIN', { open: rng() > 0.5 });
    addDoorway(crewStartX + 5, 48, 'H', 'Galley & Mess', 'CABIN', { open: true });
    addProp('BUNK', 'LOWER', crewStartX + 3, 38, 2, 1, { blocking: true, room: 'Crew Quarters' });
    addProp('BUNK', 'LOWER', crewEndX - 1, 38, 2, 1, { blocking: true, room: 'Crew Quarters' });
    addProp('GALLEY_COUNTER', 'LOWER', crewStartX + 3, 50, 2, 1, { blocking: true, room: 'Galley & Mess' });
    addProp('MESS_TABLE', 'LOWER', crewEndX - 1, 50, 2, 1, { blocking: true, room: 'Galley & Mess' });
  } else {
    addRoom('Crew Quarters', 'LOWER', crewStartX + 3, 44, crewEndX, 50, 'FLOOR', 'CABIN');
    addRoom('Galley & Mess', 'LOWER', crewStartX + 3, 38, crewEndX, 39, 'FLOOR', 'CABIN');
    addDoorway(crewStartX + 2, 47, 'V', 'Crew Quarters', 'CABIN', { open: false });
    addDoorway(crewStartX + 5, 43, 'H', 'Crew Quarters', 'CABIN', { open: rng() > 0.5 });
    addDoorway(crewStartX + 5, 40, 'H', 'Galley & Mess', 'CABIN', { open: true });
    addProp('BUNK', 'LOWER', crewStartX + 3, 50, 2, 1, { blocking: true, room: 'Crew Quarters' });
    addProp('BUNK', 'LOWER', crewEndX - 1, 50, 2, 1, { blocking: true, room: 'Crew Quarters' });
    addProp('GALLEY_COUNTER', 'LOWER', crewStartX + 3, 38, 2, 1, { blocking: true, room: 'Galley & Mess' });
    addProp('MESS_TABLE', 'LOWER', crewEndX - 1, 38, 2, 1, { blocking: true, room: 'Galley & Mess' });
  }

  // Padlocked shortcut between Lower Cargo Hold & Crew Quarters
  addDoorway(holdEndX + 1, flipY ? 47 : 42, 'V', 'Crew Quarters', 'CABIN', { locked: true });

  // Bow Pump Room (50..54, 41..47)
  addRoom('Pump Room', 'LOWER', 50, 41, 54, 47, 'FLOOR', 'GRATING');
  addDoorway(49, gangLowerY + (flipY ? 1 : 0), 'V', 'Pump Room', 'GRATING', { open: false });
  addProp('BOILER', 'LOWER', 53, 43, 1, 2, { blocking: true, room: 'Pump Room' });
  steamVents.push({
    id: 'vent_2',
    tx: 51,
    ty: 42,
    x: 51.5 * tileSize,
    y: 42.5 * tileSize,
    timer: 6,
    activeTimer: 0,
  });

  // Enforce unbroken outer steel hull skin around Lower Deck (never let rooms punch through ocean boundary)
  for (let y = 33; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (deckGrid[y][x] !== 'LOWER' || tiles[y][x] === 'VOID') continue;
      const touchesVoid =
        tiles[y - 1][x] === 'VOID' ||
        tiles[y + 1][x] === 'VOID' ||
        tiles[y][x - 1] === 'VOID' ||
        tiles[y][x + 1] === 'VOID';
      if (touchesVoid && tiles[y][x] !== 'WALL') {
        setTile(x, y, 'WALL', 'Corridor', 'STEEL');
      }
    }
  }

  // --- 4. Bidirectional Stairwell Links between MAIN & LOWER Decks ---
  const aftStairLower = { tx: 10, ty: flipY ? 48 : 40, room: 'Engine Room' as RoomName };
  const midStairLower = {
    tx: holdStartX + 1,
    ty: flipY ? 43 : 45,
    room: 'Corridor' as RoomName,
  };
  const bowStairLower = { tx: 51, ty: 44, room: 'Pump Room' as RoomName };

  const linkStairs = (
    idA: string,
    deckA: ShipDeck,
    posA: { tx: number; ty: number; room: RoomName },
    idB: string,
    deckB: ShipDeck,
    posB: { tx: number; ty: number; room: RoomName },
    label: string
  ) => {
    setTile(posA.tx, posA.ty, deckA === 'MAIN' && roomGrid[posA.ty][posA.tx] === 'Container Bay' ? 'EXTERIOR_DECK' : 'FLOOR', posA.room, floorMaterial[posA.ty][posA.tx]);
    setTile(posB.tx, posB.ty, 'FLOOR', posB.room, floorMaterial[posB.ty][posB.tx]);
    reserveAround(posA.tx, posA.ty, 1);
    reserveAround(posB.tx, posB.ty, 1);

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
        room: posA.room,
        label,
        direction: deckA === 'MAIN' ? 'DOWN' : 'UP',
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
        room: posB.room,
        label,
        direction: deckB === 'MAIN' ? 'DOWN' : 'UP',
      }
    );
  };

  linkStairs('stair_aft_main', 'MAIN', aftStairMain, 'stair_aft_lower', 'LOWER', aftStairLower, 'Aft Machinery Companionway');
  linkStairs('stair_mid_main', 'MAIN', midStairMain, 'stair_mid_lower', 'LOWER', midStairLower, 'Midships Cargo Companionway');
  linkStairs('stair_bow_main', 'MAIN', bowStairMain, 'stair_bow_lower', 'LOWER', bowStairLower, 'Forecastle Hatch');

  // --- 4b. Post-Carve Doorway Validation & Corridor Stub Pruning ---
  const stairKeys = new Set(stairwells.map((s) => key(s.tx, s.ty)));
  // Prune any 1-tile corridor stubs (walkable Corridor FLOOR tiles walled on >= 3 sides without stairs/doors)
  const provisionalDoorKeys = new Set(doors.map((d) => key(d.tx, d.ty)));
  let prunedAny = true;
  while (prunedAny) {
    prunedAny = false;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (tiles[y][x] !== 'FLOOR' || roomGrid[y][x] !== 'Corridor') continue;
        const k = key(x, y);
        if (stairKeys.has(k) || provisionalDoorKeys.has(k)) continue;
        let wallCount = 0;
        if (!isTileWalkable(tiles[y - 1][x])) wallCount++;
        if (!isTileWalkable(tiles[y + 1][x])) wallCount++;
        if (!isTileWalkable(tiles[y][x - 1])) wallCount++;
        if (!isTileWalkable(tiles[y][x + 1])) wallCount++;
        if (wallCount >= 3) {
          setTile(x, y, 'WALL', 'Corridor', 'STEEL');
          prunedAny = true;
        }
      }
    }
  }

  // Strictly keep ONLY doors cleanly framed by perpendicular WALL jambs and opposite walkable passages
  const validatedDoors = doors.filter((d) => {
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
  });
  doors.length = 0;
  doors.push(...validatedDoors);

  // --- 5. Dynamic Hiding Spots, Containers, and Room Light Switches ---
  const findFreeTilesInRoom = (roomName: RoomName): Array<{ tx: number; ty: number }> => {
    const res: Array<{ tx: number; ty: number }> = [];
    for (let y = 0; y < height; y++) {
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
      return { c, wallNeighbors, tie: rng() };
    });
    scored.sort((a, b) => b.wallNeighbors - a.wallNeighbors || a.tie - b.tie);
    return scored[0]?.c ?? null;
  };

  // Room Light Switches in every major enclosed interior room
  const litSwitchRooms: RoomName[] = [
    'Bridge',
    'Chart Room',
    'Officers Mess',
    'Workshop',
    'Engine Room',
    'Boiler Room',
    'Lower Cargo Hold',
    'Infirmary',
    'Crew Quarters',
    'Galley & Mess',
    'Pump Room',
  ];
  const lightSwitches: RoomLightSwitch[] = [];
  let switchSeq = 0;

  for (const rName of litSwitchRooms) {
    if (!rooms.some((r) => r.name === rName)) continue;
    const free = findFreeTilesInRoom(rName);
    const chosen = pickWallAdjacentTile(free);
    if (!chosen) continue;
    reserved.add(key(chosen.tx, chosen.ty));
    lightSwitches.push({
      id: `light_${switchSeq++}`,
      room: rName,
      tx: chosen.tx,
      ty: chosen.ty,
      x: (chosen.tx + 0.5) * tileSize,
      y: (chosen.ty + 0.5) * tileSize,
      isOn: false,
    });
  }

  // Hiding Spots across both decks
  const hidingSpots: HidingSpot[] = [];
  let hideSeq = 0;
  const hidingSpec: Array<{ room: RoomName; count: number; type: HidingSpotType }> = [
    { room: 'Bridge', count: 2, type: 'LOCKER' },
    { room: 'Chart Room', count: 1, type: 'UNDER_DESK' },
    { room: 'Officers Mess', count: 1, type: 'UNDER_DESK' },
    { room: 'Container Bay', count: 3, type: 'CARGO_CRATE' },
    { room: 'Engine Room', count: 3, type: 'LOCKER' },
    { room: 'Boiler Room', count: 1, type: 'LOCKER' },
    { room: 'Workshop', count: 2, type: 'LOCKER' },
    { room: 'Lower Cargo Hold', count: 3, type: 'CARGO_CRATE' },
    { room: 'Infirmary', count: 2, type: 'LOCKER' },
    { room: 'Crew Quarters', count: 3, type: 'LOCKER' },
    { room: 'Galley & Mess', count: 2, type: 'UNDER_DESK' },
    { room: 'Pump Room', count: 1, type: 'LOCKER' },
    { room: 'Corridor', count: 3, type: 'LOCKER' },
  ];

  for (const spec of hidingSpec) {
    for (let i = 0; i < spec.count; i++) {
      const free = findFreeTilesInRoom(spec.room);
      const chosen = pickWallAdjacentTile(free);
      if (!chosen) break;
      reserved.add(key(chosen.tx, chosen.ty));
      hidingSpots.push({
        id: `hide_${hideSeq++}`,
        tx: chosen.tx,
        ty: chosen.ty,
        x: (chosen.tx + 0.5) * tileSize,
        y: (chosen.ty + 0.5) * tileSize,
        type: spec.type,
        room: spec.room,
        angle: rng() * Math.PI * 2,
        checkedFlash: 0,
      });
    }
  }

  // Searchable Containers distributed across rooms & weather deck
  const containerSpec: Array<{ room: RoomName; count: number; type: ContainerType }> = [
    { room: 'Bridge', count: 2, type: 'DESK' },
    { room: 'Chart Room', count: 2, type: 'DESK' },
    { room: 'Officers Mess', count: 2, type: 'CABINET' },
    { room: 'Container Bay', count: 4, type: 'SUPPLY_CRATE' },
    { room: 'Forecastle', count: 1, type: 'SUPPLY_CRATE' },
    { room: 'Weather Deck', count: 2, type: 'SUPPLY_CRATE' },
    { room: 'Workshop', count: 2, type: 'TOOLBOX' },
    { room: 'Engine Room', count: 3, type: 'TOOLBOX' },
    { room: 'Boiler Room', count: 2, type: 'TOOLBOX' },
    { room: 'Lower Cargo Hold', count: 3, type: 'SUPPLY_CRATE' },
    { room: 'Infirmary', count: 2, type: 'CABINET' },
    { room: 'Crew Quarters', count: 3, type: 'CABINET' },
    { room: 'Galley & Mess', count: 2, type: 'CABINET' },
    { room: 'Pump Room', count: 1, type: 'TOOLBOX' },
  ];

  const containerCoords: Array<{ tx: number; ty: number; type: ContainerType; room: RoomName }> = [];
  for (const spec of containerSpec) {
    for (let i = 0; i < spec.count; i++) {
      const free = findFreeTilesInRoom(spec.room);
      const chosen = pickWallAdjacentTile(free);
      if (!chosen) break;
      reserved.add(key(chosen.tx, chosen.ty));
      containerCoords.push({
        tx: chosen.tx,
        ty: chosen.ty,
        type: spec.type,
        room: spec.room,
      });
    }
  }

  // --- 6. Player & Brute Spawns (Opposite Decks or Far Apart!) ---
  const playerSpawnChoices = [
    { tx: crewStartX + 4, ty: gangLowerY },
    { tx: 9, ty: 14 }, // Stern Helideck edge
    { tx: 54, ty: 13 }, // Forecastle
  ].filter((c) => isTileWalkable(tiles[c.ty]?.[c.tx] ?? 'VOID'));
  const pStart = playerSpawnChoices[Math.floor(rng() * playerSpawnChoices.length)] ?? { tx: 9, ty: 14 };

  const playerDeck = deckGrid[pStart.ty][pStart.tx];
  const bruteChoices = [
    { tx: 13, ty: flipY ? 44 : 42 }, // Engine Room (LOWER)
    { tx: holdStartX + 4, ty: flipY ? 45 : 42 }, // Lower Cargo Hold (LOWER)
    { tx: 46, ty: 14 }, // Forward Container Bay (MAIN)
    { tx: aftStairMain.tx, ty: aftStairMain.ty }, // Main Deck Aft
  ].filter(
    (c) =>
      isTileWalkable(tiles[c.ty]?.[c.tx] ?? 'VOID') &&
      (deckGrid[c.ty][c.tx] !== playerDeck ||
        Math.abs(c.tx - pStart.tx) + Math.abs(c.ty - pStart.ty) >= 22)
  );
  const bStart = bruteChoices[Math.floor(rng() * bruteChoices.length)] ?? {
    tx: 13,
    ty: flipY ? 44 : 42,
  };

  // --- 7. Verify Multi-Deck Reachability BEFORE Assigning Guaranteed Escape Items ---
  const doorByTile = new Map<number, Door>();
  for (const d of doors) doorByTile.set(key(d.tx, d.ty), d);
  const stairByTile = new Map<number, Stairwell>();
  for (const s of stairwells) stairByTile.set(key(s.tx, s.ty), s);

  const visited = new Uint8Array(width * height);
  const queue: Array<{ tx: number; ty: number }> = [{ tx: pStart.tx, ty: pStart.ty }];
  visited[key(pStart.tx, pStart.ty)] = 1;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const neighbors: Array<{ nx: number; ny: number }> = [
      { nx: cur.tx + 1, ny: cur.ty },
      { nx: cur.tx - 1, ny: cur.ty },
      { nx: cur.tx, ny: cur.ty + 1 },
      { nx: cur.tx, ny: cur.ty - 1 },
    ];
    const st = stairByTile.get(key(cur.tx, cur.ty));
    if (st) {
      const target = stairwells.find((o) => o.id === st.targetStairId);
      if (target) neighbors.push({ nx: target.tx, ny: target.ty });
    }
    for (const { nx, ny } of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const k = key(nx, ny);
      if (visited[k]) continue;
      if (!isTileWalkable(tiles[ny][nx])) continue;
      const door = doorByTile.get(k);
      if (door?.isLocked) continue;
      visited[k] = 1;
      queue.push({ tx: nx, ty: ny });
    }
  }

  const reachableContainerCoords = containerCoords.filter((c) => visited[key(c.tx, c.ty)] === 1);
  const reachableSpots = hidingSpots.filter((s) => visited[key(s.tx, s.ty)] === 1);
  const reachableSwitches = lightSwitches.filter((sw) => visited[key(sw.tx, sw.ty)] === 1);

  const guaranteedItems: ItemId[] = [
    'WINCH_CRANK',
    'MARINE_BATTERY',
    'HULL_PATCH',
    'AVIATION_FUEL',
    'IGNITION_KEY',
    'ROTOR_FUSE',
    'BACKPACK',
    'BOLT_CUTTERS',
    'BOLT_CUTTERS',
    'FIRE_EXTINGUISHER',
    'FIRE_EXTINGUISHER',
    'FLARE',
    'FLARE',
    'FLARE',
    'GLOWSTICK',
    'GLOWSTICK',
    'GLOWSTICK',
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
    searched: false,
    item: assignedItems[idx],
  }));

  return {
    width,
    height,
    tileSize,
    archetype,
    tiles,
    roomGrid,
    deckGrid,
    floorMaterial,
    rooms,
    doors,
    stairwells,
    props,
    hidingSpots: reachableSpots,
    containers: reachableContainers,
    steamVents,
    lightSwitches: reachableSwitches,
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
    seed,
  };
}
