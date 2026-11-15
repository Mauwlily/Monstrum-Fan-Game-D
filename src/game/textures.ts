import { FloorMaterial } from './types';

export interface ProceduralShipTextures {
  floorPatterns: Record<FloorMaterial, CanvasPattern | null>;
  wallArmorPattern: CanvasPattern | null;
  grimeDecals: HTMLCanvasElement[];
}

function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function createCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Unable to create offscreen texture canvas');
  return [c, ctx];
}

function addSurfaceNoise(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rng: () => number,
  count: number,
  lightColor: string,
  darkColor: string
): void {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * w);
    const y = Math.floor(rng() * h);
    const size = rng() > 0.78 ? 2 : 1;
    ctx.fillStyle = rng() > 0.5 ? lightColor : darkColor;
    ctx.fillRect(x, y, size, size);
  }
}

function drawRivet(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.beginPath();
  ctx.arc(x + 0.6, y + 0.6, 1.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(148, 163, 184, 0.34)';
  ctx.beginPath();
  ctx.arc(x, y, 1.1, 0, Math.PI * 2);
  ctx.fill();
}

function buildSteelPlateTile(ts: number): HTMLCanvasElement {
  const size = ts * 2;
  const [c, ctx] = createCanvas(size, size);
  const rng = makePrng(101);

  ctx.fillStyle = '#141b24';
  ctx.fillRect(0, 0, size, size);

  // Subtle brushed metal streaks
  for (let i = 0; i < 42; i++) {
    const y = rng() * size;
    const len = 14 + rng() * 32;
    const x = rng() * size;
    ctx.fillStyle = rng() > 0.5 ? 'rgba(148, 163, 184, 0.035)' : 'rgba(6, 9, 14, 0.14)';
    ctx.fillRect(x, y, len, 1);
  }

  // Offset welded plate sub-panels so ship doesn't look like a uniform square grid
  const plates = [
    { x: 0, y: 0, w: ts, h: ts, shade: '#161e29' },
    { x: ts, y: 0, w: ts, h: ts, shade: '#131922' },
    { x: 0, y: ts, w: ts, h: ts, shade: '#121821' },
    { x: ts, y: ts, w: ts, h: ts, shade: '#151c27' },
  ];
  for (const p of plates) {
    ctx.fillStyle = p.shade;
    ctx.fillRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + 1.5, p.y + p.h - 1.5);
    ctx.lineTo(p.x + 1.5, p.y + 1.5);
    ctx.lineTo(p.x + p.w - 1.5, p.y + 1.5);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(2, 6, 12, 0.45)';
    ctx.beginPath();
    ctx.moveTo(p.x + p.w - 0.5, p.y + 1);
    ctx.lineTo(p.x + p.w - 0.5, p.y + p.h - 0.5);
    ctx.lineTo(p.x + 1, p.y + p.h - 0.5);
    ctx.stroke();

    drawRivet(ctx, p.x + 5, p.y + 5);
    drawRivet(ctx, p.x + p.w - 5, p.y + 5);
    drawRivet(ctx, p.x + 5, p.y + p.h - 5);
    drawRivet(ctx, p.x + p.w - 5, p.y + p.h - 5);
  }

  // Subtle rust patina at one corner seam
  const rg = ctx.createRadialGradient(ts * 0.9, ts * 1.1, 2, ts * 0.9, ts * 1.1, 16);
  rg.addColorStop(0, 'rgba(124, 45, 18, 0.16)');
  rg.addColorStop(1, 'rgba(124, 45, 18, 0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, size, size);

  addSurfaceNoise(ctx, size, size, rng, 280, 'rgba(203, 213, 225, 0.03)', 'rgba(0, 0, 0, 0.14)');
  return c;
}

function buildGratingTile(ts: number): HTMLCanvasElement {
  const [c, ctx] = createCanvas(ts, ts);
  const rng = makePrng(202);

  // Dark machinery abyss beneath grating
  ctx.fillStyle = '#06090e';
  ctx.fillRect(0, 0, ts, ts);

  // Faint lower-bilge pipe shadow beneath grate
  ctx.fillStyle = 'rgba(30, 41, 59, 0.25)';
  ctx.fillRect(0, ts * 0.22, ts, 7);
  ctx.fillRect(ts * 0.65, 0, 6, ts);

  // Steel diamond/bar grate lattice
  ctx.strokeStyle = '#1f2a38';
  ctx.lineWidth = 2.2;
  for (let x = 3; x < ts; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ts);
    ctx.stroke();
  }
  ctx.strokeStyle = '#29374a';
  ctx.lineWidth = 1.6;
  for (let y = 5; y < ts; y += 11) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ts, y);
    ctx.stroke();
  }

  // Subtle rust on grate welds
  addSurfaceNoise(ctx, ts, ts, rng, 70, 'rgba(180, 83, 9, 0.09)', 'rgba(148, 163, 184, 0.05)');
  return c;
}

function buildCargoTile(ts: number): HTMLCanvasElement {
  const size = ts * 2;
  const [c, ctx] = createCanvas(size, size);
  const rng = makePrng(303);

  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, size, size);

  // Heavy ribbed industrial plating
  for (let y = 0; y < size; y += 11) {
    ctx.fillStyle = y % 22 === 0 ? 'rgba(30, 41, 59, 0.36)' : 'rgba(9, 13, 18, 0.35)';
    ctx.fillRect(0, y, size, 4);
  }

  // Staggered plate weld lines
  ctx.strokeStyle = 'rgba(2, 6, 12, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(0.5, 0.5, size - 1, ts - 1);
  ctx.strokeRect(0.5, ts + 0.5, size - 1, ts - 1);
  ctx.beginPath();
  ctx.moveTo(ts, 0);
  ctx.lineTo(ts, ts);
  ctx.moveTo(ts * 0.5, ts);
  ctx.lineTo(ts * 0.5, size);
  ctx.stroke();

  // Warm rust & ochre cargo dust streaks
  for (let i = 0; i < 6; i++) {
    const rx = rng() * size;
    const ry = rng() * size;
    const rg = ctx.createRadialGradient(rx, ry, 2, rx, ry, 18 + rng() * 14);
    rg.addColorStop(0, 'rgba(146, 64, 14, 0.16)');
    rg.addColorStop(1, 'rgba(146, 64, 14, 0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, size, size);
  }

  // Subtle corner tie-down D-rings
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.14)';
  ctx.lineWidth = 1;
  ctx.strokeRect(6, 6, 5, 5);
  ctx.strokeRect(ts + 6, ts + 6, 5, 5);

  addSurfaceNoise(ctx, size, size, rng, 240, 'rgba(245, 158, 11, 0.03)', 'rgba(0, 0, 0, 0.15)');
  return c;
}

function buildCabinTile(ts: number): HTMLCanvasElement {
  const size = ts * 2;
  const [c, ctx] = createCanvas(size, size);
  const rng = makePrng(404);

  // Worn shipboard cabin planking / dark maritime linoleum
  ctx.fillStyle = '#181e28';
  ctx.fillRect(0, 0, size, size);

  const plankH = 11;
  for (let row = 0; row < size / plankH; row++) {
    const py = row * plankH;
    const tint = row % 3 === 0 ? '#1b222e' : row % 3 === 1 ? '#171d27' : '#151a24';
    ctx.fillStyle = tint;
    ctx.fillRect(0, py, size, plankH - 1);
    ctx.fillStyle = 'rgba(5, 8, 13, 0.5)';
    ctx.fillRect(0, py + plankH - 1, size, 1);

    const jointX = ((row * 31) % (size - 16)) + 8;
    ctx.fillRect(jointX, py, 1, plankH);

    // Subtle wood/composite grain streaks
    for (let g = 0; g < 4; g++) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.03)';
      ctx.fillRect(rng() * size, py + 2 + rng() * (plankH - 4), 10 + rng() * 18, 1);
    }
  }

  addSurfaceNoise(ctx, size, size, rng, 200, 'rgba(203, 213, 225, 0.025)', 'rgba(0, 0, 0, 0.12)');
  return c;
}

function buildBridgeTile(ts: number): HTMLCanvasElement {
  const [c, ctx] = createCanvas(ts, ts);
  const rng = makePrng(505);

  ctx.fillStyle = '#0f1621';
  ctx.fillRect(0, 0, ts, ts);

  // Anti-slip studded rubber bridge deck matting
  for (let y = 4; y < ts; y += 7) {
    for (let x = 4; x < ts; x += 7) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
      ctx.fillRect(x, y, 2, 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(x + 1, y + 1, 1.5, 1.5);
    }
  }

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.06)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, ts - 1, ts - 1);
  addSurfaceNoise(ctx, ts, ts, rng, 80, 'rgba(56, 189, 248, 0.025)', 'rgba(0, 0, 0, 0.15)');
  return c;
}

function buildWeatherDeckTile(ts: number): HTMLCanvasElement {
  const size = ts * 2;
  const [c, ctx] = createCanvas(size, size);
  const rng = makePrng(606);

  ctx.fillStyle = '#0f1620';
  ctx.fillRect(0, 0, size, size);

  // Long fore-to-aft weathered steel deck strakes
  for (let y = 0; y < size; y += 14) {
    ctx.fillStyle = y % 28 === 0 ? '#111924' : '#0e151e';
    ctx.fillRect(0, y, size, 13);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.06)';
    ctx.fillRect(0, y, size, 1);
    ctx.fillStyle = 'rgba(2, 6, 12, 0.5)';
    ctx.fillRect(0, y + 13, size, 1);
  }

  // Sea-salt & wet weather sheen patches
  for (let i = 0; i < 5; i++) {
    const wx = rng() * size;
    const wy = rng() * size;
    const wg = ctx.createRadialGradient(wx, wy, 2, wx, wy, 16 + rng() * 14);
    wg.addColorStop(0, 'rgba(56, 189, 248, 0.05)');
    wg.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = wg;
    ctx.fillRect(0, 0, size, size);
  }

  addSurfaceNoise(ctx, size, size, rng, 240, 'rgba(148, 163, 184, 0.03)', 'rgba(0, 0, 0, 0.16)');
  return c;
}

function buildWallArmorTile(ts: number): HTMLCanvasElement {
  const size = ts * 2;
  const [c, ctx] = createCanvas(size, size);
  const rng = makePrng(707);

  ctx.fillStyle = '#1d2635';
  ctx.fillRect(0, 0, size, size);

  // Diagonal structural weld bands & heavy armor plating
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.05)';
  ctx.lineWidth = 2;
  for (let d = -size; d < size * 2; d += 22) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + size, size);
    ctx.stroke();
  }

  // Armor sub-panels with rivets
  for (let py = 0; py < size; py += ts) {
    for (let px = 0; px < size; px += ts) {
      ctx.fillStyle = ((px + py) / ts) % 2 === 0 ? 'rgba(47, 61, 82, 0.34)' : 'rgba(15, 23, 42, 0.24)';
      ctx.fillRect(px + 2, py + 2, ts - 4, ts - 4);
      drawRivet(ctx, px + 6, py + 6);
      drawRivet(ctx, px + ts - 6, py + 6);
      drawRivet(ctx, px + 6, py + ts - 6);
      drawRivet(ctx, px + ts - 6, py + ts - 6);
    }
  }

  // Subtle corrosion streaks
  for (let i = 0; i < 6; i++) {
    const rx = rng() * size;
    const ry = rng() * size;
    const rg = ctx.createRadialGradient(rx, ry, 2, rx, ry, 14);
    rg.addColorStop(0, 'rgba(124, 45, 18, 0.18)');
    rg.addColorStop(1, 'rgba(124, 45, 18, 0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, size, size);
  }

  addSurfaceNoise(ctx, size, size, rng, 200, 'rgba(203, 213, 225, 0.03)', 'rgba(0, 0, 0, 0.16)');
  return c;
}

function buildGrimeDecals(ts: number): HTMLCanvasElement[] {
  const decals: HTMLCanvasElement[] = [];
  for (let variant = 0; variant < 6; variant++) {
    const [c, ctx] = createCanvas(ts, ts);
    const rng = makePrng(900 + variant * 37);
    const cx = ts * (0.3 + rng() * 0.4);
    const cy = ts * (0.3 + rng() * 0.4);
    const r = ts * (0.28 + rng() * 0.22);

    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
    if (variant % 2 === 0) {
      // Rust corrosion blotch
      g.addColorStop(0, 'rgba(124, 45, 18, 0.24)');
      g.addColorStop(0.55, 'rgba(92, 34, 14, 0.11)');
      g.addColorStop(1, 'rgba(92, 34, 14, 0)');
    } else {
      // Dark bilge oil stain
      g.addColorStop(0, 'rgba(3, 6, 10, 0.34)');
      g.addColorStop(0.6, 'rgba(8, 12, 18, 0.16)');
      g.addColorStop(1, 'rgba(8, 12, 18, 0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Small scattered flecks around stain
    for (let k = 0; k < 6; k++) {
      const fx = cx + (rng() - 0.5) * r * 1.4;
      const fy = cy + (rng() - 0.5) * r * 1.4;
      ctx.fillStyle = variant % 2 === 0 ? 'rgba(154, 52, 18, 0.18)' : 'rgba(2, 4, 8, 0.28)';
      ctx.beginPath();
      ctx.arc(fx, fy, 1 + rng() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    decals.push(c);
  }
  return decals;
}

export function createProceduralShipTextures(
  ctx: CanvasRenderingContext2D,
  tileSize: number
): ProceduralShipTextures {
  return {
    floorPatterns: {
      STEEL: ctx.createPattern(buildSteelPlateTile(tileSize), 'repeat'),
      GRATING: ctx.createPattern(buildGratingTile(tileSize), 'repeat'),
      CARGO: ctx.createPattern(buildCargoTile(tileSize), 'repeat'),
      CABIN: ctx.createPattern(buildCabinTile(tileSize), 'repeat'),
      BRIDGE: ctx.createPattern(buildBridgeTile(tileSize), 'repeat'),
      WEATHER: ctx.createPattern(buildWeatherDeckTile(tileSize), 'repeat'),
    },
    wallArmorPattern: ctx.createPattern(buildWallArmorTile(tileSize), 'repeat'),
    grimeDecals: buildGrimeDecals(tileSize),
  };
}
