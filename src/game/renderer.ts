import { getRoomLightFlicker } from './lighting';
import { isTileWalkable } from './mapGen';
import { MonstrumGameEngine } from './engine';
import { createProceduralShipTextures, ProceduralShipTextures } from './textures';
import { Container, getDeckLabel, HidingSpot, RoomLightSwitch, RoomName, ShipDeck } from './types';
import {
  computeVisibilityPolygon,
  getLocalOccluders,
  getSensesProfile,
  hasLineOfSight,
  hasLineOfSightToEntity,
} from './visibility';

interface RayLightPoly {
  x: number;
  y: number;
  range: number;
  intensity: number;
  sputterAmount: number;
  poly: Array<{ x: number; y: number }>;
}

interface BruteBeamData {
  ox: number;
  oy: number;
  angle: number;
  range: number;
  intensity: number;
  isChasing: boolean;
  poly: Array<{ x: number; y: number }>;
}

interface StairGlowData {
  x: number;
  y: number;
  range: number;
  intensity: number;
  poly: Array<{ x: number; y: number }>;
}

interface DoorPeekBeamData {
  ox: number;
  oy: number;
  range: number;
  poly: Array<{ x: number; y: number }>;
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

export class GameRenderer {
  private lightCanvas: HTMLCanvasElement;
  private lightCtx: CanvasRenderingContext2D;
  private lastPlayerSightPolys: Array<Array<{ x: number; y: number }>> = [];
  private textures: ProceduralShipTextures | null = null;

  constructor() {
    this.lightCanvas = document.createElement('canvas');
    const ctx = this.lightCanvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize 2D lighting context');
    this.lightCtx = ctx;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    timeSec: number
  ): void {
    if (this.lightCanvas.width !== width || this.lightCanvas.height !== height) {
      this.lightCanvas.width = width;
      this.lightCanvas.height = height;
    }

    if (!this.textures) {
      this.textures = createProceduralShipTextures(ctx, engine.map.tileSize);
    }

    const shakeX = engine.screenShake > 0 ? (Math.random() - 0.5) * engine.screenShake : 0;
    const shakeY = engine.screenShake > 0 ? (Math.random() - 0.5) * engine.screenShake : 0;
    const zoom = engine.getEffectiveZoom(width, height);
    const viewCenterX = width / 2 + shakeX;
    const viewCenterY = height / 2 + shakeY;

    // 1. Pure OLED black void background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(viewCenterX, viewCenterY);
    ctx.scale(zoom, zoom);
    ctx.translate(-engine.cameraX, -engine.cameraY);

    const incomingStairId = engine.getBruteIncomingStairDestId();

    this.drawOceanWaves(ctx, engine, width, height, timeSec, zoom);
    this.drawTiles(ctx, engine, width, height, timeSec, zoom);
    this.drawRoomStencils(ctx, engine, width, height, zoom);
    this.drawBloodStreaks(ctx, engine, width, height, zoom);
    this.drawStairwells(ctx, engine, incomingStairId, timeSec);
    this.drawBulkheads(ctx, engine, width, height, zoom);
    this.drawEscapeZones(ctx, engine, timeSec);
    this.drawShipProps(ctx, engine, width, height, zoom);
    this.drawSteamPipes(ctx, engine, width, height, zoom, timeSec);
    this.drawPaperMaps(ctx, engine, width, height, zoom, timeSec);
    this.drawContainers(ctx, engine, width, height, zoom);
    this.drawHidingSpots(ctx, engine, width, height, zoom);
    this.drawLightSwitches(ctx, engine, timeSec, width, height, zoom);
    this.drawDoors(ctx, engine, width, height, zoom);
    this.drawDroppedLights(ctx, engine, timeSec, width, height, zoom);
    this.drawWorldPickups(ctx, engine, timeSec, undefined, width, height, zoom);
    this.drawParticles(ctx, engine);

    if (engine.player.hidingSpotId === null) {
      this.drawPlayer(ctx, engine, timeSec);
    }

    this.drawBrute(ctx, engine, timeSec);

    // Precompute lit room, Brute searchlight beam, stairwell shaft spill, and door keyhole beam polygons
    const litRoomPolys = this.computeLitRoomPolygons(engine, timeSec);
    const bruteBeam = this.computeBruteBeamPolygon(engine, timeSec);
    const stairGlow = this.computeIncomingStairGlow(engine, incomingStairId, timeSec);
    const doorPeekData = this.computeDoorPeekBeam(engine);
    this.drawWarmLightingTints(ctx, engine, litRoomPolys, bruteBeam, stairGlow, doorPeekData, timeSec);

    ctx.restore();

    // 2. Pure #000000 Raycast Darkness & Player-LoS Clipped Lighting Overlay
    this.renderLightingMask(
      engine,
      width,
      height,
      viewCenterX,
      viewCenterY,
      zoom,
      timeSec,
      litRoomPolys,
      bruteBeam,
      stairGlow,
      doorPeekData
    );
    ctx.drawImage(this.lightCanvas, 0, 0);

    // 3. Post-darkness perceptual details (strictly LoS-gated)
    ctx.save();
    ctx.translate(viewCenterX, viewCenterY);
    ctx.scale(zoom, zoom);
    ctx.translate(-engine.cameraX, -engine.cameraY);
    this.drawLightSwitchBeacons(ctx, engine, timeSec);
    this.drawStairwellBeacons(ctx, engine, incomingStairId, timeSec);
    this.drawStairClimbRing(ctx, engine);
    this.drawBruteEyesInDarkness(ctx, engine, timeSec);
    this.drawRipples(ctx, engine);
    this.drawInteractHalo(ctx, engine, timeSec);
    if (engine.debugConfig.enabled) {
      this.drawDebugOverlays(ctx, engine, width, height, zoom);
    }
    ctx.restore();

    // 3b. Circular Raycasted Stairwell Landing Peek Portal (Hold Q near stairwell)
    if (
      engine.player.peekingStairId !== null &&
      engine.player.hidingSpotId === null &&
      engine.player.climbingStairId === null
    ) {
      this.drawStairPeekPortal(
        ctx,
        engine,
        viewCenterX,
        viewCenterY,
        zoom,
        width,
        height,
        timeSec,
        litRoomPolys,
        bruteBeam
      );
    }

    // 4. Screen vignette & spot/chase danger pulse
    this.drawVignetteAndDanger(ctx, engine, width, height, zoom, timeSec);
  }

  private drawOceanWaves(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    timeSec: number,
    zoom: number
  ): void {
    const halfW = width / (2 * zoom);
    const halfH = height / (2 * zoom);
    const startX = Math.floor((engine.cameraX - halfW) / 140) * 140 - 140;
    const endX = engine.cameraX + halfW + 140;
    const startY = Math.floor((engine.cameraY - halfH) / 76) * 76 - 76;
    const endY = engine.cameraY + halfH + 76;

    // Deep layered North Atlantic swells
    ctx.lineWidth = 1.6;
    for (let y = startY; y < endY; y += 76) {
      for (let x = startX; x < endX; x += 140) {
        const phase = y * 0.024 + x * 0.011;
        const drift = Math.sin(timeSec * 1.15 + phase) * 16;
        ctx.strokeStyle = 'rgba(28, 56, 92, 0.22)';
        ctx.beginPath();
        ctx.moveTo(x + drift, y);
        ctx.quadraticCurveTo(x + 36 + drift, y - 7, x + 74 + drift, y);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
        ctx.beginPath();
        ctx.moveTo(x + 24 - drift * 0.6, y + 28);
        ctx.quadraticCurveTo(x + 56 - drift * 0.6, y + 23, x + 90 - drift * 0.6, y + 28);
        ctx.stroke();
      }
    }

    // Subtle sea-foam wake hugging the outer hull plates
    const { tiles, tileSize, width: mw, height: mh } = engine.map;
    const minTx = Math.max(0, Math.floor((engine.cameraX - halfW) / tileSize) - 1);
    const maxTx = Math.min(mw - 1, Math.ceil((engine.cameraX + halfW) / tileSize) + 1);
    const minTy = Math.max(0, Math.floor((engine.cameraY - halfH) / tileSize) - 1);
    const maxTy = Math.min(mh - 1, Math.ceil((engine.cameraY + halfH) / tileSize) + 1);

    ctx.strokeStyle = 'rgba(125, 211, 252, 0.1)';
    ctx.lineWidth = 2.2;
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const t = tiles[ty][tx];
        if (t === 'VOID') continue;
        const x = tx * tileSize;
        const y = ty * tileSize;
        const wave = Math.sin(timeSec * 1.8 + tx * 0.45 + ty * 0.35) * 2.5;
        if (tiles[ty - 1]?.[tx] === 'VOID') {
          ctx.beginPath();
          ctx.moveTo(x + 2, y - 6 + wave);
          ctx.quadraticCurveTo(x + tileSize * 0.5, y - 9 - wave, x + tileSize - 2, y - 6 + wave);
          ctx.stroke();
        }
        if (tiles[ty + 1]?.[tx] === 'VOID') {
          ctx.beginPath();
          ctx.moveTo(x + 2, y + tileSize + 6 - wave);
          ctx.quadraticCurveTo(
            x + tileSize * 0.5,
            y + tileSize + 9 + wave,
            x + tileSize - 2,
            y + tileSize + 6 - wave
          );
          ctx.stroke();
        }
      }
    }
  }

  private drawTiles(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    timeSec: number,
    zoom: number,
    camX = engine.cameraX,
    camY = engine.cameraY
  ): void {
    const { tiles, floorMaterial, tileSize, width: mw, height: mh } = engine.map;
    const halfW = width / (2 * zoom);
    const halfH = height / (2 * zoom);
    const minTx = Math.max(0, Math.floor((camX - halfW) / tileSize) - 1);
    const maxTx = Math.min(mw - 1, Math.ceil((camX + halfW) / tileSize) + 1);
    const minTy = Math.max(0, Math.floor((camY - halfH) / tileSize) - 1);
    const maxTy = Math.min(mh - 1, Math.ceil((camY + halfH) / tileSize) + 1);
    const tex = this.textures;

    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const t = tiles[ty][tx];
        if (t === 'VOID' || t === 'WALL') continue;
        const x = tx * tileSize;
        const y = ty * tileSize;
        const mat =
          t === 'EXTERIOR_DECK' || t === 'ESCAPE_HELI' || t === 'ESCAPE_LIFEBOAT'
            ? 'WEATHER'
            : floorMaterial[ty][tx];

        // World-aligned cached procedural ship deck texture
        const pat = tex?.floorPatterns[mat];
        if (pat) {
          ctx.fillStyle = pat;
          ctx.fillRect(x, y, tileSize, tileSize);
        } else {
          ctx.fillStyle = '#141a23';
          ctx.fillRect(x, y, tileSize, tileSize);
        }

        // Deterministic rust/oil grime decals breaking repetition
        const hash = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
        if (tex && tex.grimeDecals.length > 0 && mat !== 'BRIDGE' && hash % 7 === 0) {
          const decal = tex.grimeDecals[hash % tex.grimeDecals.length];
          ctx.drawImage(decal, x, y);
        }

        // Escape deck hazard zones
        if (t === 'ESCAPE_HELI') {
          ctx.fillStyle = 'rgba(251, 191, 36, 0.1)';
          ctx.fillRect(x, y, tileSize, tileSize);
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.24)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
        } else if (t === 'ESCAPE_LIFEBOAT') {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
          ctx.fillRect(x, y, tileSize, tileSize);
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
        } else if (t === 'ESCAPE_SUBMARINE') {
          ctx.fillStyle = 'rgba(45, 212, 191, 0.14)';
          ctx.fillRect(x, y, tileSize, tileSize);
          ctx.strokeStyle = 'rgba(45, 212, 191, 0.34)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
        }

        // Floor-to-wall Ambient Occlusion + crisp steel bulkhead baseboard along inner wall edge
        const aoDepth = 6;
        const wallN = tiles[ty - 1]?.[tx] === 'WALL';
        const wallS = tiles[ty + 1]?.[tx] === 'WALL';
        const wallW = tiles[ty]?.[tx - 1] === 'WALL';
        const wallE = tiles[ty]?.[tx + 1] === 'WALL';

        if (wallN) {
          const g = ctx.createLinearGradient(x, y, x, y + aoDepth);
          g.addColorStop(0, 'rgba(0, 0, 0, 0.36)');
          g.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(x, y, tileSize, aoDepth);
          ctx.fillStyle = 'rgba(100, 116, 139, 0.38)';
          ctx.fillRect(x, y, tileSize, 1.5);
        }
        if (wallS) {
          const g = ctx.createLinearGradient(x, y + tileSize, x, y + tileSize - aoDepth);
          g.addColorStop(0, 'rgba(0, 0, 0, 0.34)');
          g.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(x, y + tileSize - aoDepth, tileSize, aoDepth);
          ctx.fillStyle = 'rgba(71, 85, 105, 0.38)';
          ctx.fillRect(x, y + tileSize - 1.5, tileSize, 1.5);
        }
        if (wallW) {
          const g = ctx.createLinearGradient(x, y, x + aoDepth, y);
          g.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
          g.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(x, y, aoDepth, tileSize);
          ctx.fillStyle = 'rgba(100, 116, 139, 0.36)';
          ctx.fillRect(x, y, 1.5, tileSize);
        }
        if (wallE) {
          const g = ctx.createLinearGradient(x + tileSize, y, x + tileSize - aoDepth, y);
          g.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
          g.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(x + tileSize - aoDepth, y, aoDepth, tileSize);
          ctx.fillStyle = 'rgba(71, 85, 105, 0.36)';
          ctx.fillRect(x + tileSize - 1.5, y, 1.5, tileSize);
        }

        // Exterior deck corner-chamfered tubular steel gunwale safety railings
        if (t === 'EXTERIOR_DECK' || t === 'ESCAPE_HELI' || t === 'ESCAPE_LIFEBOAT') {
          const voidN = tiles[ty - 1]?.[tx] === 'VOID';
          const voidS = tiles[ty + 1]?.[tx] === 'VOID';
          const voidW = tiles[ty]?.[tx - 1] === 'VOID';
          const voidE = tiles[ty]?.[tx + 1] === 'VOID';

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
            drawRail(x + (voidW ? cham : 0), y + inset, x + tileSize - (voidE ? cham : 0), y + inset);
          }
          if (voidS) {
            drawRail(
              x + (voidW ? cham : 0),
              y + tileSize - inset,
              x + tileSize - (voidE ? cham : 0),
              y + tileSize - inset
            );
          }
          if (voidW) {
            drawRail(x + inset, y + (voidN ? cham : 0), x + inset, y + tileSize - (voidS ? cham : 0));
          }
          if (voidE) {
            drawRail(
              x + tileSize - inset,
              y + (voidN ? cham : 0),
              x + tileSize - inset,
              y + tileSize - (voidS ? cham : 0)
            );
          }
          // Angled chamfer corner rail caps
          if (voidN && voidW) drawRail(x + inset, y + cham, x + cham, y + inset);
          if (voidN && voidE) drawRail(x + tileSize - cham, y + inset, x + tileSize - inset, y + cham);
          if (voidS && voidW) drawRail(x + inset, y + tileSize - cham, x + cham, y + tileSize - inset);
          if (voidS && voidE)
            drawRail(x + tileSize - cham, y + tileSize - inset, x + tileSize - inset, y + tileSize - cham);
        }
      }
    }
  }

  private drawBulkheads(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number,
    camX = engine.cameraX,
    camY = engine.cameraY
  ): void {
    const { tiles, tileSize, width: mw, height: mh } = engine.map;
    const halfW = width / (2 * zoom);
    const halfH = height / (2 * zoom);
    const minTx = Math.max(0, Math.floor((camX - halfW) / tileSize) - 1);
    const maxTx = Math.min(mw - 1, Math.ceil((camX + halfW) / tileSize) + 1);
    const minTy = Math.max(0, Math.floor((camY - halfH) / tileSize) - 1);
    const maxTy = Math.min(mh - 1, Math.ceil((camY + halfH) / tileSize) + 1);
    const armorPattern = this.textures?.wallArmorPattern;

    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (tiles[ty][tx] !== 'WALL') continue;
        const x = tx * tileSize;
        const y = ty * tileSize;

        // Flush outer armor fill aligned 1:1 with raycast wall segments (zero gaps behind walls)
        ctx.fillStyle = armorPattern ?? '#1d2635';
        ctx.fillRect(x, y, tileSize, tileSize);

        const nWall = tiles[ty - 1]?.[tx] === 'WALL';
        const sWall = tiles[ty + 1]?.[tx] === 'WALL';
        const wWall = tiles[ty]?.[tx - 1] === 'WALL';
        const eWall = tiles[ty]?.[tx + 1] === 'WALL';

        const isOuterHull =
          tiles[ty - 1]?.[tx] === 'VOID' ||
          tiles[ty + 1]?.[tx] === 'VOID' ||
          tiles[ty]?.[tx - 1] === 'VOID' ||
          tiles[ty]?.[tx + 1] === 'VOID';

        // Connected bulkhead rim bevels only along exposed faces (eliminates blocky tile grid lines)
        const rimW = 4;
        if (!nWall) {
          ctx.fillStyle = isOuterHull ? '#475569' : '#3b4a62';
          ctx.fillRect(x, y, tileSize, rimW);
          ctx.fillStyle = '#090d14';
          ctx.fillRect(x, y, tileSize, 1.2);
        }
        if (!sWall) {
          ctx.fillStyle = '#111722';
          ctx.fillRect(x, y + tileSize - rimW, tileSize, rimW);
          ctx.fillStyle = '#06090e';
          ctx.fillRect(x, y + tileSize - 1.2, tileSize, 1.2);
        }
        if (!wWall) {
          ctx.fillStyle = isOuterHull ? '#3e4c63' : '#313f55';
          ctx.fillRect(x, y, rimW, tileSize);
          ctx.fillStyle = '#090d14';
          ctx.fillRect(x, y, 1.2, tileSize);
        }
        if (!eWall) {
          ctx.fillStyle = '#151c29';
          ctx.fillRect(x + tileSize - rimW, y, rimW, tileSize);
          ctx.fillStyle = '#06090e';
          ctx.fillRect(x + tileSize - 1.2, y, 1.2, tileSize);
        }

        // Mitered corner highlights/caps where two exposed bulkhead faces meet
        if (!nWall && !wWall) {
          ctx.fillStyle = '#64748b';
          ctx.fillRect(x + 1, y + 1, rimW - 1, rimW - 1);
        }
        if (!nWall && !eWall) {
          ctx.fillStyle = '#475569';
          ctx.fillRect(x + tileSize - rimW, y + 1, rimW - 1, rimW - 1);
        }
        if (!sWall && !wWall) {
          ctx.fillStyle = '#293548';
          ctx.fillRect(x + 1, y + tileSize - rimW, rimW - 1, rimW - 1);
        }
        if (!sWall && !eWall) {
          ctx.fillStyle = '#0b0f17';
          ctx.fillRect(x + tileSize - rimW, y + tileSize - rimW, rimW - 1, rimW - 1);
        }

        // Subtle welded center rib on thicker multi-tile bulkheads
        if (nWall && sWall && !wWall && !eWall) {
          ctx.fillStyle = 'rgba(148, 163, 184, 0.08)';
          ctx.fillRect(x + tileSize * 0.5 - 1, y, 2, tileSize);
        } else if (wWall && eWall && !nWall && !sWall) {
          ctx.fillStyle = 'rgba(148, 163, 184, 0.08)';
          ctx.fillRect(x, y + tileSize * 0.5 - 1, tileSize, 2);
        }
      }
    }
  }

  private drawRoomStencils(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number,
    camX = engine.cameraX,
    camY = engine.cameraY
  ): void {
    const halfW = width / (2 * zoom) + 220;
    const halfH = height / (2 * zoom) + 180;
    ctx.save();
    ctx.font = '600 11px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';

    const ts = engine.map.tileSize;
    for (const r of engine.map.rooms) {
      if (r.name === 'Catwalk') continue;
      const cx = ((r.x1 + r.x2 + 1) / 2) * ts;
      const cy = ((r.y1 + r.y2 + 1) / 2) * ts;
      if (Math.abs(cx - camX) > halfW || Math.abs(cy - camY) > halfH) continue;
      ctx.fillText(r.name.toUpperCase(), cx, cy);
    }
    ctx.restore();
  }

  private drawBloodStreaks(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number,
    camX = engine.cameraX,
    camY = engine.cameraY
  ): void {
    const streaks = engine.map.bloodStreaks;
    if (!streaks || streaks.length === 0) return;

    const halfW = width / (2 * zoom) + 90;
    const halfH = height / (2 * zoom) + 90;

    for (const bs of streaks) {
      if (
        Math.abs(bs.x - camX) > halfW ||
        Math.abs(bs.y - camY) > halfH
      ) {
        continue;
      }

      ctx.save();
      ctx.translate(bs.x, bs.y);
      ctx.rotate(bs.angle);

      const alpha = bs.intensity;
      if (bs.kind === 'DRAG_SMEAR') {
        // Dark dried pool at origin
        ctx.fillStyle = `rgba(62, 10, 12, ${alpha * 0.72})`;
        ctx.beginPath();
        ctx.ellipse(2, 0, bs.width * 0.65, bs.width * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();

        // Tapered body/finger drag streaks
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
          // Heel
          ctx.beginPath();
          ctx.ellipse(sx - 1.5, sy, 2.0, 1.5, 0, 0, Math.PI * 2);
          ctx.fill();
          // Forefoot sole
          ctx.beginPath();
          ctx.ellipse(sx + 2.4, sy, 3.0, 1.85, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // SPLATTER: coagulated core + directional cast-off droplets
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
  }

  private drawShipProps(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number,
    camX = engine.cameraX,
    camY = engine.cameraY
  ): void {
    const ts = engine.map.tileSize;
    const halfW = width / (2 * zoom) + 120;
    const halfH = height / (2 * zoom) + 120;
    const minX = camX - halfW;
    const maxX = camX + halfW;
    const minY = camY - halfH;
    const maxY = camY + halfH;

    // Two-pass order: walkable floor clutter first (flush on deck), then blocking centerpieces
    const sortedProps = [
      ...engine.map.props.filter((p) => !p.blocking),
      ...engine.map.props.filter((p) => Boolean(p.blocking)),
    ];

    for (const prop of sortedProps) {
      if (prop.kind === 'SUBMARINE_HULL') continue; // Rendered with moonpool detail in drawEscapeZones
      const px = prop.tx * ts;
      const py = prop.ty * ts;
      const pw = prop.tw * ts;
      const ph = prop.th * ts;
      if (px + pw < minX || px > maxX || py + ph < minY || py > maxY) continue;

      ctx.save();
      if (prop.kind === 'SHIPPING_CONTAINER') {
        // Ground contact shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        traceRoundedRect(ctx, px + 5, py + 6, pw - 4, ph - 4, 4);
        ctx.fill();

        // Rounded beveled container shell
        ctx.fillStyle = prop.color ?? '#334155';
        traceRoundedRect(ctx, px + 2, py + 2, pw - 4, ph - 4, 4);
        ctx.fill();

        // Corrugated steel roof ribs
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

        // ISO Corner castings
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

        // Cylindrical rotor housing, cooling fins & copper manifold rings
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

        // Furnace sight-glass & riveted pressure collar
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

        // Pipe flange collars
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
      } else if (prop.kind === 'FLOODGATE_LEVER') {
        const subPartsDone = engine.escape.submarineParts.length === 3;
        const subActiveOrReady = engine.escape.submarineState !== 'IDLE';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
        traceRoundedRect(ctx, px + 7, py + 7, pw - 10, ph - 10, 3);
        ctx.fill();
        ctx.fillStyle = '#1e293b';
        traceRoundedRect(ctx, px + 5, py + 5, pw - 10, ph - 10, 3);
        ctx.fill();
        ctx.strokeStyle = subActiveOrReady ? '#34d399' : subPartsDone ? '#2dd4bf' : '#64748b';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        // Lever track & handle
        ctx.fillStyle = '#090d14';
        ctx.fillRect(px + pw * 0.5 - 3, py + 11, 6, ph - 22);
        const leverY = subActiveOrReady ? py + ph - 16 : py + 14;
        ctx.fillStyle = subActiveOrReady ? '#34d399' : subPartsDone ? '#f59e0b' : '#ef4444';
        ctx.fillRect(px + pw * 0.5 - 7, leverY - 3, 14, 6);
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
    }
  }

  private drawSteamPipes(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number,
    timeSec: number,
    camX = engine.cameraX,
    camY = engine.cameraY
  ): void {
    const ts = engine.map.tileSize;
    const halfW = width / (2 * zoom) + 220;
    const halfH = height / (2 * zoom) + 220;

    for (const pipe of engine.map.steamPipes) {
      if (Math.abs(pipe.x - camX) > halfW || Math.abs(pipe.y - camY) > halfH) continue;

      const wallCx = (pipe.wallTx + 0.5) * ts;
      const wallCy = (pipe.wallTy + 0.5) * ts;
      const edgeX = wallCx + pipe.dirX * (ts * 0.48);
      const edgeY = wallCy + pipe.dirY * (ts * 0.48);
      const perpX = -pipe.dirY;
      const perpY = pipe.dirX;

      const isWarn = pipe.warningTimer > 0;
      const isActive = pipe.activeTimer > 0;

      ctx.save();
      // Wall-mounted bronze/iron pipe collar & directional flanged nozzle
      ctx.strokeStyle = '#090d14';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(edgeX - pipe.dirX * 10, edgeY - pipe.dirY * 10);
      ctx.lineTo(edgeX + pipe.dirX * 11, edgeY + pipe.dirY * 11);
      ctx.stroke();

      ctx.strokeStyle = isActive ? '#e2e8f0' : isWarn ? '#f59e0b' : '#9a3412';
      ctx.lineWidth = 5.2;
      ctx.beginPath();
      ctx.moveTo(edgeX - pipe.dirX * 9, edgeY - pipe.dirY * 9);
      ctx.lineTo(edgeX + pipe.dirX * 10, edgeY + pipe.dirY * 10);
      ctx.stroke();

      // Bolted wall flange collar
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(edgeX - perpX * 8, edgeY - perpY * 8);
      ctx.lineTo(edgeX + perpX * 8, edgeY + perpY * 8);
      ctx.stroke();

      // Pressure valve gauge LED
      ctx.fillStyle = isActive
        ? '#ef4444'
        : isWarn
          ? Math.sin(timeSec * 22) > 0
            ? '#fde047'
            : '#f97316'
          : '#475569';
      ctx.beginPath();
      ctx.arc(edgeX - pipe.dirX * 4 + perpX * 6, edgeY - pipe.dirY * 4 + perpY * 6, 2.8, 0, Math.PI * 2);
      ctx.fill();

      // Warning hiss flare at nozzle before burst
      if (isWarn) {
        const wPulse = 0.35 + 0.25 * Math.sin(timeSec * 24);
        const wGrad = ctx.createRadialGradient(edgeX, edgeY, 2, edgeX + pipe.dirX * 18, edgeY + pipe.dirY * 18, 28);
        wGrad.addColorStop(0, `rgba(253, 224, 71, ${wPulse})`);
        wGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');
        ctx.fillStyle = wGrad;
        ctx.beginPath();
        ctx.arc(edgeX + pipe.dirX * 10, edgeY + pipe.dirY * 10, 26, 0, Math.PI * 2);
        ctx.fill();
      }

      // Directional high-pressure steam burst jet (clipped by walls & closed doors)
      if (isActive) {
        const clippedTiles = engine.getSteamPipeClippedRangeTiles(pipe);
        if (clippedTiles > 0) {
          const jetLen = clippedTiles * ts - 4;
          const endX = edgeX + pipe.dirX * jetLen;
          const endY = edgeY + pipe.dirY * jetLen;
          const jetGrad = ctx.createLinearGradient(edgeX, edgeY, endX, endY);
          jetGrad.addColorStop(0, 'rgba(248, 250, 252, 0.72)');
          jetGrad.addColorStop(0.5, 'rgba(226, 232, 240, 0.45)');
          jetGrad.addColorStop(1, 'rgba(203, 213, 225, 0.08)');

          const wobble = Math.sin(timeSec * 36 + pipe.wallTx) * 2.5;
          ctx.fillStyle = jetGrad;
          ctx.beginPath();
          ctx.moveTo(edgeX + perpX * 5, edgeY + perpY * 5);
          ctx.lineTo(endX + perpX * (16 + wobble), endY + perpY * (16 + wobble));
          ctx.lineTo(endX - perpX * (16 - wobble), endY - perpY * (16 - wobble));
          ctx.lineTo(edgeX - perpX * 5, edgeY - perpY * 5);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  private drawPaperMaps(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number,
    timeSec: number,
    camX = engine.cameraX,
    camY = engine.cameraY
  ): void {
    const halfW = width / (2 * zoom) + 90;
    const halfH = height / (2 * zoom) + 90;

    for (const stand of engine.map.paperMaps) {
      if (Math.abs(stand.x - camX) > halfW || Math.abs(stand.y - camY) > halfH) continue;

      ctx.save();
      ctx.translate(stand.x, stand.y);

      // Stand drop shadow & steel table pedestal
      ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
      traceRoundedRect(ctx, -13, -9, 28, 22, 3);
      ctx.fill();

      ctx.fillStyle = '#334155';
      traceRoundedRect(ctx, -15, -11, 28, 22, 3);
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Blueprint parchment sheet pinned to lectern
      ctx.fillStyle = '#e7dcc2';
      traceRoundedRect(ctx, -11, -8, 20, 16, 1.5);
      ctx.fill();

      // Ink schematic deck lines + tiny red "YOU ARE HERE" pin
      ctx.strokeStyle = '#1e3a5f';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-8, -3);
      ctx.lineTo(6, -3);
      ctx.moveTo(-8, 2);
      ctx.lineTo(4, 2);
      ctx.stroke();

      const pulse = 0.65 + 0.35 * Math.sin(timeSec * 4.5);
      ctx.fillStyle = `rgba(220, 38, 38, ${pulse})`;
      ctx.beginPath();
      ctx.arc(2, -1, 2.2, 0, Math.PI * 2);
      ctx.fill();

      // Warm brass map reading lamp rim
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(-12, -10, 6, 3);

      ctx.restore();
    }
  }

  private drawStairwells(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    incomingStairId: string | null,
    timeSec: number
  ): void {
    const half = 27; // Enlarged 54x54 heavy companionway hatch
    const size = half * 2;
    for (const st of engine.map.stairwells) {
      const isBruteComing = st.id === incomingStairId;
      const pulse = isBruteComing ? 0.65 + 0.35 * Math.sin(timeSec * 10) : 0;

      ctx.save();
      ctx.translate(st.x, st.y);

      // Floor drop-shadow around heavy hatch coaming
      ctx.fillStyle = 'rgba(0, 0, 0, 0.56)';
      traceRoundedRect(ctx, -half + 2, -half + 3, size, size, 5);
      ctx.fill();

      // Heavy bolted outer steel coaming frame
      ctx.fillStyle = isBruteComing ? '#291811' : '#1b2432';
      traceRoundedRect(ctx, -half, -half, size, size, 5);
      ctx.fill();

      ctx.strokeStyle = isBruteComing
        ? `rgba(255, 115, 20, ${0.75 + 0.25 * pulse})`
        : st.direction === 'DOWN'
          ? '#38bdf8'
          : '#fbbf24';
      ctx.lineWidth = isBruteComing ? 2.6 : 1.9;
      traceRoundedRect(ctx, -half + 0.5, -half + 0.5, size - 1, size - 1, 5);
      ctx.stroke();

      // Recessed stairwell abyss interior
      const innerHalf = 20;
      ctx.fillStyle = '#070a0f';
      traceRoundedRect(ctx, -innerHalf, -innerHalf, innerHalf * 2, innerHalf * 2, 3);
      ctx.fill();

      // Pulsing orange furnace glow inside the companionway shaft when Brute is climbing through
      if (isBruteComing) {
        const g = ctx.createRadialGradient(0, 0, 3, 0, 0, 34);
        g.addColorStop(0, `rgba(255, 237, 213, ${0.82 * pulse})`);
        g.addColorStop(0.35, `rgba(255, 115, 0, ${0.75 * pulse})`);
        g.addColorStop(0.75, `rgba(234, 88, 12, ${0.42 * pulse})`);
        g.addColorStop(1, 'rgba(234, 88, 12, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 34, 0, Math.PI * 2);
        ctx.fill();
      }

      // 6 deep anti-slip steel treads descending into shaft
      for (let i = 0; i < 6; i++) {
        const sy = -16 + i * 6;
        const depthFade = st.direction === 'DOWN' ? 1 - i * 0.11 : 0.45 + i * 0.11;
        ctx.fillStyle = isBruteComing
          ? `rgba(255, 140, 56, ${0.35 + depthFade * 0.35 * pulse})`
          : `rgba(71, 85, 105, ${depthFade})`;
        ctx.fillRect(-16, sy, 32, 3.6);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(-16, sy + 3.6, 32, 1);
      }

      // Yellow/amber safety nosing bar on top step edge
      ctx.fillStyle = isBruteComing ? '#ffedd5' : '#f59e0b';
      ctx.fillRect(-16, st.direction === 'DOWN' ? -18 : 15.5, 32, 2.5);

      // Twin tubular side handrails along coaming
      ctx.strokeStyle = isBruteComing ? '#fdba74' : '#94a3b8';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-21.5, -19);
      ctx.lineTo(-21.5, 19);
      ctx.moveTo(21.5, -19);
      ctx.lineTo(21.5, 19);
      ctx.stroke();

      // Corner rivets on outer coaming
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

      // Crisp directional chevron
      ctx.fillStyle = isBruteComing
        ? '#fff7ed'
        : st.direction === 'DOWN'
          ? '#38bdf8'
          : '#fbbf24';
      ctx.beginPath();
      if (st.direction === 'UP') {
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

      ctx.restore();
    }
  }

  private drawEscapeZones(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    timeSec: number
  ): void {
    const ts = engine.map.tileSize;
    const esc = engine.escape;

    // --- 1. STERN HELIDECK & CARGO CHOPPER ---
    const hx = engine.map.heliPos.x + 14;
    const hy = engine.map.heliPos.y;
    const hasFuel = esc.heliParts.includes('AVIATION_FUEL');
    const hasFuse = esc.heliParts.includes('ROTOR_FUSE');
    const hasKey = esc.heliParts.includes('IGNITION_KEY');
    const heliReady = esc.heliState === 'READY';
    const heliActivating = esc.heliState === 'ACTIVATING';
    const heliSpool = heliReady ? 1 : heliActivating ? esc.heliActivationProgress : 0;

    ctx.save();
    // Octagonal weathered yellow helipad outline & safety circle
    const padR = 64;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.beginPath();
    ctx.arc(hx, hy, padR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = heliReady
      ? '#34d399'
      : esc.heliParts.length === 3
        ? '#fbbf24'
        : 'rgba(251, 191, 36, 0.5)';
    ctx.lineWidth = 3.2;
    ctx.setLineDash([12, 7]);
    ctx.beginPath();
    ctx.arc(hx, hy, padR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Inner aiming ring & stencil H
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.2)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(hx, hy, 44, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = '700 34px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = heliReady ? 'rgba(52, 211, 153, 0.4)' : 'rgba(251, 191, 36, 0.28)';
    ctx.fillText('H', hx + 8, hy);

    // 4 Corner Deck Perimeter Strobe Lights
    const strobeOn = Math.sin(timeSec * (heliReady ? 6 : 12)) > 0;
    for (const [sx, sy] of [
      [-52, -48],
      [52, -48],
      [-52, 48],
      [52, 48],
    ]) {
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(hx + sx, hy + sy, 4, 0, Math.PI * 2);
      ctx.fill();
      if (heliReady || (heliActivating && strobeOn)) {
        ctx.fillStyle = heliReady ? '#34d399' : '#f59e0b';
        ctx.beginPath();
        ctx.arc(hx + sx, hy + sy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = hasFuse ? 'rgba(251, 191, 36, 0.45)' : '#334155';
        ctx.beginPath();
        ctx.arc(hx + sx, hy + sy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Helicopter Body Anchor (centered at heliPos)
    const lx = engine.map.heliPos.x;
    const ly = engine.map.heliPos.y;
    const heliVibX = heliSpool > 0.15 ? Math.sin(timeSec * 52) * heliSpool * 0.9 : 0;
    const heliVibY = heliSpool > 0.15 ? Math.cos(timeSec * 46) * heliSpool * 0.9 : 0;

    ctx.save();
    ctx.translate(lx + heliVibX, ly + heliVibY);

    // Helicopter ground drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.56)';
    ctx.beginPath();
    ctx.ellipse(2, 5, 36, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-46, 0, 32, 8);

    // Twin tubular landing skids & cross-struts
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
    // Struts
    ctx.moveTo(-10, -16);
    ctx.lineTo(-8, -11);
    ctx.moveTo(12, -16);
    ctx.lineTo(10, -11);
    ctx.moveTo(-10, 16);
    ctx.lineTo(-8, 11);
    ctx.moveTo(12, 16);
    ctx.lineTo(10, 11);
    ctx.stroke();

    // Tail Boom & Horizontal/Vertical Stabilizers
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

    // Tail fin & spinning tail rotor
    ctx.fillStyle = '#d97706';
    ctx.fillRect(-49, -7, 4, 14);
    ctx.fillStyle = '#0f172a';
    const tailSpin = heliSpool > 0 ? Math.sin(timeSec * (12 + heliSpool * 44)) * 7 : 6;
    ctx.fillRect(-48, -tailSpin, 2, tailSpin * 2);

    // Fuselage Cabin Shell
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
    ctx.strokeStyle = heliReady ? '#34d399' : '#64748b';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // High-vis rescue stripe along fuselage flanks
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, -10.5);
    ctx.lineTo(12, -11);
    ctx.moveTo(-14, 10.5);
    ctx.lineTo(12, 11);
    ctx.stroke();

    // Part 3: IGNITION_KEY — Cockpit Canopy & Lit Avionics Console + Wing Nav Strobes
    ctx.fillStyle = hasKey ? '#082f49' : '#090d14';
    ctx.beginPath();
    ctx.moveTo(14, -9);
    ctx.quadraticCurveTo(30, -6, 30, 0);
    ctx.quadraticCurveTo(30, 6, 14, 9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hasKey ? '#38bdf8' : '#334155';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (hasKey) {
      // Glowing green/amber cockpit instrument glow
      ctx.fillStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.fillRect(19, -5.5, 4, 11);
      ctx.fillStyle = '#34d399';
      ctx.fillRect(21, -3, 2, 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(21, 1, 2, 2);
      // Red/Green nav lights on fuselage sponsons
      const navBlink = Math.sin(timeSec * 5) > -0.3;
      if (navBlink) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(8, -14.5, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(8, 14.5, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Part 1: AVIATION_FUEL — External Fuel Cell & Hose (Port Flank)
    if (hasFuel) {
      ctx.fillStyle = '#b91c1c';
      traceRoundedRect(ctx, -12, -20, 14, 7, 2);
      ctx.fill();
      ctx.strokeStyle = '#fca5a5';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-4, -13);
      ctx.quadraticCurveTo(-2, -9, 2, -10);
      ctx.stroke();
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.arc(-5, -16.5, 1.7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Dry open filler port & disconnected dangling hose
      ctx.fillStyle = '#090d14';
      ctx.beginPath();
      ctx.arc(-2, -13, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-2, -13);
      ctx.quadraticCurveTo(-8, -19, -13, -17);
      ctx.stroke();
    }

    // Part 2: ROTOR_FUSE — Starboard Turbine Electronics Bay
    if (hasFuse) {
      ctx.fillStyle = '#1e293b';
      traceRoundedRect(ctx, -8, 12, 13, 6.5, 1.5);
      ctx.fill();
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.arc(-1.5, 15.2, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Exposed dark/sparking turbine relay socket
      ctx.fillStyle = '#090d14';
      ctx.fillRect(-7, 12, 11, 5.5);
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 1;
      ctx.strokeRect(-7, 12, 11, 5.5);
      if (Math.sin(timeSec * 19) > 0.78) {
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(-2, 14.5, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Dorsal Turbine Cowling & Dual Exhausts
    ctx.fillStyle = '#1e293b';
    traceRoundedRect(ctx, -10, -6.5, 18, 13, 3);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(-11, -3.5, 2.6, 0, Math.PI * 2);
    ctx.arc(-11, 3.5, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Rotor Assembly (gradual acceleration during ACTIVATING -> full blur disc at READY)
    const rotorAngle =
      heliSpool > 0
        ? timeSec * (2 + heliSpool * 24)
        : 0.42;

    if (heliSpool > 0.22) {
      const discAlpha = Math.min(0.32, (heliSpool - 0.22) * 0.42);
      ctx.fillStyle = `rgba(226, 232, 240, ${discAlpha})`;
      ctx.beginPath();
      ctx.arc(0, 0, 44, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(251, 191, 36, ${discAlpha * 1.4})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, 44, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.save();
    ctx.rotate(rotorAngle);
    const bladeAlpha = heliSpool > 0.5 ? 0.45 : 0.85;
    ctx.strokeStyle = `rgba(226, 232, 240, ${bladeAlpha})`;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(-44, 0);
    ctx.lineTo(44, 0);
    ctx.moveTo(0, -44);
    ctx.lineTo(0, 44);
    ctx.stroke();
    // Blade tip warning stripes
    ctx.strokeStyle = `rgba(251, 191, 36, ${bladeAlpha})`;
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
    ctx.restore();

    // Rotor Hub Cap
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();

    // --- 2. BOW LIFEBOAT & HYDRAULIC DAVIT CRANE ---
    const bx = engine.map.lifeboatPos.x;
    const by = engine.map.lifeboatPos.y;
    const bTx = engine.map.lifeboatPos.tx;
    const bTy = engine.map.lifeboatPos.ty;
    // Detect which side is outboard VOID rail (port top = -1, starboard bottom = +1)
    const voidNorth = engine.map.tiles[bTy - 1]?.[bTx] === 'VOID';
    const outSign = voidNorth ? -1 : 1;

    const hasPatch = esc.lifeboatParts.includes('HULL_PATCH');
    const hasCrank = esc.lifeboatParts.includes('WINCH_CRANK');
    const hasBattery = esc.lifeboatParts.includes('MARINE_BATTERY');
    const boatReady = esc.lifeboatState === 'READY';
    const boatActivating = esc.lifeboatState === 'ACTIVATING';
    const craneSwing = boatReady ? 1 : boatActivating ? esc.lifeboatActivationProgress : 0;

    // Davit deck pedestals sit slightly inboard of rail, arms swing boat outward over sea (-outSign*0 -> +outSign*34)
    const inboardY = by - outSign * 14;
    const swingOutDist = craneSwing * 36;
    const boatY = by - outSign * 2 + outSign * swingOutDist;
    const boatX = bx + 16;

    ctx.save();
    // Deck mounting plate & yellow safety hazard border around davit bay
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    traceRoundedRect(ctx, bx - 16, by - 16, ts + 28, ts, 4);
    ctx.fill();
    ctx.strokeStyle = boatReady
      ? '#34d399'
      : esc.lifeboatParts.length === 3
        ? '#38bdf8'
        : 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    traceRoundedRect(ctx, bx - 16, by - 16, ts + 28, ts, 4);
    ctx.stroke();
    ctx.setLineDash([]);

    // Twin Steel A-Frame Davit Pedestals (fore & aft)
    const leftPedX = bx - 8;
    const rightPedX = bx + 40;
    for (const px of [leftPedX, rightPedX]) {
      ctx.fillStyle = '#334155';
      traceRoundedRect(ctx, px - 6, inboardY - 6, 12, 12, 2);
      ctx.fill();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Swinging hydraulic davit boom arm extending from pedestal over the hull rail
      const armReach = 12 + swingOutDist * 1.05;
      const tipY = inboardY + outSign * armReach;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 6.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px + 2, inboardY + 2);
      ctx.lineTo(px + 2, tipY + 2);
      ctx.stroke();

      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 4.8;
      ctx.beginPath();
      ctx.moveTo(px, inboardY);
      ctx.lineTo(px, tipY);
      ctx.stroke();

      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(px, tipY, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Center Hydraulic Winch Drum Box (between the two pedestals)
    const winchX = (leftPedX + rightPedX) / 2;
    ctx.fillStyle = '#1e293b';
    traceRoundedRect(ctx, winchX - 10, inboardY - 6, 20, 12, 2);
    ctx.fill();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Part 2: WINCH_CRANK — Bare Spline vs Geared Crank Wheel + Cable Tension
    if (hasCrank) {
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(winchX + 12, inboardY, 5.5, 0, Math.PI * 2);
      ctx.stroke();
      const crankAng = boatActivating ? timeSec * 9 : 0.6;
      ctx.beginPath();
      ctx.moveTo(winchX + 12, inboardY);
      ctx.lineTo(winchX + 12 + Math.cos(crankAng) * 7, inboardY + Math.sin(crankAng) * 7);
      ctx.stroke();
    } else {
      // Bare stripped spline stub
      ctx.fillStyle = '#475569';
      ctx.fillRect(winchX + 9, inboardY - 2, 5, 4);
    }

    // Part 3: MARINE_BATTERY — Deck Power Tray & Floodlight
    const batX = bx - 14;
    const batY = inboardY - outSign * 4;
    ctx.fillStyle = '#0f172a';
    traceRoundedRect(ctx, batX - 5, batY - 5, 10, 10, 1.5);
    ctx.fill();
    if (hasBattery) {
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(batX - 4, batY - 4, 8, 8);
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath();
      ctx.arc(batX, batY, 2, 0, Math.PI * 2);
      ctx.fill();
      if (boatActivating || boatReady) {
        // Davit crane spotlight cone illuminating boat over water
        const spot = ctx.createRadialGradient(boatX, boatY, 4, boatX, boatY, 42);
        spot.addColorStop(0, boatReady ? 'rgba(52, 211, 153, 0.25)' : 'rgba(56, 189, 248, 0.22)');
        spot.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = spot;
        ctx.beginPath();
        ctx.arc(boatX, boatY, 42, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = '#ca8a04';
      ctx.lineWidth = 1;
      ctx.strokeRect(batX - 4.5, batY - 4.5, 9, 9);
    }

    // Lifeboat Hull (suspended & swung out over the ocean as crane activates)
    const boatBob = boatReady ? Math.sin(timeSec * 2.8) * 1.4 : 0;
    ctx.save();
    ctx.translate(boatX, boatY + boatBob);

    // Water/deck contact shadow beneath boat
    ctx.fillStyle = 'rgba(0, 0, 0, 0.52)';
    ctx.beginPath();
    ctx.ellipse(2, 4, 28, 12.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Enclosed Rescue-Orange Lifeboat Hull
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
    ctx.strokeStyle = boatReady ? '#34d399' : '#fed7aa';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Reflective white/slate top cabin canopy & hatch
    ctx.fillStyle = '#e2e8f0';
    traceRoundedRect(ctx, -14, -7, 26, 14, 5);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    traceRoundedRect(ctx, 4, -4.5, 6, 9, 2);
    ctx.fill();

    // Part 1: HULL_PATCH — Fractured Hull Crack vs Bolted Steel Patch
    if (hasPatch) {
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
      // Jagged hull fracture
      ctx.strokeStyle = '#090d14';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-10, -4);
      ctx.lineTo(-6, -1);
      ctx.lineTo(-8, 2);
      ctx.lineTo(-3, 5);
      ctx.stroke();
    }

    // Steel hoisting shackles & lift cables connecting davit tips to boat bow/stern
    ctx.strokeStyle = hasCrank ? '#e2e8f0' : 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = hasCrank ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(-22, 0);
    ctx.lineTo(leftPedX - boatX, inboardY + outSign * (12 + swingOutDist * 1.05) - (boatY + boatBob));
    ctx.moveTo(22, 0);
    ctx.lineTo(rightPedX - boatX, inboardY + outSign * (12 + swingOutDist * 1.05) - (boatY + boatBob));
    ctx.stroke();

    ctx.restore();
    ctx.restore();

    // --- 3. DECK 1 MOONPOOL CHAMBER & DEEP-DIVE SUBMARINE ---
    const subPos = engine.map.submarinePos;
    const poolX = 102 * ts;
    const poolY = 92 * ts;
    const poolW = 4 * ts;
    const poolH = 6 * ts;
    const hasSubBat = esc.submarineParts.includes('SUB_BATTERY');
    const hasBallast = esc.submarineParts.includes('BALLAST_PUMP');
    const hasDiveKey = esc.submarineParts.includes('DIVE_KEY');
    const subReady = esc.submarineState === 'READY';
    const subActivating = esc.submarineState === 'ACTIVATING';
    const floodLevel = subReady ? 1 : subActivating ? esc.submarineActivationProgress : 0;

    ctx.save();
    // Recessed Moonpool Water Basin (centered on 102..105, 92..97)
    ctx.fillStyle = '#04121d';
    traceRoundedRect(ctx, poolX - 6, poolY - 6, poolW + 12, poolH + 12, 6);
    ctx.fill();

    // Water ripples inside moonpool + surging white foam during floodgate deluge
    const waterAlpha = 0.42 + floodLevel * 0.45;
    ctx.fillStyle = `rgba(13, 148, 136, ${waterAlpha * 0.25})`;
    traceRoundedRect(ctx, poolX, poolY, poolW, poolH, 4);
    ctx.fill();

    ctx.strokeStyle = subActivating
      ? `rgba(153, 246, 228, ${0.45 + Math.sin(timeSec * 14) * 0.25})`
      : 'rgba(45, 212, 191, 0.22)';
    ctx.lineWidth = 1.6;
    for (let wy = poolY + 24; wy < poolY + poolH - 18; wy += 36) {
      const drift = Math.sin(timeSec * (subActivating ? 8 : 2.1) + wy * 0.05) * 6;
      ctx.beginPath();
      ctx.moveTo(poolX + 16 + drift, wy);
      ctx.quadraticCurveTo(poolX + poolW * 0.5, wy - 6, poolX + poolW - 16 + drift, wy);
      ctx.stroke();
    }

    // Moonpool steel coaming & hazard border
    ctx.strokeStyle = subReady ? '#34d399' : esc.submarineParts.length === 3 ? '#2dd4bf' : 'rgba(45, 212, 191, 0.48)';
    ctx.lineWidth = 2.6;
    ctx.setLineDash([10, 6]);
    traceRoundedRect(ctx, poolX - 4, poolY - 4, poolW + 8, poolH + 8, 5);
    ctx.stroke();
    ctx.setLineDash([]);

    // Boarding boarding-gangway apron at submarinePos (100, 95)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    traceRoundedRect(ctx, subPos.x - 18, subPos.y - 26, 46, 52, 4);
    ctx.fill();
    ctx.strokeStyle = subReady ? '#34d399' : '#2dd4bf';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Deep-Dive Rescue Submarine (vertical bow-south / bow-north posture inside moonpool)
    const subCx = poolX + poolW * 0.5;
    const subCy = poolY + poolH * 0.5 + (subReady ? Math.sin(timeSec * 3) * 2.5 : 0);
    ctx.save();
    ctx.translate(subCx, subCy);

    // Shadow in water
    ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
    ctx.beginPath();
    ctx.ellipse(4, 4, 34, 98, 0, 0, Math.PI * 2);
    ctx.fill();

    // Outer dive hull (deep graphite + rescue-yellow dorsal stripe)
    const subGrad = ctx.createLinearGradient(-32, 0, 32, 0);
    subGrad.addColorStop(0, '#0f172a');
    subGrad.addColorStop(0.5, '#334155');
    subGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = subGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 31, 94, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = subReady ? '#34d399' : '#64748b';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Bow & stern hydroplanes
    ctx.fillStyle = '#475569';
    ctx.fillRect(-42, -56, 12, 10);
    ctx.fillRect(30, -56, 12, 10);
    ctx.fillRect(-38, 70, 10, 8);
    ctx.fillRect(28, 70, 10, 8);

    // Centerline safety stripe
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, -82);
    ctx.lineTo(0, 82);
    ctx.stroke();

    // Conning tower sail & hatch
    ctx.fillStyle = '#1e293b';
    traceRoundedRect(ctx, -16, -24, 32, 48, 12);
    ctx.fill();
    ctx.strokeStyle = subReady ? '#34d399' : '#94a3b8';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Part 1: SUB_BATTERY — Port Power Cell Bank
    ctx.fillStyle = hasSubBat ? '#0d9488' : '#090d14';
    traceRoundedRect(ctx, -28, -16, 10, 32, 2);
    ctx.fill();
    ctx.strokeStyle = hasSubBat ? '#5eead4' : '#475569';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (hasSubBat) {
      ctx.fillStyle = '#5eead4';
      ctx.fillRect(-25, -10, 4, 6);
      ctx.fillRect(-25, 4, 4, 6);
    }

    // Part 2: BALLAST_PUMP — Aft Starboard Trim Manifold
    ctx.fillStyle = hasBallast ? '#0369a1' : '#090d14';
    traceRoundedRect(ctx, 18, 18, 11, 26, 2);
    ctx.fill();
    ctx.strokeStyle = hasBallast ? '#38bdf8' : '#475569';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Part 3: DIVE_KEY — Conning Periscope & Helm Console Beacon
    ctx.fillStyle = hasDiveKey ? '#064e3b' : '#090d14';
    ctx.beginPath();
    ctx.arc(0, -4, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hasDiveKey ? '#34d399' : '#475569';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    if (hasDiveKey) {
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.arc(0, -4, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Floodgate Lever floor beacon ring
    ctx.strokeStyle =
      esc.submarineState === 'READY'
        ? 'rgba(52, 211, 153, 0.75)'
        : esc.submarineParts.length === 3
          ? `rgba(45, 212, 191, ${0.45 + 0.35 * Math.sin(timeSec * 6)})`
          : 'rgba(148, 163, 184, 0.32)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(subPos.leverX, subPos.leverY, 26, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  private drawWorldPickups(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    timeSec: number,
    deckOverride?: ShipDeck,
    width = 1280,
    height = 720,
    zoom = 1.25,
    camX = engine.cameraX,
    camY = engine.cameraY
  ): void {
    const deck = deckOverride ?? engine.getCurrentDeck();
    const halfW = width / (2 * zoom) + 80;
    const halfH = height / (2 * zoom) + 80;
    for (const wp of engine.worldPickups) {
      if (wp.deck !== deck) continue;
      if (Math.abs(wp.x - camX) > halfW || Math.abs(wp.y - camY) > halfH) continue;
      const pulse = 1 + Math.sin(timeSec * 5 + wp.id) * 0.14;
      ctx.save();
      ctx.translate(wp.x, wp.y);

      // Ground halo ring so dropped items stay readable in torchlight
      ctx.strokeStyle =
        wp.item === 'BACKPACK'
          ? 'rgba(249, 115, 22, 0.72)'
          : wp.item === 'AVIATION_FUEL' || wp.item === 'IGNITION_KEY' || wp.item === 'ROTOR_FUSE'
            ? 'rgba(251, 191, 36, 0.65)'
            : wp.item === 'WINCH_CRANK' || wp.item === 'MARINE_BATTERY' || wp.item === 'HULL_PATCH'
              ? 'rgba(56, 189, 248, 0.65)'
              : wp.item === 'SUB_BATTERY' || wp.item === 'BALLAST_PUMP' || wp.item === 'DIVE_KEY'
                ? 'rgba(45, 212, 191, 0.68)'
                : 'rgba(163, 230, 53, 0.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, 12 * pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(1, 2, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      if (wp.item === 'BACKPACK') {
        // Rugged Expedition Rucksack
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
      } else if (wp.item === 'AVIATION_FUEL') {
        ctx.fillStyle = '#dc2626';
        traceRoundedRect(ctx, -6, -7, 12, 14, 2);
        ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(1, -9, 4, 3);
      } else if (wp.item === 'IGNITION_KEY' || wp.item === 'DIVE_KEY') {
        ctx.strokeStyle = wp.item === 'DIVE_KEY' ? '#2dd4bf' : '#fbbf24';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-3, 0, 3.5, 0, Math.PI * 2);
        ctx.moveTo(0.5, 0);
        ctx.lineTo(7, 0);
        ctx.lineTo(7, 3);
        ctx.stroke();
      } else if (wp.item === 'ROTOR_FUSE') {
        ctx.fillStyle = '#1e293b';
        traceRoundedRect(ctx, -7, -4, 14, 8, 2);
        ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(-7, -3, 3, 6);
        ctx.fillRect(4, -3, 3, 6);
        ctx.fillStyle = '#34d399';
        ctx.fillRect(-2, -1.5, 4, 3);
      } else if (wp.item === 'HULL_PATCH') {
        ctx.fillStyle = '#475569';
        traceRoundedRect(ctx, -7, -6, 14, 12, 1.5);
        ctx.fill();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (wp.item === 'WINCH_CRANK') {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
        ctx.moveTo(0, 0);
        ctx.lineTo(7, -4);
        ctx.stroke();
      } else if (wp.item === 'MARINE_BATTERY' || wp.item === 'SUB_BATTERY') {
        ctx.fillStyle = wp.item === 'SUB_BATTERY' ? '#0f766e' : '#0369a1';
        traceRoundedRect(ctx, -6, -6, 12, 12, 1.5);
        ctx.fill();
        ctx.fillStyle = wp.item === 'SUB_BATTERY' ? '#5eead4' : '#38bdf8';
        ctx.fillRect(-4, -8, 3, 2);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(1, -8, 3, 2);
      } else if (wp.item === 'BALLAST_PUMP') {
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
        // General Tool Drop
        ctx.fillStyle =
          wp.item === 'FLARE'
            ? '#fb7185'
            : wp.item === 'GLOWSTICK'
              ? '#34d399'
              : wp.item === 'FIRE_EXTINGUISHER'
                ? '#ef4444'
                : wp.item === 'BOLT_CUTTERS'
                  ? '#cbd5e1'
                  : '#a3e635';
        traceRoundedRect(ctx, -6, -3, 12, 6, 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  private drawContainers(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number,
    camX = engine.cameraX,
    camY = engine.cameraY
  ): void {
    const halfW = width / (2 * zoom) + 70;
    const halfH = height / (2 * zoom) + 70;
    for (const c of engine.map.containers) {
      if (Math.abs(c.x - camX) > halfW || Math.abs(c.y - camY) > halfH) continue;
      this.drawSingleContainer(ctx, c);
    }
  }

  private drawSingleContainer(ctx: CanvasRenderingContext2D, c: Container): void {
    ctx.save();
    ctx.translate(c.x, c.y);

    if (c.type === 'CABINET') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      traceRoundedRect(ctx, -11, -8, 26, 20, 3);
      ctx.fill();
      ctx.fillStyle = c.searched ? '#1e2530' : '#334155';
      traceRoundedRect(ctx, -13, -10, 26, 20, 3);
      ctx.fill();
      ctx.strokeStyle = c.searched ? '#334155' : '#64748b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (c.type === 'TOOLBOX') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      traceRoundedRect(ctx, -9, -6, 22, 16, 2.5);
      ctx.fill();
      ctx.fillStyle = c.searched ? '#3b1c1c' : '#991b1b';
      traceRoundedRect(ctx, -11, -8, 22, 16, 2.5);
      ctx.fill();
      ctx.strokeStyle = c.searched ? '#475569' : '#fca5a5';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else if (c.type === 'SUPPLY_CRATE') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.44)';
      traceRoundedRect(ctx, -11, -11, 26, 26, 3);
      ctx.fill();
      ctx.fillStyle = c.searched ? '#262018' : '#57422a';
      traceRoundedRect(ctx, -13, -13, 26, 26, 3);
      ctx.fill();
      ctx.strokeStyle = c.searched ? '#3f362a' : '#a17c50';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-11, -11);
      ctx.lineTo(11, 11);
      ctx.stroke();
    } else {
      // DESK
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      traceRoundedRect(ctx, -12, -7, 28, 18, 2.5);
      ctx.fill();
      ctx.fillStyle = c.searched ? '#1e242c' : '#3b4656';
      traceRoundedRect(ctx, -14, -9, 28, 18, 2.5);
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Subtle unsearched latch indicator
    if (!c.searched) {
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-3, -2, 6, 4);
    }
    ctx.restore();
  }

  private drawHidingSpots(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number,
    camX = engine.cameraX,
    camY = engine.cameraY
  ): void {
    const halfW = width / (2 * zoom) + 70;
    const halfH = height / (2 * zoom) + 70;
    for (const s of engine.map.hidingSpots) {
      if (Math.abs(s.x - camX) > halfW || Math.abs(s.y - camY) > halfH) continue;
      this.drawSingleHidingSpot(ctx, s, engine.player.hidingSpotId === s.id);
    }
  }

  private drawSingleHidingSpot(
    ctx: CanvasRenderingContext2D,
    s: HidingSpot,
    isOccupied: boolean
  ): void {
    ctx.save();
    ctx.translate(s.x, s.y);

    const flash = s.checkedFlash;
    if (s.type === 'LOCKER') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
      traceRoundedRect(ctx, -12, -12, 28, 28, 3);
      ctx.fill();
      ctx.fillStyle = flash > 0 ? '#7c2d12' : isOccupied ? '#1e3a5f' : '#283242';
      traceRoundedRect(ctx, -14, -14, 28, 28, 3);
      ctx.fill();
      ctx.strokeStyle = flash > 0 ? '#f97316' : isOccupied ? '#38bdf8' : '#526075';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Louvered vent lines
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.6;
      for (let ly = -7; ly <= 7; ly += 5) {
        ctx.beginPath();
        ctx.moveTo(-8, ly);
        ctx.lineTo(8, ly);
        ctx.stroke();
      }
    } else if (s.type === 'UNDER_DESK') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      traceRoundedRect(ctx, -13, -9, 30, 22, 3);
      ctx.fill();
      ctx.fillStyle = flash > 0 ? '#7c2d12' : isOccupied ? '#1e3a5f' : '#333d4d';
      traceRoundedRect(ctx, -15, -11, 30, 22, 3);
      ctx.fill();
      ctx.strokeStyle = flash > 0 ? '#f97316' : isOccupied ? '#38bdf8' : '#64748b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // CARGO_CRATE hiding spot
      ctx.fillStyle = 'rgba(0, 0, 0, 0.46)';
      traceRoundedRect(ctx, -12, -12, 28, 28, 3);
      ctx.fill();
      ctx.fillStyle = flash > 0 ? '#7c2d12' : isOccupied ? '#1e3a5f' : '#4a3a28';
      traceRoundedRect(ctx, -14, -14, 28, 28, 3);
      ctx.fill();
      ctx.strokeStyle = flash > 0 ? '#f97316' : isOccupied ? '#38bdf8' : '#8a6b48';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawLightSwitches(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    timeSec: number,
    width: number,
    height: number,
    zoom: number,
    camX = engine.cameraX,
    camY = engine.cameraY
  ): void {
    const b = engine.brute;
    const halfW = width / (2 * zoom) + 70;
    const halfH = height / (2 * zoom) + 70;
    for (const sw of engine.map.lightSwitches) {
      if (Math.abs(sw.x - camX) > halfW || Math.abs(sw.y - camY) > halfH) continue;
      const flk = sw.isOn
        ? getRoomLightFlicker(sw.id, timeSec, Math.hypot(b.x - sw.x, b.y - sw.y))
        : { intensity: 1, sputterAmount: 0 };
      ctx.save();
      ctx.translate(sw.x, sw.y);
      ctx.fillStyle = '#1e293b';
      traceRoundedRect(ctx, -7, -7, 14, 14, 2.5);
      ctx.fill();
      ctx.strokeStyle = sw.isOn
        ? `rgba(52, 211, 153, ${(0.45 + 0.55 * flk.intensity).toFixed(2)})`
        : '#64748b';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Toggle lever & status LED
      ctx.fillStyle = sw.isOn
        ? `rgba(52, 211, 153, ${(0.4 + 0.6 * flk.intensity).toFixed(2)})`
        : '#f59e0b';
      ctx.fillRect(-2.5, sw.isOn ? -4 : 1, 5, 3);
      ctx.restore();
    }
  }

  private drawDoors(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number,
    camX = engine.cameraX,
    camY = engine.cameraY
  ): void {
    const ts = engine.map.tileSize;
    const halfW = width / (2 * zoom) + ts * 2;
    const halfH = height / (2 * zoom) + ts * 2;
    for (const d of engine.map.doors) {
      const cx = (d.tx + 0.5) * ts;
      const cy = (d.ty + 0.5) * ts;
      if (Math.abs(cx - camX) > halfW || Math.abs(cy - camY) > halfH) continue;
      ctx.save();
      ctx.translate(cx, cy);

      if (d.isBroken) {
        // Splintered twisted hinge frame
        ctx.fillStyle = '#475569';
        if (d.orientation === 'H') {
          ctx.fillRect(-ts / 2, -3, 8, 6);
          ctx.fillRect(ts / 2 - 8, -3, 8, 6);
        } else {
          ctx.fillRect(-3, -ts / 2, 6, 8);
          ctx.fillRect(-3, ts / 2 - 8, 6, 8);
        }
        ctx.restore();
        continue;
      }

      if (d.orientation === 'V') {
        ctx.rotate(Math.PI / 2);
      }

      // Steel bulkhead threshold strip
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.fillRect(-ts / 2, -6, ts, 12);

      if (d.openProgress > 0.02) {
        // Smooth rotating armored door leaf based on openProgress (0..1)
        ctx.translate(-ts / 2 + 4, 0);
        ctx.rotate(-d.openProgress * 1.38);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        traceRoundedRect(ctx, 1, -2, ts - 8, d.isWatertight ? 9 : 7, 2);
        ctx.fill();
        ctx.fillStyle = d.isLocked ? '#7f1d1d' : d.isWatertight ? '#1e3a4c' : '#526075';
        traceRoundedRect(ctx, 0, d.isWatertight ? -4.5 : -3.5, ts - 8, d.isWatertight ? 9 : 7, 2);
        ctx.fill();
        ctx.strokeStyle = d.isWatertight ? '#22d3ee' : '#94a3b8';
        ctx.lineWidth = d.isWatertight ? 1.5 : 1.1;
        ctx.stroke();
        if (d.isWatertight) {
          // Brass dogging wheel on swung watertight leaf
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc((ts - 8) * 0.5, 0, 3.8, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        const wt = Boolean(d.isWatertight);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        traceRoundedRect(ctx, -ts / 2 + 3, -3, ts - 4, wt ? 11 : 9, 2);
        ctx.fill();
        ctx.fillStyle = d.isLocked ? '#7f1d1d' : wt ? '#1e3a4c' : '#475569';
        traceRoundedRect(ctx, -ts / 2 + 2, wt ? -5.5 : -4.5, ts - 4, wt ? 11 : 9, 2);
        ctx.fill();
        ctx.strokeStyle = d.isLocked ? '#ef4444' : wt ? '#22d3ee' : '#94a3b8';
        ctx.lineWidth = wt ? 1.9 : 1.5;
        ctx.stroke();
        // Porthole / reinforcement bar
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(-8, -2, 16, 4);
        if (wt && !d.isLocked) {
          // Heavy brass dogging handwheel + bolted ribs
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(-ts / 2 + 4, -4, 3, 8);
          ctx.fillRect(ts / 2 - 7, -4, 3, 8);
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
        if (d.isLocked) {
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (d.lockCut) {
        // Severed padlock debris left on floor frame (noticeable by Brute)
        ctx.fillStyle = '#991b1b';
        ctx.fillRect(ts / 2 - 9, 7, 5, 4);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(ts / 2 - 4, 8, 3, 3);
      }
      ctx.restore();
    }
  }

  private drawDroppedLights(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    timeSec: number,
    width: number,
    height: number,
    zoom: number,
    camX = engine.cameraX,
    camY = engine.cameraY
  ): void {
    const halfW = width / (2 * zoom) + 70;
    const halfH = height / (2 * zoom) + 70;
    for (const l of engine.droppedLights) {
      if (Math.abs(l.x - camX) > halfW || Math.abs(l.y - camY) > halfH) continue;
      ctx.save();
      if (l.type === 'GLOWSTICK') {
        ctx.fillStyle = '#34d399';
        ctx.translate(l.x, l.y);
        ctx.rotate(0.5);
        ctx.fillRect(-6, -2, 12, 4);
      } else {
        const flicker = 4 + Math.sin(timeSec * 28) * 1.5;
        ctx.fillStyle = '#fb7185';
        ctx.beginPath();
        ctx.arc(l.x, l.y, flicker, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, engine: MonstrumGameEngine): void {
    for (const pt of engine.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    timeSec: number
  ): void {
    const p = engine.player;
    const stride = p.isMoving ? Math.sin(p.walkPhase) : 0;
    const crouchScale = p.crouching ? 0.87 : 1.0;
    const torsoTwist = p.isMoving ? stride * (p.sprinting ? 0.1 : 0.055) : 0;
    const idleBreath = p.isMoving
      ? 0
      : Math.sin(timeSec * (p.exhausted ? 7.2 : 2.5)) * (p.exhausted ? 0.45 : 0.18);
    const hasLight = p.flashlightOn && p.battery > 0;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle + torsoTwist);

    // 1. Ground contact shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.ellipse(-1, 2, 10 * crouchScale, (p.crouching ? 11 : 13.5), 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Articulated steel-toed deck boots stepping during stride
    const drawBoot = (xOff: number, yOff: number) => {
      ctx.fillStyle = '#0f172a';
      traceRoundedRect(ctx, xOff - 3.6, yOff - 2.3, 7.6, 4.6, 1.8);
      ctx.fill();
      ctx.fillStyle = '#334155';
      traceRoundedRect(ctx, xOff + 1.4, yOff - 1.9, 2.5, 3.8, 1.1);
      ctx.fill();
    };
    const leftStride = stride * (p.crouching ? 3.2 : p.sprinting ? 6.2 : 4.8);
    drawBoot(leftStride, -4.4 * crouchScale);
    drawBoot(-leftStride, 4.4 * crouchScale);

    // 3. Strapped canvas utility satchel OR expanded Crew Expedition Backpack
    ctx.save();
    ctx.translate(-5.8 * crouchScale, 0);
    if (p.hasBackpack) {
      // Larger rugged orange-trimmed crew expedition backpack (+2 slots upgrade)
      ctx.fillStyle = '#7c2d12';
      traceRoundedRect(ctx, -6.2, -9.2 * crouchScale, 10, 18.4 * crouchScale, 3);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.fillStyle = '#c2410c';
      traceRoundedRect(ctx, -4.8, -7.2 * crouchScale, 6.2, 14.4 * crouchScale, 2);
      ctx.fill();
      // Twin SOLAS orange straps & bedroll
      ctx.fillStyle = '#fb923c';
      ctx.fillRect(-3.6, -7.5 * crouchScale, 1.8, 15 * crouchScale);
      ctx.fillStyle = '#334155';
      traceRoundedRect(ctx, -7.6, -5.8 * crouchScale, 2.6, 11.6 * crouchScale, 1.2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#1f2d27';
      traceRoundedRect(ctx, -4.4, -7.2 * crouchScale, 7.6, 14.4 * crouchScale, 2.5);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // Canvas pack flap & high-vis survival strap
      ctx.fillStyle = '#2d3f37';
      traceRoundedRect(ctx, -3.5, -5.8 * crouchScale, 4.8, 11.6 * crouchScale, 1.6);
      ctx.fill();
      ctx.fillStyle = p.inventory.length > 1 ? '#d97706' : '#475569';
      ctx.fillRect(-1.8, -5.4 * crouchScale, 1.6, 10.8 * crouchScale);
    }
    ctx.restore();

    // 4. Left arm (counter-swinging in oilskin sleeve with deckhand glove)
    const leftArmForward = -stride * (p.crouching ? 2.4 : p.sprinting ? 5.2 : 3.8);
    ctx.save();
    ctx.translate(leftArmForward * 0.45, -10.5 * crouchScale);
    ctx.rotate(-stride * 0.16);
    ctx.fillStyle = '#1e3a5f';
    traceRoundedRect(ctx, -2.6, -2.4, 8.6, 4.8, 2.2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Deckhand glove
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.arc(6.2, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 5. Right arm braced forward holding heavy-duty marine flashlight
    const rightArmBob = stride * (p.crouching ? 1.2 : 2.1);
    ctx.save();
    ctx.translate(rightArmBob * 0.35, 9.6 * crouchScale);
    ctx.rotate(-0.12 + stride * 0.06);
    ctx.fillStyle = '#1e3a5f';
    traceRoundedRect(ctx, -2.0, -2.4, 9.2, 4.8, 2.2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Gloved hand gripping torch
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.arc(7.2, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Marine flashlight body + flared bezel
    ctx.fillStyle = '#334155';
    traceRoundedRect(ctx, 5.2, -1.7, 7.6, 3.4, 1.0);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(11.6, -2.2, 2.4, 4.4);
    ctx.fillStyle = hasLight ? '#fef08a' : '#1e293b';
    ctx.fillRect(13.8, -1.7, 1.4, 3.4);
    if (hasLight) {
      const lensGlow = ctx.createRadialGradient(14.8, 0, 0.5, 14.8, 0, 6);
      lensGlow.addColorStop(0, 'rgba(254, 249, 195, 0.85)');
      lensGlow.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = lensGlow;
      ctx.beginPath();
      ctx.arc(14.8, 0, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 6. Weathered Maritime Oilskin Deck Jacket Torso
    const shoulderRadiusY = (p.crouching ? 9.8 : 11.8) + idleBreath;
    const torsoRadiusX = (p.crouching ? 7.2 : 7.6) + idleBreath * 0.6;
    const jacketGrad = ctx.createLinearGradient(-7, -shoulderRadiusY, 7, shoulderRadiusY);
    jacketGrad.addColorStop(0, '#1e3a5f');
    jacketGrad.addColorStop(0.5, '#254a78');
    jacketGrad.addColorStop(1, '#172c49');
    ctx.fillStyle = jacketGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, torsoRadiusX, shoulderRadiusY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // High-vis SOLAS maritime reflective shoulder & collar stripes
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.85)';
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2.2, -shoulderRadiusY + 2.3);
    ctx.lineTo(2.4, -shoulderRadiusY + 3.4);
    ctx.moveTo(-2.2, shoulderRadiusY - 2.3);
    ctx.lineTo(2.4, shoulderRadiusY - 3.4);
    ctx.stroke();

    // Jacket storm collar fold
    ctx.fillStyle = '#0f223d';
    ctx.beginPath();
    ctx.ellipse(0.6, 0, 5.2, 6.8 * crouchScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // 7. Sculpted Head with Knit Watch Cap
    const headX = p.crouching ? 2.4 : p.sprinting ? 2.0 : 1.0;
    const headR = p.crouching ? 6.1 : 6.6;

    // Subtle facial/forehead edge under cap brim
    ctx.fillStyle = '#cfa987';
    ctx.beginPath();
    ctx.arc(headX + 1.4, 0, headR * 0.86, -0.7, 0.7);
    ctx.fill();

    // Ribbed knit watch cap crown
    const capGrad = ctx.createRadialGradient(headX - 1.2, -1.2, 1, headX, 0, headR);
    capGrad.addColorStop(0, '#64748b');
    capGrad.addColorStop(0.65, '#334155');
    capGrad.addColorStop(1, '#1e293b');
    ctx.fillStyle = capGrad;
    ctx.beginPath();
    ctx.arc(headX, 0, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Rolled watch-cap cuff band & crown knit seams
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(headX, 0, headR - 1.3, -1.15, 1.15);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(headX - headR * 0.75, 0);
    ctx.lineTo(headX + headR * 0.45, 0);
    ctx.moveTo(headX - 1.2, -headR * 0.65);
    ctx.lineTo(headX - 1.2, headR * 0.65);
    ctx.stroke();

    ctx.restore();
  }

  private drawBrute(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    timeSec: number
  ): void {
    const b = engine.brute;
    // Hidden inside companionway shaft while climbing between decks
    if (b.stairClimbTimer > 0) return;

    const isChasing = b.state === 'CHASE' || b.state === 'SMASH_DOOR';
    const isStalking = b.state === 'STALK' || b.state === 'CHECK_HIDING';
    const isStunned = b.state === 'STUNNED';
    const isLunging =
      b.state === 'SMASH_DOOR' ||
      (b.state === 'CHECK_HIDING' && b.inspectTimer > 0 && b.inspectTimer < 0.72);

    const stride = isStunned ? 0 : Math.sin(b.walkPhase);
    const torsoTwist = isStunned
      ? Math.sin(timeSec * 16) * 0.05
      : stride * (isChasing ? 0.11 : 0.06);
    const ventPulse = isStunned
      ? 0.25
      : 0.65 + 0.35 * Math.sin(timeSec * (isChasing ? 13 : 5.5));

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle + torsoTwist);

    // Ground contact shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
    ctx.beginPath();
    ctx.ellipse(-2, 3, 18, 25, 0, 0, Math.PI * 2);
    ctx.fill();

    // Articulated Arms & Triple Iron Claws (velocity-synced stride or forward door-smash lunge)
    const leftReach = isLunging ? 11 : stride * (isChasing ? 8 : 5);
    const rightReach = isLunging ? 11 : -stride * (isChasing ? 8 : 5);

    const drawClawArm = (side: -1 | 1, reach: number) => {
      ctx.save();
      ctx.translate(reach * 0.5, side * 18);

      // Piston arm joint
      ctx.fillStyle = '#2d1c18';
      ctx.strokeStyle = isChasing ? '#c2410c' : '#573326';
      ctx.lineWidth = 1.6;
      traceRoundedRect(ctx, -4, -4.5, 16 + Math.max(0, reach * 0.35), 9, 3);
      ctx.fill();
      ctx.stroke();

      // Heavy iron gauntlet
      const gx = 12 + reach * 0.45;
      ctx.fillStyle = '#3f241c';
      ctx.beginPath();
      ctx.arc(gx, 0, 6.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isChasing ? '#fb923c' : '#9a3412';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Curved triple iron claws
      ctx.fillStyle = '#cbd5e1';
      for (const cy of [-3.2, 0, 3.2]) {
        ctx.beginPath();
        ctx.moveTo(gx + 3, cy - 1.2);
        ctx.lineTo(gx + 10.5, cy * 0.85);
        ctx.lineTo(gx + 3, cy + 1.2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };

    drawClawArm(-1, leftReach);
    drawClawArm(1, rightReach);

    // Massive Hulking Biomechanical Torso Carapace
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

    // Layered riveted shoulder pauldrons
    ctx.fillStyle = '#2d1c19';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.1;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(0, side * 14.5, 9.5, 6.2, side * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Glowing Molten Vent Fissures along chest/shoulder armor
    const ventAlpha = isChasing ? 0.95 * ventPulse : isStalking ? 0.72 * ventPulse : 0.45 * ventPulse;
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

    // Dorsal spine plates & glowing furnace core
    for (let s = 0; s < 3; s++) {
      const sx = -12 + s * 5.2;
      ctx.fillStyle = `rgba(249, 115, 22, ${ventAlpha * 0.85})`;
      ctx.fillRect(sx - 1.5, -2.5, 3, 5);
      ctx.fillStyle = '#18100f';
      ctx.fillRect(sx - 2.5, -4, 2.2, 8);
    }

    // Armored Furnace Head & Iconic Projector Visor
    ctx.fillStyle = '#191110';
    ctx.beginPath();
    ctx.arc(6, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isChasing ? '#fb923c' : '#9a3412';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Forward brow cowl
    ctx.fillStyle = '#2b1b17';
    ctx.beginPath();
    ctx.arc(8.5, 0, 7.2, -Math.PI * 0.45, Math.PI * 0.45);
    ctx.fill();

    // Twin Blazing Molten Optic Lenses / Projector Slit
    if (!isStunned) {
      ctx.fillStyle = isChasing ? '#ffedd5' : '#fdba74';
      ctx.beginPath();
      ctx.arc(12.5, -3.5, 2.4, 0, Math.PI * 2);
      ctx.arc(12.5, 3.5, 2.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(255, 95, 0, ${0.85 * ventPulse})`;
      ctx.fillRect(10.5, -5.5, 3, 11);
    }

    ctx.restore();
  }

  private findNearestWalkableInRoom(
    engine: MonstrumGameEngine,
    roomId: number,
    targetX: number,
    targetY: number
  ): { x: number; y: number } {
    const { map } = engine;
    const ts = map.tileSize;
    const tTx = Math.max(0, Math.min(map.width - 1, Math.floor(targetX / ts)));
    const tTy = Math.max(0, Math.min(map.height - 1, Math.floor(targetY / ts)));
    if (isTileWalkable(map.tiles[tTy]?.[tTx] ?? 'VOID') && map.roomIdGrid[tTy][tTx] === roomId) {
      return { x: targetX, y: targetY };
    }

    let bestDist = Infinity;
    let bestPt = { x: targetX, y: targetY };
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.roomIdGrid[y][x] !== roomId || !isTileWalkable(map.tiles[y][x])) continue;
        const wx = (x + 0.5) * ts;
        const wy = (y + 0.5) * ts;
        const d = Math.hypot(wx - targetX, wy - targetY);
        if (d < bestDist) {
          bestDist = d;
          bestPt = { x: wx, y: wy };
        }
      }
    }
    return bestPt;
  }

  private getRoomLightFixtures(
    engine: MonstrumGameEngine,
    sw: RoomLightSwitch
  ): Array<{ x: number; y: number; range: number }> {
    const ts = engine.map.tileSize;
    const rm = engine.map.rooms.find((r) => r.id === sw.roomId);
    if (!rm) {
      return [{ x: sw.x, y: sw.y, range: 360 }];
    }

    const rW = (rm.x2 - rm.x1 + 1) * ts;
    const rH = (rm.y2 - rm.y1 + 1) * ts;
    const rcx = ((rm.x1 + rm.x2 + 1) / 2) * ts;
    const rcy = ((rm.y1 + rm.y2 + 1) / 2) * ts;
    const centerPt = this.findNearestWalkableInRoom(engine, sw.roomId, rcx, rcy);
    const range = Math.max(310, Math.hypot(rW, rH) * 0.65 + 175);

    const fixtures: Array<{ x: number; y: number; range: number }> = [
      { x: centerPt.x, y: centerPt.y, range },
    ];

    // Add secondary ceiling fixture for wide rooms so internal props do not cast harsh blind spots
    if (rm.x2 - rm.x1 >= 7) {
      const leftPt = this.findNearestWalkableInRoom(
        engine,
        sw.roomId,
        (rm.x1 + 1.5) * ts,
        rcy
      );
      const rightPt = this.findNearestWalkableInRoom(
        engine,
        sw.roomId,
        (rm.x2 - 0.5) * ts,
        rcy
      );
      if (Math.hypot(leftPt.x - centerPt.x, leftPt.y - centerPt.y) > ts * 1.8) {
        fixtures.push({ x: leftPt.x, y: leftPt.y, range: range * 0.9 });
      }
      if (Math.hypot(rightPt.x - centerPt.x, rightPt.y - centerPt.y) > ts * 1.8) {
        fixtures.push({ x: rightPt.x, y: rightPt.y, range: range * 0.9 });
      }
    }

    return fixtures;
  }

  private computeLitRoomPolygons(
    engine: MonstrumGameEngine,
    timeSec: number
  ): RayLightPoly[] {
    const polys: RayLightPoly[] = [];
    const b = engine.brute;
    for (const sw of engine.map.lightSwitches) {
      if (!sw.isOn) continue;
      const bruteDist = Math.hypot(b.x - sw.x, b.y - sw.y);
      const { intensity, sputterAmount } = getRoomLightFlicker(sw.id, timeSec, bruteDist);
      const fixtures = this.getRoomLightFixtures(engine, sw);
      for (const fx of fixtures) {
        const poly = computeVisibilityPolygon(
          engine.map,
          engine.doorsByTile,
          fx.x,
          fx.y,
          0,
          Math.PI * 2,
          fx.range,
          84
        );
        polys.push({ x: fx.x, y: fx.y, range: fx.range, intensity, sputterAmount, poly });
      }
    }
    return polys;
  }

  private computeBruteBeamPolygon(
    engine: MonstrumGameEngine,
    timeSec: number
  ): BruteBeamData | null {
    const b = engine.brute;
    if (b.stairClimbTimer > 0) return null;

    const isChasing = b.state === 'CHASE' || b.state === 'SMASH_DOOR';
    const isStunned = b.state === 'STUNNED';
    const ox = b.x + Math.cos(b.angle) * 8;
    const oy = b.y + Math.sin(b.angle) * 8;
    const coneWidth = ((isChasing ? 66 : 58) * Math.PI) / 180;
    const range = isStunned ? 175 : isChasing ? 375 : 320;
    const intensity = isStunned
      ? 0.22 + 0.1 * Math.sin(timeSec * 28)
      : isChasing
        ? 1.0
        : 0.85;

    const rayPts = computeVisibilityPolygon(
      engine.map,
      engine.doorsByTile,
      ox,
      oy,
      b.angle - coneWidth / 2,
      coneWidth,
      range,
      72
    );

    return {
      ox,
      oy,
      angle: b.angle,
      range,
      intensity,
      isChasing,
      poly: [{ x: ox, y: oy }, ...rayPts],
    };
  }

  private computeIncomingStairGlow(
    engine: MonstrumGameEngine,
    incomingStairId: string | null,
    timeSec: number
  ): StairGlowData | null {
    if (!incomingStairId) return null;
    const st = engine.map.stairwells.find((s) => s.id === incomingStairId);
    if (!st) return null;
    const range = 195;
    const intensity = 0.72 + 0.28 * Math.sin(timeSec * 10);
    const poly = computeVisibilityPolygon(
      engine.map,
      engine.doorsByTile,
      st.x,
      st.y,
      0,
      Math.PI * 2,
      range,
      64
    );
    return { x: st.x, y: st.y, range, intensity, poly };
  }

  private computeDoorPeekBeam(engine: MonstrumGameEngine): DoorPeekBeamData | null {
    const p = engine.player;
    if (!p.peekingDoorId || p.hidingSpotId !== null || p.battery <= 0) return null;
    const door = engine.map.doors.find(
      (d) => d.id === p.peekingDoorId && !d.isOpen && !d.isBroken
    );
    if (!door) return null;

    const ts = engine.map.tileSize;
    const dcx = (door.tx + 0.5) * ts;
    const dcy = (door.ty + 0.5) * ts;
    const peekAngle = Math.atan2(dcy - p.y, dcx - p.x);
    const crossSign =
      door.orientation === 'H' ? Math.sign(dcy - p.y) || 1 : Math.sign(dcx - p.x) || 1;
    const ox = door.orientation === 'H' ? dcx : dcx + crossSign * 10;
    const oy = door.orientation === 'H' ? dcy + crossSign * 10 : dcy;
    const coneWidth = (40 * Math.PI) / 180;
    const range = 440;
    const poly = computeVisibilityPolygon(
      engine.map,
      engine.doorsByTile,
      ox,
      oy,
      peekAngle - coneWidth / 2,
      coneWidth,
      range,
      44,
      door.ty * engine.map.width + door.tx
    );
    return { ox, oy, range, poly: [{ x: ox, y: oy }, ...poly] };
  }

  private drawWarmLightingTints(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    litRoomPolys: RayLightPoly[],
    bruteBeam: BruteBeamData | null,
    stairGlow: StairGlowData | null,
    doorPeekData: DoorPeekBeamData | null,
    timeSec: number
  ): void {
    for (const lp of litRoomPolys) {
      if (lp.poly.length < 3) continue;
      const g = ctx.createRadialGradient(lp.x, lp.y, 14, lp.x, lp.y, lp.range);
      const warmA0 = (0.145 * lp.intensity).toFixed(3);
      const warmA1 = (0.085 * lp.intensity).toFixed(3);
      if (lp.sputterAmount > 0.35) {
        // Brief aging fluorescent ballast cool-white sag tint during voltage dip
        g.addColorStop(0, `rgba(226, 232, 240, ${warmA0})`);
        g.addColorStop(0.55, `rgba(203, 213, 225, ${warmA1})`);
        g.addColorStop(1, 'rgba(203, 213, 225, 0)');
      } else {
        g.addColorStop(0, `rgba(254, 240, 199, ${warmA0})`);
        g.addColorStop(0.55, `rgba(253, 224, 155, ${warmA1})`);
        g.addColorStop(1, 'rgba(253, 224, 155, 0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(lp.poly[0].x, lp.poly[0].y);
      for (let i = 1; i < lp.poly.length; i++) {
        ctx.lineTo(lp.poly[i].x, lp.poly[i].y);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Iconic Monstrum Brute orange searchlight beam (strictly wall-blocked via raycast)
    if (bruteBeam && bruteBeam.poly.length >= 3) {
      const g = ctx.createRadialGradient(
        bruteBeam.ox,
        bruteBeam.oy,
        6,
        bruteBeam.ox,
        bruteBeam.oy,
        bruteBeam.range
      );
      const a0 = (bruteBeam.isChasing ? 0.44 : 0.34) * bruteBeam.intensity;
      const a1 = (bruteBeam.isChasing ? 0.24 : 0.17) * bruteBeam.intensity;
      g.addColorStop(0, `rgba(255, 195, 105, ${a0})`);
      g.addColorStop(0.5, `rgba(249, 115, 22, ${a1})`);
      g.addColorStop(1, 'rgba(234, 88, 12, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(bruteBeam.poly[0].x, bruteBeam.poly[0].y);
      for (let i = 1; i < bruteBeam.poly.length; i++) {
        ctx.lineTo(bruteBeam.poly[i].x, bruteBeam.poly[i].y);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Pulsing orange stairwell spill when Brute is climbing toward this hatch
    if (stairGlow && stairGlow.poly.length >= 3) {
      const g = ctx.createRadialGradient(stairGlow.x, stairGlow.y, 10, stairGlow.x, stairGlow.y, stairGlow.range);
      g.addColorStop(0, `rgba(255, 140, 30, ${0.42 * stairGlow.intensity})`);
      g.addColorStop(0.55, `rgba(234, 88, 12, ${0.18 * stairGlow.intensity})`);
      g.addColorStop(1, 'rgba(234, 88, 12, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(stairGlow.poly[0].x, stairGlow.poly[0].y);
      for (let i = 1; i < stairGlow.poly.length; i++) {
        ctx.lineTo(stairGlow.poly[i].x, stairGlow.poly[i].y);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Focused flashlight beam projecting past closed door during Q keyhole peek
    if (doorPeekData && doorPeekData.poly.length >= 3) {
      const g = ctx.createRadialGradient(
        doorPeekData.ox,
        doorPeekData.oy,
        6,
        doorPeekData.ox,
        doorPeekData.oy,
        doorPeekData.range
      );
      g.addColorStop(0, 'rgba(254, 249, 224, 0.22)');
      g.addColorStop(0.55, 'rgba(226, 232, 240, 0.09)');
      g.addColorStop(1, 'rgba(226, 232, 240, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(doorPeekData.poly[0].x, doorPeekData.poly[0].y);
      for (let i = 1; i < doorPeekData.poly.length; i++) {
        ctx.lineTo(doorPeekData.poly[i].x, doorPeekData.poly[i].y);
      }
      ctx.closePath();
      ctx.fill();
    }

    for (const l of engine.droppedLights) {
      const r = l.type === 'FLARE' ? 220 + Math.sin(timeSec * 22) * 14 : 140;
      const poly = computeVisibilityPolygon(
        engine.map,
        engine.doorsByTile,
        l.x,
        l.y,
        0,
        Math.PI * 2,
        r,
        56
      );
      if (poly.length < 3) continue;
      const g = ctx.createRadialGradient(l.x, l.y, 4, l.x, l.y, r);
      if (l.type === 'FLARE') {
        g.addColorStop(0, 'rgba(251, 113, 133, 0.24)');
        g.addColorStop(0.6, 'rgba(244, 63, 94, 0.09)');
        g.addColorStop(1, 'rgba(244, 63, 94, 0)');
      } else {
        g.addColorStop(0, 'rgba(52, 211, 153, 0.18)');
        g.addColorStop(0.6, 'rgba(16, 185, 129, 0.07)');
        g.addColorStop(1, 'rgba(16, 185, 129, 0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i].x, poly[i].y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  private renderLightingMask(
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    viewCenterX: number,
    viewCenterY: number,
    zoom: number,
    timeSec: number,
    litRoomPolys: RayLightPoly[],
    bruteBeam: BruteBeamData | null,
    stairGlow: StairGlowData | null,
    doorPeekData: DoorPeekBeamData | null
  ): void {
    const lctx = this.lightCtx;
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, width, height);

    // Pure #000000 OLED/MiniLED darkness mask (100% opaque outside player LoS & lights)
    lctx.fillStyle = '#000000';
    lctx.fillRect(0, 0, width, height);

    lctx.save();
    lctx.translate(viewCenterX, viewCenterY);
    lctx.scale(zoom, zoom);
    lctx.translate(-engine.cameraX, -engine.cameraY);

    const p = engine.player;
    const isHiding = p.hidingSpotId !== null;
    const isPeekingSpot = p.peekingSpotId !== null;

    // A. Build strict Player Line-of-Sight Clip Polygons (nothing outside these can EVER be seen!)
    const sightPolys: Array<Array<{ x: number; y: number }>> = [];

    if (isHiding && !isPeekingSpot) {
      // Unpeeked inside hiding spot: tiny interior awareness only; cannot see lit room outside
      sightPolys.push(
        computeVisibilityPolygon(
          engine.map,
          engine.doorsByTile,
          p.x,
          p.y,
          0,
          Math.PI * 2,
          34,
          28
        )
      );
    } else if (isHiding && isPeekingSpot) {
      // Vent-peeking from hiding spot: tiny locker interior + narrow 54° vent cone
      sightPolys.push(
        computeVisibilityPolygon(
          engine.map,
          engine.doorsByTile,
          p.x,
          p.y,
          0,
          Math.PI * 2,
          32,
          24
        )
      );
      const coneWidth = (54 * Math.PI) / 180;
      sightPolys.push([
        { x: p.x, y: p.y },
        ...computeVisibilityPolygon(
          engine.map,
          engine.doorsByTile,
          p.x,
          p.y,
          p.angle - coneWidth / 2,
          coneWidth,
          460,
          48
        ),
      ]);
    } else {
      // Full 360° player line-of-sight polygon strictly clipped to inner wall edges & closed doors
      const maxSightDist = Math.hypot(width, height) / (2 * zoom) + 260;
      sightPolys.push(
        computeVisibilityPolygon(
          engine.map,
          engine.doorsByTile,
          p.x,
          p.y,
          0,
          Math.PI * 2,
          maxSightDist,
          120
        )
      );
    }

    // Add keyhole peek polygon when peeking a closed door (requires flashlight battery > 0)
    if (doorPeekData) {
      sightPolys.push(doorPeekData.poly);
    }

    this.lastPlayerSightPolys = sightPolys;

    // B. Hard-clip ALL light cutouts to the Player's True Sight Polygon
    lctx.save();
    lctx.beginPath();
    for (const poly of sightPolys) {
      if (poly.length < 3) continue;
      lctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) {
        lctx.lineTo(poly[i].x, poly[i].y);
      }
      lctx.closePath();
    }
    lctx.clip();

    lctx.globalCompositeOperation = 'destination-out';

    // 1. Short 360° close tactile ambient awareness around player (clipped by walls)
    const ambientRadius = isHiding ? 34 : 92;
    const ambGrad = lctx.createRadialGradient(p.x, p.y, 6, p.x, p.y, ambientRadius);
    ambGrad.addColorStop(0, isHiding ? 'rgba(0,0,0,0.86)' : 'rgba(0,0,0,0.9)');
    ambGrad.addColorStop(0.55, isHiding ? 'rgba(0,0,0,0.34)' : 'rgba(0,0,0,0.44)');
    ambGrad.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = ambGrad;
    lctx.beginPath();
    lctx.arc(p.x, p.y, ambientRadius, 0, Math.PI * 2);
    lctx.fill();

    // 2. Raycast Flashlight Cone (or silent ambient vent-peek cutout when hiding in a lit room)
    if (p.flashlightOn && p.battery > 0 && (!isHiding || isPeekingSpot)) {
      const range = isPeekingSpot ? 460 : 520;
      const coneWidth = ((isPeekingSpot ? 54 : 82) * Math.PI) / 180;
      const flicker = p.battery < 18 && Math.sin(timeSec * 37) > 0.72 ? 0.45 : 1.0;

      const conePoly = computeVisibilityPolygon(
        engine.map,
        engine.doorsByTile,
        p.x,
        p.y,
        p.angle - coneWidth / 2,
        coneWidth,
        range,
        72
      );

      const coneGrad = lctx.createRadialGradient(p.x, p.y, 12, p.x, p.y, range);
      coneGrad.addColorStop(0, `rgba(0,0,0,${0.98 * flicker})`);
      coneGrad.addColorStop(0.68, `rgba(0,0,0,${0.82 * flicker})`);
      coneGrad.addColorStop(1, 'rgba(0,0,0,0)');

      lctx.fillStyle = coneGrad;
      lctx.beginPath();
      lctx.moveTo(p.x, p.y);
      for (const pt of conePoly) lctx.lineTo(pt.x, pt.y);
      lctx.closePath();
      lctx.fill();
    } else if (
      isHiding &&
      isPeekingSpot &&
      !p.flashlightOn &&
      engine.isHidingSpotRoomLit(p.hidingSpotId)
    ) {
      const range = 420;
      const coneWidth = (54 * Math.PI) / 180;
      const conePoly = computeVisibilityPolygon(
        engine.map,
        engine.doorsByTile,
        p.x,
        p.y,
        p.angle - coneWidth / 2,
        coneWidth,
        range,
        56
      );
      const ventGrad = lctx.createRadialGradient(p.x, p.y, 12, p.x, p.y, range);
      ventGrad.addColorStop(0, 'rgba(0,0,0,0.74)');
      ventGrad.addColorStop(0.65, 'rgba(0,0,0,0.48)');
      ventGrad.addColorStop(1, 'rgba(0,0,0,0)');

      lctx.fillStyle = ventGrad;
      lctx.beginPath();
      lctx.moveTo(p.x, p.y);
      for (const pt of conePoly) lctx.lineTo(pt.x, pt.y);
      lctx.closePath();
      lctx.fill();
    }

    // 3. Closed-Door Keyhole/Crack Peek Cone
    if (doorPeekData) {
      const { ox, oy, range, poly } = doorPeekData;
      const peekGrad = lctx.createRadialGradient(ox, oy, 10, ox, oy, range);
      peekGrad.addColorStop(0, 'rgba(0,0,0,0.95)');
      peekGrad.addColorStop(0.7, 'rgba(0,0,0,0.74)');
      peekGrad.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = peekGrad;
      lctx.beginPath();
      lctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) lctx.lineTo(poly[i].x, poly[i].y);
      lctx.closePath();
      lctx.fill();
    }

    // 4. Overhead Room Lights & Doorway Spill Cones (flicker-modulated, strictly clipped to player LoS!)
    for (const lp of litRoomPolys) {
      if (lp.poly.length < 3) continue;
      const rGrad = lctx.createRadialGradient(lp.x, lp.y, 20, lp.x, lp.y, lp.range);
      rGrad.addColorStop(0, `rgba(0,0,0,${(0.96 * lp.intensity).toFixed(3)})`);
      rGrad.addColorStop(0.65, `rgba(0,0,0,${(0.78 * lp.intensity).toFixed(3)})`);
      rGrad.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = rGrad;
      lctx.beginPath();
      lctx.moveTo(lp.poly[0].x, lp.poly[0].y);
      for (let i = 1; i < lp.poly.length; i++) lctx.lineTo(lp.poly[i].x, lp.poly[i].y);
      lctx.closePath();
      lctx.fill();
    }

    // 5. Brute Iconic Orange Searchlight Beam (spills around open corners into player LoS, wall-blocked!)
    if (bruteBeam && bruteBeam.poly.length >= 3) {
      const bGrad = lctx.createRadialGradient(
        bruteBeam.ox,
        bruteBeam.oy,
        10,
        bruteBeam.ox,
        bruteBeam.oy,
        bruteBeam.range
      );
      bGrad.addColorStop(0, `rgba(0,0,0,${0.97 * bruteBeam.intensity})`);
      bGrad.addColorStop(0.66, `rgba(0,0,0,${0.76 * bruteBeam.intensity})`);
      bGrad.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = bGrad;
      lctx.beginPath();
      lctx.moveTo(bruteBeam.poly[0].x, bruteBeam.poly[0].y);
      for (let i = 1; i < bruteBeam.poly.length; i++) {
        lctx.lineTo(bruteBeam.poly[i].x, bruteBeam.poly[i].y);
      }
      lctx.closePath();
      lctx.fill();
    }

    // 6. Pulsing Incoming Brute Stairwell Glow (clipped strictly to player LoS!)
    if (stairGlow && stairGlow.poly.length >= 3) {
      const sGrad = lctx.createRadialGradient(
        stairGlow.x,
        stairGlow.y,
        8,
        stairGlow.x,
        stairGlow.y,
        stairGlow.range
      );
      sGrad.addColorStop(0, `rgba(0,0,0,${0.92 * stairGlow.intensity})`);
      sGrad.addColorStop(0.58, `rgba(0,0,0,${0.56 * stairGlow.intensity})`);
      sGrad.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = sGrad;
      lctx.beginPath();
      lctx.moveTo(stairGlow.poly[0].x, stairGlow.poly[0].y);
      for (let i = 1; i < stairGlow.poly.length; i++) {
        lctx.lineTo(stairGlow.poly[i].x, stairGlow.poly[i].y);
      }
      lctx.closePath();
      lctx.fill();
    }

    // 7. Raycasted Dropped Glowsticks & Flares (never bleed behind walls!)
    for (const l of engine.droppedLights) {
      const r = l.type === 'FLARE' ? 220 + Math.sin(timeSec * 22) * 14 : 140;
      const lightPoly = computeVisibilityPolygon(
        engine.map,
        engine.doorsByTile,
        l.x,
        l.y,
        0,
        Math.PI * 2,
        r,
        56
      );
      if (lightPoly.length < 3) continue;
      const g = lctx.createRadialGradient(l.x, l.y, 6, l.x, l.y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.94)');
      g.addColorStop(0.7, 'rgba(0,0,0,0.65)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = g;
      lctx.beginPath();
      lctx.moveTo(lightPoly[0].x, lightPoly[0].y);
      for (let i = 1; i < lightPoly.length; i++) lctx.lineTo(lightPoly[i].x, lightPoly[i].y);
      lctx.closePath();
      lctx.fill();
    }

    // 8. Raycasted Escape Zone Beacons (only visible within player LoS, never through walls)
    const bTx = engine.map.lifeboatPos.tx;
    const bTy = engine.map.lifeboatPos.ty;
    const voidNorth = engine.map.tiles[bTy - 1]?.[bTx] === 'VOID';
    const outSign = voidNorth ? -1 : 1;
    const boatSwing =
      engine.escape.lifeboatState === 'READY'
        ? 1
        : engine.escape.lifeboatState === 'ACTIVATING'
          ? engine.escape.lifeboatActivationProgress
          : 0;
    const hasBoatBattery = engine.escape.lifeboatParts.includes('MARINE_BATTERY');
    const boatBeaconX = engine.map.lifeboatPos.x + 14;
    const boatBeaconY = engine.map.lifeboatPos.y + outSign * boatSwing * 32;

    const beacons = [
      {
        x: boatBeaconX,
        y: boatBeaconY,
        r: hasBoatBattery ? 145 : 115,
        alpha: hasBoatBattery ? 0.85 : 0.65,
      },
      {
        x: engine.map.heliPos.x,
        y: engine.map.heliPos.y,
        r: engine.escape.heliState !== 'IDLE' ? 150 : 120,
        alpha: engine.escape.heliState !== 'IDLE' ? 0.82 : 0.65,
      },
      {
        x: engine.map.submarinePos.x,
        y: engine.map.submarinePos.y,
        r: engine.escape.submarineState !== 'IDLE' ? 165 : 130,
        alpha: engine.escape.submarineState !== 'IDLE' ? 0.85 : 0.68,
      },
    ];
    for (const bc of beacons) {
      const bPoly = computeVisibilityPolygon(
        engine.map,
        engine.doorsByTile,
        bc.x,
        bc.y,
        0,
        Math.PI * 2,
        bc.r,
        40
      );
      if (bPoly.length < 3) continue;
      const g = lctx.createRadialGradient(bc.x, bc.y, 6, bc.x, bc.y, bc.r);
      g.addColorStop(0, `rgba(0,0,0,${bc.alpha})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = g;
      lctx.beginPath();
      lctx.moveTo(bPoly[0].x, bPoly[0].y);
      for (let i = 1; i < bPoly.length; i++) lctx.lineTo(bPoly[i].x, bPoly[i].y);
      lctx.closePath();
      lctx.fill();
    }

    lctx.restore(); // pop LoS clip
    lctx.restore(); // pop camera transform
  }

  private isWithinVentPeekCone(p: MonstrumGameEngine['player'], tx: number, ty: number): boolean {
    const toTarget = Math.atan2(ty - p.y, tx - p.x);
    let diff = toTarget - p.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff) <= (28 * Math.PI) / 180;
  }

  private drawLightSwitchBeacons(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    timeSec: number
  ): void {
    const p = engine.player;
    const b = engine.brute;
    if (p.hidingSpotId !== null && p.peekingSpotId === null) return;
    for (const sw of engine.map.lightSwitches) {
      const dist = Math.hypot(sw.x - p.x, sw.y - p.y);
      if (dist > 460) continue;
      if (p.peekingSpotId !== null && dist > 48 && !this.isWithinVentPeekCone(p, sw.x, sw.y)) {
        continue;
      }
      if (!hasLineOfSightToEntity(engine.map, engine.doorsByTile, p.x, p.y, sw.x, sw.y)) continue;
      const flk = sw.isOn
        ? getRoomLightFlicker(sw.id, timeSec, Math.hypot(b.x - sw.x, b.y - sw.y))
        : { intensity: 1, sputterAmount: 0 };
      ctx.save();
      ctx.fillStyle = sw.isOn
        ? `rgba(52, 211, 153, ${(0.4 + 0.55 * flk.intensity).toFixed(2)})`
        : 'rgba(245, 158, 11, 0.72)';
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawStairwellBeacons(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    incomingStairId: string | null,
    timeSec: number
  ): void {
    const p = engine.player;
    if (p.hidingSpotId !== null && p.peekingSpotId === null) return;
    for (const st of engine.map.stairwells) {
      const dist = Math.hypot(st.x - p.x, st.y - p.y);
      if (dist > 460) continue;
      if (p.peekingSpotId !== null && dist > 48 && !this.isWithinVentPeekCone(p, st.x, st.y)) {
        continue;
      }
      if (!hasLineOfSight(engine.map, engine.doorsByTile, p.x, p.y, st.x, st.y)) continue;
      const isBruteComing = st.id === incomingStairId;
      ctx.save();
      if (isBruteComing) {
        const pulse = 0.65 + 0.35 * Math.sin(timeSec * 10);
        const aura = ctx.createRadialGradient(st.x, st.y, 2, st.x, st.y, 32);
        aura.addColorStop(0, `rgba(255, 130, 20, ${0.75 * pulse})`);
        aura.addColorStop(1, 'rgba(234, 88, 12, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(st.x, st.y, 32, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffedd5';
        ctx.beginPath();
        ctx.arc(st.x, st.y, 3.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = st.direction === 'DOWN' ? 'rgba(56, 189, 248, 0.75)' : 'rgba(251, 191, 36, 0.75)';
        ctx.beginPath();
        ctx.arc(st.x, st.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawStairClimbRing(ctx: CanvasRenderingContext2D, engine: MonstrumGameEngine): void {
    const p = engine.player;
    if (!p.climbingStairId) return;
    const st = engine.map.stairwells.find((s) => s.id === p.climbingStairId);
    if (!st) return;

    const progress = Math.max(0, Math.min(1, p.climbProgress));
    const color = st.direction === 'DOWN' ? '#38bdf8' : '#fbbf24';
    ctx.save();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(st.x, st.y, 30, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(st.x, st.y, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
    ctx.restore();
  }

  private drawBruteEyesInDarkness(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    timeSec: number
  ): void {
    const b = engine.brute;
    const p = engine.player;
    if (b.state === 'STUNNED' || b.stairClimbTimer > 0) return;

    const dist = Math.hypot(b.x - p.x, b.y - p.y);
    if (dist > 620) return;

    // Inside a hiding spot without peeking, you cannot see the Brute's eyes beyond immediate slats
    if (p.hidingSpotId !== null && p.peekingSpotId === null && dist > 48) {
      return;
    }

    let visible = hasLineOfSight(engine.map, engine.doorsByTile, p.x, p.y, b.x, b.y);
    if (visible && p.hidingSpotId !== null && p.peekingSpotId !== null && dist > 48) {
      const toBrute = Math.atan2(b.y - p.y, b.x - p.x);
      let angleDiff = toBrute - p.angle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      if (Math.abs(angleDiff) > (28 * Math.PI) / 180) {
        visible = false;
      }
    }
    if (!visible && p.peekingDoorId) {
      const door = engine.map.doors.find(
        (d) => d.id === p.peekingDoorId && !d.isOpen && !d.isBroken
      );
      if (door) {
        const dcx = (door.tx + 0.5) * engine.map.tileSize;
        const dcy = (door.ty + 0.5) * engine.map.tileSize;
        const peekAngle = Math.atan2(dcy - p.y, dcx - p.x);
        const ox = dcx + Math.cos(peekAngle) * 14;
        const oy = dcy + Math.sin(peekAngle) * 14;
        const toBrute = Math.atan2(b.y - oy, b.x - ox);
        let angleDiff = toBrute - peekAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        if (
          Math.abs(angleDiff) <= (20 * Math.PI) / 180 &&
          Math.hypot(b.x - ox, b.y - oy) <= 430 &&
          hasLineOfSight(engine.map, engine.doorsByTile, ox, oy, b.x, b.y)
        ) {
          visible = true;
        }
      }
    }
    if (!visible) return;

    const isChasing = b.state === 'CHASE' || b.state === 'SMASH_DOOR';
    const isStalking = b.state === 'STALK' || b.state === 'CHECK_HIDING';
    const pulse = 0.75 + Math.sin(timeSec * 10) * 0.2;

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);

    // Glowing ember aura around Brute's visor when in LoS
    const glowRadius = isChasing ? 34 : isStalking ? 26 : 20;
    const glow = ctx.createRadialGradient(12, 0, 1, 12, 0, glowRadius);
    glow.addColorStop(
      0,
      isChasing
        ? `rgba(255, 85, 0, ${0.7 * pulse})`
        : isStalking
          ? `rgba(251, 146, 60, ${0.52 * pulse})`
          : 'rgba(249, 115, 22, 0.36)'
    );
    glow.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(12, 0, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isChasing ? '#ffedd5' : isStalking ? '#fdba74' : '#fb923c';
    ctx.beginPath();
    ctx.arc(12.5, -3.5, 2.4, 0, Math.PI * 2);
    ctx.arc(12.5, 3.5, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawRipples(ctx: CanvasRenderingContext2D, engine: MonstrumGameEngine): void {
    for (const r of engine.ripples) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, r.alpha);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawInteractHalo(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    timeSec: number
  ): void {
    const nearest = engine.findNearestInteractable();
    if (!nearest) return;

    let tx = 0;
    let ty = 0;
    if (nearest.kind === 'CONTAINER') {
      tx = nearest.container.x;
      ty = nearest.container.y;
    } else if (nearest.kind === 'PICKUP') {
      tx = nearest.pickup.x;
      ty = nearest.pickup.y;
    } else if (nearest.kind === 'HIDING') {
      tx = nearest.spot.x;
      ty = nearest.spot.y;
    } else if (nearest.kind === 'PAPER_MAP') {
      tx = nearest.stand.x;
      ty = nearest.stand.y;
    } else if (nearest.kind === 'LIGHT_SWITCH') {
      tx = nearest.lightSwitch.x;
      ty = nearest.lightSwitch.y;
    } else if (nearest.kind === 'STAIRWELL') {
      tx = nearest.stairwell.x;
      ty = nearest.stairwell.y;
    } else if (nearest.kind === 'DOOR') {
      tx = (nearest.door.tx + 0.5) * engine.map.tileSize;
      ty = (nearest.door.ty + 0.5) * engine.map.tileSize;
    } else if (nearest.kind === 'ESCAPE_LIFEBOAT') {
      tx = engine.map.lifeboatPos.x;
      ty = engine.map.lifeboatPos.y;
    } else if (nearest.kind === 'ESCAPE_HELI') {
      tx = engine.map.heliPos.x;
      ty = engine.map.heliPos.y;
    } else if (nearest.kind === 'ESCAPE_SUBMARINE') {
      tx =
        nearest.subTarget === 'LEVER'
          ? engine.map.submarinePos.leverX
          : engine.map.submarinePos.x;
      ty =
        nearest.subTarget === 'LEVER'
          ? engine.map.submarinePos.leverY
          : engine.map.submarinePos.y;
    }

    const pulse = 18 + Math.sin(timeSec * 6) * 2.5;
    ctx.save();
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.72)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(tx, ty, pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawDebugOverlays(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number
  ): void {
    const cfg = engine.debugConfig;
    const halfW = width / (2 * zoom) + 80;
    const halfH = height / (2 * zoom) + 80;

    if (cfg.showWallSegments) {
      const segs = getLocalOccluders(
        engine.map,
        engine.doorsByTile,
        engine.cameraX - halfW,
        engine.cameraY - halfH,
        engine.cameraX + halfW,
        engine.cameraY + halfH
      );
      ctx.save();
      ctx.lineWidth = 2;
      for (const s of segs) {
        ctx.strokeStyle = s.kind === 'DOOR' ? 'rgba(251, 191, 36, 0.9)' : 'rgba(244, 63, 94, 0.78)';
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (cfg.showPlayerLos) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
      ctx.lineWidth = 1.4;
      for (const poly of this.lastPlayerSightPolys) {
        if (poly.length < 3) continue;
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i].x, poly[i].y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }

    if (cfg.showBruteFov) {
      const b = engine.brute;
      const senses = getSensesProfile(engine.difficulty, engine.bruteTuning);
      const halfFovRad = (senses.halfFovDeg * Math.PI) / 180;
      const fovRange = 345 * senses.sightMult;
      ctx.save();
      ctx.strokeStyle = 'rgba(249, 115, 22, 0.72)';
      ctx.fillStyle = 'rgba(249, 115, 22, 0.08)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.arc(b.x, b.y, fovRange, b.angle - halfFovRad, b.angle + halfFovRad);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (b.path.length > 0) {
        const ts = engine.map.tileSize;
        ctx.strokeStyle = 'rgba(251, 146, 60, 0.85)';
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        for (const wp of b.path) {
          ctx.lineTo((wp.tx + 0.5) * ts, (wp.ty + 0.5) * ts);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (b.currentInspectSpotId) {
        const spot = engine.map.hidingSpots.find((s) => s.id === b.currentInspectSpotId);
        if (spot) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(spot.x - 18, spot.y - 18, 36, 36);
        }
      }
      ctx.restore();
    }

    if (cfg.showBlackProbes && engine.debugProbePoints.length > 0) {
      ctx.save();
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let idx = 0; idx < engine.debugProbePoints.length; idx++) {
        const pt = engine.debugProbePoints[idx];
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.85)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(pt.x - 9, pt.y);
        ctx.lineTo(pt.x - 4, pt.y);
        ctx.moveTo(pt.x + 4, pt.y);
        ctx.lineTo(pt.x + 9, pt.y);
        ctx.moveTo(pt.x, pt.y - 9);
        ctx.lineTo(pt.x, pt.y - 4);
        ctx.moveTo(pt.x, pt.y + 4);
        ctx.lineTo(pt.x, pt.y + 9);
        ctx.stroke();
        const labelOffsetY = idx % 2 === 0 ? -16 : 16;
        ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
        ctx.fillText(pt.label, pt.x, pt.y + labelOffsetY);
      }
      ctx.restore();
    }
  }

  private drawStairPeekPortal(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    viewCenterX: number,
    viewCenterY: number,
    zoom: number,
    width: number,
    height: number,
    timeSec: number,
    litRoomPolys: RayLightPoly[],
    bruteBeam: BruteBeamData | null
  ): void {
    const st = engine.map.stairwells.find((s) => s.id === engine.player.peekingStairId);
    const dest = st ? engine.map.stairwells.find((s) => s.id === st.targetStairId) : undefined;
    if (!st || !dest) return;

    const rawPortalX = viewCenterX + (st.x - engine.cameraX) * zoom;
    const rawPortalY = viewCenterY + (st.y - engine.cameraY) * zoom;
    const portalRadius = Math.max(160, Math.min(350, Math.round(240 * zoom)));
    const margin = portalRadius + 16;
    const portalX = Math.max(margin, Math.min(width - margin, rawPortalX));
    const portalY = Math.max(margin, Math.min(height - margin, rawPortalY));
    const viewWorldRadius = portalRadius / zoom + 28;
    const peekRange = Math.min(800, viewWorldRadius);

    // Raycasted Line-of-Sight polygon from the destination landing (walls & closed doors strictly clip to #000000!)
    const destSightPoly = computeVisibilityPolygon(
      engine.map,
      engine.doorsByTile,
      dest.x,
      dest.y,
      0,
      Math.PI * 2,
      peekRange,
      128
    );

    ctx.save();
    ctx.beginPath();
    ctx.arc(portalX, portalY, portalRadius, 0, Math.PI * 2);
    ctx.clip();

    // Pure #000000 abyss behind destination-deck walls
    ctx.fillStyle = '#000000';
    ctx.fillRect(
      portalX - portalRadius,
      portalY - portalRadius,
      portalRadius * 2,
      portalRadius * 2
    );

    if (destSightPoly.length >= 3) {
      ctx.save();
      ctx.translate(portalX, portalY);
      ctx.scale(zoom, zoom);
      ctx.translate(-dest.x, -dest.y);

      // Strict LoS clip on destination deck
      ctx.beginPath();
      ctx.moveTo(destSightPoly[0].x, destSightPoly[0].y);
      for (let i = 1; i < destSightPoly.length; i++) {
        ctx.lineTo(destSightPoly[i].x, destSightPoly[i].y);
      }
      ctx.closePath();
      ctx.clip();

      const worldSpan = viewWorldRadius * 2.2;
      this.drawTiles(ctx, engine, worldSpan, worldSpan, timeSec, 1, dest.x, dest.y);
      this.drawRoomStencils(ctx, engine, worldSpan, worldSpan, 1, dest.x, dest.y);
      this.drawBloodStreaks(ctx, engine, worldSpan, worldSpan, 1, dest.x, dest.y);
      this.drawStairwells(ctx, engine, null, timeSec);
      this.drawBulkheads(ctx, engine, worldSpan, worldSpan, 1, dest.x, dest.y);
      this.drawShipProps(ctx, engine, worldSpan, worldSpan, 1, dest.x, dest.y);
      this.drawSteamPipes(ctx, engine, worldSpan, worldSpan, 1, timeSec, dest.x, dest.y);
      this.drawPaperMaps(ctx, engine, worldSpan, worldSpan, 1, timeSec, dest.x, dest.y);
      this.drawContainers(ctx, engine, worldSpan, worldSpan, 1, dest.x, dest.y);
      this.drawHidingSpots(ctx, engine, worldSpan, worldSpan, 1, dest.x, dest.y);
      this.drawLightSwitches(ctx, engine, timeSec, worldSpan, worldSpan, 1, dest.x, dest.y);
      this.drawDoors(ctx, engine, worldSpan, worldSpan, 1, dest.x, dest.y);
      this.drawDroppedLights(ctx, engine, timeSec, worldSpan, worldSpan, 1, dest.x, dest.y);
      this.drawWorldPickups(ctx, engine, timeSec, dest.deck, worldSpan, worldSpan, 1, dest.x, dest.y);
      this.drawParticles(ctx, engine);

      // Render Brute inside landing portal if on destination deck and inside LoS
      const b = engine.brute;
      const bDist = Math.hypot(b.x - dest.x, b.y - dest.y);
      const bInView =
        b.stairClimbTimer <= 0 &&
        bDist <= peekRange + 28 &&
        hasLineOfSight(engine.map, engine.doorsByTile, dest.x, dest.y, b.x, b.y);
      if (bInView) {
        this.drawBrute(ctx, engine, timeSec);
      }

      // Apply warm tints if lit rooms / Brute searchlight intersect the destination landing
      const destLitPolys = litRoomPolys.filter(
        (lp) => Math.hypot(lp.x - dest.x, lp.y - dest.y) < lp.range + peekRange
      );
      const destBeam =
        bruteBeam && Math.hypot(bruteBeam.ox - dest.x, bruteBeam.oy - dest.y) < bruteBeam.range + peekRange
          ? bruteBeam
          : null;
      this.drawWarmLightingTints(ctx, engine, destLitPolys, destBeam, null, null, timeSec);

      // Shadowed landing visibility falloff (brighter when flashlight ON or destination room lit)
      const hasTorch = engine.player.flashlightOn && engine.player.battery > 0;
      const roomLitNearDest = destLitPolys.some(
        (lp) => Math.hypot(lp.x - dest.x, lp.y - dest.y) < lp.range * 0.9
      );
      const centerShadowAlpha = roomLitNearDest ? 0.05 : hasTorch ? 0.14 : 0.48;
      const midShadowAlpha = roomLitNearDest ? 0.25 : hasTorch ? 0.56 : 0.8;
      const dimGrad = ctx.createRadialGradient(
        dest.x,
        dest.y,
        14,
        dest.x,
        dest.y,
        peekRange
      );
      dimGrad.addColorStop(0, `rgba(0, 0, 0, ${centerShadowAlpha})`);
      dimGrad.addColorStop(0.58, `rgba(0, 0, 0, ${midShadowAlpha})`);
      dimGrad.addColorStop(1, 'rgba(0, 0, 0, 0.96)');
      ctx.fillStyle = dimGrad;
      ctx.fillRect(dest.x - peekRange, dest.y - peekRange, peekRange * 2, peekRange * 2);

      // Re-emphasize glowing Brute eyes & light switch LEDs piercing darkness in destination LoS
      for (const sw of engine.map.lightSwitches) {
        if (Math.hypot(sw.x - dest.x, sw.y - dest.y) <= peekRange) {
          if (hasLineOfSightToEntity(engine.map, engine.doorsByTile, dest.x, dest.y, sw.x, sw.y)) {
            ctx.fillStyle = sw.isOn ? 'rgba(52, 211, 153, 0.9)' : 'rgba(245, 158, 11, 0.85)';
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, 2.3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      if (bInView && b.state !== 'STUNNED') {
        const isChasing = b.state === 'CHASE' || b.state === 'SMASH_DOOR';
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        const eyeGlow = ctx.createRadialGradient(12, 0, 1, 12, 0, isChasing ? 32 : 22);
        eyeGlow.addColorStop(0, isChasing ? 'rgba(255, 85, 0, 0.72)' : 'rgba(249, 115, 22, 0.45)');
        eyeGlow.addColorStop(1, 'rgba(249, 115, 22, 0)');
        ctx.fillStyle = eyeGlow;
        ctx.beginPath();
        ctx.arc(12, 0, isChasing ? 32 : 22, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = isChasing ? '#ffedd5' : '#fdba74';
        ctx.beginPath();
        ctx.arc(12.5, -3.5, 2.4, 0, Math.PI * 2);
        ctx.arc(12.5, 3.5, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.restore(); // pop world transform & LoS clip
    }

    // Soft circular tunnel vignette inside portal
    const portalVignette = ctx.createRadialGradient(
      portalX,
      portalY,
      portalRadius * 0.62,
      portalX,
      portalY,
      portalRadius
    );
    portalVignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    portalVignette.addColorStop(1, 'rgba(0, 0, 0, 0.88)');
    ctx.fillStyle = portalVignette;
    ctx.beginPath();
    ctx.arc(portalX, portalY, portalRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // pop circular clip

    // Crisp outer companionway peephole ring & destination badge
    const accent = st.direction === 'DOWN' ? '#38bdf8' : '#fbbf24';
    ctx.save();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(portalX, portalY, portalRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(portalX, portalY, portalRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Subtle rectangular deck header bar just above portal rim
    const badgeText = `${getDeckLabel(dest.deck).toUpperCase()} · ${dest.room.toUpperCase()}`;
    ctx.font = '600 11px "JetBrains Mono", monospace';
    const textW = ctx.measureText(badgeText).width;
    const boxW = textW + 18;
    const boxH = 22;
    const boxX = portalX - boxW / 2;
    const boxY = Math.max(8, portalY - portalRadius - 14);
    ctx.fillStyle = 'rgba(7, 10, 15, 0.94)';
    traceRoundedRect(ctx, boxX, boxY, boxW, boxH, 3);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, portalX, boxY + boxH / 2 + 0.5);
    ctx.restore();
  }

  private drawVignetteAndDanger(
    ctx: CanvasRenderingContext2D,
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number,
    timeSec: number
  ): void {
    const bruteDist = engine.getEffectiveBruteDistance();
    const isChasing = engine.brute.state === 'CHASE' || engine.brute.state === 'SMASH_DOOR';
    const prox = Math.max(0, 1 - bruteDist / 450);

    const redBoost = isChasing
      ? 0.28 + Math.sin(timeSec * 10) * 0.08
      : prox > 0.25
        ? (prox - 0.25) * 0.24
        : 0;

    // Pure black edge vignette so unseen OLED/MiniLED pixels remain strictly #000000
    const grad = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.34,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.74
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.82)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Clip red danger/chase pulse + steam condensation fog strictly inside player sight polygons
    const steamFog = engine.player.steamFogAlpha;
    if ((redBoost > 0 || engine.spotFlashAlpha > 0 || steamFog > 0.01) && this.lastPlayerSightPolys.length > 0) {
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-engine.cameraX, -engine.cameraY);
      ctx.beginPath();
      for (const poly of this.lastPlayerSightPolys) {
        if (poly.length < 3) continue;
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i].x, poly[i].y);
        }
        ctx.closePath();
      }
      ctx.clip();
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      if (steamFog > 0.01) {
        const fogGrad = ctx.createRadialGradient(
          width / 2,
          height / 2,
          Math.min(width, height) * 0.06,
          width / 2,
          height / 2,
          Math.max(width, height) * 0.72
        );
        fogGrad.addColorStop(0, `rgba(226, 232, 240, ${(steamFog * 0.56).toFixed(3)})`);
        fogGrad.addColorStop(0.55, `rgba(203, 213, 225, ${(steamFog * 0.68).toFixed(3)})`);
        fogGrad.addColorStop(1, `rgba(148, 163, 184, ${(steamFog * 0.74).toFixed(3)})`);
        ctx.fillStyle = fogGrad;
        ctx.fillRect(0, 0, width, height);
      }

      if (redBoost > 0) {
        const dGrad = ctx.createRadialGradient(
          width / 2,
          height / 2,
          Math.min(width, height) * 0.12,
          width / 2,
          height / 2,
          Math.max(width, height) * 0.65
        );
        dGrad.addColorStop(0, 'rgba(185, 15, 10, 0)');
        dGrad.addColorStop(1, `rgba(185, 15, 10, ${Math.min(0.45, redBoost)})`);
        ctx.fillStyle = dGrad;
        ctx.fillRect(0, 0, width, height);
      }

      if (engine.spotFlashAlpha > 0) {
        ctx.fillStyle = `rgba(234, 88, 12, ${engine.spotFlashAlpha * 0.25})`;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }
  }
}

export function getRoomGuidanceLabel(room: RoomName): string {
  switch (room) {
    case 'Lifeboat Davit':
      return 'Deck 2 Lifeboat Davit';
    case 'Helideck':
      return 'Deck 3 Stern Helideck';
    case 'Submarine Bay':
      return 'Deck 1 Submarine Bay';
    default:
      return room;
  }
}
