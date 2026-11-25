import * as THREE from 'three/webgpu';
import { createProceduralShipTextures } from './textures';
import {
  ContainerType,
  HidingSpotType,
  ItemId,
  ShipDeck,
  ShipMap,
  ShipProp,
  SHIP_DECK_ORDER,
} from './types';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Unable to create offscreen 2D canvas for Three.js asset');
  return [c, ctx];
}

function makeSpriteCanvas(
  logicalW: number,
  logicalH: number,
  scale = 2
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(logicalW * scale);
  c.height = Math.ceil(logicalH * scale);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Unable to create offscreen sprite canvas');
  ctx.scale(scale, scale);
  return [c, ctx];
}

function toTexture(
  canvas: HTMLCanvasElement,
  anisotropy: number,
  linear = false
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

export interface BakedDeckChunk {
  deck: ShipDeck;
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
  texture: THREE.CanvasTexture;
}

export interface HullWakeEdge {
  deck: ShipDeck;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  nx: number;
  ny: number;
  midYOffset: number;
  phase: number;
}

export interface BakedShipAssets {
  chunks: BakedDeckChunk[];
  wakeEdges: HullWakeEdge[];
  dispose: () => void;
}

export function bakeShipDeckChunks(map: ShipMap, anisotropy: number): BakedShipAssets {
  const ts = map.tileSize;
  const [, dummyCtx] = makeCanvas(4, 4);
  const procTex = createProceduralShipTextures(dummyCtx, ts);

  const chunks: BakedDeckChunk[] = [];
  const chunkTilesX = 32; // 32 * 44 = 1408px max dimension (safe on every GPU)

  const walkableClutter = map.props.filter(
    (p) => !p.blocking && p.kind !== 'SUBMARINE_HULL' && p.kind !== 'FLOODGATE_LEVER'
  );
  const blockingStaticProps = map.props.filter(
    (p) => Boolean(p.blocking) && p.kind !== 'SUBMARINE_HULL' && p.kind !== 'FLOODGATE_LEVER'
  );

  for (const deck of SHIP_DECK_ORDER) {
    const bounds = map.deckBounds[deck];
    const yStartTile = bounds.y1;
    const yEndTile = bounds.y2;
    const hTiles = yEndTile - yStartTile + 1;
    const yPx = yStartTile * ts;
    const hPx = hTiles * ts;

    for (let xStartTile = 0; xStartTile < map.width; xStartTile += chunkTilesX) {
      const xEndTile = Math.min(map.width - 1, xStartTile + chunkTilesX - 1);
      const wTiles = xEndTile - xStartTile + 1;
      const xPx = xStartTile * ts;
      const wPx = wTiles * ts;

      const [canvas, ctx] = makeCanvas(wPx, hPx);
      ctx.save();
      ctx.translate(-xPx, -yPx);

      // 1. Tiles (floors, grime decals, escape zone hazard borders, wall AO + baseboards, gunwale rails)
      for (let ty = yStartTile; ty <= yEndTile; ty++) {
        for (let tx = xStartTile; tx <= xEndTile; tx++) {
          const t = map.tiles[ty][tx];
          if (t === 'VOID' || t === 'WALL') continue;
          const x = tx * ts;
          const y = ty * ts;
          const mat =
            t === 'EXTERIOR_DECK' || t === 'ESCAPE_HELI' || t === 'ESCAPE_LIFEBOAT'
              ? 'WEATHER'
              : map.floorMaterial[ty][tx];

          const pat = procTex.floorPatterns[mat];
          if (pat) {
            ctx.fillStyle = pat;
            ctx.fillRect(x, y, ts, ts);
          } else {
            ctx.fillStyle = '#141a23';
            ctx.fillRect(x, y, ts, ts);
          }

          const hash = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
          if (procTex.grimeDecals.length > 0 && mat !== 'BRIDGE' && hash % 7 === 0) {
            ctx.drawImage(procTex.grimeDecals[hash % procTex.grimeDecals.length], x, y);
          }

          if (t === 'ESCAPE_HELI') {
            ctx.fillStyle = 'rgba(251, 191, 36, 0.1)';
            ctx.fillRect(x, y, ts, ts);
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.24)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 2, y + 2, ts - 4, ts - 4);
          } else if (t === 'ESCAPE_LIFEBOAT') {
            ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
            ctx.fillRect(x, y, ts, ts);
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 2, y + 2, ts - 4, ts - 4);
          } else if (t === 'ESCAPE_SUBMARINE') {
            ctx.fillStyle = 'rgba(45, 212, 191, 0.14)';
            ctx.fillRect(x, y, ts, ts);
            ctx.strokeStyle = 'rgba(45, 212, 191, 0.34)';
            ctx.lineWidth = 1.2;
            ctx.strokeRect(x + 2, y + 2, ts - 4, ts - 4);
          }

          const aoDepth = 6;
          const wallN = map.tiles[ty - 1]?.[tx] === 'WALL';
          const wallS = map.tiles[ty + 1]?.[tx] === 'WALL';
          const wallW = map.tiles[ty]?.[tx - 1] === 'WALL';
          const wallE = map.tiles[ty]?.[tx + 1] === 'WALL';

          if (wallN) {
            const g = ctx.createLinearGradient(x, y, x, y + aoDepth);
            g.addColorStop(0, 'rgba(0, 0, 0, 0.36)');
            g.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(x, y, ts, aoDepth);
            ctx.fillStyle = 'rgba(100, 116, 139, 0.38)';
            ctx.fillRect(x, y, ts, 1.5);
          }
          if (wallS) {
            const g = ctx.createLinearGradient(x, y + ts, x, y + ts - aoDepth);
            g.addColorStop(0, 'rgba(0, 0, 0, 0.34)');
            g.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(x, y + ts - aoDepth, ts, aoDepth);
            ctx.fillStyle = 'rgba(71, 85, 105, 0.38)';
            ctx.fillRect(x, y + ts - 1.5, ts, 1.5);
          }
          if (wallW) {
            const g = ctx.createLinearGradient(x, y, x + aoDepth, y);
            g.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
            g.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(x, y, aoDepth, ts);
            ctx.fillStyle = 'rgba(100, 116, 139, 0.36)';
            ctx.fillRect(x, y, 1.5, ts);
          }
          if (wallE) {
            const g = ctx.createLinearGradient(x + ts, y, x + ts - aoDepth, y);
            g.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
            g.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(x + ts - aoDepth, y, aoDepth, ts);
            ctx.fillStyle = 'rgba(71, 85, 105, 0.36)';
            ctx.fillRect(x + ts - 1.5, y, 1.5, ts);
          }

          if (
            deck !== 'DECK_3' &&
            (t === 'EXTERIOR_DECK' || t === 'ESCAPE_HELI' || t === 'ESCAPE_LIFEBOAT')
          ) {
            const voidN = map.tiles[ty - 1]?.[tx] === 'VOID';
            const voidS = map.tiles[ty + 1]?.[tx] === 'VOID';
            const voidW = map.tiles[ty]?.[tx - 1] === 'VOID';
            const voidE = map.tiles[ty]?.[tx + 1] === 'VOID';

            const inset = 3;
            const cham = 10;

            const drawRail = (x1: number, y1: number, x2: number, y2: number) => {
              ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
              ctx.lineWidth = 4.2;
              ctx.beginPath();
              ctx.moveTo(x1, y1 + 1.5);
              ctx.lineTo(x2, y2 + 1.5);
              ctx.stroke();

              ctx.strokeStyle = '#64748b';
              ctx.lineWidth = 2.6;
              ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.stroke();

              ctx.fillStyle = '#cbd5e1';
              ctx.beginPath();
              ctx.arc(x1, y1, 2.2, 0, Math.PI * 2);
              ctx.arc(x2, y2, 2.2, 0, Math.PI * 2);
              ctx.fill();
            };

            if (voidN) {
              drawRail(x + (voidW ? cham : 0), y + inset, x + ts - (voidE ? cham : 0), y + inset);
            }
            if (voidS) {
              drawRail(
                x + (voidW ? cham : 0),
                y + ts - inset,
                x + ts - (voidE ? cham : 0),
                y + ts - inset
              );
            }
            if (voidW) {
              drawRail(x + inset, y + (voidN ? cham : 0), x + inset, y + ts - (voidS ? cham : 0));
            }
            if (voidE) {
              drawRail(
                x + ts - inset,
                y + (voidN ? cham : 0),
                x + ts - inset,
                y + ts - (voidS ? cham : 0)
              );
            }
            if (voidN && voidW) drawRail(x + inset, y + cham, x + cham, y + inset);
            if (voidN && voidE) drawRail(x + ts - cham, y + inset, x + ts - inset, y + cham);
            if (voidS && voidW) drawRail(x + inset, y + ts - cham, x + cham, y + ts - inset);
            if (voidS && voidE)
              drawRail(x + ts - cham, y + ts - inset, x + ts - inset, y + ts - cham);
          }
        }
      }

      // 2. Room floor stencils
      ctx.save();
      ctx.font = '600 11px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
      for (const r of map.rooms) {
        if (r.deck !== deck || r.name === 'Catwalk') continue;
        const rcx = ((r.x1 + r.x2 + 1) / 2) * ts;
        const rcy = ((r.y1 + r.y2 + 1) / 2) * ts;
        if (rcx + 180 < xPx || rcx - 180 > xPx + wPx) continue;
        ctx.fillText(r.name.toUpperCase(), rcx, rcy);
      }
      ctx.restore();

      // 3. Blood streaks
      for (const bs of map.bloodStreaks) {
        const bTy = Math.floor(bs.y / ts);
        if (bTy < yStartTile || bTy > yEndTile) continue;
        if (bs.x + 120 < xPx || bs.x - 120 > xPx + wPx) continue;

        ctx.save();
        ctx.translate(bs.x, bs.y);
        ctx.rotate(bs.angle);
        const alpha = bs.intensity;
        if (bs.kind === 'DRAG_SMEAR') {
          ctx.fillStyle = `rgba(62, 10, 12, ${alpha * 0.72})`;
          ctx.beginPath();
          ctx.ellipse(2, 0, bs.width * 0.65, bs.width * 0.45, 0, 0, Math.PI * 2);
          ctx.fill();

          const ribs = [-0.34, -0.08, 0.16, 0.38];
          for (let r = 0; r < ribs.length; r++) {
            const offsetY = ribs[r] * bs.width;
            const segLen = bs.length * (0.72 + ((bs.seed + r * 17) % 28) / 100);
            const grad = ctx.createLinearGradient(0, offsetY, segLen, offsetY);
            grad.addColorStop(0, `rgba(112, 16, 20, ${alpha * 0.78})`);
            grad.addColorStop(0.55, `rgba(88, 12, 15, ${alpha * 0.48})`);
            grad.addColorStop(1, 'rgba(62, 8, 10, 0)');
            ctx.strokeStyle = grad;
            ctx.lineCap = 'round';
            ctx.lineWidth = r === 1 || r === 2 ? 3.2 : 1.9;
            ctx.beginPath();
            ctx.moveTo(0, offsetY);
            ctx.quadraticCurveTo(
              segLen * 0.5,
              offsetY + (((bs.seed + r) % 3) - 1) * 1.4,
              segLen,
              offsetY * 0.85
            );
            ctx.stroke();
          }
        } else if (bs.kind === 'BOOTPRINTS') {
          const steps = Math.max(4, Math.floor(bs.length / 10));
          for (let i = 0; i < steps; i++) {
            const stepAlpha = alpha * Math.max(0.18, 0.85 - (i / steps) * 0.62);
            const sx = i * 9.5;
            const sy = i % 2 === 0 ? -3.4 : 3.4;
            ctx.fillStyle = `rgba(98, 14, 18, ${stepAlpha})`;
            ctx.beginPath();
            ctx.ellipse(sx - 1.5, sy, 2.0, 1.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(sx + 2.4, sy, 3.0, 1.85, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          ctx.fillStyle = `rgba(76, 11, 14, ${alpha * 0.76})`;
          ctx.beginPath();
          ctx.ellipse(0, 0, bs.width * 0.42, bs.width * 0.3, 0.2, 0, Math.PI * 2);
          ctx.fill();
          let s = bs.seed + 11;
          for (let d = 0; d < 9; d++) {
            s = (s * 1664525 + 1013904223) >>> 0;
            const a = ((s % 1000) / 1000 - 0.5) * 1.3;
            s = (s * 1664525 + 1013904223) >>> 0;
            const dist = 4 + ((s % 1000) / 1000) * bs.length;
            const rad = Math.max(0.8, 1.0 + ((s >>> 8) % 24) / 10);
            ctx.fillStyle =
              d % 3 === 0
                ? `rgba(127, 29, 29, ${alpha * 0.68})`
                : `rgba(88, 13, 16, ${alpha * 0.58})`;
            ctx.beginPath();
            ctx.ellipse(
              Math.cos(a) * dist,
              Math.sin(a) * dist,
              rad * 1.35,
              rad * 0.85,
              a,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // 4. Bulkheads are rendered as 3D extruded geometry in ShipStructure3D (WALL tiles stay alpha=0)

      // 5. Static Ship Props (walkable clutter first, then blocking furniture/machinery)
      const drawStaticProp = (prop: ShipProp) => {
        if (prop.deck !== deck) return;
        const px = prop.tx * ts;
        const py = prop.ty * ts;
        const pw = prop.tw * ts;
        const ph = prop.th * ts;
        if (px + pw < xPx || px > xPx + wPx) return;

        ctx.save();
        if (prop.kind === 'SHIPPING_CONTAINER') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          traceRoundedRect(ctx, px + 5, py + 6, pw - 4, ph - 4, 4);
          ctx.fill();
          ctx.fillStyle = prop.color ?? '#334155';
          traceRoundedRect(ctx, px + 2, py + 2, pw - 4, ph - 4, 4);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.36)';
          ctx.lineWidth = 2.2;
          for (let rx = px + 9; rx < px + pw - 6; rx += 8) {
            ctx.beginPath();
            ctx.moveTo(rx, py + 5);
            ctx.lineTo(rx, py + ph - 5);
            ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(226, 232, 240, 0.14)';
          ctx.lineWidth = 1;
          for (let rx = px + 11; rx < px + pw - 6; rx += 8) {
            ctx.beginPath();
            ctx.moveTo(rx, py + 5);
            ctx.lineTo(rx, py + ph - 5);
            ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(226, 232, 240, 0.24)';
          ctx.lineWidth = 1.5;
          traceRoundedRect(ctx, px + 2.5, py + 2.5, pw - 5, ph - 5, 4);
          ctx.stroke();
          ctx.fillStyle = '#94a3b8';
          ctx.fillRect(px + 2, py + 2, 5, 5);
          ctx.fillRect(px + pw - 7, py + 2, 5, 5);
          ctx.fillRect(px + 2, py + ph - 7, 5, 5);
          ctx.fillRect(px + pw - 7, py + ph - 7, 5, 5);
        } else if (prop.kind === 'TURBINE') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          traceRoundedRect(ctx, px + 5, py + 7, pw - 6, ph - 8, 6);
          ctx.fill();
          ctx.fillStyle = '#242f3f';
          traceRoundedRect(ctx, px + 3, py + 4, pw - 6, ph - 8, 6);
          ctx.fill();
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.fillStyle = '#9a3412';
          traceRoundedRect(ctx, px + 10, py + 8, 7, ph - 16, 2);
          ctx.fill();
          traceRoundedRect(ctx, px + pw - 19, py + 8, 7, ph - 16, 2);
          ctx.fill();
          ctx.fillStyle = '#475569';
          traceRoundedRect(ctx, px + 20, py + 11, pw - 42, ph - 22, 4);
          ctx.fill();
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)';
          ctx.lineWidth = 1.5;
          for (let fx = px + 26; fx < px + pw - 24; fx += 7) {
            ctx.beginPath();
            ctx.moveTo(fx, py + 12);
            ctx.lineTo(fx, py + ph - 12);
            ctx.stroke();
          }
        } else if (prop.kind === 'BOILER') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          traceRoundedRect(ctx, px + 6, py + 6, pw - 8, ph - 8, 6);
          ctx.fill();
          ctx.fillStyle = '#2e2623';
          traceRoundedRect(ctx, px + 4, py + 4, pw - 8, ph - 8, 6);
          ctx.fill();
          ctx.strokeStyle = '#b45309';
          ctx.lineWidth = 1.8;
          ctx.stroke();
          ctx.fillStyle = '#1c1917';
          ctx.beginPath();
          ctx.arc(px + pw / 2, py + ph / 2, 8.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(px + pw / 2, py + ph / 2, 4.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (prop.kind === 'PIPE_RUN') {
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(px + 2, py + 12);
          ctx.lineTo(px + pw - 2, py + 12);
          ctx.stroke();
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 4.5;
          ctx.beginPath();
          ctx.moveTo(px + 2, py + 10);
          ctx.lineTo(px + pw - 2, py + 10);
          ctx.stroke();
          ctx.strokeStyle = '#9a3412';
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.moveTo(px + 2, py + 19);
          ctx.lineTo(px + pw - 2, py + 19);
          ctx.stroke();
          ctx.fillStyle = '#64748b';
          for (let fx = px + 14; fx < px + pw - 10; fx += 34) {
            ctx.fillRect(fx - 2, py + 6, 4, 17);
          }
        } else if (prop.kind === 'BUNK') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
          traceRoundedRect(ctx, px + 6, py + 8, pw - 8, ph - 12, 3);
          ctx.fill();
          ctx.fillStyle = '#2b3648';
          traceRoundedRect(ctx, px + 4, py + 6, pw - 8, ph - 12, 3);
          ctx.fill();
          ctx.fillStyle = '#1e3a5f';
          traceRoundedRect(ctx, px + 14, py + 8, pw - 20, ph - 16, 2);
          ctx.fill();
          ctx.fillStyle = '#cbd5e1';
          traceRoundedRect(ctx, px + 6, py + 9, 7, ph - 18, 2);
          ctx.fill();
        } else if (prop.kind === 'GALLEY_COUNTER') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
          traceRoundedRect(ctx, px + 5, py + 7, pw - 6, ph - 10, 3);
          ctx.fill();
          ctx.fillStyle = '#475569';
          traceRoundedRect(ctx, px + 3, py + 5, pw - 6, ph - 10, 3);
          ctx.fill();
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(px + 8, py + 9, 14, ph - 18);
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.arc(px + pw - 18, py + ph / 2, 6, 0, Math.PI * 2);
          ctx.stroke();
        } else if (prop.kind === 'MESS_TABLE') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
          traceRoundedRect(ctx, px + 7, py + 10, pw - 10, ph - 16, 3);
          ctx.fill();
          ctx.fillStyle = '#57422a';
          traceRoundedRect(ctx, px + 5, py + 8, pw - 10, ph - 16, 3);
          ctx.fill();
          ctx.strokeStyle = '#785a3a';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = '#334155';
          ctx.fillRect(px + 8, py + 2, pw - 16, 4);
          ctx.fillRect(px + 8, py + ph - 6, pw - 16, 4);
        } else if (prop.kind === 'HELM_CONSOLE') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.44)';
          traceRoundedRect(ctx, px + 8, py + 6, pw - 12, ph - 8, 4);
          ctx.fill();
          ctx.fillStyle = '#1e293b';
          traceRoundedRect(ctx, px + 6, py + 4, pw - 12, ph - 8, 4);
          ctx.fill();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.4;
          ctx.stroke();
          ctx.fillStyle = '#34d399';
          ctx.fillRect(px + 10, py + 12, 4, 8);
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(px + 10, py + ph - 20, 4, 8);
        } else if (prop.kind === 'CHART_TABLE') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
          traceRoundedRect(ctx, px + 6, py + 6, pw - 8, ph - 8, 3);
          ctx.fill();
          ctx.fillStyle = '#3b4656';
          traceRoundedRect(ctx, px + 4, py + 4, pw - 8, ph - 8, 3);
          ctx.fill();
          ctx.fillStyle = '#cbd5e1';
          ctx.fillRect(px + 9, py + 9, pw - 18, ph - 18);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(px + 11, py + 11, pw - 22, ph - 22);
        } else if (prop.kind === 'MED_BED') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
          traceRoundedRect(ctx, px + 6, py + 8, pw - 8, ph - 12, 3);
          ctx.fill();
          ctx.fillStyle = '#334155';
          traceRoundedRect(ctx, px + 4, py + 6, pw - 8, ph - 12, 3);
          ctx.fill();
          ctx.fillStyle = '#94a3b8';
          traceRoundedRect(ctx, px + 6, py + 8, pw - 12, ph - 16, 2);
          ctx.fill();
          ctx.fillStyle = '#dc2626';
          ctx.fillRect(px + pw / 2 - 4, py + ph / 2 - 1.5, 8, 3);
          ctx.fillRect(px + pw / 2 - 1.5, py + ph / 2 - 4, 3, 8);
        } else if (prop.kind === 'WORKBENCH') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
          traceRoundedRect(ctx, px + 6, py + 8, pw - 8, ph - 12, 3);
          ctx.fill();
          ctx.fillStyle = '#475569';
          traceRoundedRect(ctx, px + 4, py + 6, pw - 8, ph - 12, 3);
          ctx.fill();
          ctx.fillStyle = '#991b1b';
          ctx.fillRect(px + 8, py + 10, 10, 8);
        } else if (prop.kind === 'CAPSTAN') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.beginPath();
          ctx.arc(px + ts / 2 + 2, py + ts / 2 + 3, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#334155';
          ctx.beginPath();
          ctx.arc(px + ts / 2, py + ts / 2, 13, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = '#475569';
          ctx.beginPath();
          ctx.arc(px + ts / 2, py + ts / 2, 6, 0, Math.PI * 2);
          ctx.fill();
        } else if (prop.kind === 'CRANE_PEDESTAL') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
          ctx.beginPath();
          ctx.arc(px + pw / 2 + 3, py + ph / 2 + 4, 21, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#854d0e';
          ctx.beginPath();
          ctx.arc(px + pw / 2, py + ph / 2, 20, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(px + pw / 2, py + ph / 2);
          ctx.lineTo(px + pw / 2 + 28, py + ph / 2 - 16);
          ctx.stroke();
        } else if (prop.kind === 'PUMP_UNIT') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.46)';
          traceRoundedRect(ctx, px + 6, py + 7, pw - 8, ph - 8, 5);
          ctx.fill();
          ctx.fillStyle = '#1e293b';
          traceRoundedRect(ctx, px + 4, py + 4, pw - 8, ph - 8, 5);
          ctx.fill();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = '#0f766e';
          ctx.beginPath();
          ctx.arc(px + pw * 0.5, py + ph * 0.5, 13, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (prop.kind === 'SWITCHGEAR') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          traceRoundedRect(ctx, px + 6, py + 8, pw - 8, ph - 10, 3);
          ctx.fill();
          ctx.fillStyle = '#242f3f';
          traceRoundedRect(ctx, px + 4, py + 6, pw - 8, ph - 10, 3);
          ctx.fill();
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1.4;
          ctx.stroke();
          for (let sx = px + 14; sx < px + pw - 12; sx += 18) {
            ctx.fillStyle = sx % 36 < 18 ? '#f59e0b' : '#34d399';
            ctx.fillRect(sx, py + 12, 4, 4);
          }
        } else if (prop.kind === 'CABIN_WARDROBE') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
          traceRoundedRect(ctx, px + 7, py + 7, pw - 10, ph - 10, 2);
          ctx.fill();
          ctx.fillStyle = '#3f2e22';
          traceRoundedRect(ctx, px + 5, py + 5, pw - 10, ph - 10, 2);
          ctx.fill();
          ctx.strokeStyle = '#785a3a';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(px + pw / 2 - 0.8, py + 7, 1.6, ph - 14);
        } else if (prop.kind === 'GALLEY_FRIDGE') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
          traceRoundedRect(ctx, px + 7, py + 7, pw - 10, ph - 10, 3);
          ctx.fill();
          ctx.fillStyle = '#64748b';
          traceRoundedRect(ctx, px + 5, py + 5, pw - 10, ph - 10, 3);
          ctx.fill();
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 1.3;
          ctx.stroke();
          ctx.fillStyle = '#334155';
          ctx.fillRect(px + 9, py + ph - 11, pw - 18, 3);
        } else if (prop.kind === 'DINING_BOOTH') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
          traceRoundedRect(ctx, px + 5, py + 7, pw - 6, ph - 10, 3);
          ctx.fill();
          ctx.fillStyle = '#7f1d1d';
          traceRoundedRect(ctx, px + 3, py + 5, pw - 6, 8, 2);
          ctx.fill();
          traceRoundedRect(ctx, px + 3, py + ph - 13, pw - 6, 8, 2);
          ctx.fill();
          ctx.fillStyle = '#cbd5e1';
          traceRoundedRect(ctx, px + 6, py + ph / 2 - 5, pw - 12, 10, 2);
          ctx.fill();
        } else if (prop.kind === 'MED_CART') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
          traceRoundedRect(ctx, px + 8, py + 8, pw - 12, ph - 12, 3);
          ctx.fill();
          ctx.fillStyle = '#cbd5e1';
          traceRoundedRect(ctx, px + 6, py + 6, pw - 12, ph - 12, 3);
          ctx.fill();
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = '#dc2626';
          ctx.fillRect(px + pw / 2 - 4, py + ph / 2 - 1.5, 8, 3);
          ctx.fillRect(px + pw / 2 - 1.5, py + ph / 2 - 4, 3, 8);
        } else if (prop.kind === 'CARGO_RACK') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
          traceRoundedRect(ctx, px + 5, py + 7, pw - 6, ph - 10, 2);
          ctx.fill();
          ctx.fillStyle = '#334155';
          traceRoundedRect(ctx, px + 3, py + 5, pw - 6, ph - 10, 2);
          ctx.fill();
          ctx.strokeStyle = '#d97706';
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.fillStyle = '#57422a';
          ctx.fillRect(px + 8, py + 9, pw / 2 - 10, ph - 18);
          ctx.fillStyle = '#1e3a5f';
          ctx.fillRect(px + pw / 2 + 2, py + 9, pw / 2 - 10, ph - 18);
        } else if (prop.kind === 'GENERATOR_SKID') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.46)';
          traceRoundedRect(ctx, px + 5, py + 7, pw - 6, ph - 10, 4);
          ctx.fill();
          ctx.fillStyle = '#1f2937';
          traceRoundedRect(ctx, px + 3, py + 5, pw - 6, ph - 10, 4);
          ctx.fill();
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = '#991b1b';
          traceRoundedRect(ctx, px + 10, py + 10, pw - 20, ph - 20, 3);
          ctx.fill();
          ctx.fillStyle = '#334155';
          for (let gx = px + 14; gx < px + pw - 14; gx += 7) {
            ctx.fillRect(gx, py + 12, 3, ph - 24);
          }
        } else if (prop.kind === 'VALVE_MANIFOLD') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
          traceRoundedRect(ctx, px + 7, py + 7, pw - 10, ph - 10, 3);
          ctx.fill();
          ctx.fillStyle = '#334155';
          traceRoundedRect(ctx, px + 5, py + 5, pw - 10, ph - 10, 3);
          ctx.fill();
          ctx.strokeStyle = '#9a3412';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(px + 7, py + ph / 2);
          ctx.lineTo(px + pw - 7, py + ph / 2);
          ctx.stroke();
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px + pw / 2, py + ph / 2, 7, 0, Math.PI * 2);
          ctx.stroke();
        } else if (prop.kind === 'COMPRESSED_AIR_TANK') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
          ctx.beginPath();
          ctx.arc(px + pw / 2 + 2, py + ph / 2 + 2, 13, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#0f766e';
          ctx.beginPath();
          ctx.arc(px + pw / 2, py + ph / 2, 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#99f6e4';
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.fillStyle = '#cbd5e1';
          ctx.beginPath();
          ctx.arc(px + pw / 2, py + ph / 2, 4, 0, Math.PI * 2);
          ctx.fill();
        } else if (prop.kind === 'DIVE_GEAR_RACK') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
          traceRoundedRect(ctx, px + 6, py + 8, pw - 8, ph - 12, 3);
          ctx.fill();
          ctx.fillStyle = '#1e293b';
          traceRoundedRect(ctx, px + 4, py + 6, pw - 8, ph - 12, 3);
          ctx.fill();
          ctx.strokeStyle = '#2dd4bf';
          ctx.lineWidth = 1.3;
          ctx.stroke();
          for (let tx = px + 11; tx < px + pw - 10; tx += 11) {
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath();
            ctx.arc(tx, py + ph / 2, 3.6, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (prop.kind === 'RUBBER_RUNNER') {
          ctx.fillStyle = 'rgba(15, 23, 42, 0.58)';
          traceRoundedRect(ctx, px + 4, py + 8, pw - 8, ph - 16, 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.35)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
          for (let rx = px + 10; rx < px + pw - 8; rx += 8) {
            ctx.beginPath();
            ctx.moveTo(rx, py + 11);
            ctx.lineTo(rx, py + ph - 11);
            ctx.stroke();
          }
        } else if (prop.kind === 'FLOOR_GRATE') {
          ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
          ctx.fillRect(px + 5, py + 5, pw - 10, ph - 10);
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.45)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(px + 5, py + 5, pw - 10, ph - 10);
          for (let gx = px + 10; gx < px + pw - 6; gx += 6) {
            ctx.beginPath();
            ctx.moveTo(gx, py + 6);
            ctx.lineTo(gx, py + ph - 6);
            ctx.stroke();
          }
        } else if (prop.kind === 'CABLE_COIL') {
          const cx = px + pw / 2;
          const cy = py + ph / 2;
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.7)';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(cx, cy, 11, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = prop.color ?? '#b45309';
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.arc(cx, cy, 11, 0, Math.PI * 1.85);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx + 1, cy - 1, 7.2, 0.4, Math.PI * 2.1);
          ctx.stroke();
        } else if (prop.kind === 'CAUTION_MAT') {
          ctx.fillStyle = 'rgba(24, 24, 27, 0.72)';
          ctx.fillRect(px + 4, py + 8, pw - 8, ph - 16);
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + 4, py + 8, pw - 8, ph - 16);
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.36)';
          ctx.lineWidth = 2;
          for (let sx = px + 8; sx < px + pw - 10; sx += 9) {
            ctx.beginPath();
            ctx.moveTo(sx, py + ph - 10);
            ctx.lineTo(sx + 5, py + 10);
            ctx.stroke();
          }
        } else if (prop.kind === 'OIL_DRIP_TRAY') {
          ctx.fillStyle = 'rgba(30, 41, 59, 0.65)';
          ctx.fillRect(px + 7, py + 9, pw - 14, ph - 18);
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.55)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(px + 7, py + 9, pw - 14, ph - 18);
          ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
          ctx.beginPath();
          ctx.ellipse(px + pw / 2, py + ph / 2, pw * 0.25, ph * 0.2, 0.2, 0, Math.PI * 2);
          ctx.fill();
        } else if (prop.kind === 'RUG_MAT') {
          ctx.fillStyle = prop.color ?? 'rgba(127, 29, 29, 0.48)';
          traceRoundedRect(ctx, px + 5, py + 7, pw - 10, ph - 14, 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(217, 119, 6, 0.35)';
          ctx.lineWidth = 1.2;
          traceRoundedRect(ctx, px + 8, py + 10, pw - 16, ph - 20, 1);
          ctx.stroke();
        }
        ctx.restore();
      };

      for (const p of walkableClutter) drawStaticProp(p);

      // 6. Recessed DOWN stairwell shaft cutouts (alpha = 0 so 3D steps descend cleanly below z = 0)
      for (const st of map.stairwells) {
        if (st.deck !== deck || st.direction !== 'DOWN') continue;
        if (st.x + 28 < xPx || st.x - 28 > xPx + wPx) continue;
        ctx.clearRect(st.x - 19.5, st.y - 19.5, 39, 39);
      }

      // 7. Recessed Deck 1 Submarine Moonpool cutout so 3D tank walls & water sit below z = 0
      if (deck === 'DECK_1') {
        const subPool = map.props.find((p) => p.kind === 'SUBMARINE_HULL');
        const poolX = (subPool?.tx ?? 102) * ts;
        const poolY = (subPool?.ty ?? 92) * ts;
        const poolW = (subPool?.tw ?? 4) * ts;
        const poolH = (subPool?.th ?? 6) * ts;
        if (poolX + poolW >= xPx && poolX <= xPx + wPx) {
          ctx.clearRect(poolX + 2, poolY + 2, poolW - 4, poolH - 4);
        }
      }

      ctx.restore();

      chunks.push({
        deck,
        xPx,
        yPx,
        wPx,
        hPx,
        texture: toTexture(canvas, anisotropy),
      });
    }
  }

  // Extract sea-foam wake edges around outer hull plates
  const wakeEdges: HullWakeEdge[] = [];
  for (const seg of map.deck3Railings) {
    const segLen = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
    const subCount = Math.max(1, Math.round(segLen / ts));
    const offset = 8.5;
    for (let i = 0; i < subCount; i++) {
      const t0 = i / subCount;
      const t1 = (i + 1) / subCount;
      const sx1 = seg.x1 + (seg.x2 - seg.x1) * t0 + seg.nx * offset;
      const sy1 = seg.y1 + (seg.y2 - seg.y1) * t0 + seg.ny * offset;
      const sx2 = seg.x1 + (seg.x2 - seg.x1) * t1 + seg.nx * offset;
      const sy2 = seg.y1 + (seg.y2 - seg.y1) * t1 + seg.ny * offset;
      wakeEdges.push({
        deck: 'DECK_3',
        x1: sx1,
        y1: sy1,
        x2: sx2,
        y2: sy2,
        nx: seg.nx,
        ny: seg.ny,
        midYOffset: seg.ny * 3,
        phase: sx1 * 0.01 + sy1 * 0.008,
      });
    }
  }
  for (const deck of SHIP_DECK_ORDER) {
    if (deck === 'DECK_3') continue;
    const bounds = map.deckBounds[deck];
    for (let ty = bounds.y1; ty <= bounds.y2; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        if (map.tiles[ty][tx] === 'VOID') continue;
        const x = tx * ts;
        const y = ty * ts;
        const phase = tx * 0.45 + ty * 0.35;
        if (map.tiles[ty - 1]?.[tx] === 'VOID') {
          wakeEdges.push({
            deck,
            x1: x + 2,
            y1: y - 6,
            x2: x + ts - 2,
            y2: y - 6,
            nx: 0,
            ny: -1,
            midYOffset: -3,
            phase,
          });
        }
        if (map.tiles[ty + 1]?.[tx] === 'VOID') {
          wakeEdges.push({
            deck,
            x1: x + 2,
            y1: y + ts + 6,
            x2: x + ts - 2,
            y2: y + ts + 6,
            nx: 0,
            ny: 1,
            midYOffset: 3,
            phase: -phase,
          });
        }
      }
    }
  }

  return {
    chunks,
    wakeEdges,
    dispose: () => {
      for (const ch of chunks) ch.texture.dispose();
    },
  };
}

export interface SpriteEntry {
  texture: THREE.CanvasTexture;
  w: number;
  h: number;
}

export interface DynamicSpriteLibrary {
  containers: Record<`${ContainerType}:${0 | 1}`, SpriteEntry>;
  hidingSpots: Record<`${HidingSpotType}:normal` | `${HidingSpotType}:occupied` | `${HidingSpotType}:flash`, SpriteEntry>;
  paperMapBase: SpriteEntry;
  fuseSocketEmpty: SpriteEntry;
  fuseSocketLoaded: SpriteEntry;
  lightSwitchBase: Record<'off' | 'on' | 'powered', SpriteEntry>;
  doorThreshold: SpriteEntry;
  doorBrokenH: SpriteEntry;
  doorBrokenV: SpriteEntry;
  doorClosed: Record<'normal' | 'locked' | 'watertight', SpriteEntry>;
  doorLeaf: Record<'normal' | 'locked' | 'watertight', SpriteEntry>;
  doorPadlockDebris: SpriteEntry;
  glowstick: SpriteEntry;
  softDisc: SpriteEntry;
  softRing: SpriteEntry;
  stairwell: Record<'UP' | 'DOWN' | 'COMING', SpriteEntry>;
  pickups: Record<ItemId, SpriteEntry>;
  steamNozzle: Record<'idle' | 'warn' | 'active', SpriteEntry>;
  steamJet: SpriteEntry;
  floodgateLeverBase: Record<'idle' | 'ready' | 'active', SpriteEntry>;
  heliPad: Record<'idle' | 'parts3' | 'ready', SpriteEntry>;
  heliFuselage: SpriteEntry;
  heliFuelPort: Record<'empty' | 'filled', SpriteEntry>;
  heliFuseBay: Record<'empty' | 'filled', SpriteEntry>;
  heliCockpit: Record<'empty' | 'filled', SpriteEntry>;
  heliRotorBlades: SpriteEntry;
  heliRotorDisc: SpriteEntry;
  heliBollard: Record<'intact' | 'cut', SpriteEntry>;
  lifeboatDeckPlate: Record<'idle' | 'parts3' | 'ready', SpriteEntry>;
  lifeboatPedestal: SpriteEntry;
  lifeboatWinch: SpriteEntry;
  lifeboatBattery: Record<'empty' | 'filled', SpriteEntry>;
  lifeboatHull: Record<'cracked' | 'patched' | 'ready', SpriteEntry>;
  subMoonpool: Record<'idle' | 'parts3' | 'ready', SpriteEntry>;
  subApron: Record<'idle' | 'ready', SpriteEntry>;
  subHull: Record<'idle' | 'ready', SpriteEntry>;
  subBattery: Record<'empty' | 'filled', SpriteEntry>;
  subBallast: Record<'empty' | 'filled', SpriteEntry>;
  subDiveKey: Record<'empty' | 'filled', SpriteEntry>;
  playerShadow: SpriteEntry;
  playerBoot: SpriteEntry;
  playerSatchel: Record<'empty' | 'loaded', SpriteEntry>;
  playerBackpack: SpriteEntry;
  playerLeftArm: SpriteEntry;
  playerRightArm: Record<'off' | 'on', SpriteEntry>;
  playerTorso: SpriteEntry;
  playerHead: SpriteEntry;
  bruteShadow: SpriteEntry;
  bruteClawArm: Record<'normal' | 'chase', SpriteEntry>;
  bruteTorso: Record<'roam' | 'stalk' | 'chase' | 'stunned', SpriteEntry>;
  bruteHead: Record<'roam' | 'chase' | 'stunned', SpriteEntry>;
  dispose: () => void;
}

export function createDynamicSpriteLibrary(
  tileSize: number,
  anisotropy: number
): DynamicSpriteLibrary {
  const allTextures: THREE.CanvasTexture[] = [];
  const reg = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, scale = 2): SpriteEntry => {
    const [canvas, ctx] = makeSpriteCanvas(w, h, scale);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    draw(ctx);
    ctx.restore();
    const texture = toTexture(canvas, anisotropy);
    allTextures.push(texture);
    return { texture, w, h };
  };

  // Containers
  const containers = {} as DynamicSpriteLibrary['containers'];
  for (const type of ['CABINET', 'TOOLBOX', 'DRAWER', 'DESK'] as ContainerType[]) {
    for (const searched of [0, 1] as const) {
      const s = searched === 1;
      containers[`${type}:${searched}`] = reg(34, 34, (ctx) => {
        if (type === 'CABINET') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
          traceRoundedRect(ctx, -11, -8, 26, 20, 3);
          ctx.fill();
          ctx.fillStyle = s ? '#1e2530' : '#334155';
          traceRoundedRect(ctx, -13, -10, 26, 20, 3);
          ctx.fill();
          ctx.strokeStyle = s ? '#334155' : '#64748b';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (type === 'TOOLBOX') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
          traceRoundedRect(ctx, -9, -6, 22, 16, 2.5);
          ctx.fill();
          ctx.fillStyle = s ? '#3b1c1c' : '#991b1b';
          traceRoundedRect(ctx, -11, -8, 22, 16, 2.5);
          ctx.fill();
          ctx.strokeStyle = s ? '#475569' : '#fca5a5';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        } else if (type === 'DRAWER') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.44)';
          traceRoundedRect(ctx, -11, -11, 26, 26, 3);
          ctx.fill();
          ctx.fillStyle = s ? '#262018' : '#57422a';
          traceRoundedRect(ctx, -13, -13, 26, 26, 3);
          ctx.fill();
          ctx.strokeStyle = s ? '#3f362a' : '#a17c50';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(-11, -11);
          ctx.lineTo(11, 11);
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
          traceRoundedRect(ctx, -12, -7, 28, 18, 2.5);
          ctx.fill();
          ctx.fillStyle = s ? '#1e242c' : '#3b4656';
          traceRoundedRect(ctx, -14, -9, 28, 18, 2.5);
          ctx.fill();
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        if (!s) {
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(-3, -2, 6, 4);
        }
      });
    }
  }

  // Hiding Spots
  const hidingSpots = {} as DynamicSpriteLibrary['hidingSpots'];
  for (const type of ['LOCKER', 'UNDER_DESK', 'CARGO_CRATE'] as HidingSpotType[]) {
    for (const mode of ['normal', 'occupied', 'flash'] as const) {
      const flash = mode === 'flash';
      const isOccupied = mode === 'occupied';
      hidingSpots[`${type}:${mode}`] = reg(38, 38, (ctx) => {
        if (type === 'LOCKER') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
          traceRoundedRect(ctx, -12, -12, 28, 28, 3);
          ctx.fill();
          ctx.fillStyle = flash ? '#7c2d12' : isOccupied ? '#1e3a5f' : '#283242';
          traceRoundedRect(ctx, -14, -14, 28, 28, 3);
          ctx.fill();
          ctx.strokeStyle = flash ? '#f97316' : isOccupied ? '#38bdf8' : '#526075';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.6;
          for (let ly = -7; ly <= 7; ly += 5) {
            ctx.beginPath();
            ctx.moveTo(-8, ly);
            ctx.lineTo(8, ly);
            ctx.stroke();
          }
        } else if (type === 'UNDER_DESK') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
          traceRoundedRect(ctx, -13, -9, 30, 22, 3);
          ctx.fill();
          ctx.fillStyle = flash ? '#7c2d12' : isOccupied ? '#1e3a5f' : '#333d4d';
          traceRoundedRect(ctx, -15, -11, 30, 22, 3);
          ctx.fill();
          ctx.strokeStyle = flash ? '#f97316' : isOccupied ? '#38bdf8' : '#64748b';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.46)';
          traceRoundedRect(ctx, -12, -12, 28, 28, 3);
          ctx.fill();
          ctx.fillStyle = flash ? '#7c2d12' : isOccupied ? '#1e3a5f' : '#4a3a28';
          traceRoundedRect(ctx, -14, -14, 28, 28, 3);
          ctx.fill();
          ctx.strokeStyle = flash ? '#f97316' : isOccupied ? '#38bdf8' : '#8a6b48';
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
      });
    }
  }

  // Paper Map Stand
  const paperMapBase = reg(34, 30, (ctx) => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
    traceRoundedRect(ctx, -13, -9, 28, 22, 3);
    ctx.fill();
    ctx.fillStyle = '#334155';
    traceRoundedRect(ctx, -15, -11, 28, 22, 3);
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = '#e7dcc2';
    traceRoundedRect(ctx, -11, -8, 20, 16, 1.5);
    ctx.fill();
    ctx.strokeStyle = '#1e3a5f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-8, -3);
    ctx.lineTo(6, -3);
    ctx.moveTo(-8, 2);
    ctx.lineTo(4, 2);
    ctx.stroke();
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(-12, -10, 6, 3);
  });

  // Fuse Socket
  const makeFuseSocket = (hasFuse: boolean) =>
    reg(34, 34, (ctx) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      traceRoundedRect(ctx, -12, -12, 26, 26, 3);
      ctx.fill();
      ctx.fillStyle = hasFuse ? '#172822' : '#1e293b';
      traceRoundedRect(ctx, -14, -14, 28, 28, 3);
      ctx.fill();
      ctx.strokeStyle = hasFuse ? '#34d399' : '#f59e0b';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = '#090d14';
      traceRoundedRect(ctx, -9, -7, 18, 14, 2);
      ctx.fill();
      ctx.fillStyle = '#d97706';
      ctx.fillRect(-10, -4, 3, 8);
      ctx.fillRect(7, -4, 3, 8);
      if (hasFuse) {
        ctx.fillStyle = '#f59e0b';
        traceRoundedRect(ctx, -6, -3.5, 12, 7, 1.5);
        ctx.fill();
      }
    });
  const fuseSocketEmpty = makeFuseSocket(false);
  const fuseSocketLoaded = makeFuseSocket(true);

  // Light Switch
  const makeSwitch = (mode: 'off' | 'on' | 'powered') =>
    reg(18, 18, (ctx) => {
      ctx.fillStyle = '#1e293b';
      traceRoundedRect(ctx, -7, -7, 14, 14, 2.5);
      ctx.fill();
      ctx.strokeStyle =
        mode === 'powered' ? '#fbbf24' : mode === 'on' ? '#34d399' : '#64748b';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle =
        mode === 'powered' ? '#fbbf24' : mode === 'on' ? '#34d399' : '#f59e0b';
      ctx.fillRect(-2.5, mode === 'off' ? 1 : -4, 5, 3);
    });
  const lightSwitchBase = {
    off: makeSwitch('off'),
    on: makeSwitch('on'),
    powered: makeSwitch('powered'),
  };

  // Doors
  const doorThreshold = reg(tileSize + 4, 16, (ctx) => {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.fillRect(-tileSize / 2, -6, tileSize, 12);
  });
  const doorBrokenH = reg(tileSize + 4, 12, (ctx) => {
    ctx.fillStyle = '#475569';
    ctx.fillRect(-tileSize / 2, -3, 8, 6);
    ctx.fillRect(tileSize / 2 - 8, -3, 8, 6);
  });
  const doorBrokenV = reg(12, tileSize + 4, (ctx) => {
    ctx.fillStyle = '#475569';
    ctx.fillRect(-3, -tileSize / 2, 6, 8);
    ctx.fillRect(-3, tileSize / 2 - 8, 6, 8);
  });

  const makeClosedDoor = (kind: 'normal' | 'locked' | 'watertight') =>
    reg(tileSize + 8, 22, (ctx) => {
      const wt = kind === 'watertight';
      const locked = kind === 'locked';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      traceRoundedRect(ctx, -tileSize / 2 + 3, -3, tileSize - 4, wt ? 11 : 9, 2);
      ctx.fill();
      ctx.fillStyle = locked ? '#7f1d1d' : wt ? '#1e3a4c' : '#475569';
      traceRoundedRect(ctx, -tileSize / 2 + 2, wt ? -5.5 : -4.5, tileSize - 4, wt ? 11 : 9, 2);
      ctx.fill();
      ctx.strokeStyle = locked ? '#ef4444' : wt ? '#22d3ee' : '#94a3b8';
      ctx.lineWidth = wt ? 1.9 : 1.5;
      ctx.stroke();
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-8, -2, 16, 4);
      if (wt) {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(-tileSize / 2 + 4, -4, 3, 8);
        ctx.fillRect(tileSize / 2 - 7, -4, 3, 8);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 4.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-4, 0);
        ctx.lineTo(4, 0);
        ctx.moveTo(0, -4);
        ctx.lineTo(0, 4);
        ctx.stroke();
      }
      if (locked) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

  // Door leaf drawn with hinge at local origin (0, 0) -> canvas size 2 * tileSize so it rotates cleanly around center!
  const makeDoorLeaf = (kind: 'normal' | 'locked' | 'watertight') =>
    reg(tileSize * 2, 24, (ctx) => {
      const wt = kind === 'watertight';
      const locked = kind === 'locked';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      traceRoundedRect(ctx, 1, -2, tileSize - 8, wt ? 9 : 7, 2);
      ctx.fill();
      ctx.fillStyle = locked ? '#7f1d1d' : wt ? '#1e3a4c' : '#526075';
      traceRoundedRect(ctx, 0, wt ? -4.5 : -3.5, tileSize - 8, wt ? 9 : 7, 2);
      ctx.fill();
      ctx.strokeStyle = wt ? '#22d3ee' : '#94a3b8';
      ctx.lineWidth = wt ? 1.5 : 1.1;
      ctx.stroke();
      if (wt) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc((tileSize - 8) * 0.5, 0, 3.8, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

  const doorClosed = {
    normal: makeClosedDoor('normal'),
    locked: makeClosedDoor('locked'),
    watertight: makeClosedDoor('watertight'),
  };
  const doorLeaf = {
    normal: makeDoorLeaf('normal'),
    locked: makeDoorLeaf('locked'),
    watertight: makeDoorLeaf('watertight'),
  };

  const doorPadlockDebris = reg(tileSize + 6, 26, (ctx) => {
    ctx.fillStyle = '#991b1b';
    ctx.fillRect(tileSize / 2 - 9, 7, 5, 4);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(tileSize / 2 - 4, 8, 3, 3);
  });

  // Glowstick & Generic Soft Disc / Ring
  const glowstick = reg(16, 16, (ctx) => {
    ctx.rotate(0.5);
    ctx.fillStyle = '#34d399';
    ctx.fillRect(-6, -2, 12, 4);
  });
  const softDisc = reg(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();
  });
  const softRing = reg(64, 64, (ctx) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Stairwells
  const makeStairwell = (mode: 'UP' | 'DOWN' | 'COMING') =>
    reg(66, 66, (ctx) => {
      const half = 27;
      const size = half * 2;
      const isBruteComing = mode === 'COMING';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.56)';
      traceRoundedRect(ctx, -half + 2, -half + 3, size, size, 5);
      ctx.fill();
      ctx.fillStyle = isBruteComing ? '#291811' : '#1b2432';
      traceRoundedRect(ctx, -half, -half, size, size, 5);
      ctx.fill();
      ctx.strokeStyle = isBruteComing ? '#ff7314' : mode === 'DOWN' ? '#38bdf8' : '#fbbf24';
      ctx.lineWidth = isBruteComing ? 2.6 : 1.9;
      traceRoundedRect(ctx, -half + 0.5, -half + 0.5, size - 1, size - 1, 5);
      ctx.stroke();

      const innerHalf = 20;
      ctx.fillStyle = '#070a0f';
      traceRoundedRect(ctx, -innerHalf, -innerHalf, innerHalf * 2, innerHalf * 2, 3);
      ctx.fill();

      for (let i = 0; i < 6; i++) {
        const sy = -16 + i * 6;
        const depthFade = mode === 'DOWN' ? 1 - i * 0.11 : 0.45 + i * 0.11;
        ctx.fillStyle = isBruteComing
          ? `rgba(255, 140, 56, ${0.45 + depthFade * 0.35})`
          : `rgba(71, 85, 105, ${depthFade})`;
        ctx.fillRect(-16, sy, 32, 3.6);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(-16, sy + 3.6, 32, 1);
      }
      ctx.fillStyle = isBruteComing ? '#ffedd5' : '#f59e0b';
      ctx.fillRect(-16, mode === 'DOWN' ? -18 : 15.5, 32, 2.5);
      ctx.strokeStyle = isBruteComing ? '#fdba74' : '#94a3b8';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-21.5, -19);
      ctx.lineTo(-21.5, 19);
      ctx.moveTo(21.5, -19);
      ctx.lineTo(21.5, 19);
      ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      for (const [rx, ry] of [
        [-23, -23],
        [23, -23],
        [-23, 23],
        [23, 23],
      ]) {
        ctx.beginPath();
        ctx.arc(rx, ry, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = isBruteComing ? '#fff7ed' : mode === 'DOWN' ? '#38bdf8' : '#fbbf24';
      ctx.beginPath();
      if (mode === 'UP') {
        ctx.moveTo(0, -10);
        ctx.lineTo(7, -1);
        ctx.lineTo(-7, -1);
      } else {
        ctx.moveTo(0, 10);
        ctx.lineTo(7, 1);
        ctx.lineTo(-7, 1);
      }
      ctx.closePath();
      ctx.fill();
    });
  const stairwell = {
    UP: makeStairwell('UP'),
    DOWN: makeStairwell('DOWN'),
    COMING: makeStairwell('COMING'),
  };

  // World Pickups (16 ItemIds)
  const itemIds: ItemId[] = [
    'WINCH_CRANK',
    'MARINE_BATTERY',
    'HULL_PATCH',
    'AVIATION_FUEL',
    'IGNITION_KEY',
    'ROTOR_FUSE',
    'SUB_BATTERY',
    'BALLAST_PUMP',
    'DIVE_KEY',
    'BATTERY_PACK',
    'GLOWSTICK',
    'FLARE',
    'FIRE_EXTINGUISHER',
    'BOLT_CUTTERS',
    'MASTER_FUSE',
    'BACKPACK',
  ];
  const pickups = {} as Record<ItemId, SpriteEntry>;
  for (const item of itemIds) {
    pickups[item] = reg(28, 28, (ctx) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(1, 2, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      if (item === 'MASTER_FUSE') {
        ctx.fillStyle = '#1e293b';
        traceRoundedRect(ctx, -8, -4.5, 16, 9, 2);
        ctx.fill();
        ctx.fillStyle = '#d97706';
        ctx.fillRect(-8, -4, 3.5, 8);
        ctx.fillRect(4.5, -4, 3.5, 8);
        ctx.fillStyle = '#fde047';
        ctx.fillRect(-3.5, -2.5, 7, 5);
      } else if (item === 'BACKPACK') {
        ctx.fillStyle = '#c2410c';
        traceRoundedRect(ctx, -8, -9, 16, 18, 4);
        ctx.fill();
        ctx.strokeStyle = '#fed7aa';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.fillStyle = '#1e293b';
        traceRoundedRect(ctx, -5, -4, 10, 9, 2);
        ctx.fill();
        ctx.fillStyle = '#fb923c';
        ctx.fillRect(-6, -9, 12, 2.4);
      } else if (item === 'AVIATION_FUEL') {
        ctx.fillStyle = '#dc2626';
        traceRoundedRect(ctx, -6, -7, 12, 14, 2);
        ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(1, -9, 4, 3);
      } else if (item === 'IGNITION_KEY' || item === 'DIVE_KEY') {
        ctx.strokeStyle = item === 'DIVE_KEY' ? '#2dd4bf' : '#fbbf24';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-3, 0, 3.5, 0, Math.PI * 2);
        ctx.moveTo(0.5, 0);
        ctx.lineTo(7, 0);
        ctx.lineTo(7, 3);
        ctx.stroke();
      } else if (item === 'ROTOR_FUSE') {
        ctx.fillStyle = '#1e293b';
        traceRoundedRect(ctx, -7, -4, 14, 8, 2);
        ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(-7, -3, 3, 6);
        ctx.fillRect(4, -3, 3, 6);
        ctx.fillStyle = '#34d399';
        ctx.fillRect(-2, -1.5, 4, 3);
      } else if (item === 'HULL_PATCH') {
        ctx.fillStyle = '#475569';
        traceRoundedRect(ctx, -7, -6, 14, 12, 1.5);
        ctx.fill();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (item === 'WINCH_CRANK') {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
        ctx.moveTo(0, 0);
        ctx.lineTo(7, -4);
        ctx.stroke();
      } else if (item === 'MARINE_BATTERY' || item === 'SUB_BATTERY') {
        ctx.fillStyle = item === 'SUB_BATTERY' ? '#0f766e' : '#0369a1';
        traceRoundedRect(ctx, -6, -6, 12, 12, 1.5);
        ctx.fill();
        ctx.fillStyle = item === 'SUB_BATTERY' ? '#5eead4' : '#38bdf8';
        ctx.fillRect(-4, -8, 3, 2);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(1, -8, 3, 2);
      } else if (item === 'BALLAST_PUMP') {
        ctx.fillStyle = '#1e293b';
        traceRoundedRect(ctx, -7, -5, 14, 10, 2);
        ctx.fill();
        ctx.strokeStyle = '#2dd4bf';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#2dd4bf';
        ctx.beginPath();
        ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle =
          item === 'FLARE'
            ? '#fb7185'
            : item === 'GLOWSTICK'
              ? '#34d399'
              : item === 'FIRE_EXTINGUISHER'
                ? '#ef4444'
                : item === 'BOLT_CUTTERS'
                  ? '#cbd5e1'
                  : '#a3e635';
        traceRoundedRect(ctx, -6, -3, 12, 6, 2);
        ctx.fill();
      }
    });
  }

  // Steam Pipe Nozzle (+X forward) & Steam Jet
  const makeNozzle = (mode: 'idle' | 'warn' | 'active') =>
    reg(32, 26, (ctx) => {
      ctx.strokeStyle = '#090d14';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(11, 0);
      ctx.stroke();
      ctx.strokeStyle = mode === 'active' ? '#e2e8f0' : mode === 'warn' ? '#f59e0b' : '#9a3412';
      ctx.lineWidth = 5.2;
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(0, 8);
      ctx.stroke();
      ctx.fillStyle = mode === 'active' ? '#ef4444' : mode === 'warn' ? '#fde047' : '#475569';
      ctx.beginPath();
      ctx.arc(-4, 6, 2.8, 0, Math.PI * 2);
      ctx.fill();
    });
  const steamNozzle = {
    idle: makeNozzle('idle'),
    warn: makeNozzle('warn'),
    active: makeNozzle('active'),
  };
  const steamJet = reg(128, 42, (ctx) => {
    const g = ctx.createLinearGradient(-64, 0, 64, 0);
    g.addColorStop(0, 'rgba(248, 250, 252, 0.72)');
    g.addColorStop(0.5, 'rgba(226, 232, 240, 0.45)');
    g.addColorStop(1, 'rgba(203, 213, 225, 0.08)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-64, 5);
    ctx.lineTo(64, 17);
    ctx.lineTo(64, -17);
    ctx.lineTo(-64, -5);
    ctx.closePath();
    ctx.fill();
  });

  // Floodgate Lever (Deck 1 Submarine)
  const makeLever = (mode: 'idle' | 'ready' | 'active') =>
    reg(tileSize, tileSize, (ctx) => {
      const w = tileSize;
      const h = tileSize;
      ctx.translate(-w / 2, -h / 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
      traceRoundedRect(ctx, 7, 7, w - 10, h - 10, 3);
      ctx.fill();
      ctx.fillStyle = '#1e293b';
      traceRoundedRect(ctx, 5, 5, w - 10, h - 10, 3);
      ctx.fill();
      ctx.strokeStyle = mode === 'active' ? '#34d399' : mode === 'ready' ? '#2dd4bf' : '#64748b';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = '#090d14';
      ctx.fillRect(w * 0.5 - 3, 11, 6, h - 22);
      const leverY = mode === 'active' ? h - 16 : 14;
      ctx.fillStyle = mode === 'active' ? '#34d399' : mode === 'ready' ? '#f59e0b' : '#ef4444';
      ctx.fillRect(w * 0.5 - 7, leverY - 3, 14, 6);
    });
  const floodgateLeverBase = {
    idle: makeLever('idle'),
    ready: makeLever('ready'),
    active: makeLever('active'),
  };

  // --- ESCAPE ZONES ---
  const makeHeliPad = (mode: 'idle' | 'parts3' | 'ready') =>
    reg(144, 144, (ctx) => {
      const padR = 64;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, padR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle =
        mode === 'ready' ? '#34d399' : mode === 'parts3' ? '#fbbf24' : 'rgba(251, 191, 36, 0.5)';
      ctx.lineWidth = 3.2;
      ctx.setLineDash([12, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, padR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.2)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, 44, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = '700 34px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = mode === 'ready' ? 'rgba(52, 211, 153, 0.4)' : 'rgba(251, 191, 36, 0.28)';
      ctx.fillText('H', 8, 0);
      for (const [sx, sy] of [
        [-52, -48],
        [52, -48],
        [-52, 48],
        [52, 48],
      ]) {
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  const heliPad = {
    idle: makeHeliPad('idle'),
    parts3: makeHeliPad('parts3'),
    ready: makeHeliPad('ready'),
  };

  const heliFuselage = reg(116, 46, (ctx) => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.56)';
    ctx.beginPath();
    ctx.ellipse(2, 5, 36, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-46, 0, 32, 8);

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-22, -16);
    ctx.lineTo(24, -16);
    ctx.lineTo(29, -13);
    ctx.moveTo(-22, 16);
    ctx.lineTo(24, 16);
    ctx.lineTo(29, 13);
    ctx.moveTo(-10, -16);
    ctx.lineTo(-8, -11);
    ctx.moveTo(12, -16);
    ctx.lineTo(10, -11);
    ctx.moveTo(-10, 16);
    ctx.lineTo(-8, 11);
    ctx.moveTo(12, 16);
    ctx.lineTo(10, 11);
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(-14, -6);
    ctx.lineTo(-48, -2.5);
    ctx.lineTo(-48, 2.5);
    ctx.lineTo(-14, 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = '#d97706';
    ctx.fillRect(-49, -7, 4, 14);

    const bodyGrad = ctx.createLinearGradient(0, -15, 0, 15);
    bodyGrad.addColorStop(0, '#334155');
    bodyGrad.addColorStop(0.5, '#475569');
    bodyGrad.addColorStop(1, '#1e293b');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(-18, -11);
    ctx.quadraticCurveTo(4, -16, 26, -9);
    ctx.quadraticCurveTo(35, 0, 26, 9);
    ctx.quadraticCurveTo(4, 16, -18, 11);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, -10.5);
    ctx.lineTo(12, -11);
    ctx.moveTo(-14, 10.5);
    ctx.lineTo(12, 11);
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    traceRoundedRect(ctx, -10, -6.5, 18, 13, 3);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(-11, -3.5, 2.6, 0, Math.PI * 2);
    ctx.arc(-11, 3.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
  });

  const heliFuelPort = {
    empty: reg(36, 26, (ctx) => {
      ctx.fillStyle = '#090d14';
      ctx.beginPath();
      ctx.arc(4, 2, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(4, 2);
      ctx.quadraticCurveTo(-2, -4, -7, -2);
      ctx.stroke();
    }),
    filled: reg(36, 26, (ctx) => {
      ctx.fillStyle = '#b91c1c';
      traceRoundedRect(ctx, -8, -5, 14, 7, 2);
      ctx.fill();
      ctx.strokeStyle = '#fca5a5';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.quadraticCurveTo(2, 6, 6, 5);
      ctx.stroke();
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.arc(-1, -1.5, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }),
  };

  const heliFuseBay = {
    empty: reg(22, 14, (ctx) => {
      ctx.fillStyle = '#090d14';
      ctx.fillRect(-5.5, -2.75, 11, 5.5);
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 1;
      ctx.strokeRect(-5.5, -2.75, 11, 5.5);
    }),
    filled: reg(22, 14, (ctx) => {
      ctx.fillStyle = '#1e293b';
      traceRoundedRect(ctx, -6.5, -3.25, 13, 6.5, 1.5);
      ctx.fill();
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }),
  };

  const heliCockpit = {
    empty: reg(26, 24, (ctx) => {
      ctx.fillStyle = '#090d14';
      ctx.beginPath();
      ctx.moveTo(-8, -9);
      ctx.quadraticCurveTo(8, -6, 8, 0);
      ctx.quadraticCurveTo(8, 6, -8, 9);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }),
    filled: reg(26, 24, (ctx) => {
      ctx.fillStyle = '#082f49';
      ctx.beginPath();
      ctx.moveTo(-8, -9);
      ctx.quadraticCurveTo(8, -6, 8, 0);
      ctx.quadraticCurveTo(8, 6, -8, 9);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.fillRect(-3, -5.5, 4, 11);
      ctx.fillStyle = '#34d399';
      ctx.fillRect(-1, -3, 2, 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-1, 1, 2, 2);
    }),
  };

  const heliRotorBlades = reg(96, 96, (ctx) => {
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(-44, 0);
    ctx.lineTo(44, 0);
    ctx.moveTo(0, -44);
    ctx.lineTo(0, 44);
    ctx.stroke();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(-44, 0);
    ctx.lineTo(-37, 0);
    ctx.moveTo(37, 0);
    ctx.lineTo(44, 0);
    ctx.moveTo(0, -44);
    ctx.lineTo(0, -37);
    ctx.moveTo(0, 37);
    ctx.lineTo(0, 44);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();
  });

  const heliRotorDisc = reg(96, 96, (ctx) => {
    ctx.fillStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.beginPath();
    ctx.arc(0, 0, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, 44, 0, Math.PI * 2);
    ctx.stroke();
  });

  const heliBollard = {
    intact: reg(14, 14, (ctx) => {
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }),
    cut: reg(14, 14, (ctx) => {
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }),
  };

  // Lifeboat sprites
  const makeLifeboatPlate = (mode: 'idle' | 'parts3' | 'ready') =>
    reg(tileSize + 36, tileSize + 8, (ctx) => {
      const w = tileSize + 28;
      const h = tileSize;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
      traceRoundedRect(ctx, -w / 2, -h / 2, w, h, 4);
      ctx.fill();
      ctx.strokeStyle =
        mode === 'ready' ? '#34d399' : mode === 'parts3' ? '#38bdf8' : 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      traceRoundedRect(ctx, -w / 2, -h / 2, w, h, 4);
      ctx.stroke();
    });
  const lifeboatDeckPlate = {
    idle: makeLifeboatPlate('idle'),
    parts3: makeLifeboatPlate('parts3'),
    ready: makeLifeboatPlate('ready'),
  };
  const lifeboatPedestal = reg(18, 18, (ctx) => {
    ctx.fillStyle = '#334155';
    traceRoundedRect(ctx, -6, -6, 12, 12, 2);
    ctx.fill();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  });
  const lifeboatWinch = reg(24, 16, (ctx) => {
    ctx.fillStyle = '#1e293b';
    traceRoundedRect(ctx, -10, -6, 20, 12, 2);
    ctx.fill();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });
  const lifeboatBattery = {
    empty: reg(14, 14, (ctx) => {
      ctx.fillStyle = '#0f172a';
      traceRoundedRect(ctx, -5, -5, 10, 10, 1.5);
      ctx.fill();
      ctx.strokeStyle = '#ca8a04';
      ctx.lineWidth = 1;
      ctx.strokeRect(-4.5, -4.5, 9, 9);
    }),
    filled: reg(14, 14, (ctx) => {
      ctx.fillStyle = '#0f172a';
      traceRoundedRect(ctx, -5, -5, 10, 10, 1.5);
      ctx.fill();
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.fill();
    }),
  };
  const makeBoatHull = (mode: 'cracked' | 'patched' | 'ready') =>
    reg(66, 36, (ctx) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.52)';
      ctx.beginPath();
      ctx.ellipse(2, 4, 28, 12.5, 0, 0, Math.PI * 2);
      ctx.fill();
      const hullGrad = ctx.createLinearGradient(0, -12, 0, 12);
      hullGrad.addColorStop(0, '#fb923c');
      hullGrad.addColorStop(0.5, '#ea580c');
      hullGrad.addColorStop(1, '#9a3412');
      ctx.fillStyle = hullGrad;
      ctx.beginPath();
      ctx.moveTo(-27, 0);
      ctx.quadraticCurveTo(-18, -12, 0, -12);
      ctx.quadraticCurveTo(20, -12, 27, 0);
      ctx.quadraticCurveTo(20, 12, 0, 12);
      ctx.quadraticCurveTo(-18, 12, -27, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = mode === 'ready' ? '#34d399' : '#fed7aa';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.fillStyle = '#e2e8f0';
      traceRoundedRect(ctx, -14, -7, 26, 14, 5);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      traceRoundedRect(ctx, 4, -4.5, 6, 9, 2);
      ctx.fill();

      if (mode !== 'cracked') {
        ctx.fillStyle = '#475569';
        traceRoundedRect(ctx, -11, -5, 11, 10, 1.5);
        ctx.fill();
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#e2e8f0';
        for (const [rx, ry] of [
          [-9, -3],
          [-2, -3],
          [-9, 3],
          [-2, 3],
        ]) {
          ctx.fillRect(rx, ry, 1.4, 1.4);
        }
      } else {
        ctx.strokeStyle = '#090d14';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-10, -4);
        ctx.lineTo(-6, -1);
        ctx.lineTo(-8, 2);
        ctx.lineTo(-3, 5);
        ctx.stroke();
      }
    });
  const lifeboatHull = {
    cracked: makeBoatHull('cracked'),
    patched: makeBoatHull('patched'),
    ready: makeBoatHull('ready'),
  };

  // Submarine Moonpool sprites
  const poolW = 4 * tileSize;
  const poolH = 6 * tileSize;
  const makeMoonpool = (mode: 'idle' | 'parts3' | 'ready') =>
    reg(poolW + 24, poolH + 24, (ctx) => {
      ctx.fillStyle = '#04121d';
      traceRoundedRect(ctx, -poolW / 2 - 6, -poolH / 2 - 6, poolW + 12, poolH + 12, 6);
      ctx.fill();
      const alpha = mode === 'ready' ? 0.87 : 0.42;
      ctx.fillStyle = `rgba(13, 148, 136, ${alpha * 0.25})`;
      traceRoundedRect(ctx, -poolW / 2, -poolH / 2, poolW, poolH, 4);
      ctx.fill();
      ctx.strokeStyle =
        mode === 'ready' ? '#34d399' : mode === 'parts3' ? '#2dd4bf' : 'rgba(45, 212, 191, 0.48)';
      ctx.lineWidth = 2.6;
      ctx.setLineDash([10, 6]);
      traceRoundedRect(ctx, -poolW / 2 - 4, -poolH / 2 - 4, poolW + 8, poolH + 8, 5);
      ctx.stroke();
    });
  const subMoonpool = {
    idle: makeMoonpool('idle'),
    parts3: makeMoonpool('parts3'),
    ready: makeMoonpool('ready'),
  };

  const makeSubApron = (ready: boolean) =>
    reg(54, 60, (ctx) => {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      traceRoundedRect(ctx, -18, -26, 46, 52, 4);
      ctx.fill();
      ctx.strokeStyle = ready ? '#34d399' : '#2dd4bf';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    });
  const subApron = { idle: makeSubApron(false), ready: makeSubApron(true) };

  const makeSubHull = (ready: boolean) =>
    reg(96, 212, (ctx) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
      ctx.beginPath();
      ctx.ellipse(4, 4, 34, 98, 0, 0, Math.PI * 2);
      ctx.fill();
      const subGrad = ctx.createLinearGradient(-32, 0, 32, 0);
      subGrad.addColorStop(0, '#0f172a');
      subGrad.addColorStop(0.5, '#334155');
      subGrad.addColorStop(1, '#0f172a');
      ctx.fillStyle = subGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, 31, 94, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ready ? '#34d399' : '#64748b';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#475569';
      ctx.fillRect(-42, -56, 12, 10);
      ctx.fillRect(30, -56, 12, 10);
      ctx.fillRect(-38, 70, 10, 8);
      ctx.fillRect(28, 70, 10, 8);

      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(0, -82);
      ctx.lineTo(0, 82);
      ctx.stroke();

      ctx.fillStyle = '#1e293b';
      traceRoundedRect(ctx, -16, -24, 32, 48, 12);
      ctx.fill();
      ctx.strokeStyle = ready ? '#34d399' : '#94a3b8';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    });
  const subHull = { idle: makeSubHull(false), ready: makeSubHull(true) };

  const subBattery = {
    empty: reg(16, 38, (ctx) => {
      ctx.fillStyle = '#090d14';
      traceRoundedRect(ctx, -5, -16, 10, 32, 2);
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }),
    filled: reg(16, 38, (ctx) => {
      ctx.fillStyle = '#0d9488';
      traceRoundedRect(ctx, -5, -16, 10, 32, 2);
      ctx.fill();
      ctx.strokeStyle = '#5eead4';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#5eead4';
      ctx.fillRect(-2, -10, 4, 6);
      ctx.fillRect(-2, 4, 4, 6);
    }),
  };

  const subBallast = {
    empty: reg(16, 32, (ctx) => {
      ctx.fillStyle = '#090d14';
      traceRoundedRect(ctx, -5.5, -13, 11, 26, 2);
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }),
    filled: reg(16, 32, (ctx) => {
      ctx.fillStyle = '#0369a1';
      traceRoundedRect(ctx, -5.5, -13, 11, 26, 2);
      ctx.fill();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }),
  };

  const subDiveKey = {
    empty: reg(22, 22, (ctx) => {
      ctx.fillStyle = '#090d14';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }),
    filled: reg(22, 22, (ctx) => {
      ctx.fillStyle = '#064e3b';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }),
  };

  // --- PLAYER ARTICULATED 2D PLANES ---
  const playerShadow = reg(28, 34, (ctx) => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.ellipse(-1, 2, 10, 13.5, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  const playerBoot = reg(12, 10, (ctx) => {
    ctx.fillStyle = '#0f172a';
    traceRoundedRect(ctx, -3.6, -2.3, 7.6, 4.6, 1.8);
    ctx.fill();
    ctx.fillStyle = '#334155';
    traceRoundedRect(ctx, 1.4, -1.9, 2.5, 3.8, 1.1);
    ctx.fill();
  });
  const makeSatchel = (loaded: boolean) =>
    reg(14, 20, (ctx) => {
      ctx.fillStyle = '#1f2d27';
      traceRoundedRect(ctx, -4.4, -7.2, 7.6, 14.4, 2.5);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#2d3f37';
      traceRoundedRect(ctx, -3.5, -5.8, 4.8, 11.6, 1.6);
      ctx.fill();
      ctx.fillStyle = loaded ? '#d97706' : '#475569';
      ctx.fillRect(-1.8, -5.4, 1.6, 10.8);
    });
  const playerSatchel = { empty: makeSatchel(false), loaded: makeSatchel(true) };
  const playerBackpack = reg(20, 24, (ctx) => {
    ctx.fillStyle = '#7c2d12';
    traceRoundedRect(ctx, -6.2, -9.2, 10, 18.4, 3);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.fillStyle = '#c2410c';
    traceRoundedRect(ctx, -4.8, -7.2, 6.2, 14.4, 2);
    ctx.fill();
    ctx.fillStyle = '#fb923c';
    ctx.fillRect(-3.6, -7.5, 1.8, 15);
    ctx.fillStyle = '#334155';
    traceRoundedRect(ctx, -7.6, -5.8, 2.6, 11.6, 1.2);
    ctx.fill();
  });
  const playerLeftArm = reg(16, 10, (ctx) => {
    ctx.fillStyle = '#1e3a5f';
    traceRoundedRect(ctx, -2.6, -2.4, 8.6, 4.8, 2.2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.arc(6.2, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
  });
  const makeRightArm = (lightOn: boolean) =>
    reg(44, 18, (ctx) => {
      ctx.fillStyle = '#1e3a5f';
      traceRoundedRect(ctx, -2.0, -2.4, 9.2, 4.8, 2.2);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.arc(7.2, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#334155';
      traceRoundedRect(ctx, 5.2, -1.7, 7.6, 3.4, 1.0);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(11.6, -2.2, 2.4, 4.4);
      ctx.fillStyle = lightOn ? '#fef08a' : '#1e293b';
      ctx.fillRect(13.8, -1.7, 1.4, 3.4);
      if (lightOn) {
        const lensGlow = ctx.createRadialGradient(14.8, 0, 0.5, 14.8, 0, 6);
        lensGlow.addColorStop(0, 'rgba(254, 249, 195, 0.85)');
        lensGlow.addColorStop(1, 'rgba(253, 224, 71, 0)');
        ctx.fillStyle = lensGlow;
        ctx.beginPath();
        ctx.arc(14.8, 0, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  const playerRightArm = { off: makeRightArm(false), on: makeRightArm(true) };
  const playerTorso = reg(22, 30, (ctx) => {
    const sr = 11.8;
    const tr = 7.6;
    const jacketGrad = ctx.createLinearGradient(-7, -sr, 7, sr);
    jacketGrad.addColorStop(0, '#1e3a5f');
    jacketGrad.addColorStop(0.5, '#254a78');
    jacketGrad.addColorStop(1, '#172c49');
    ctx.fillStyle = jacketGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, tr, sr, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.85)';
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2.2, -sr + 2.3);
    ctx.lineTo(2.4, -sr + 3.4);
    ctx.moveTo(-2.2, sr - 2.3);
    ctx.lineTo(2.4, sr - 3.4);
    ctx.stroke();
    ctx.fillStyle = '#0f223d';
    ctx.beginPath();
    ctx.ellipse(0.6, 0, 5.2, 6.8, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  const playerHead = reg(20, 20, (ctx) => {
    const headR = 6.6;
    ctx.fillStyle = '#cfa987';
    ctx.beginPath();
    ctx.arc(1.4, 0, headR * 0.86, -0.7, 0.7);
    ctx.fill();
    const capGrad = ctx.createRadialGradient(-1.2, -1.2, 1, 0, 0, headR);
    capGrad.addColorStop(0, '#64748b');
    capGrad.addColorStop(0.65, '#334155');
    capGrad.addColorStop(1, '#1e293b');
    ctx.fillStyle = capGrad;
    ctx.beginPath();
    ctx.arc(0, 0, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, headR - 1.3, -1.15, 1.15);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-headR * 0.75, 0);
    ctx.lineTo(headR * 0.45, 0);
    ctx.moveTo(-1.2, -headR * 0.65);
    ctx.lineTo(-1.2, headR * 0.65);
    ctx.stroke();
  });

  // --- BRUTE ARTICULATED 2D PLANES ---
  const bruteShadow = reg(46, 58, (ctx) => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
    ctx.beginPath();
    ctx.ellipse(-2, 3, 18, 25, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  const makeBruteClawArm = (isChasing: boolean) =>
    reg(42, 20, (ctx) => {
      ctx.fillStyle = '#2d1c18';
      ctx.strokeStyle = isChasing ? '#c2410c' : '#573326';
      ctx.lineWidth = 1.6;
      traceRoundedRect(ctx, -4, -4.5, 17, 9, 3);
      ctx.fill();
      ctx.stroke();
      const gx = 13;
      ctx.fillStyle = '#3f241c';
      ctx.beginPath();
      ctx.arc(gx, 0, 6.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isChasing ? '#fb923c' : '#9a3412';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = '#cbd5e1';
      for (const cy of [-3.2, 0, 3.2]) {
        ctx.beginPath();
        ctx.moveTo(gx + 3, cy - 1.2);
        ctx.lineTo(gx + 10.5, cy * 0.85);
        ctx.lineTo(gx + 3, cy + 1.2);
        ctx.closePath();
        ctx.fill();
      }
    });
  const bruteClawArm = {
    normal: makeBruteClawArm(false),
    chase: makeBruteClawArm(true),
  };

  const makeBruteTorso = (mode: 'roam' | 'stalk' | 'chase' | 'stunned') =>
    reg(44, 52, (ctx) => {
      const isChasing = mode === 'chase';
      const isStalking = mode === 'stalk';
      const isStunned = mode === 'stunned';
      ctx.fillStyle = isChasing ? '#341610' : isStalking ? '#2a1612' : '#211513';
      ctx.beginPath();
      ctx.moveTo(-16, -12);
      ctx.quadraticCurveTo(-18, 0, -16, 12);
      ctx.lineTo(-4, 22);
      ctx.quadraticCurveTo(8, 22, 13, 13);
      ctx.lineTo(13, -13);
      ctx.quadraticCurveTo(8, -22, -4, -22);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = isChasing ? '#ea580c' : isStalking ? '#c2410c' : '#7c2d12';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#2d1c19';
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.1;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(0, side * 14.5, 9.5, 6.2, side * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      const ventAlpha = isStunned ? 0.25 : isChasing ? 0.95 : isStalking ? 0.72 : 0.45;
      ctx.fillStyle = `rgba(255, 107, 0, ${ventAlpha})`;
      for (const side of [-1, 1]) {
        for (let v = 0; v < 3; v++) {
          ctx.save();
          ctx.translate(-3 + v * 4.5, side * (11.5 - v * 0.7));
          ctx.rotate(side * 0.35);
          ctx.fillRect(-1.2, -3, 2.4, 6);
          ctx.restore();
        }
      }
      for (let s = 0; s < 3; s++) {
        const sx = -12 + s * 5.2;
        ctx.fillStyle = `rgba(249, 115, 22, ${ventAlpha * 0.85})`;
        ctx.fillRect(sx - 1.5, -2.5, 3, 5);
        ctx.fillStyle = '#18100f';
        ctx.fillRect(sx - 2.5, -4, 2.2, 8);
      }
    });
  const bruteTorso = {
    roam: makeBruteTorso('roam'),
    stalk: makeBruteTorso('stalk'),
    chase: makeBruteTorso('chase'),
    stunned: makeBruteTorso('stunned'),
  };

  const makeBruteHead = (mode: 'roam' | 'chase' | 'stunned') =>
    reg(38, 28, (ctx) => {
      const isChasing = mode === 'chase';
      const isStunned = mode === 'stunned';
      ctx.fillStyle = '#191110';
      ctx.beginPath();
      ctx.arc(6, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isChasing ? '#fb923c' : '#9a3412';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = '#2b1b17';
      ctx.beginPath();
      ctx.arc(8.5, 0, 7.2, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.fill();
      if (!isStunned) {
        ctx.fillStyle = isChasing ? '#ffedd5' : '#fdba74';
        ctx.beginPath();
        ctx.arc(12.5, -3.5, 2.4, 0, Math.PI * 2);
        ctx.arc(12.5, 3.5, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 95, 0, 0.85)';
        ctx.fillRect(10.5, -5.5, 3, 11);
      }
    });
  const bruteHead = {
    roam: makeBruteHead('roam'),
    chase: makeBruteHead('chase'),
    stunned: makeBruteHead('stunned'),
  };

  return {
    containers,
    hidingSpots,
    paperMapBase,
    fuseSocketEmpty,
    fuseSocketLoaded,
    lightSwitchBase,
    doorThreshold,
    doorBrokenH,
    doorBrokenV,
    doorClosed,
    doorLeaf,
    doorPadlockDebris,
    glowstick,
    softDisc,
    softRing,
    stairwell,
    pickups,
    steamNozzle,
    steamJet,
    floodgateLeverBase,
    heliPad,
    heliFuselage,
    heliFuelPort,
    heliFuseBay,
    heliCockpit,
    heliRotorBlades,
    heliRotorDisc,
    heliBollard,
    lifeboatDeckPlate,
    lifeboatPedestal,
    lifeboatWinch,
    lifeboatBattery,
    lifeboatHull,
    subMoonpool,
    subApron,
    subHull,
    subBattery,
    subBallast,
    subDiveKey,
    playerShadow,
    playerBoot,
    playerSatchel,
    playerBackpack,
    playerLeftArm,
    playerRightArm,
    playerTorso,
    playerHead,
    bruteShadow,
    bruteClawArm,
    bruteTorso,
    bruteHead,
    dispose: () => {
      for (const tex of allTextures) tex.dispose();
    },
  };
}
