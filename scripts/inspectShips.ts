import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { generateCargoShip, isTileWalkable } from '../src/game/mapGen';
import { analyzeShipMap, renderShipAscii, ShipAuditReport } from '../src/game/shipAnalyzer';
import { ShipMap } from '../src/game/types';

const SNAPSHOT_DIR = path.resolve(
  '.aistudio/artifacts/brain/e5cc8ba5-d298-4762-80a7-fcddc0bf69d0/ship_snapshots'
);

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function encodePngRgba(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter None
    rgba.subarray(y * width * 4, (y + 1) * width * 4).forEach((v, idx) => {
      raw[y * stride + 1 + idx] = v;
    });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = Number.parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function renderShipBlueprintPng(map: ShipMap, audit: ShipAuditReport, outPath: string): void {
  const scale = 12;
  const imgW = map.width * scale;
  const imgH = map.height * scale;
  const buf = new Uint8Array(imgW * imgH * 4);

  const fillRectPx = (
    px: number,
    py: number,
    pw: number,
    ph: number,
    r: number,
    g: number,
    b: number
  ) => {
    const x0 = Math.max(0, px);
    const y0 = Math.max(0, py);
    const x1 = Math.min(imgW, px + pw);
    const y1 = Math.min(imgH, py + ph);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * imgW + x) * 4;
        buf[idx] = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = 255;
      }
    }
  };

  // Base tiles
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tiles[y][x];
      const mat = map.floorMaterial[y][x];
      const rm = map.roomGrid[y][x];
      let rgb: [number, number, number] = [5, 10, 18];
      if (t === 'WALL') {
        rgb = [22, 31, 46];
      } else if (t === 'EXTERIOR_DECK') {
        rgb = rm === 'Catwalk' ? [42, 54, 72] : rm === 'Helideck' ? [52, 60, 48] : [36, 48, 66];
      } else if (t === 'FLOOR') {
        if (mat === 'GRATING') rgb = [38, 52, 68];
        else if (mat === 'CARGO') rgb = [60, 50, 38];
        else if (mat === 'CABIN') rgb = [54, 61, 78];
        else if (mat === 'BRIDGE') rgb = [30, 58, 86];
        else rgb = [46, 56, 70];
      } else if (t === 'ESCAPE_HELI') {
        rgb = [250, 204, 21];
      } else if (t === 'ESCAPE_LIFEBOAT') {
        rgb = [56, 189, 248];
      }
      fillRectPx(x * scale, y * scale, scale, scale, rgb[0], rgb[1], rgb[2]);

      // Tile gridline for readable proportions
      if (isTileWalkable(t)) {
        fillRectPx(
          x * scale,
          y * scale,
          scale,
          1,
          Math.max(0, rgb[0] - 8),
          Math.max(0, rgb[1] - 8),
          Math.max(0, rgb[2] - 8)
        );
        fillRectPx(
          x * scale,
          y * scale,
          1,
          scale,
          Math.max(0, rgb[0] - 8),
          Math.max(0, rgb[1] - 8),
          Math.max(0, rgb[2] - 8)
        );
      }
    }
  }

  // Props (Shipping containers + machinery)
  for (const prop of map.props) {
    const [r, g, b] = prop.color
      ? hexToRgb(prop.color)
      : prop.kind === 'TURBINE' || prop.kind === 'BOILER'
        ? [180, 83, 9]
        : [100, 116, 139];
    fillRectPx(
      prop.tx * scale + 1,
      prop.ty * scale + 1,
      prop.tw * scale - 2,
      prop.th * scale - 2,
      r,
      g,
      b
    );
  }

  // Stairwells
  for (const st of map.stairwells) {
    const [r, g, b] = st.direction === 'DOWN' ? [56, 189, 248] : [251, 191, 36];
    fillRectPx(st.tx * scale + 2, st.ty * scale + 2, scale - 4, scale - 4, r, g, b);
  }

  // Hiding spots (blue) & Containers (gold) & Switches (emerald)
  for (const h of map.hidingSpots) {
    fillRectPx(h.tx * scale + 3, h.ty * scale + 3, scale - 6, scale - 6, 59, 130, 246);
  }
  for (const c of map.containers) {
    fillRectPx(c.tx * scale + 4, c.ty * scale + 4, scale - 8, scale - 8, 250, 204, 21);
  }
  for (const sw of map.lightSwitches) {
    fillRectPx(sw.tx * scale + 4, sw.ty * scale + 4, scale - 8, scale - 8, 52, 211, 153);
  }

  // Doors (amber/green for valid, glaring MAGENTA box for stray!)
  const strayIds = new Set(audit.strayDoors.map((d) => d.doorId));
  for (const d of map.doors) {
    const isStray = strayIds.has(d.id);
    if (isStray) {
      fillRectPx((d.tx - 1) * scale, (d.ty - 1) * scale, scale * 3, 2, 255, 0, 128);
      fillRectPx((d.tx - 1) * scale, (d.ty + 2) * scale - 2, scale * 3, 2, 255, 0, 128);
      fillRectPx((d.tx - 1) * scale, (d.ty - 1) * scale, 2, scale * 3, 255, 0, 128);
      fillRectPx((d.tx + 2) * scale - 2, (d.ty - 1) * scale, 2, scale * 3, 255, 0, 128);
      fillRectPx(d.tx * scale + 1, d.ty * scale + 1, scale - 2, scale - 2, 255, 0, 128);
    } else {
      const [r, g, b] = d.isLocked ? [239, 68, 68] : [245, 158, 11];
      if (d.orientation === 'H') {
        fillRectPx(d.tx * scale, d.ty * scale + 4, scale, 4, r, g, b);
      } else {
        fillRectPx(d.tx * scale + 4, d.ty * scale, 4, scale, r, g, b);
      }
    }
  }

  // Corridor stubs (cyan highlight)
  for (const st of audit.corridorStubs) {
    fillRectPx(st.tx * scale + 2, st.ty * scale + 2, scale - 4, scale - 4, 34, 211, 238);
  }

  // Player & Brute spawns
  const pTx = Math.floor(map.playerSpawn.x / map.tileSize);
  const pTy = Math.floor(map.playerSpawn.y / map.tileSize);
  const bTx = Math.floor(map.bruteSpawn.x / map.tileSize);
  const bTy = Math.floor(map.bruteSpawn.y / map.tileSize);
  fillRectPx(pTx * scale + 2, pTy * scale + 2, scale - 4, scale - 4, 34, 197, 94);
  fillRectPx(bTx * scale + 2, bTy * scale + 2, scale - 4, scale - 4, 239, 68, 68);

  fs.writeFileSync(outPath, encodePngRgba(imgW, imgH, buf));
}

fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

// Sample 100 seeds across archetypes and emit statistics + representative PNG blueprints
const sampleByArch = new Map<string, { map: ShipMap; audit: ShipAuditReport }>();
let totalStrayDoors = 0;
let totalCorridorStubs = 0;
let totalRoomDeadEnds = 0;
let totalUnreachable = 0;
const reasonExamples = new Map<string, number>();

for (let i = 0; i < 100; i++) {
  const seed = 100000 + i * 7919;
  const map = generateCargoShip(seed);
  const audit = analyzeShipMap(map);
  totalStrayDoors += audit.strayDoors.length;
  totalCorridorStubs += audit.corridorStubs.length;
  totalRoomDeadEnds += audit.roomDeadEnds.length;
  totalUnreachable += audit.unreachableImportant;
  for (const s of audit.strayDoors) {
    const key = `${map.archetype}: ${s.room} (${s.orientation}) -> ${s.reason}`;
    reasonExamples.set(key, (reasonExamples.get(key) ?? 0) + 1);
  }
  const archKey = `${map.archetype}_${audit.strayDoors.length > 0 ? 'hasStray' : 'clean'}`;
  if (!sampleByArch.has(archKey)) {
    sampleByArch.set(archKey, { map, audit });
  }
  if (!sampleByArch.has(map.archetype)) {
    sampleByArch.set(map.archetype, { map, audit });
  }
}

console.log('=== PROCEDURAL SHIP AUDIT (100 SEEDS) ===');
console.log({
  totalStrayDoors,
  avgStrayDoorsPerShip: (totalStrayDoors / 100).toFixed(2),
  totalCorridorStubs,
  avgCorridorStubsPerShip: (totalCorridorStubs / 100).toFixed(2),
  totalRoomDeadEnds,
  avgRoomDeadEndsPerShip: (totalRoomDeadEnds / 100).toFixed(2),
  totalUnreachable,
});
console.log('\nTop stray door causes:');
for (const [k, count] of Array.from(reasonExamples.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  [${count}x] ${k}`);
}

const renderedFiles: string[] = [];
for (const arch of ['CONTAINER_FREIGHTER', 'BULK_CARRIER', 'ICEBREAKER']) {
  const entry = sampleByArch.get(`${arch}_hasStray`) ?? sampleByArch.get(arch);
  if (!entry) continue;
  const pngPath = path.join(SNAPSHOT_DIR, `${arch.toLowerCase()}_${entry.map.seed}.png`);
  renderShipBlueprintPng(entry.map, entry.audit, pngPath);
  renderedFiles.push(pngPath);
  console.log(`\n--- ASCII SNAPSHOT: ${arch} (seed=${entry.map.seed}, strayDoors=${entry.audit.strayDoors.length}, stubs=${entry.audit.corridorStubs.length}) ---`);
  console.log(renderShipAscii(entry.map, entry.audit));
}
console.log('\nRendered PNG snapshots:', renderedFiles);
