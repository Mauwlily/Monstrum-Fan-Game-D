import * as THREE from 'three/webgpu';
import { MonstrumGameEngine } from './engine';
import { isTileWalkable } from './mapGen';
import {
  DOOR_HEIGHT_PX,
  Door,
  SHIP_DECK_ORDER,
  ShipDeck,
  ShipMap,
  WALL_HEIGHT_RATIO,
} from './types';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Unable to create offscreen structural canvas');
  return [c, ctx];
}

function makeWallTexture(anisotropy: number): THREE.CanvasTexture {
  const w = 128;
  const h = 160;
  const [c, ctx] = makeCanvas(w, h);

  // Base industrial painted freighter bulkhead steel
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#1e2938');
  bg.addColorStop(0.18, '#2d3c52');
  bg.addColorStop(0.58, '#263346');
  bg.addColorStop(0.86, '#1c2635');
  bg.addColorStop(1, '#121924');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Corrugated vertical bulkhead ribs (4 columns per tile)
  const ribW = w / 4;
  for (let i = 0; i < 4; i++) {
    const rx = i * ribW;
    ctx.fillStyle = 'rgba(203, 213, 225, 0.08)';
    ctx.fillRect(rx + 2, 16, 6, h - 32);
    ctx.fillStyle = 'rgba(6, 10, 16, 0.34)';
    ctx.fillRect(rx + ribW - 6, 16, 5, h - 32);
  }

  // Center vertical welded seam + paired rivets
  ctx.fillStyle = 'rgba(7, 11, 18, 0.52)';
  ctx.fillRect(w * 0.5 - 1.5, 0, 3, h);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.fillRect(w * 0.5 + 1.5, 0, 1, h);

  // Top structural girder lip (v near 1.0 -> meets #000000 wall cap cleanly)
  ctx.fillStyle = '#111824';
  ctx.fillRect(0, 0, w, 12);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.fillRect(0, 12, w, 2);

  // Upper horizontal conduit pipe & brackets
  ctx.fillStyle = '#090e16';
  ctx.fillRect(0, 24, w, 9);
  ctx.fillStyle = '#475569';
  ctx.fillRect(0, 25, w, 5);
  ctx.fillStyle = 'rgba(226, 232, 240, 0.2)';
  ctx.fillRect(0, 25, w, 1.5);
  for (const bx of [16, 64, 112]) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(bx - 3, 22, 6, 12);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(bx - 1, 24, 2, 8);
  }

  // Mid-wall warning/stiffener band + lower cable conduit
  ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.fillRect(0, 96, w, 6);
  ctx.fillStyle = 'rgba(100, 116, 139, 0.25)';
  ctx.fillRect(0, 97, w, 2);

  // Heavy lower kickplate / floor baseboard (v near 0.0 -> meets z = 0 floor cleanly)
  ctx.fillStyle = '#141c28';
  ctx.fillRect(0, h - 24, w, 24);
  ctx.fillStyle = '#334155';
  ctx.fillRect(0, h - 25, w, 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, h - 5, w, 5);

  // Subtle grime & rust weathering patches near lower welds and joints
  const rg = ctx.createRadialGradient(w * 0.5, h - 26, 2, w * 0.5, h - 26, 24);
  rg.addColorStop(0, 'rgba(124, 45, 18, 0.26)');
  rg.addColorStop(1, 'rgba(124, 45, 18, 0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, h - 56, w, 56);

  // Brushed metal streaks & fine rivets
  let s = 419;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 65; i++) {
    const x = rng() * w;
    const y = rng() * h;
    ctx.fillStyle = rng() > 0.5 ? 'rgba(203, 213, 225, 0.045)' : 'rgba(2, 6, 12, 0.16)';
    ctx.fillRect(x, y, 6 + rng() * 14, 1);
  }

  const drawRivet = (rx: number, ry: number) => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.arc(rx + 0.6, ry + 0.6, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.42)';
    ctx.beginPath();
    ctx.arc(rx, ry, 1.15, 0, Math.PI * 2);
    ctx.fill();
  };
  for (let rx = 10; rx < w; rx += 22) {
    drawRivet(rx, 8);
    drawRivet(rx, h - 14);
  }
  for (let ry = 20; ry < h - 26; ry += 22) {
    drawRivet(w * 0.5 - 5, ry);
    drawRivet(w * 0.5 + 5, ry);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function makeDoorLeafTexture(
  kind: 'normal' | 'locked' | 'watertight',
  anisotropy: number
): THREE.CanvasTexture {
  const w = 128;
  const h = 160;
  const [c, ctx] = makeCanvas(w, h);

  const baseTop = kind === 'locked' ? '#4f1f27' : kind === 'watertight' ? '#243c4d' : '#3a4a61';
  const baseBot = kind === 'locked' ? '#2e1116' : kind === 'watertight' ? '#162532' : '#222d3d';
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, baseTop);
  g.addColorStop(1, baseBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Outer perimeter bevel trim
  ctx.strokeStyle =
    kind === 'watertight'
      ? '#38bdf8'
      : kind === 'locked'
        ? '#f87171'
        : 'rgba(148, 163, 184, 0.48)';
  ctx.lineWidth = kind === 'watertight' ? 6 : 4;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  if (kind === 'normal') {
    // Upper recessed vision slit + lower panel & louver ribs
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(36, 20, 56, 28);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.strokeRect(36, 20, 56, 28);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
    ctx.fillRect(39, 23, 50, 22);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.fillRect(20, 62, w - 40, h - 82);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(20, 62, w - 40, h - 82);
    for (let y = 100; y < h - 24; y += 7) {
      ctx.fillStyle = 'rgba(9, 13, 20, 0.72)';
      ctx.fillRect(28, y, w - 56, 3);
    }
  } else if (kind === 'locked') {
    // Reinforced vault bulkhead cross-plates + lower amber/crimson hazard band (clear of top brace)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.56)';
    ctx.fillRect(14, 18, w - 28, h - 38);
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 18, w - 28, h - 38);

    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(12, 92, w - 24, 18);
    for (let sx = 12; sx < w - 20; sx += 16) {
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(sx, 94, 7, 14);
    }
  } else {
    // Watertight bulkhead hatch inset coaming + dogging rim
    ctx.fillStyle = '#1b2c39';
    ctx.fillRect(16, 16, w - 32, h - 32);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.58)';
    ctx.lineWidth = 3;
    ctx.strokeRect(16, 16, w - 32, h - 32);
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(25, 25, w - 50, h - 50);
  }

  // Kickplate at bottom
  ctx.fillStyle = 'rgba(9, 13, 20, 0.68)';
  ctx.fillRect(4, h - 18, w - 8, 14);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

interface DeckWallMeshes {
  deck: ShipDeck;
  sidesGeom: THREE.BufferGeometry;
  capsGeom: THREE.BufferGeometry;
  worldSides: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  worldCaps: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  losCaps: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  maskCaps: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

function buildDeckWallMeshes(
  map: ShipMap,
  deck: ShipDeck,
  wallHeight: number,
  sidesMat: THREE.MeshBasicMaterial,
  capMat: THREE.MeshBasicMaterial
): DeckWallMeshes {
  const { width, tileSize: ts, tiles } = map;
  const bounds = map.deckBounds[deck];
  const yStart = bounds.y1;
  const yEnd = bounds.y2;

  const capPos: number[] = [];
  const capNorm: number[] = [];

  for (let ty = yStart; ty <= yEnd; ty++) {
    let runStart = -1;
    const flushCap = (endTx: number) => {
      if (runStart < 0 || endTx <= runStart) return;
      const x0 = runStart * ts;
      const x1 = endTx * ts;
      const yTop = -(ty * ts);
      const yBot = -((ty + 1) * ts);
      // CCW facing +Z: (x0,yBot) -> (x1,yBot) -> (x1,yTop) and (x0,yBot) -> (x1,yTop) -> (x0,yTop)
      capPos.push(
        x0, yBot, wallHeight,
        x1, yBot, wallHeight,
        x1, yTop, wallHeight,
        x0, yBot, wallHeight,
        x1, yTop, wallHeight,
        x0, yTop, wallHeight
      );
      for (let i = 0; i < 6; i++) capNorm.push(0, 0, 1);
      runStart = -1;
    };

    for (let tx = 0; tx < width; tx++) {
      if (tiles[ty][tx] === 'WALL') {
        if (runStart < 0) runStart = tx;
      } else {
        flushCap(tx);
      }
    }
    flushCap(width);
  }

  const capsGeom = new THREE.BufferGeometry();
  capsGeom.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
  capsGeom.setAttribute('normal', new THREE.Float32BufferAttribute(capNorm, 3));

  const sidePos: number[] = [];
  const sideNorm: number[] = [];
  const sideUv: number[] = [];
  const sideCol: number[] = [];

  const getTile = (tx: number, ty: number) => {
    if (tx < 0 || tx >= width || ty < yStart || ty > yEnd) return 'VOID';
    return tiles[ty][tx];
  };

  const pushWallQuad = (
    ax2d: number,
    ay2d: number,
    bx2d: number,
    by2d: number,
    nx2d: number,
    ny2d: number,
    lenTiles: number,
    isOuterHull: boolean
  ) => {
    // Outward 3D normal = (nx2d, -ny2d, 0)
    const dirShade = ny2d > 0 ? 1.0 : nx2d > 0 ? 0.86 : nx2d < 0 ? 0.82 : 0.74;
    const hullR = isOuterHull ? 0.92 : 1.0;
    const hullG = isOuterHull ? 0.96 : 1.0;
    const hullB = isOuterHull ? 1.04 : 1.0;
    const botMult = 0.58 * dirShade;
    const topMult = 1.04 * dirShade;

    const br = hullR * botMult;
    const bg = hullG * botMult;
    const bb = hullB * botMult;
    const tr = hullR * topMult;
    const tg = hullG * topMult;
    const tb = hullB * topMult;

    const ax = ax2d;
    const ay = -ay2d;
    const bx = bx2d;
    const by = -by2d;
    const threeNx = nx2d;
    const threeNy = -ny2d;

    // A0 -> B0 -> B1, A0 -> B1 -> A1 (verified outward CCW)
    sidePos.push(
      ax, ay, 0,
      bx, by, 0,
      bx, by, wallHeight,
      ax, ay, 0,
      bx, by, wallHeight,
      ax, ay, wallHeight
    );
    for (let i = 0; i < 6; i++) sideNorm.push(threeNx, threeNy, 0);
    sideUv.push(
      0, 0,
      lenTiles, 0,
      lenTiles, 1,
      0, 0,
      lenTiles, 1,
      0, 1
    );
    sideCol.push(
      br, bg, bb,
      br, bg, bb,
      tr, tg, tb,
      br, bg, bb,
      tr, tg, tb,
      tr, tg, tb
    );
  };

  // Horizontal boundaries y = yStart .. yEnd + 1 (merged per facing & interior/exterior run)
  for (let y = yStart; y <= yEnd + 1; y++) {
    const wy = y * ts;
    let runStart = -1;
    let runMode = 0; // 1: South-facing (wall above, open below), 2: North-facing (open above, wall below)
    let runOuter = false;

    const flush = (endX: number) => {
      if (runStart >= 0 && endX > runStart) {
        const lenTiles = endX - runStart;
        if (runMode === 1) {
          // South-facing (nx=0, ny=+1): A = left -> B = right
          pushWallQuad(runStart * ts, wy, endX * ts, wy, 0, 1, lenTiles, runOuter);
        } else {
          // North-facing (nx=0, ny=-1): A = right -> B = left
          pushWallQuad(endX * ts, wy, runStart * ts, wy, 0, -1, lenTiles, runOuter);
        }
      }
      runStart = -1;
      runMode = 0;
    };

    for (let x = 0; x < width; x++) {
      const above = getTile(x, y - 1);
      const below = getTile(x, y);
      const aboveWall = above === 'WALL';
      const belowWall = below === 'WALL';
      const mode = aboveWall && !belowWall ? 1 : !aboveWall && belowWall ? 2 : 0;
      const isOuter = mode === 1 ? below === 'VOID' : mode === 2 ? above === 'VOID' : false;
      if (mode !== runMode || isOuter !== runOuter) {
        flush(x);
        if (mode !== 0) {
          runStart = x;
          runMode = mode;
          runOuter = isOuter;
        }
      }
    }
    flush(width);
  }

  // Vertical boundaries x = 0 .. width
  for (let x = 0; x <= width; x++) {
    const wx = x * ts;
    let runStart = -1;
    let runMode = 0; // 1: East-facing (wall left, open right), 2: West-facing (open left, wall right)
    let runOuter = false;

    const flush = (endY: number) => {
      if (runStart >= 0 && endY > runStart) {
        const lenTiles = endY - runStart;
        if (runMode === 1) {
          // East-facing (nx=+1, ny=0): A = south (endY) -> B = north (runStart)
          pushWallQuad(wx, endY * ts, wx, runStart * ts, 1, 0, lenTiles, runOuter);
        } else {
          // West-facing (nx=-1, ny=0): A = north (runStart) -> B = south (endY)
          pushWallQuad(wx, runStart * ts, wx, endY * ts, -1, 0, lenTiles, runOuter);
        }
      }
      runStart = -1;
      runMode = 0;
    };

    for (let y = yStart; y <= yEnd; y++) {
      const left = getTile(x - 1, y);
      const right = getTile(x, y);
      const leftWall = left === 'WALL';
      const rightWall = right === 'WALL';
      const mode = leftWall && !rightWall ? 1 : !leftWall && rightWall ? 2 : 0;
      const isOuter = mode === 1 ? right === 'VOID' : mode === 2 ? left === 'VOID' : false;
      if (mode !== runMode || isOuter !== runOuter) {
        flush(y);
        if (mode !== 0) {
          runStart = y;
          runMode = mode;
          runOuter = isOuter;
        }
      }
    }
    flush(yEnd + 1);
  }

  const sidesGeom = new THREE.BufferGeometry();
  sidesGeom.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
  sidesGeom.setAttribute('normal', new THREE.Float32BufferAttribute(sideNorm, 3));
  sidesGeom.setAttribute('uv', new THREE.Float32BufferAttribute(sideUv, 2));
  sidesGeom.setAttribute('color', new THREE.Float32BufferAttribute(sideCol, 3));

  const worldSides = new THREE.Mesh(sidesGeom, sidesMat);
  worldSides.frustumCulled = false;
  worldSides.renderOrder = 2;

  const worldCaps = new THREE.Mesh(capsGeom, capMat);
  worldCaps.frustumCulled = false;
  worldCaps.renderOrder = 4;

  const losCaps = new THREE.Mesh(capsGeom, capMat);
  losCaps.frustumCulled = false;
  losCaps.renderOrder = 0;

  const maskCaps = new THREE.Mesh(capsGeom, capMat);
  maskCaps.frustumCulled = false;
  maskCaps.renderOrder = 0;

  return {
    deck,
    sidesGeom,
    capsGeom,
    worldSides,
    worldCaps,
    losCaps,
    maskCaps,
  };
}

class ClosedDoorBlockerBatch {
  private geom: THREE.BufferGeometry;
  private mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private posAttr: THREE.BufferAttribute;
  private posArr: Float32Array;
  private maxQuads = 128;

  constructor(
    private parent: THREE.Object3D,
    capMat: THREE.MeshBasicMaterial,
    renderOrder: number
  ) {
    this.posArr = new Float32Array(this.maxQuads * 6 * 3);
    this.posAttr = new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', this.posAttr);
    this.geom.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(this.geom, capMat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = renderOrder;
    parent.add(this.mesh);
  }

  private ensureQuads(needed: number): void {
    if (needed <= this.maxQuads) return;
    this.maxQuads = Math.max(this.maxQuads * 2, needed + 32);
    this.posArr = new Float32Array(this.maxQuads * 6 * 3);
    this.posAttr = new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('position', this.posAttr);
  }

  public update(
    map: ShipMap,
    renderDeck: ShipDeck,
    camX: number,
    camY: number,
    halfW: number,
    halfH: number,
    excludeDoorId?: string | null
  ): void {
    const ts = map.tileSize;
    const z = DOOR_HEIGHT_PX + 0.2;
    let quadCount = 0;
    const bounds = map.deckBounds[renderDeck];

    for (let i = 0; i < map.doors.length; i++) {
      const d = map.doors[i];
      if (d.ty < bounds.y1 || d.ty > bounds.y2) continue;
      if (d.isBroken || d.openProgress > 0.35) continue;
      if (excludeDoorId && d.id === excludeDoorId) continue;

      const dcx = (d.tx + 0.5) * ts;
      const dcy = (d.ty + 0.5) * ts;
      if (Math.abs(dcx - camX) > halfW || Math.abs(dcy - camY) > halfH) continue;

      this.ensureQuads(quadCount + 1);
      let idx = quadCount * 18;
      let x0 = 0;
      let x1 = 0;
      let y0 = 0;
      let y1 = 0;

      if (d.orientation === 'H') {
        const signY = camY >= dcy ? 1 : -1;
        const farCenterY = dcy - signY * 3.0;
        x0 = d.tx * ts;
        x1 = (d.tx + 1) * ts;
        y0 = farCenterY - 1.6;
        y1 = farCenterY + 1.6;
      } else {
        const signX = camX >= dcx ? 1 : -1;
        const farCenterX = dcx - signX * 3.0;
        x0 = farCenterX - 1.6;
        x1 = farCenterX + 1.6;
        y0 = d.ty * ts;
        y1 = (d.ty + 1) * ts;
      }

      const tyBot = -y1;
      const tyTop = -y0;
      this.posArr[idx++] = x0; this.posArr[idx++] = tyBot; this.posArr[idx++] = z;
      this.posArr[idx++] = x1; this.posArr[idx++] = tyBot; this.posArr[idx++] = z;
      this.posArr[idx++] = x1; this.posArr[idx++] = tyTop; this.posArr[idx++] = z;
      this.posArr[idx++] = x0; this.posArr[idx++] = tyBot; this.posArr[idx++] = z;
      this.posArr[idx++] = x1; this.posArr[idx++] = tyTop; this.posArr[idx++] = z;
      this.posArr[idx++] = x0; this.posArr[idx++] = tyTop; this.posArr[idx++] = z;
      quadCount++;
    }

    const vertCount = quadCount * 6;
    if (vertCount === 0) {
      this.geom.setDrawRange(0, 0);
      this.mesh.visible = false;
      return;
    }

    this.posAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(0, vertCount * 3);
    this.posAttr.needsUpdate = true;
    this.geom.setDrawRange(0, vertCount);
    this.mesh.visible = true;
  }

  public dispose(): void {
    this.parent.remove(this.mesh);
    this.geom.dispose();
  }
}

interface DoorRig3D {
  door: Door;
  deck: ShipDeck;
  cx: number;
  cy: number;
  root: THREE.Group;
  hingePivot: THREE.Group;
  leafMesh: THREE.Mesh;
  leafTopMesh: THREE.Mesh;
  normalHandles: THREE.Group;
  lockedAttach: THREE.Group;
  watertightAttach: THREE.Group;
  padlockDebris: THREE.Group;
  brokenGroup: THREE.Group;
  lastKind: 'normal' | 'locked' | 'watertight';
}

interface StairRig3D {
  id: string;
  deck: ShipDeck;
  x: number;
  y: number;
  direction: 'UP' | 'DOWN';
  root: THREE.Group;
  trimMat: THREE.MeshBasicMaterial;
  accentMat: THREE.MeshBasicMaterial;
  baseColorHex: number;
  stepBaseHex: number;
  wasComing: boolean;
}

export class ShipStructure3D {
  private map: ShipMap;
  private wallHeight: number;
  private disposed = false;

  // Shared procedural textures
  private wallTex: THREE.CanvasTexture;
  private doorTextures: Record<'normal' | 'locked' | 'watertight', THREE.CanvasTexture>;

  // Shared materials
  private wallSidesMat: THREE.MeshBasicMaterial;
  private blackCapMat: THREE.MeshBasicMaterial;
  private doorLeafMaterials: Record<'normal' | 'locked' | 'watertight', THREE.MeshBasicMaterial>;
  private doorTopCapMaterials: Record<'normal' | 'locked' | 'watertight', THREE.MeshBasicMaterial>;
  private doorJambMat: THREE.MeshBasicMaterial;
  private doorLintelMat: THREE.MeshBasicMaterial;
  private doorBraceMat: THREE.MeshBasicMaterial;
  private doorThresholdMat: THREE.MeshBasicMaterial;
  private steelLightMat: THREE.MeshBasicMaterial;
  private crimsonMat: THREE.MeshBasicMaterial;
  private brassMat: THREE.MeshBasicMaterial;
  private cyanTrimMat: THREE.MeshBasicMaterial;
  private splinterWoodMat: THREE.MeshBasicMaterial;
  private shaftDarkMat: THREE.MeshBasicMaterial;
  private shaftFloorMat: THREE.MeshBasicMaterial;
  private stairStepMat: THREE.MeshBasicMaterial;
  private stairRiserMat: THREE.MeshBasicMaterial;
  private stairRailMat: THREE.MeshBasicMaterial;

  // Disposable structural geometries
  private sharedGeoms: THREE.BufferGeometry[] = [];
  private deckWalls: Map<ShipDeck, DeckWallMeshes> = new Map();
  private doorRigs: DoorRig3D[] = [];
  private stairRigs: StairRig3D[] = [];
  private stairMaterials: THREE.MeshBasicMaterial[] = [];
  private debugWireMaterials: THREE.MeshBasicMaterial[] = [];
  private deck3ExteriorGroup = new THREE.Group();
  private deck3HullMat: THREE.MeshBasicMaterial;
  private deck3RailMat: THREE.MeshBasicMaterial;
  private debugWireframe = false;
  private debugHideWallCaps = false;

  private losDoorBlockers: ClosedDoorBlockerBatch;
  private maskDoorBlockers: ClosedDoorBlockerBatch;
  private incomingWarmCol = new THREE.Color(0xffedd5);
  private incomingWhiteCol = new THREE.Color(0xffffff);

  constructor(
    map: ShipMap,
    anisotropy: number,
    private worldScene: THREE.Scene,
    private losScene: THREE.Scene,
    private lightMaskScene: THREE.Scene
  ) {
    this.map = map;
    this.wallHeight = map.tileSize * WALL_HEIGHT_RATIO;

    this.wallTex = makeWallTexture(anisotropy);
    this.doorTextures = {
      normal: makeDoorLeafTexture('normal', anisotropy),
      locked: makeDoorLeafTexture('locked', anisotropy),
      watertight: makeDoorLeafTexture('watertight', anisotropy),
    };

    this.wallSidesMat = new THREE.MeshBasicMaterial({
      map: this.wallTex,
      vertexColors: true,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: true,
    });
    this.blackCapMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      toneMapped: false,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: true,
    });

    const makeLeafMat = (tex: THREE.CanvasTexture) =>
      new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
      });

    this.doorLeafMaterials = {
      normal: makeLeafMat(this.doorTextures.normal),
      locked: makeLeafMat(this.doorTextures.locked),
      watertight: makeLeafMat(this.doorTextures.watertight),
    };
    this.doorTopCapMaterials = {
      normal: new THREE.MeshBasicMaterial({
        color: 0x64748b,
        depthTest: true,
        depthWrite: true,
      }),
      locked: new THREE.MeshBasicMaterial({
        color: 0xef4444,
        depthTest: true,
        depthWrite: true,
      }),
      watertight: new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        depthTest: true,
        depthWrite: true,
      }),
    };
    this.doorJambMat = new THREE.MeshBasicMaterial({
      color: 0x1e2836,
      depthTest: true,
      depthWrite: true,
    });
    this.doorLintelMat = new THREE.MeshBasicMaterial({
      color: 0x131b26,
      depthTest: true,
      depthWrite: true,
    });
    this.doorBraceMat = new THREE.MeshBasicMaterial({
      color: 0x7f1d1d,
      depthTest: true,
      depthWrite: true,
    });
    this.doorThresholdMat = new THREE.MeshBasicMaterial({
      color: 0x161f2b,
      depthTest: true,
      depthWrite: true,
    });
    this.steelLightMat = new THREE.MeshBasicMaterial({
      color: 0xcbd5e1,
      depthTest: true,
      depthWrite: true,
    });
    this.crimsonMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      depthTest: true,
      depthWrite: true,
    });
    this.brassMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      depthTest: true,
      depthWrite: true,
    });
    this.cyanTrimMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      depthTest: true,
      depthWrite: true,
    });
    this.splinterWoodMat = new THREE.MeshBasicMaterial({
      color: 0x475569,
      depthTest: true,
      depthWrite: true,
    });
    this.shaftDarkMat = new THREE.MeshBasicMaterial({
      color: 0x0b121c,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
    });
    this.shaftFloorMat = new THREE.MeshBasicMaterial({
      color: 0x030508,
      toneMapped: false,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
    });
    this.stairStepMat = new THREE.MeshBasicMaterial({
      color: 0x3b4a5e,
      depthTest: true,
      depthWrite: true,
    });
    this.stairRiserMat = new THREE.MeshBasicMaterial({
      color: 0x18212f,
      depthTest: true,
      depthWrite: true,
    });
    this.stairRailMat = new THREE.MeshBasicMaterial({
      color: 0x94a3b8,
      depthTest: true,
      depthWrite: true,
    });

    this.stairMaterials.push(
      ...([
        // Additional shared stair tone materials will be pushed inside buildStairwells
      ] as THREE.MeshBasicMaterial[])
    );

    this.deck3HullMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
    });
    this.deck3RailMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: true,
    });

    this.debugWireMaterials.push(
      this.wallSidesMat,
      this.blackCapMat,
      this.doorLeafMaterials.normal,
      this.doorLeafMaterials.locked,
      this.doorLeafMaterials.watertight,
      this.doorTopCapMaterials.normal,
      this.doorTopCapMaterials.locked,
      this.doorTopCapMaterials.watertight,
      this.doorJambMat,
      this.doorLintelMat,
      this.doorBraceMat,
      this.doorThresholdMat,
      this.steelLightMat,
      this.crimsonMat,
      this.brassMat,
      this.cyanTrimMat,
      this.splinterWoodMat,
      this.shaftDarkMat,
      this.shaftFloorMat,
      this.stairStepMat,
      this.stairRiserMat,
      this.stairRailMat,
      this.deck3HullMat,
      this.deck3RailMat
    );

    // Build per-deck wall meshes
    for (const deck of SHIP_DECK_ORDER) {
      const dw = buildDeckWallMeshes(map, deck, this.wallHeight, this.wallSidesMat, this.blackCapMat);
      this.deckWalls.set(deck, dw);
      this.worldScene.add(dw.worldSides);
      this.worldScene.add(dw.worldCaps);
      this.losScene.add(dw.losCaps);
      this.lightMaskScene.add(dw.maskCaps);
    }

    this.losDoorBlockers = new ClosedDoorBlockerBatch(this.losScene, this.blackCapMat, 0);
    this.maskDoorBlockers = new ClosedDoorBlockerBatch(this.lightMaskScene, this.blackCapMat, 0);

    this.buildDoors();
    this.buildStairwells();
    this.buildDeck3ExteriorHullAndRailings();
  }

  public setDebugVisualOptions(wireframe: boolean, hideWallCaps: boolean): void {
    this.debugHideWallCaps = hideWallCaps;
    if (this.debugWireframe !== wireframe) {
      this.debugWireframe = wireframe;
      for (const m of this.debugWireMaterials) {
        m.wireframe = wireframe;
        m.needsUpdate = true;
      }
      for (const m of this.stairMaterials) {
        m.wireframe = wireframe;
        m.needsUpdate = true;
      }
    }
  }

  public getStairRotation(id: string): number {
    return this.stairRigs.find((s) => s.id === id)?.root.rotation.z ?? 0;
  }

  private trackGeom<T extends THREE.BufferGeometry>(g: T): T {
    this.sharedGeoms.push(g);
    return g;
  }

  private setRenderOrderRecursive(obj: THREE.Object3D, order: number): void {
    obj.traverse((child) => {
      child.renderOrder = order;
    });
  }

  private buildDoors(): void {
    const ts = this.map.tileSize;
    const dh = DOOR_HEIGHT_PX;
    const wh = this.wallHeight;
    const jambH = wh - 0.15;
    const jambW = 4.6;
    const jambD = 16.4;
    const lintelH = Math.max(4, jambH - dh - 0.4);
    const leafW = ts - 8;
    const leafBodyH = dh - 1.5;

    const threshGeom = this.trackGeom(new THREE.BoxGeometry(ts, 12, 1.4));
    const jambGeom = this.trackGeom(new THREE.BoxGeometry(jambW, jambD, jambH));
    // Twin outer transom header rails bridge dh..wh outside ±6.2 so Top 0° door hardware stays 100% unobstructed
    const lintelRailGeom = this.trackGeom(new THREE.BoxGeometry(ts - jambW * 1.4, 2.0, lintelH));
    const hingeKnuckleGeom = this.trackGeom(new THREE.CylinderGeometry(1.75, 1.75, 4.2, 8));
    hingeKnuckleGeom.rotateX(Math.PI / 2);

    const leafGeom = this.trackGeom(new THREE.BoxGeometry(leafW, 5.2, leafBodyH));
    // Remap BoxGeometry UVs so +/-Y faces are upright (+Z -> v=1 canvas top, -Z -> v=0 canvas bottom)
    const leafPosAttr = leafGeom.getAttribute('position') as THREE.BufferAttribute;
    const leafNormAttr = leafGeom.getAttribute('normal') as THREE.BufferAttribute;
    const leafUvAttr = leafGeom.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < leafPosAttr.count; i++) {
      const ny = leafNormAttr.getY(i);
      if (Math.abs(ny) > 0.5) {
        const px = leafPosAttr.getX(i);
        const pz = leafPosAttr.getZ(i);
        const u = ny < 0 ? px / leafW + 0.5 : 0.5 - px / leafW;
        const v = pz / leafBodyH + 0.5;
        leafUvAttr.setXY(i, u, v);
      }
    }
    leafUvAttr.needsUpdate = true;

    const leafTopGeom = this.trackGeom(new THREE.BoxGeometry(leafW, 5.8, 1.4));
    const handlePlateGeom = this.trackGeom(new THREE.BoxGeometry(3.4, 7.6, 6.2));
    const handleLeverGeom = this.trackGeom(new THREE.BoxGeometry(6.8, 9.4, 1.8));

    const padlockBarGeom = this.trackGeom(new THREE.BoxGeometry(20, 8.2, 4.0));
    const padlockBodyGeom = this.trackGeom(new THREE.BoxGeometry(8.2, 10.2, 7.8));
    const padlockKeyholeGeom = this.trackGeom(new THREE.BoxGeometry(2.4, 10.8, 2.6));
    const padlockShackleGeom = this.trackGeom(new THREE.TorusGeometry(2.6, 0.85, 6, 12, Math.PI));
    padlockShackleGeom.rotateX(Math.PI / 2);

    const wheelRimGeom = this.trackGeom(new THREE.TorusGeometry(6.6, 1.15, 6, 14));
    wheelRimGeom.rotateX(Math.PI / 2);
    const wheelSpokeHGeom = this.trackGeom(new THREE.BoxGeometry(12.8, 1.5, 1.5));
    const wheelSpokeVGeom = this.trackGeom(new THREE.BoxGeometry(1.5, 1.5, 12.8));
    const wheelHubGeom = this.trackGeom(new THREE.CylinderGeometry(2.0, 2.0, 10.8, 8));
    wheelHubGeom.rotateX(Math.PI / 2);
    const gasketBarGeom = this.trackGeom(new THREE.BoxGeometry(2.6, 6.6, dh - 3.5));
    const gasketTopBotGeom = this.trackGeom(new THREE.BoxGeometry(leafW - 2, 6.4, 2.0));

    const debrisBodyGeom = this.trackGeom(new THREE.BoxGeometry(6, 5, 3));
    const debrisShackleGeom = this.trackGeom(new THREE.BoxGeometry(4, 2, 1.5));
    const shearedHingeGeom = this.trackGeom(new THREE.BoxGeometry(5.5, 4.5, 4));
    const fallenLeafGeom = this.trackGeom(new THREE.BoxGeometry(ts - 11, 20, 3.2));
    const splinterBarGeom = this.trackGeom(new THREE.BoxGeometry(14, 4.2, 2.2));

    for (const door of this.map.doors) {
      const deck = this.map.deckGrid[door.ty]?.[door.tx] ?? 'DECK_2';
      const cx = (door.tx + 0.5) * ts;
      const cy = (door.ty + 0.5) * ts;

      const root = new THREE.Group();
      root.position.set(cx, -cy, 0);
      root.rotation.z = door.orientation === 'V' ? -Math.PI / 2 : 0;

      const thresh = new THREE.Mesh(threshGeom, this.doorThresholdMat);
      thresh.position.set(0, 0, 0.7);
      root.add(thresh);

      const leftJamb = new THREE.Mesh(jambGeom, this.doorJambMat);
      leftJamb.position.set(-ts / 2 + jambW * 0.5, 0, jambH * 0.5);
      root.add(leftJamb);

      const rightJamb = new THREE.Mesh(jambGeom, this.doorJambMat);
      rightJamb.position.set(ts / 2 - jambW * 0.5, 0, jambH * 0.5);
      root.add(rightJamb);

      const lintelZ = dh + 0.4 + lintelH * 0.5;
      const lintelFront = new THREE.Mesh(lintelRailGeom, this.doorLintelMat);
      lintelFront.position.set(0, -7.2, lintelZ);
      const lintelBack = new THREE.Mesh(lintelRailGeom, this.doorLintelMat);
      lintelBack.position.set(0, 7.2, lintelZ);
      root.add(lintelFront, lintelBack);

      for (const hz of [10, dh * 0.5, dh - 8]) {
        const knuckle = new THREE.Mesh(hingeKnuckleGeom, this.steelLightMat);
        knuckle.position.set(-ts / 2 + 4.0, 0, hz);
        root.add(knuckle);
      }

      // Hinge pivot
      const hingePivot = new THREE.Group();
      hingePivot.position.set(-ts / 2 + 4, 0, 0);
      root.add(hingePivot);

      const kind: 'normal' | 'locked' | 'watertight' = door.isLocked
        ? 'locked'
        : door.isWatertight
          ? 'watertight'
          : 'normal';

      const leafMesh = new THREE.Mesh(leafGeom, this.doorLeafMaterials[kind]);
      leafMesh.position.set(leafW * 0.5, 0, leafBodyH * 0.5);
      hingePivot.add(leafMesh);

      const leafTopMesh = new THREE.Mesh(leafTopGeom, this.doorTopCapMaterials[kind]);
      leafTopMesh.position.set(leafW * 0.5, 0, dh - 1.1);
      hingePivot.add(leafTopMesh);

      // Normal handles (mounted on upper chest so readable both from angled 3D and top-down)
      const normalHandles = new THREE.Group();
      const plate = new THREE.Mesh(handlePlateGeom, this.doorJambMat);
      plate.position.set(leafW - 6.0, 0, dh * 0.62);
      const lever = new THREE.Mesh(handleLeverGeom, this.steelLightMat);
      lever.position.set(leafW - 7.8, 0, dh * 0.62);
      normalHandles.add(plate, lever);
      hingePivot.add(normalHandles);

      // Locked crimson padlock + two-tone crossbar (clearly visible both overhead and at oblique angle)
      const lockedAttach = new THREE.Group();
      const brace = new THREE.Mesh(padlockBarGeom, this.doorBraceMat);
      brace.position.set(leafW * 0.52, 0, dh * 0.72);
      const lockBody = new THREE.Mesh(padlockBodyGeom, this.crimsonMat);
      lockBody.position.set(leafW * 0.72, 0, dh * 0.72);
      const lockCylinder = new THREE.Mesh(padlockKeyholeGeom, this.brassMat);
      lockCylinder.position.set(leafW * 0.72, 0, dh * 0.72 - 1.1);
      const shackleFront = new THREE.Mesh(padlockShackleGeom, this.steelLightMat);
      shackleFront.position.set(leafW * 0.72, -3.5, dh * 0.72 + 3.8);
      const shackleBack = new THREE.Mesh(padlockShackleGeom, this.steelLightMat);
      shackleBack.position.set(leafW * 0.72, 3.5, dh * 0.72 + 3.8);
      lockedAttach.add(brace, lockBody, lockCylinder, shackleFront, shackleBack);
      hingePivot.add(lockedAttach);

      // Watertight brass 4-spoke wheel + cyan gasket frame
      const watertightAttach = new THREE.Group();
      const gLeft = new THREE.Mesh(gasketBarGeom, this.cyanTrimMat);
      gLeft.position.set(2.2, 0, dh * 0.5);
      const gRight = new THREE.Mesh(gasketBarGeom, this.cyanTrimMat);
      gRight.position.set(leafW - 2.2, 0, dh * 0.5);
      const gTop = new THREE.Mesh(gasketTopBotGeom, this.cyanTrimMat);
      gTop.position.set(leafW * 0.5, 0, dh - 2.5);
      const wheelFront = new THREE.Mesh(wheelRimGeom, this.brassMat);
      wheelFront.position.set(leafW * 0.5, -4.6, dh * 0.64);
      const wheelBack = new THREE.Mesh(wheelRimGeom, this.brassMat);
      wheelBack.position.set(leafW * 0.5, 4.6, dh * 0.64);
      const spokeHF = new THREE.Mesh(wheelSpokeHGeom, this.brassMat);
      spokeHF.position.set(leafW * 0.5, -4.6, dh * 0.64);
      const spokeHB = new THREE.Mesh(wheelSpokeHGeom, this.brassMat);
      spokeHB.position.set(leafW * 0.5, 4.6, dh * 0.64);
      const spokeVF = new THREE.Mesh(wheelSpokeVGeom, this.brassMat);
      spokeVF.position.set(leafW * 0.5, -4.6, dh * 0.64);
      const spokeVB = new THREE.Mesh(wheelSpokeVGeom, this.brassMat);
      spokeVB.position.set(leafW * 0.5, 4.6, dh * 0.64);
      const hub = new THREE.Mesh(wheelHubGeom, this.brassMat);
      hub.position.set(leafW * 0.5, 0, dh * 0.64);
      watertightAttach.add(
        gLeft,
        gRight,
        gTop,
        wheelFront,
        wheelBack,
        spokeHF,
        spokeHB,
        spokeVF,
        spokeVB,
        hub
      );
      hingePivot.add(watertightAttach);

      // Cut padlock debris
      const padlockDebris = new THREE.Group();
      const cutBody = new THREE.Mesh(debrisBodyGeom, this.crimsonMat);
      cutBody.position.set(-5, 9, 1.5);
      cutBody.rotation.z = 0.4;
      const cutShackle = new THREE.Mesh(debrisShackleGeom, this.steelLightMat);
      cutShackle.position.set(2, -9, 1.0);
      cutShackle.rotation.z = -0.6;
      padlockDebris.add(cutBody, cutShackle);
      root.add(padlockDebris);

      // Broken smashed doorway group
      const brokenGroup = new THREE.Group();
      const shLow = new THREE.Mesh(shearedHingeGeom, this.steelLightMat);
      shLow.position.set(-ts / 2 + 5.5, 1, 10);
      shLow.rotation.z = -0.25;
      const shHigh = new THREE.Mesh(shearedHingeGeom, this.steelLightMat);
      shHigh.position.set(-ts / 2 + 5.5, -1.5, dh - 10);
      shHigh.rotation.z = 0.3;
      const fallenLeaf = new THREE.Mesh(fallenLeafGeom, this.splinterWoodMat);
      fallenLeaf.position.set(2, 11, 1.6);
      fallenLeaf.rotation.z = 0.22;
      const splinter1 = new THREE.Mesh(splinterBarGeom, this.doorJambMat);
      splinter1.position.set(-6, -12, 1.4);
      splinter1.rotation.z = -0.45;
      const splinter2 = new THREE.Mesh(splinterBarGeom, this.crimsonMat);
      splinter2.position.set(9, 17, 1.2);
      splinter2.rotation.z = 0.72;
      brokenGroup.add(shLow, shHigh, fallenLeaf, splinter1, splinter2);
      root.add(brokenGroup);

      // CRITICAL: WebGPURenderer sets groupOrder from any traversed Group.renderOrder;
      // enforce renderOrder = 5 on every child Group & Mesh so doors always draw after oceanMesh (0) & floor/walls (2/4).
      this.setRenderOrderRecursive(root, 5);
      root.visible = false;
      this.worldScene.add(root);

      this.doorRigs.push({
        door,
        deck,
        cx,
        cy,
        root,
        hingePivot,
        leafMesh,
        leafTopMesh,
        normalHandles,
        lockedAttach,
        watertightAttach,
        padlockDebris,
        brokenGroup,
        lastKind: kind,
      });
    }
  }

  private getStairApproachRotation(st: ShipMap['stairwells'][number]): number {
    // Local entrance is (0, -1) in Three = South (+Y in 2D).
    // Score each walkable cardinal direction so stairs cleanly face open landing clearance and back onto bulkheads when possible.
    const candidates = [
      { dx: 0, dy: 1, rotZ: 0 },
      { dx: 1, dy: 0, rotZ: Math.PI / 2 },
      { dx: 0, dy: -1, rotZ: Math.PI },
      { dx: -1, dy: 0, rotZ: -Math.PI / 2 },
    ];
    const doorSet = new Set<number>();
    for (const d of this.map.doors) {
      doorSet.add(d.ty * this.map.width + d.tx);
    }

    let bestScore = -Infinity;
    let bestRot = 0;

    for (const c of candidates) {
      const nx = st.tx + c.dx;
      const ny = st.ty + c.dy;
      if (nx < 0 || nx >= this.map.width || ny < 0 || ny >= this.map.height) continue;
      if (!isTileWalkable(this.map.tiles[ny][nx])) continue;

      let score = 0;
      if (!doorSet.has(ny * this.map.width + nx)) score += 4;

      // Measure unobstructed forward clearance along approach vector
      for (let step = 1; step <= 3; step++) {
        const fx = st.tx + c.dx * step;
        const fy = st.ty + c.dy * step;
        if (
          fx < 0 ||
          fx >= this.map.width ||
          fy < 0 ||
          fy >= this.map.height ||
          !isTileWalkable(this.map.tiles[fy][fx])
        ) {
          break;
        }
        score += 2;
      }

      // Bonus if opposite side is a solid bulkhead or hull boundary
      const bx = st.tx - c.dx;
      const by = st.ty - c.dy;
      const backTile = this.map.tiles[by]?.[bx] ?? 'VOID';
      if (backTile === 'WALL' || backTile === 'VOID') {
        score += 3;
      }

      // Mild tie-breaker preferring South (+Y 2D) entrance for natural top-down readability
      if (c.dy === 1) score += 0.5;

      if (score > bestScore) {
        bestScore = score;
        bestRot = c.rotZ;
      }
    }
    return bestRot;
  }

  private buildStairwells(): void {
    // Strictly <= 43.6 x 43.6px footprint (within 44x44 tile bounds) so collars never clip adjacent walls/doors
    const collarFBGeom = this.trackGeom(new THREE.BoxGeometry(43.6, 2.8, 1.8));
    const collarLRGeom = this.trackGeom(new THREE.BoxGeometry(2.8, 38.0, 1.8));
    const trimRingFBGeom = this.trackGeom(new THREE.BoxGeometry(43.0, 1.2, 0.6));
    const trimRingLRGeom = this.trackGeom(new THREE.BoxGeometry(1.2, 41.0, 0.6));

    // Recessed DOWN shaft walls + floor + corner ribs
    const shaftWallFBGeom = this.trackGeom(new THREE.BoxGeometry(39.6, 1.4, 34.4));
    const shaftWallLRGeom = this.trackGeom(new THREE.BoxGeometry(1.4, 39.6, 34.4));
    const shaftRibGeom = this.trackGeom(new THREE.BoxGeometry(1.6, 1.6, 32.0));
    const shaftBottomGeom = this.trackGeom(new THREE.PlaneGeometry(40, 40));

    // Crisp separated steps: pitch 5.4 > tread depth 4.5 (leaving 0.9px shadow/riser seam per step)
    const stepTreadGeom = this.trackGeom(new THREE.BoxGeometry(31.6, 4.5, 2.2));
    const stepRiserGeom = this.trackGeom(new THREE.BoxGeometry(31.6, 1.1, 5.2));
    const stepNosingGeom = this.trackGeom(new THREE.BoxGeometry(31.6, 1.2, 0.65));
    const lipWarningGeom = this.trackGeom(new THREE.BoxGeometry(31.6, 1.9, 1.0));
    const stringerGeom = this.trackGeom(new THREE.BoxGeometry(2.0, 34.0, 3.0));

    const railPostGeom = this.trackGeom(new THREE.CylinderGeometry(0.95, 0.95, 7.6, 6));
    railPostGeom.rotateX(Math.PI / 2);
    const sideRailGeom = this.trackGeom(new THREE.CylinderGeometry(1.05, 1.05, 37.5, 6));
    const backRailGeom = this.trackGeom(new THREE.CylinderGeometry(1.05, 1.05, 37.2, 6));
    backRailGeom.rotateZ(Math.PI / 2);

    // Compact UP portal threshold frame (leaves all 6 ascending treads 100% uncovered from top-down!)
    const upApronGeom = this.trackGeom(new THREE.PlaneGeometry(38.0, 38.0));
    const upPortalJambGeom = this.trackGeom(new THREE.BoxGeometry(3.2, 6.0, 28.5));
    const upPortalBeamGeom = this.trackGeom(new THREE.BoxGeometry(38.4, 6.0, 3.2));
    const upPortalThroatGeom = this.trackGeom(new THREE.PlaneGeometry(32.0, 24.0));
    const upSideRailGeom = this.trackGeom(new THREE.CylinderGeometry(1.05, 1.05, 36.0, 6));

    // Clean flat beveled chevron arrow (points toward +Y in local stair frame)
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 3.4);
    arrowShape.lineTo(4.2, -1.2);
    arrowShape.lineTo(1.7, -1.2);
    arrowShape.lineTo(1.7, -3.4);
    arrowShape.lineTo(-1.7, -3.4);
    arrowShape.lineTo(-1.7, -1.2);
    arrowShape.lineTo(-4.2, -1.2);
    arrowShape.closePath();
    const chevronGeom = this.trackGeom(
      new THREE.ExtrudeGeometry(arrowShape, {
        depth: 0.7,
        bevelEnabled: false,
      })
    );

    // Depth-graded step palettes so stairs read unambiguously as ascending or descending
    const downStepMats = [0x5e728b, 0x4f6178, 0x415064, 0x344153, 0x273241, 0x1c2532].map(
      (hex) =>
        new THREE.MeshBasicMaterial({
          color: hex,
          depthTest: true,
          depthWrite: true,
        })
    );
    const upStepMats = [0x334256, 0x3e5068, 0x495e79, 0x556c8a, 0x617b9c, 0x6f8bae].map(
      (hex) =>
        new THREE.MeshBasicMaterial({
          color: hex,
          depthTest: true,
          depthWrite: true,
        })
    );
    const downRiserMat = new THREE.MeshBasicMaterial({
      color: 0x0e1520,
      depthTest: true,
      depthWrite: true,
    });
    const stringerMat = new THREE.MeshBasicMaterial({
      color: 0x233041,
      depthTest: true,
      depthWrite: true,
    });
    this.stairMaterials.push(...downStepMats, ...upStepMats, downRiserMat, stringerMat);

    for (const st of this.map.stairwells) {
      const root = new THREE.Group();
      root.position.set(st.x, -st.y, 0);
      root.rotation.z = this.getStairApproachRotation(st);
      root.renderOrder = 3;

      const baseColorHex = st.direction === 'DOWN' ? 0x38bdf8 : 0xfbbf24;
      const stepBaseHex = st.direction === 'DOWN' ? 0x475569 : 0x526277;

      const trimMat = new THREE.MeshBasicMaterial({
        color: baseColorHex,
        depthTest: true,
        depthWrite: true,
      });
      const accentMat = new THREE.MeshBasicMaterial({
        color: st.direction === 'DOWN' ? 0xf59e0b : 0xfbbf24,
        depthTest: true,
        depthWrite: true,
      });
      this.stairMaterials.push(trimMat, accentMat);

      // Perimeter safety coaming collar strictly within ±21.8px
      const cTop = new THREE.Mesh(collarFBGeom, this.doorJambMat);
      cTop.position.set(0, 20.4, 0.9);
      const cBot = new THREE.Mesh(collarFBGeom, this.doorJambMat);
      cBot.position.set(0, -20.4, 0.9);
      const cLeft = new THREE.Mesh(collarLRGeom, this.doorJambMat);
      cLeft.position.set(-20.4, 0, 0.9);
      const cRight = new THREE.Mesh(collarLRGeom, this.doorJambMat);
      cRight.position.set(20.4, 0, 0.9);
      root.add(cTop, cBot, cLeft, cRight);

      // Bright perimeter trim stripe (outer edge ±21.7px)
      const tTop = new THREE.Mesh(trimRingFBGeom, trimMat);
      tTop.position.set(0, 21.1, 1.9);
      const tBot = new THREE.Mesh(trimRingFBGeom, trimMat);
      tBot.position.set(0, -21.1, 1.9);
      const tLeft = new THREE.Mesh(trimRingLRGeom, trimMat);
      tLeft.position.set(-21.1, 0, 1.9);
      const tRight = new THREE.Mesh(trimRingLRGeom, trimMat);
      tRight.position.set(21.1, 0, 1.9);
      root.add(tTop, tBot, tLeft, tRight);

      if (st.direction === 'DOWN') {
        // Enclosed recessed shaft (z = -34 .. 0) + opaque floor pan + structural corner pilasters
        const wallNorth = new THREE.Mesh(shaftWallFBGeom, this.shaftDarkMat);
        wallNorth.position.set(0, 19.5, -17);
        const wallSouth = new THREE.Mesh(shaftWallFBGeom, this.shaftDarkMat);
        wallSouth.position.set(0, -19.5, -17);
        const wallWest = new THREE.Mesh(shaftWallLRGeom, this.shaftDarkMat);
        wallWest.position.set(-19.5, 0, -17);
        const wallEast = new THREE.Mesh(shaftWallLRGeom, this.shaftDarkMat);
        wallEast.position.set(19.5, 0, -17);
        const shaftFloor = new THREE.Mesh(shaftBottomGeom, this.shaftFloorMat);
        shaftFloor.position.set(0, 0, -34.0);
        root.add(wallNorth, wallSouth, wallWest, wallEast, shaftFloor);

        for (const [rx, ry] of [
          [-18.2, -18.2],
          [18.2, -18.2],
          [-18.2, 18.2],
          [18.2, 18.2],
        ]) {
          const rib = new THREE.Mesh(shaftRibGeom, this.doorJambMat);
          rib.position.set(rx, ry, -16.5);
          root.add(rib);
        }

        // Angled interior steel stair stringers along shaft sides
        const stringerL = new THREE.Mesh(stringerGeom, stringerMat);
        stringerL.position.set(-16.8, 0.5, -17.0);
        stringerL.rotation.x = -0.78;
        const stringerR = new THREE.Mesh(stringerGeom, stringerMat);
        stringerR.position.set(16.8, 0.5, -17.0);
        stringerR.rotation.x = -0.78;
        root.add(stringerL, stringerR);

        // Amber entrance safety lip inside top edge of shaft opening
        const lip = new THREE.Mesh(lipWarningGeom, accentMat);
        lip.position.set(0, -17.4, 1.35);
        root.add(lip);

        // 6 Descending treads with vertical risers & progressive depth shading
        for (let i = 0; i < 6; i++) {
          const sy = -13.5 + i * 5.4;
          const sz = -3.8 - i * 5.2;
          const stepMesh = new THREE.Mesh(stepTreadGeom, downStepMats[i]);
          stepMesh.position.set(0, sy, sz);
          const riserMesh = new THREE.Mesh(stepRiserGeom, downRiserMat);
          riserMesh.position.set(0, sy - 2.0, sz - 2.6);
          const nosing = new THREE.Mesh(stepNosingGeom, i === 0 ? accentMat : trimMat);
          nosing.position.set(0, sy - 1.65, sz + 1.15);
          root.add(stepMesh, riserMesh, nosing);
        }

        // 3-sided tubular safety guardrail (open on south entrance -Y)
        const railZ = 7.6;
        const leftRail = new THREE.Mesh(sideRailGeom, this.stairRailMat);
        leftRail.position.set(-18.6, 0.4, railZ);
        const rightRail = new THREE.Mesh(sideRailGeom, this.stairRailMat);
        rightRail.position.set(18.6, 0.4, railZ);
        const backRail = new THREE.Mesh(backRailGeom, this.stairRailMat);
        backRail.position.set(0, 19.1, railZ);
        root.add(leftRail, rightRail, backRail);

        for (const [px, py] of [
          [-18.6, -17.5],
          [-18.6, 0.5],
          [-18.6, 19.1],
          [18.6, -17.5],
          [18.6, 0.5],
          [18.6, 19.1],
        ]) {
          const post = new THREE.Mesh(railPostGeom, this.stairRailMat);
          post.position.set(px, py, 4.1);
          root.add(post);
        }

        // Crisp downward approach chevron centered cleanly on south collar (-Y)
        const chevron = new THREE.Mesh(chevronGeom, trimMat);
        chevron.position.set(0, -19.8, 1.9);
        chevron.scale.set(0.72, 0.68, 1);
        root.add(chevron);
      } else {
        // UP staircase: recessed base pan + 6 clear ascending treads + compact far-edge upper landing portal
        const apron = new THREE.Mesh(upApronGeom, this.stairRiserMat);
        apron.position.set(0, 0, 0.25);
        root.add(apron);

        const stringerL = new THREE.Mesh(stringerGeom, stringerMat);
        stringerL.position.set(-16.8, -0.5, 13.0);
        stringerL.rotation.x = 0.65;
        const stringerR = new THREE.Mesh(stringerGeom, stringerMat);
        stringerR.position.set(16.8, -0.5, 13.0);
        stringerR.rotation.x = 0.65;
        root.add(stringerL, stringerR);

        // 6 Ascending steps (y = -14.0 .. +12.0, completely uncovered from straight top-down!)
        for (let i = 0; i < 6; i++) {
          const sy = -14.0 + i * 5.2;
          const sz = 2.4 + i * 4.0;
          const stepMesh = new THREE.Mesh(stepTreadGeom, upStepMats[i]);
          stepMesh.position.set(0, sy, sz);
          const riserMesh = new THREE.Mesh(stepRiserGeom, downRiserMat);
          riserMesh.position.set(0, sy - 2.0, sz - 1.6);
          const nosing = new THREE.Mesh(stepNosingGeom, accentMat);
          nosing.position.set(0, sy - 1.65, sz + 1.15);
          root.add(stepMesh, riserMesh, nosing);
        }

        // Compact Upper Bulkhead Portal Frame at far +Y edge (y = +15.2 .. +21.2)
        const portalJambL = new THREE.Mesh(upPortalJambGeom, this.doorJambMat);
        portalJambL.position.set(-17.6, 18.2, 14.25);
        const portalJambR = new THREE.Mesh(upPortalJambGeom, this.doorJambMat);
        portalJambR.position.set(17.6, 18.2, 14.25);
        const portalBeam = new THREE.Mesh(upPortalBeamGeom, this.doorJambMat);
        portalBeam.position.set(0, 18.2, 27.2);
        const portalThroat = new THREE.Mesh(upPortalThroatGeom, this.shaftFloorMat);
        portalThroat.position.set(0, 20.6, 14.5);
        portalThroat.rotation.x = Math.PI / 2;
        root.add(portalJambL, portalJambR, portalBeam, portalThroat);

        // Angled side handrails along outer stringer line (no intersection with portal jambs)
        const upRailL = new THREE.Mesh(upSideRailGeom, this.stairRailMat);
        upRailL.position.set(-18.8, -1.5, 14.5);
        upRailL.rotation.x = 0.64;
        const upRailR = new THREE.Mesh(upSideRailGeom, this.stairRailMat);
        upRailR.position.set(18.8, -1.5, 14.5);
        upRailR.rotation.x = 0.64;
        root.add(upRailL, upRailR);

        for (const [px, py, pz] of [
          [-18.8, -16.5, 4.4],
          [18.8, -16.5, 4.4],
          [-18.8, 12.0, 22.0],
          [18.8, 12.0, 22.0],
        ]) {
          const post = new THREE.Mesh(railPostGeom, this.stairRailMat);
          post.position.set(px, py, pz);
          root.add(post);
        }

        // Crisp upward chevron seated neatly on upper portal lintel (+Y)
        const chevron = new THREE.Mesh(chevronGeom, trimMat);
        chevron.position.set(0, 18.2, 28.85);
        chevron.scale.set(0.78, 0.72, 1);
        root.add(chevron);
      }

      this.setRenderOrderRecursive(root, 3);
      root.visible = false;
      this.worldScene.add(root);

      this.stairRigs.push({
        id: st.id,
        deck: st.deck,
        x: st.x,
        y: st.y,
        direction: st.direction,
        root,
        trimMat,
        accentMat,
        baseColorHex,
        stepBaseHex,
        wasComing: false,
      });
    }
  }

  public updateForFrame(
    _engine: MonstrumGameEngine,
    renderDeck: ShipDeck,
    camX: number,
    camY: number,
    halfW: number,
    halfH: number,
    incomingStairId: string | null,
    timeSec: number,
    peekOpenDoorId?: string | null
  ): void {
    if (this.disposed) return;

    // 1. Toggle per-deck walls & Deck 3 exterior wedges/railings
    for (const [deck, dw] of this.deckWalls) {
      const vis = deck === renderDeck;
      dw.worldSides.visible = vis;
      dw.worldCaps.visible = vis && !this.debugHideWallCaps;
      dw.losCaps.visible = vis;
      dw.maskCaps.visible = vis;
    }
    this.deck3ExteriorGroup.visible = renderDeck === 'DECK_3';

    // 2. Synchronize 3D door rigs
    const doorPadX = halfW + 96;
    const doorPadY = halfH + 96;
    for (let i = 0; i < this.doorRigs.length; i++) {
      const rig = this.doorRigs[i];
      if (rig.deck !== renderDeck) {
        rig.root.visible = false;
        continue;
      }
      if (Math.abs(rig.cx - camX) > doorPadX || Math.abs(rig.cy - camY) > doorPadY) {
        rig.root.visible = false;
        continue;
      }

      rig.root.visible = true;
      const d = rig.door;

      if (d.isBroken) {
        rig.hingePivot.visible = false;
        rig.padlockDebris.visible = false;
        rig.brokenGroup.visible = true;
      } else {
        rig.hingePivot.visible = true;
        rig.brokenGroup.visible = false;
        rig.padlockDebris.visible = Boolean(d.lockCut);
        rig.hingePivot.rotation.z = d.openProgress * 1.38;

        const kind: 'normal' | 'locked' | 'watertight' = d.isLocked
          ? 'locked'
          : d.isWatertight
            ? 'watertight'
            : 'normal';
        if (kind !== rig.lastKind) {
          rig.leafMesh.material = this.doorLeafMaterials[kind];
          rig.leafTopMesh.material = this.doorTopCapMaterials[kind];
          rig.lastKind = kind;
        }
        rig.normalHandles.visible = kind === 'normal';
        rig.lockedAttach.visible = d.isLocked;
        rig.watertightAttach.visible = kind === 'watertight';
      }
    }

    // 3. Synchronize 3D stairwells + incoming Brute pulse
    const pulse = 0.6 + 0.4 * Math.sin(timeSec * 10);
    for (let i = 0; i < this.stairRigs.length; i++) {
      const sr = this.stairRigs[i];
      if (sr.deck !== renderDeck) {
        sr.root.visible = false;
        continue;
      }
      if (Math.abs(sr.x - camX) > doorPadX || Math.abs(sr.y - camY) > doorPadY) {
        sr.root.visible = false;
        continue;
      }

      sr.root.visible = true;
      const isComing = sr.id === incomingStairId;
      if (isComing) {
        sr.trimMat.color.setHex(0xff7314).lerp(this.incomingWarmCol, pulse * 0.45);
        sr.accentMat.color.setHex(0xff8c1e).lerp(this.incomingWhiteCol, pulse * 0.35);
        sr.wasComing = true;
      } else if (sr.wasComing) {
        sr.trimMat.color.setHex(sr.baseColorHex);
        sr.accentMat.color.setHex(sr.direction === 'DOWN' ? 0xf59e0b : 0xfbbf24);
        sr.wasComing = false;
      }
    }

    // 4. Update dynamic closed-door depth-blocking strips in LoS and LightMask scenes
    this.losDoorBlockers.update(
      this.map,
      renderDeck,
      camX,
      camY,
      doorPadX,
      doorPadY,
      peekOpenDoorId
    );
    this.maskDoorBlockers.update(
      this.map,
      renderDeck,
      camX,
      camY,
      doorPadX,
      doorPadY,
      peekOpenDoorId
    );
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const dw of this.deckWalls.values()) {
      this.worldScene.remove(dw.worldSides);
      this.worldScene.remove(dw.worldCaps);
      this.losScene.remove(dw.losCaps);
      this.lightMaskScene.remove(dw.maskCaps);
      dw.sidesGeom.dispose();
      dw.capsGeom.dispose();
    }
    this.deckWalls.clear();

    for (const rig of this.doorRigs) {
      this.worldScene.remove(rig.root);
    }
    this.doorRigs = [];

    for (const sr of this.stairRigs) {
      this.worldScene.remove(sr.root);
    }
    this.stairRigs = [];

    this.worldScene.remove(this.deck3ExteriorGroup);

    this.losDoorBlockers.dispose();
    this.maskDoorBlockers.dispose();

    for (const g of this.sharedGeoms) {
      g.dispose();
    }
    this.sharedGeoms = [];

    for (const m of this.stairMaterials) {
      m.dispose();
    }
    this.stairMaterials = [];

    this.wallTex.dispose();
    this.doorTextures.normal.dispose();
    this.doorTextures.locked.dispose();
    this.doorTextures.watertight.dispose();

    this.wallSidesMat.dispose();
    this.blackCapMat.dispose();
    this.doorLeafMaterials.normal.dispose();
    this.doorLeafMaterials.locked.dispose();
    this.doorLeafMaterials.watertight.dispose();
    this.doorTopCapMaterials.normal.dispose();
    this.doorTopCapMaterials.locked.dispose();
    this.doorTopCapMaterials.watertight.dispose();
    this.doorJambMat.dispose();
    this.doorLintelMat.dispose();
    this.doorBraceMat.dispose();
    this.doorThresholdMat.dispose();
    this.steelLightMat.dispose();
    this.crimsonMat.dispose();
    this.brassMat.dispose();
    this.cyanTrimMat.dispose();
    this.splinterWoodMat.dispose();
    this.shaftDarkMat.dispose();
    this.shaftFloorMat.dispose();
    this.stairStepMat.dispose();
    this.stairRiserMat.dispose();
    this.stairRailMat.dispose();
    this.deck3HullMat.dispose();
    this.deck3RailMat.dispose();
  }

  private buildDeck3ExteriorHullAndRailings(): void {
    const wedges = this.map.deck3HullWedges;
    const railings = this.map.deck3Railings;
    if (wedges.length === 0 && railings.length === 0) return;

    this.deck3ExteriorGroup.visible = false;
    this.worldScene.add(this.deck3ExteriorGroup);

    const hullPos: number[] = [];
    const hullNorm: number[] = [];
    const hullCol: number[] = [];

    const cDeckBase = new THREE.Color(0x101822);
    const cDeckMid = new THREE.Color(0x141e2b);
    const cDeckEdge = new THREE.Color(0x1a2636);
    const cFreeboardTop = new THREE.Color(0x283648);
    const cFreeboardMid = new THREE.Color(0x182230);
    const cBootTop = new THREE.Color(0x471d20);
    const cWaterline = new THREE.Color(0x220c0e);
    const cRib = new THREE.Color(0x1c2633);

    const pushHullTri = (
      x0: number,
      y0: number,
      z0: number,
      c0: THREE.Color,
      x1: number,
      y1: number,
      z1: number,
      c1: THREE.Color,
      x2: number,
      y2: number,
      z2: number,
      c2: THREE.Color,
      nx: number,
      ny: number,
      nz: number
    ) => {
      hullPos.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);
      hullNorm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
      hullCol.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c2.r, c2.g, c2.b);
    };

    // 1. Deck 3 outer hull apron & bow/stern wedges (flush with WEATHER deck tiles at z = 0.015)
    for (const w of wedges) {
      let ax0 = w.x0;
      let ay0 = -w.y0;
      let ax1 = w.x1;
      let ay1 = -w.y1;
      let ax2 = w.x2;
      let ay2 = -w.y2;
      const crossZ = (ax1 - ax0) * (ay2 - ay0) - (ay1 - ay0) * (ax2 - ax0);
      if (crossZ < 0) {
        [ax1, ax2] = [ax2, ax1];
        [ay1, ay2] = [ay2, ay1];
      }
      const cA = w.kind === 'BOW' ? cDeckMid : cDeckBase;
      const cB = w.kind === 'CHAMFER' ? cDeckEdge : cDeckMid;
      const cC = cDeckEdge;
      pushHullTri(ax0, ay0, 0.02, cA, ax1, ay1, 0.02, cB, ax2, ay2, 0.02, cC, 0, 0, 1);
    }

    // 2. Below-deck vertical freeboard hull skirt + anti-fouling boot stripe down into sea (z = 0..-38)
    for (const r of railings) {
      const dx = r.x2 - r.x1;
      const dy = r.y2 - r.y1;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;

      const ax = r.x1;
      const ay = -r.y1;
      const bx = r.x2;
      const by = -r.y2;
      const nx = r.nx;
      const ny = -r.ny;
      // Ensure (B - A) x (0,0,1) matches outward (nx, ny)
      const crossEdgeZ = (bx - ax) * ny - (by - ay) * nx;
      const p1x = crossEdgeZ >= 0 ? ax : bx;
      const p1y = crossEdgeZ >= 0 ? ay : by;
      const p2x = crossEdgeZ >= 0 ? bx : ax;
      const p2y = crossEdgeZ >= 0 ? by : ay;

      const shade = ny < 0 ? 1.0 : nx > 0 ? 0.92 : nx < 0 ? 0.88 : 0.82;
      const cTop = cFreeboardTop.clone().multiplyScalar(shade);
      const cMid = cFreeboardMid.clone().multiplyScalar(shade);
      const cBoot = cBootTop.clone().multiplyScalar(shade);
      const cBot = cWaterline.clone().multiplyScalar(shade);

      // Upper freeboard band (z: 0 -> -21)
      pushHullTri(p1x, p1y, -21, cMid, p2x, p2y, -21, cMid, p2x, p2y, 0.02, cTop, nx, ny, 0);
      pushHullTri(p1x, p1y, -21, cMid, p2x, p2y, 0.02, cTop, p1x, p1y, 0.02, cTop, nx, ny, 0);

      // Lower waterline boot-stripe band (z: -21 -> -38)
      pushHullTri(p1x, p1y, -38, cBot, p2x, p2y, -38, cBot, p2x, p2y, -21, cBoot, nx, ny, 0);
      pushHullTri(p1x, p1y, -38, cBot, p2x, p2y, -21, cBoot, p1x, p1y, -21, cBoot, nx, ny, 0);

      // Exterior hull rib stiffeners every ~132px
      const ribCount = Math.floor(len / 132);
      for (let ri = 1; ri <= ribCount; ri++) {
        const t = ri / (ribCount + 1);
        const rx = p1x + (p2x - p1x) * t;
        const ry = p1y + (p2y - p1y) * t;
        const ux = (p2x - p1x) / len;
        const uy = (p2y - p1y) / len;
        const rxA = rx - ux * 1.4 + nx * 1.3;
        const ryA = ry - uy * 1.4 + ny * 1.3;
        const rxB = rx + ux * 1.4 + nx * 1.3;
        const ryB = ry + uy * 1.4 + ny * 1.3;
        pushHullTri(rxA, ryA, -34, cRib, rxB, ryB, -34, cRib, rxB, ryB, 0, cRib, nx, ny, 0);
        pushHullTri(rxA, ryA, -34, cRib, rxB, ryB, 0, cRib, rxA, ryA, 0, cRib, nx, ny, 0);
      }
    }

    if (hullPos.length > 0) {
      const hullGeom = this.trackGeom(new THREE.BufferGeometry());
      hullGeom.setAttribute('position', new THREE.Float32BufferAttribute(hullPos, 3));
      hullGeom.setAttribute('normal', new THREE.Float32BufferAttribute(hullNorm, 3));
      hullGeom.setAttribute('color', new THREE.Float32BufferAttribute(hullCol, 3));
      const hullMesh = new THREE.Mesh(hullGeom, this.deck3HullMat);
      hullMesh.frustumCulled = false;
      hullMesh.renderOrder = 2;
      this.deck3ExteriorGroup.add(hullMesh);
    }

    // 3. 3D Stanchion & Triple-Pipe Railings + Coaming Curb along Deck 3 outer edges
    const railPos: number[] = [];
    const railNorm: number[] = [];
    const railCol: number[] = [];

    const cCoamingTop = new THREE.Color(0x3b495c);
    const cCoamingSide = new THREE.Color(0x1f2836);
    const cPost = new THREE.Color(0x7c8ea3);
    const cMidPipe = new THREE.Color(0x64748b);
    const cTopPipe = new THREE.Color(0xa8b8cc);
    const cTopPipeHighlight = new THREE.Color(0xcbd5e1);

    const pushOrientedBox = (
      cx: number,
      cy: number,
      z0: number,
      z1: number,
      ux: number,
      uy: number,
      vx: number,
      vy: number,
      halfU: number,
      halfV: number,
      colSide: THREE.Color,
      colTop: THREE.Color
    ) => {
      const p00x = cx - ux * halfU - vx * halfV;
      const p00y = cy - uy * halfU - vy * halfV;
      const p10x = cx + ux * halfU - vx * halfV;
      const p10y = cy + uy * halfU - vy * halfV;
      const p11x = cx + ux * halfU + vx * halfV;
      const p11y = cy + uy * halfU + vy * halfV;
      const p01x = cx - ux * halfU + vx * halfV;
      const p01y = cy - uy * halfU + vy * halfV;

      const pushSide = (
        ax: number,
        ay: number,
        bx: number,
        by: number,
        nx: number,
        ny: number,
        cSide: THREE.Color
      ) => {
        railPos.push(
          ax, ay, z0,
          bx, by, z0,
          bx, by, z1,
          ax, ay, z0,
          bx, by, z1,
          ax, ay, z1
        );
        for (let k = 0; k < 6; k++) {
          railNorm.push(nx, ny, 0);
          railCol.push(cSide.r, cSide.g, cSide.b);
        }
      };

      // Top face (+Z)
      railPos.push(
        p00x, p00y, z1,
        p10x, p10y, z1,
        p11x, p11y, z1,
        p00x, p00y, z1,
        p11x, p11y, z1,
        p01x, p01y, z1
      );
      for (let k = 0; k < 6; k++) {
        railNorm.push(0, 0, 1);
        railCol.push(colTop.r, colTop.g, colTop.b);
      }

      pushSide(p00x, p00y, p10x, p10y, -vx, -vy, colSide);
      pushSide(p10x, p10y, p11x, p11y, ux, uy, colSide);
      pushSide(p11x, p11y, p01x, p01y, vx, vy, colSide);
      pushSide(p01x, p01y, p00x, p00y, -ux, -uy, colSide);
    };

    const placedPosts = new Set<string>();
    const addPost = (px2d: number, py2d: number) => {
      const k = `${Math.round(px2d * 0.5)},${Math.round(py2d * 0.5)}`;
      if (placedPosts.has(k)) return;
      placedPosts.add(k);
      // Stanchion base plate + vertical steel post (0..15.8)
      pushOrientedBox(px2d, -py2d, 0.02, 2.2, 1, 0, 0, 1, 1.8, 1.8, cCoamingSide, cPost);
      pushOrientedBox(px2d, -py2d, 2.2, 15.8, 1, 0, 0, 1, 1.05, 1.05, cPost, cTopPipeHighlight);
    };

    for (const r of railings) {
      const dx = r.x2 - r.x1;
      const dy = r.y2 - r.y1;
      const len = Math.hypot(dx, dy);
      if (len < 2) continue;

      // Inset 1.6px inward from outer edge so stanchions & coaming sit cleanly on steel rim
      const inX = -r.nx * 1.6;
      const inY = -r.ny * 1.6;
      const sx1 = r.x1 + inX;
      const sy1 = r.y1 + inY;
      const sx2 = r.x2 + inX;
      const sy2 = r.y2 + inY;
      const mx = (sx1 + sx2) * 0.5;
      const my = -(sy1 + sy2) * 0.5;

      // Tangent (u) and inward/outward normal (v) in Three coords
      const ux = (sx2 - sx1) / len;
      const uy = -(sy2 - sy1) / len;
      const vx = -uy;
      const vy = ux;
      const halfLen = len * 0.5;

      // Raised steel gunwale toe-kick coaming curb (z: 0.02 -> 2.4)
      pushOrientedBox(mx, my, 0.02, 2.4, ux, uy, vx, vy, halfLen, 1.35, cCoamingSide, cCoamingTop);
      // Lower & middle horizontal steel pipe bars (z = 5.4, z = 10.2)
      pushOrientedBox(mx, my, 4.7, 6.1, ux, uy, vx, vy, halfLen, 0.72, cMidPipe, cPost);
      pushOrientedBox(mx, my, 9.5, 10.9, ux, uy, vx, vy, halfLen, 0.72, cMidPipe, cPost);
      // Top brushed-steel handrail bar (z = 14.3 -> 16.0)
      pushOrientedBox(
        mx,
        my,
        14.3,
        16.0,
        ux,
        uy,
        vx,
        vy,
        halfLen,
        1.05,
        cTopPipe,
        cTopPipeHighlight
      );

      // End stanchions & intermediate stanchions every ~44px
      if (r.hasStartPost) addPost(sx1, sy1);
      if (r.hasEndPost) addPost(sx2, sy2);
      const spans = Math.max(1, Math.round(len / 44));
      for (let i = 1; i < spans; i++) {
        const t = i / spans;
        addPost(sx1 + (sx2 - sx1) * t, sy1 + (sy2 - sy1) * t);
      }
    }

    if (railPos.length > 0) {
      const railGeom = this.trackGeom(new THREE.BufferGeometry());
      railGeom.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
      railGeom.setAttribute('normal', new THREE.Float32BufferAttribute(railNorm, 3));
      railGeom.setAttribute('color', new THREE.Float32BufferAttribute(railCol, 3));
      const railMesh = new THREE.Mesh(railGeom, this.deck3RailMat);
      railMesh.frustumCulled = false;
      railMesh.renderOrder = 3;
      this.deck3ExteriorGroup.add(railMesh);
    }
  }
}
