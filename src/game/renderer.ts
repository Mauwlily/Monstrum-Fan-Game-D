import * as THREE from 'three/webgpu';
import type { ProbeReading } from '../components/DebugPanel';
import { MonstrumGameEngine } from './engine';
import { getRoomLightFlicker } from './lighting';
import { isTileWalkable } from './mapGen';
import {
  BakedShipAssets,
  bakeShipDeckChunks,
  createDynamicSpriteLibrary,
  DynamicSpriteLibrary,
  SpriteEntry,
} from './threeAssets';
import {
  CompositeMaterialBundle,
  createBakedLightmapQuadMaterial,
  createBatchedRadialFanMaterial,
  createDarknessCompositeMaterial,
  createOceanMaterial,
  createScreenBlitMaterial,
  createSrgbReadbackBlitMaterial,
  createStairPortalMaterial,
  createThinRingBatchMaterial,
  createVignetteAndDangerMaterial,
  OceanMaterialBundle,
  StairPortalMaterialBundle,
  VignetteDangerMaterialBundle,
} from './threeTsl';
import {
  getDeckLabel,
  RoomLightSwitch,
  RoomName,
  ShipDeck,
  ShipMap,
} from './types';
import {
  buildVisibilityFanBuffers,
  computeVisibilityPolygon,
  FanMeshData,
  getLocalOccluders,
  getSensesProfile,
  hasLineOfSight,
  hasLineOfSightToEntity,
  LightPolygonCache,
} from './visibility';

interface RayLightPoly {
  cacheKey?: string;
  deck: ShipDeck;
  x: number;
  y: number;
  range: number;
  intensity: number;
  sputterAmount: number;
  fan: FanMeshData;
  poly: Array<{ x: number; y: number }>;
}

interface BruteBeamData {
  ox: number;
  oy: number;
  angle: number;
  range: number;
  intensity: number;
  isChasing: boolean;
  fan: FanMeshData;
  poly: Array<{ x: number; y: number }>;
}

interface StairGlowData {
  x: number;
  y: number;
  range: number;
  intensity: number;
  fan: FanMeshData;
  poly: Array<{ x: number; y: number }>;
}

interface DoorPeekBeamData {
  ox: number;
  oy: number;
  range: number;
  isLitSide: boolean;
  fan: FanMeshData;
  poly: Array<{ x: number; y: number }>;
}

interface SpriteSlot {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  mat: THREE.MeshBasicMaterial;
}

class SpritePool {
  private slots: SpriteSlot[] = [];
  private cursor = 0;

  constructor(
    private scene: THREE.Object3D,
    private unitQuad: THREE.PlaneGeometry,
    private defaultRenderOrder: number,
    initialCapacity = 16
  ) {
    for (let i = 0; i < initialCapacity; i++) {
      this.allocateSlot();
    }
  }

  private allocateSlot(): SpriteSlot {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.unitQuad, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = this.defaultRenderOrder;
    this.scene.add(mesh);
    const slot: SpriteSlot = { mesh, mat };
    this.slots.push(slot);
    return slot;
  }

  public beginFrame(): void {
    this.cursor = 0;
  }

  public place(
    entry: SpriteEntry,
    wx: number,
    wy: number,
    options?: {
      rot2d?: number;
      scaleX?: number;
      scaleY?: number;
      tint?: number;
      opacity?: number;
      renderOrder?: number;
    }
  ): void {
    if (this.cursor >= this.slots.length) {
      this.allocateSlot();
    }
    const slot = this.slots[this.cursor++];
    const sx = (options?.scaleX ?? 1) * entry.w;
    const sy = (options?.scaleY ?? 1) * entry.h;
    if (slot.mat.map !== entry.texture) {
      slot.mat.map = entry.texture;
      slot.mat.needsUpdate = true;
    }
    slot.mat.color.setHex(options?.tint ?? 0xffffff);
    slot.mat.opacity = options?.opacity ?? 1;
    slot.mesh.position.set(wx, -wy, 0);
    slot.mesh.rotation.set(0, 0, -(options?.rot2d ?? 0));
    slot.mesh.scale.set(sx, sy, 1);
    slot.mesh.renderOrder = options?.renderOrder ?? this.defaultRenderOrder;
    slot.mesh.visible = true;
  }

  public endFrame(): void {
    for (let i = this.cursor; i < this.slots.length; i++) {
      this.slots[i].mesh.visible = false;
    }
  }

  public dispose(): void {
    for (const s of this.slots) {
      this.scene.remove(s.mesh);
      s.mat.dispose();
    }
    this.slots = [];
  }
}

class FanBatch {
  private geom: THREE.BufferGeometry;
  private mat: THREE.MeshBasicNodeMaterial;
  private mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial>;
  private posAttr: THREE.BufferAttribute;
  private radialAttr: THREE.BufferAttribute;
  private paramsAttr: THREE.BufferAttribute;
  private col0Attr: THREE.BufferAttribute;
  private col1Attr: THREE.BufferAttribute;
  private col2Attr: THREE.BufferAttribute;
  private posArr: Float32Array;
  private radialArr: Float32Array;
  private paramsArr: Float32Array;
  private col0Arr: Float32Array;
  private col1Arr: Float32Array;
  private col2Arr: Float32Array;
  private vertexCursor = 0;
  private maxVerts: number;
  private frameHash1 = 2166136261;
  private frameHash2 = 0x9e3779b9;
  private lastUploadedCount = -1;
  private lastHash1 = 0;
  private lastHash2 = 0;
  private c0 = new THREE.Color();
  private c1 = new THREE.Color();
  private c2 = new THREE.Color();

  constructor(
    private parent: THREE.Object3D,
    renderOrder: number,
    initialVerts = 2048
  ) {
    this.maxVerts = initialVerts;
    this.posArr = new Float32Array(initialVerts * 3);
    this.radialArr = new Float32Array(initialVerts * 2);
    this.paramsArr = new Float32Array(initialVerts * 3);
    this.col0Arr = new Float32Array(initialVerts * 4);
    this.col1Arr = new Float32Array(initialVerts * 4);
    this.col2Arr = new Float32Array(initialVerts * 4);

    this.posAttr = new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage);
    this.radialAttr = new THREE.BufferAttribute(this.radialArr, 2).setUsage(THREE.DynamicDrawUsage);
    this.paramsAttr = new THREE.BufferAttribute(this.paramsArr, 3).setUsage(THREE.DynamicDrawUsage);
    this.col0Attr = new THREE.BufferAttribute(this.col0Arr, 4).setUsage(THREE.DynamicDrawUsage);
    this.col1Attr = new THREE.BufferAttribute(this.col1Arr, 4).setUsage(THREE.DynamicDrawUsage);
    this.col2Attr = new THREE.BufferAttribute(this.col2Arr, 4).setUsage(THREE.DynamicDrawUsage);

    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', this.posAttr);
    this.geom.setAttribute('aRadialOffset', this.radialAttr);
    this.geom.setAttribute('aFanParams', this.paramsAttr);
    this.geom.setAttribute('aColor0', this.col0Attr);
    this.geom.setAttribute('aColor1', this.col1Attr);
    this.geom.setAttribute('aColor2', this.col2Attr);
    this.geom.setDrawRange(0, 0);

    this.mat = createBatchedRadialFanMaterial();
    this.mesh = new THREE.Mesh(this.geom, this.mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    parent.add(this.mesh);
  }

  public beginFrame(): void {
    this.vertexCursor = 0;
    this.frameHash1 = 2166136261;
    this.frameHash2 = 0x9e3779b9;
  }

  public clear(): void {
    this.vertexCursor = 0;
    this.lastUploadedCount = 0;
    this.geom.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  private ensureCapacity(addVerts: number): void {
    const needed = this.vertexCursor + addVerts;
    if (needed <= this.maxVerts) return;
    const nextMax = Math.max(this.maxVerts * 2, needed + 1024);

    const nextPos = new Float32Array(nextMax * 3);
    const nextRadial = new Float32Array(nextMax * 2);
    const nextParams = new Float32Array(nextMax * 3);
    const nextCol0 = new Float32Array(nextMax * 4);
    const nextCol1 = new Float32Array(nextMax * 4);
    const nextCol2 = new Float32Array(nextMax * 4);

    if (this.vertexCursor > 0) {
      nextPos.set(this.posArr.subarray(0, this.vertexCursor * 3));
      nextRadial.set(this.radialArr.subarray(0, this.vertexCursor * 2));
      nextParams.set(this.paramsArr.subarray(0, this.vertexCursor * 3));
      nextCol0.set(this.col0Arr.subarray(0, this.vertexCursor * 4));
      nextCol1.set(this.col1Arr.subarray(0, this.vertexCursor * 4));
      nextCol2.set(this.col2Arr.subarray(0, this.vertexCursor * 4));
    }

    this.posArr = nextPos;
    this.radialArr = nextRadial;
    this.paramsArr = nextParams;
    this.col0Arr = nextCol0;
    this.col1Arr = nextCol1;
    this.col2Arr = nextCol2;

    this.posAttr = new THREE.BufferAttribute(nextPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.radialAttr = new THREE.BufferAttribute(nextRadial, 2).setUsage(THREE.DynamicDrawUsage);
    this.paramsAttr = new THREE.BufferAttribute(nextParams, 3).setUsage(THREE.DynamicDrawUsage);
    this.col0Attr = new THREE.BufferAttribute(nextCol0, 4).setUsage(THREE.DynamicDrawUsage);
    this.col1Attr = new THREE.BufferAttribute(nextCol1, 4).setUsage(THREE.DynamicDrawUsage);
    this.col2Attr = new THREE.BufferAttribute(nextCol2, 4).setUsage(THREE.DynamicDrawUsage);

    this.geom.setAttribute('position', this.posAttr);
    this.geom.setAttribute('aRadialOffset', this.radialAttr);
    this.geom.setAttribute('aFanParams', this.paramsAttr);
    this.geom.setAttribute('aColor0', this.col0Attr);
    this.geom.setAttribute('aColor1', this.col1Attr);
    this.geom.setAttribute('aColor2', this.col2Attr);
    this.maxVerts = nextMax;
    this.lastUploadedCount = -1;
  }

  private mixHash(v: number): void {
    const iv = Math.imul(v | 0, 1);
    this.frameHash1 = Math.imul(this.frameHash1 ^ iv, 16777619);
    this.frameHash2 = Math.imul(this.frameHash2 ^ (iv + 0x9e3779b9), 2246822519);
  }

  public addFan(
    fan: FanMeshData,
    innerRadius: number,
    range: number,
    stopPos: number,
    c0Hex: number,
    a0: number,
    c1Hex: number,
    a1: number,
    c2Hex: number,
    a2: number
  ): void {
    const vCount = fan.vertexCount;
    if (vCount <= 0) return;

    this.mixHash(fan.version);
    this.mixHash(vCount);
    this.mixHash(Math.round(fan.positions[0] ?? 0));
    this.mixHash(Math.round(fan.positions[1] ?? 0));
    this.mixHash(c0Hex);
    this.mixHash(Math.round(a0 * 1000));
    this.mixHash(c1Hex);
    this.mixHash(Math.round(a1 * 1000));
    this.mixHash(Math.round(range));

    this.ensureCapacity(vCount);

    const vBase = this.vertexCursor;
    this.posArr.set(fan.positions.subarray(0, vCount * 3), vBase * 3);
    this.radialArr.set(fan.radialOffsets.subarray(0, vCount * 2), vBase * 2);

    this.c0.setHex(c0Hex);
    this.c1.setHex(c1Hex);
    this.c2.setHex(c2Hex);

    const r0 = this.c0.r;
    const g0 = this.c0.g;
    const b0 = this.c0.b;
    const r1 = this.c1.r;
    const g1 = this.c1.g;
    const b1 = this.c1.b;
    const r2 = this.c2.r;
    const g2 = this.c2.g;
    const b2 = this.c2.b;

    const paramsArr = this.paramsArr;
    const col0Arr = this.col0Arr;
    const col1Arr = this.col1Arr;
    const col2Arr = this.col2Arr;

    let i3 = vBase * 3;
    let i4 = vBase * 4;
    for (let i = 0; i < vCount; i++) {
      paramsArr[i3] = innerRadius;
      paramsArr[i3 + 1] = range;
      paramsArr[i3 + 2] = stopPos;
      i3 += 3;

      col0Arr[i4] = r0;
      col0Arr[i4 + 1] = g0;
      col0Arr[i4 + 2] = b0;
      col0Arr[i4 + 3] = a0;

      col1Arr[i4] = r1;
      col1Arr[i4 + 1] = g1;
      col1Arr[i4 + 2] = b1;
      col1Arr[i4 + 3] = a1;

      col2Arr[i4] = r2;
      col2Arr[i4 + 1] = g2;
      col2Arr[i4 + 2] = b2;
      col2Arr[i4 + 3] = a2;
      i4 += 4;
    }

    this.vertexCursor = vBase + vCount;
  }

  public endFrame(): void {
    const count = this.vertexCursor;
    if (count === 0) {
      this.geom.setDrawRange(0, 0);
      this.mesh.visible = false;
      this.lastUploadedCount = 0;
      return;
    }

    if (
      count === this.lastUploadedCount &&
      this.frameHash1 === this.lastHash1 &&
      this.frameHash2 === this.lastHash2
    ) {
      this.geom.setDrawRange(0, count);
      this.mesh.visible = true;
      return;
    }

    this.lastUploadedCount = count;
    this.lastHash1 = this.frameHash1;
    this.lastHash2 = this.frameHash2;

    this.posAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(0, count * 3);
    this.posAttr.needsUpdate = true;

    this.radialAttr.clearUpdateRanges();
    this.radialAttr.addUpdateRange(0, count * 2);
    this.radialAttr.needsUpdate = true;

    this.paramsAttr.clearUpdateRanges();
    this.paramsAttr.addUpdateRange(0, count * 3);
    this.paramsAttr.needsUpdate = true;

    this.col0Attr.clearUpdateRanges();
    this.col0Attr.addUpdateRange(0, count * 4);
    this.col0Attr.needsUpdate = true;

    this.col1Attr.clearUpdateRanges();
    this.col1Attr.addUpdateRange(0, count * 4);
    this.col1Attr.needsUpdate = true;

    this.col2Attr.clearUpdateRanges();
    this.col2Attr.addUpdateRange(0, count * 4);
    this.col2Attr.needsUpdate = true;

    this.geom.setDrawRange(0, count);
    this.mesh.visible = true;
  }

  public dispose(): void {
    this.parent.remove(this.mesh);
    this.geom.dispose();
    this.mat.dispose();
  }
}

class DynamicLineBatch {
  private geom: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private posArr: Float32Array;
  private mat: THREE.LineBasicMaterial;
  private lines: THREE.LineSegments;
  private vertexCursor = 0;
  private maxVerts: number;

  constructor(
    private parent: THREE.Object3D,
    color: number,
    opacity: number,
    renderOrder: number,
    initialVerts = 512
  ) {
    this.maxVerts = initialVerts;
    this.posArr = new Float32Array(initialVerts * 3);
    this.posAttr = new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', this.posAttr);
    this.geom.setDrawRange(0, 0);

    this.mat = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthWrite: false,
      depthTest: false,
    });
    this.lines = new THREE.LineSegments(this.geom, this.mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.renderOrder = renderOrder;
    parent.add(this.lines);
  }

  public beginFrame(): void {
    this.vertexCursor = 0;
  }

  public setStyle(color: number, opacity: number): void {
    this.mat.color.setHex(color);
    this.mat.opacity = opacity;
    this.mat.transparent = opacity < 1;
  }

  private ensureCapacity(addVerts: number): void {
    if (this.vertexCursor + addVerts <= this.maxVerts) return;
    const nextMax = Math.max(this.maxVerts * 2, this.vertexCursor + addVerts + 128);
    const nextArr = new Float32Array(nextMax * 3);
    nextArr.set(this.posArr.subarray(0, this.vertexCursor * 3));
    this.posArr = nextArr;
    this.posAttr = new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('position', this.posAttr);
    this.maxVerts = nextMax;
  }

  public addSegment(x1: number, y1: number, x2: number, y2: number): void {
    this.ensureCapacity(2);
    let idx = this.vertexCursor * 3;
    this.posArr[idx++] = x1;
    this.posArr[idx++] = -y1;
    this.posArr[idx++] = 0;
    this.posArr[idx++] = x2;
    this.posArr[idx++] = -y2;
    this.posArr[idx++] = 0;
    this.vertexCursor += 2;
  }

  public addDashedSegment(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    dashLen = 5,
    gapLen = 4
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    const ux = dx / len;
    const uy = dy / len;
    const step = dashLen + gapLen;
    for (let d = 0; d < len; d += step) {
      const dEnd = Math.min(len, d + dashLen);
      this.addSegment(x1 + ux * d, y1 + uy * d, x1 + ux * dEnd, y1 + uy * dEnd);
    }
  }

  public addPolyLoop(pts: Array<{ x: number; y: number }>): void {
    if (pts.length < 2) return;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      this.addSegment(a.x, a.y, b.x, b.y);
    }
  }

  public addRect(x: number, y: number, w: number, h: number): void {
    this.addSegment(x, y, x + w, y);
    this.addSegment(x + w, y, x + w, y + h);
    this.addSegment(x + w, y + h, x, y + h);
    this.addSegment(x, y + h, x, y);
  }

  public endFrame(): void {
    if (this.vertexCursor === 0) {
      this.geom.setDrawRange(0, 0);
      this.lines.visible = false;
      return;
    }
    this.posAttr.needsUpdate = true;
    this.geom.setDrawRange(0, this.vertexCursor);
    this.lines.visible = true;
  }

  public dispose(): void {
    this.parent.remove(this.lines);
    this.geom.dispose();
    this.mat.dispose();
  }
}

class ThinRingBatch {
  private geom: THREE.BufferGeometry;
  private mat: THREE.MeshBasicNodeMaterial;
  private mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial>;
  private posAttr: THREE.BufferAttribute;
  private offsetAttr: THREE.BufferAttribute;
  private paramsAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private posArr: Float32Array;
  private offsetArr: Float32Array;
  private paramsArr: Float32Array;
  private colorArr: Float32Array;
  private vertexCursor = 0;
  private maxVerts: number;

  constructor(
    private parent: THREE.Object3D,
    renderOrder: number,
    initialQuads = 64
  ) {
    this.maxVerts = initialQuads * 6;
    this.posArr = new Float32Array(this.maxVerts * 3);
    this.offsetArr = new Float32Array(this.maxVerts * 2);
    this.paramsArr = new Float32Array(this.maxVerts * 3);
    this.colorArr = new Float32Array(this.maxVerts * 4);

    this.posAttr = new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage);
    this.offsetAttr = new THREE.BufferAttribute(this.offsetArr, 2).setUsage(THREE.DynamicDrawUsage);
    this.paramsAttr = new THREE.BufferAttribute(this.paramsArr, 3).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.colorArr, 4).setUsage(THREE.DynamicDrawUsage);

    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', this.posAttr);
    this.geom.setAttribute('aRingOffset', this.offsetAttr);
    this.geom.setAttribute('aRingParams', this.paramsAttr);
    this.geom.setAttribute('aRingColor', this.colorAttr);
    this.geom.setDrawRange(0, 0);

    this.mat = createThinRingBatchMaterial();
    this.mesh = new THREE.Mesh(this.geom, this.mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    parent.add(this.mesh);
  }

  public beginFrame(): void {
    this.vertexCursor = 0;
  }

  private ensureCapacity(addVerts: number): void {
    if (this.vertexCursor + addVerts <= this.maxVerts) return;
    const nextMax = Math.max(this.maxVerts * 2, this.vertexCursor + addVerts + 96);
    const nextPos = new Float32Array(nextMax * 3);
    const nextOffset = new Float32Array(nextMax * 2);
    const nextParams = new Float32Array(nextMax * 3);
    const nextColor = new Float32Array(nextMax * 4);

    if (this.vertexCursor > 0) {
      nextPos.set(this.posArr.subarray(0, this.vertexCursor * 3));
      nextOffset.set(this.offsetArr.subarray(0, this.vertexCursor * 2));
      nextParams.set(this.paramsArr.subarray(0, this.vertexCursor * 3));
      nextColor.set(this.colorArr.subarray(0, this.vertexCursor * 4));
    }

    this.posArr = nextPos;
    this.offsetArr = nextOffset;
    this.paramsArr = nextParams;
    this.colorArr = nextColor;

    this.posAttr = new THREE.BufferAttribute(nextPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.offsetAttr = new THREE.BufferAttribute(nextOffset, 2).setUsage(THREE.DynamicDrawUsage);
    this.paramsAttr = new THREE.BufferAttribute(nextParams, 3).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(nextColor, 4).setUsage(THREE.DynamicDrawUsage);

    this.geom.setAttribute('position', this.posAttr);
    this.geom.setAttribute('aRingOffset', this.offsetAttr);
    this.geom.setAttribute('aRingParams', this.paramsAttr);
    this.geom.setAttribute('aRingColor', this.colorAttr);
    this.maxVerts = nextMax;
  }

  public addRing(
    wx: number,
    wy: number,
    radius: number,
    halfThickness: number,
    feather: number,
    color: THREE.Color,
    alpha: number
  ): void {
    if (radius <= 0.5 || alpha <= 0.002) return;
    this.ensureCapacity(6);

    const half = radius + halfThickness + feather + 2;
    const cx = wx;
    const cy = -wy;
    const cr = color.r;
    const cg = color.g;
    const cb = color.b;

    const corners: Array<[number, number]> = [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, -half],
      [half, half],
      [-half, half],
    ];

    let i2 = this.vertexCursor * 2;
    let i3 = this.vertexCursor * 3;
    let i4 = this.vertexCursor * 4;

    for (let k = 0; k < 6; k++) {
      const [ox, oy] = corners[k];
      this.posArr[i3] = cx + ox;
      this.posArr[i3 + 1] = cy + oy;
      this.posArr[i3 + 2] = 0;

      this.offsetArr[i2] = ox;
      this.offsetArr[i2 + 1] = oy;

      this.paramsArr[i3] = radius;
      this.paramsArr[i3 + 1] = halfThickness;
      this.paramsArr[i3 + 2] = feather;

      this.colorArr[i4] = cr;
      this.colorArr[i4 + 1] = cg;
      this.colorArr[i4 + 2] = cb;
      this.colorArr[i4 + 3] = alpha;

      i2 += 2;
      i3 += 3;
      i4 += 4;
    }

    this.vertexCursor += 6;
  }

  public endFrame(): void {
    const count = this.vertexCursor;
    if (count === 0) {
      this.geom.setDrawRange(0, 0);
      this.mesh.visible = false;
      return;
    }
    this.posAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(0, count * 3);
    this.posAttr.needsUpdate = true;

    this.offsetAttr.clearUpdateRanges();
    this.offsetAttr.addUpdateRange(0, count * 2);
    this.offsetAttr.needsUpdate = true;

    this.paramsAttr.clearUpdateRanges();
    this.paramsAttr.addUpdateRange(0, count * 3);
    this.paramsAttr.needsUpdate = true;

    this.colorAttr.clearUpdateRanges();
    this.colorAttr.addUpdateRange(0, count * 4);
    this.colorAttr.needsUpdate = true;

    this.geom.setDrawRange(0, count);
    this.mesh.visible = true;
  }

  public dispose(): void {
    this.parent.remove(this.mesh);
    this.geom.dispose();
    this.mat.dispose();
  }
}

export class GameRenderer {
  private renderer: THREE.WebGPURenderer | null = null;
  private initialized = false;
  private disposed = false;
  private initPromise: Promise<void> | null = null;
  private anisotropy = 1;
  private isWebGPU = false;

  private sprites: DynamicSpriteLibrary | null = null;
  private bakedShip: BakedShipAssets | null = null;
  private bakedMapRef: ShipMap | null = null;
  private deckChunkMeshes: Array<{
    deck: ShipDeck;
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    geom: THREE.PlaneGeometry;
    mat: THREE.MeshBasicMaterial;
  }> = [];

  // Precomputed per-map caches
  private roomFixturesCache = new Map<string, Array<{ x: number; y: number; range: number }>>();
  private lightPolyCache = new LightPolygonCache();
  private lastPlayerSightPolys: Array<Array<{ x: number; y: number }>> = [];
  private dynamicFansCache = new Map<string, FanMeshData>();
  private lastScreenWidth = 1280;
  private lastScreenHeight = 720;

  // Shared Geometries & Scenes
  private unitQuadGeom = new THREE.PlaneGeometry(1, 1);
  private ndcQuadGeom = new THREE.PlaneGeometry(2, 2);

  private worldScene = new THREE.Scene();
  private losScene = new THREE.Scene();
  private lightMaskScene = new THREE.Scene();
  private compositeScene = new THREE.Scene();
  private postScene = new THREE.Scene();
  private screenOverlayScene = new THREE.Scene();
  private vignetteScene = new THREE.Scene();
  private blitScene = new THREE.Scene();
  private readbackScene = new THREE.Scene();
  private deckBakeWarmScene = new THREE.Scene();
  private deckBakeMaskScene = new THREE.Scene();

  // Cameras
  private worldCamera = new THREE.OrthographicCamera(-640, 640, 360, -360, 0.1, 500);
  private portalCamera = new THREE.OrthographicCamera(-200, 200, 200, -200, 0.1, 500);
  private screenCamera = new THREE.OrthographicCamera(0, 1280, 0, -720, 0.1, 500);
  private ndcCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private deckBakeCamera = new THREE.OrthographicCamera(0, 1000, 0, -1000, 0.1, 500);

  // Render Targets
  private sceneTarget: THREE.RenderTarget | null = null;
  private losTarget: THREE.RenderTarget | null = null;
  private lightMaskTarget: THREE.RenderTarget | null = null;
  private finalTarget: THREE.RenderTarget | null = null;
  private probeTarget: THREE.RenderTarget | null = null;
  private portalTarget: THREE.RenderTarget | null = null;
  private portalLosTarget: THREE.RenderTarget | null = null;
  private deckWarmTarget: THREE.RenderTarget | null = null;
  private deckMaskTarget: THREE.RenderTarget | null = null;
  private deckWarmPixelW = 0;
  private deckWarmPixelH = 0;
  private bakedLightMapRef: ShipMap | null = null;
  private bakedLightDeck: ShipDeck | null = null;
  private bakedLightDoorHash1 = 0;
  private bakedLightDoorHash2 = 0;
  private targetPixelW = 0;
  private targetPixelH = 0;
  private portalPixelSpan = 0;

  // TSL Materials & Quads
  private oceanBundle: OceanMaterialBundle | null = null;
  private oceanMesh: THREE.Mesh | null = null;
  private compositeBundle: CompositeMaterialBundle | null = null;
  private vignetteBundle: VignetteDangerMaterialBundle | null = null;
  private portalBundle: StairPortalMaterialBundle | null = null;
  private portalQuad: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial> | null = null;
  private deckWarmQuad: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial> | null = null;
  private deckWarmTexNode: ReturnType<typeof createBakedLightmapQuadMaterial>['texNode'] | null = null;
  private deckWarmMat: THREE.MeshBasicNodeMaterial | null = null;
  private deckMaskQuad: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial> | null = null;
  private deckMaskTexNode: ReturnType<typeof createBakedLightmapQuadMaterial>['texNode'] | null = null;
  private deckMaskMat: THREE.MeshBasicNodeMaterial | null = null;
  private screenBlitMat: THREE.MeshBasicNodeMaterial | null = null;
  private readbackBlitMat: THREE.MeshBasicNodeMaterial | null = null;
  private screenBlitMesh: THREE.Mesh | null = null;
  private readbackBlitMesh: THREE.Mesh | null = null;
  private compositeQuad: THREE.Mesh | null = null;
  private vignetteQuad: THREE.Mesh | null = null;
  private deckBakeWarmFans: FanBatch | null = null;
  private deckBakeMaskFans: FanBatch | null = null;

  // Pools
  private worldSprites: SpritePool | null = null;
  private postSprites: SpritePool | null = null;
  private screenSprites: SpritePool | null = null;
  private staticWarmFans: FanBatch | null = null;
  private worldWarmFans: FanBatch | null = null;
  private staticMaskFans: FanBatch | null = null;
  private lightMaskFans: FanBatch | null = null;
  private losFans: FanBatch | null = null;
  private portalLosFans: FanBatch | null = null;

  // Dynamic Line Batches
  private wakeLines: DynamicLineBatch | null = null;
  private worldLinesDark: DynamicLineBatch | null = null;
  private worldLinesSteel: DynamicLineBatch | null = null;
  private worldLinesLight: DynamicLineBatch | null = null;
  private worldLinesTeal: DynamicLineBatch | null = null;
  private postLinesSlate: DynamicLineBatch | null = null;
  private postLinesCyan: DynamicLineBatch | null = null;
  private postLinesAmber: DynamicLineBatch | null = null;
  private postLinesRose: DynamicLineBatch | null = null;
  private postLinesOrange: DynamicLineBatch | null = null;
  private postLinesEmerald: DynamicLineBatch | null = null;
  private postLinesRed: DynamicLineBatch | null = null;
  private postLinesWhite: DynamicLineBatch | null = null;
  private ringBatch: ThinRingBatch | null = null;
  private bruteFovFanBatch: FanBatch | null = null;

  // Cached small procedural label textures (black probe labels + stair portal badge)
  private textBadgeCache = new Map<string, SpriteEntry>();
  private readbackQueue: Promise<void> = Promise.resolve();
  private tmpVec2 = new THREE.Vector2();
  private tmpColor = new THREE.Color();

  private setColorFromCss(target: THREE.Color, css: string): THREE.Color {
    if (css.startsWith('rgb')) {
      const m = css.match(/[\d.]+/g);
      if (m && m.length >= 3) {
        target.setRGB(
          Number(m[0]) / 255,
          Number(m[1]) / 255,
          Number(m[2]) / 255,
          THREE.SRGBColorSpace
        );
        return target;
      }
    }
    return target.set(css);
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public getBackendLabel(): string {
    if (!this.initialized) return 'Initializing';
    return this.isWebGPU ? 'WebGPU' : 'WebGL2';
  }

  public async init(canvas: HTMLCanvasElement): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const renderer = new THREE.WebGPURenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
      });
      await renderer.init();

      if (this.disposed) {
        renderer.dispose();
        return;
      }

      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setClearColor(0x000000, 1);

      const backend = renderer.backend as {
        isWebGPUBackend?: boolean;
        device?: GPUDevice;
      };
      this.isWebGPU = Boolean(backend?.isWebGPUBackend);
      this.anisotropy = Math.min(4, renderer.getMaxAnisotropy?.() ?? 1);

      if (this.isWebGPU && backend?.device?.lost) {
        backend.device.lost.then((info) => {
          if (!this.disposed) {
            console.warn('WebGPU device lost:', info?.message ?? info?.reason);
          }
        });
      }

      this.renderer = renderer;
      this.worldCamera.position.set(0, 0, 100);
      this.portalCamera.position.set(0, 0, 100);
      this.screenCamera.position.set(0, 0, 100);
      this.ndcCamera.position.set(0, 0, 5);
      this.deckBakeCamera.position.set(0, 0, 100);

      this.sprites = createDynamicSpriteLibrary(44, this.anisotropy);

      // Ocean background quad
      this.oceanBundle = createOceanMaterial();
      this.oceanMesh = new THREE.Mesh(this.unitQuadGeom, this.oceanBundle.material);
      this.oceanMesh.frustumCulled = false;
      this.oceanMesh.renderOrder = 0;
      this.worldScene.add(this.oceanMesh);

      // Pools
      this.worldSprites = new SpritePool(this.worldScene, this.unitQuadGeom, 8, 96);
      this.postSprites = new SpritePool(this.postScene, this.unitQuadGeom, 1, 24);
      this.screenSprites = new SpritePool(this.screenOverlayScene, this.unitQuadGeom, 2, 16);

      this.staticWarmFans = new FanBatch(this.worldScene, 19, 16384);
      this.worldWarmFans = new FanBatch(this.worldScene, 20, 2048);
      this.staticMaskFans = new FanBatch(this.lightMaskScene, 0, 16384);
      this.lightMaskFans = new FanBatch(this.lightMaskScene, 1, 2048);
      this.deckBakeWarmFans = new FanBatch(this.deckBakeWarmScene, 0, 20480);
      this.deckBakeMaskFans = new FanBatch(this.deckBakeMaskScene, 0, 20480);
      this.losFans = new FanBatch(this.losScene, 0, 1024);
      this.portalLosFans = new FanBatch(this.losScene, 0, 1024);

      // Line batches
      this.wakeLines = new DynamicLineBatch(this.worldScene, 0x7dd3fc, 0.14, 1, 1024);
      this.worldLinesDark = new DynamicLineBatch(this.worldScene, 0x090d14, 0.9, 5, 128);
      this.worldLinesSteel = new DynamicLineBatch(this.worldScene, 0x64748b, 0.95, 5, 128);
      this.worldLinesLight = new DynamicLineBatch(this.worldScene, 0xe2e8f0, 0.95, 5, 128);
      this.worldLinesTeal = new DynamicLineBatch(this.worldScene, 0x2dd4bf, 0.45, 4, 256);

      this.postLinesSlate = new DynamicLineBatch(this.postScene, 0x0f172a, 0.85, 0, 128);
      this.postLinesCyan = new DynamicLineBatch(this.postScene, 0x38bdf8, 0.85, 5, 512);
      this.postLinesAmber = new DynamicLineBatch(this.postScene, 0xfbbf24, 0.9, 5, 256);
      this.postLinesRose = new DynamicLineBatch(this.postScene, 0xf43f5e, 0.78, 5, 1024);
      this.postLinesOrange = new DynamicLineBatch(this.postScene, 0xf97316, 0.78, 5, 512);
      this.postLinesEmerald = new DynamicLineBatch(this.postScene, 0x34d399, 0.85, 5, 128);
      this.postLinesRed = new DynamicLineBatch(this.postScene, 0xef4444, 0.95, 5, 64);
      this.postLinesWhite = new DynamicLineBatch(this.postScene, 0xf8fafc, 0.72, 2, 128);
      this.ringBatch = new ThinRingBatch(this.postScene, 2, 64);

      this.bruteFovFanBatch = new FanBatch(this.postScene, 4, 512);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.ensureRenderTargets(window.innerWidth, window.innerHeight, dpr);
      this.ensurePortalTargets(400);

      this.initialized = true;
    })();

    return this.initPromise;
  }

  private createRt(
    w: number,
    h: number,
    type: THREE.TextureDataType
  ): THREE.RenderTarget {
    const rt = new THREE.RenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type,
      depthBuffer: false,
      stencilBuffer: false,
    });
    rt.texture.generateMipmaps = false;
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
  }

  private ensureRenderTargets(width: number, height: number, dpr: number): void {
    const renderer = this.renderer;
    if (!renderer) return;

    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    renderer.getDrawingBufferSize(this.tmpVec2);
    const pw = Math.max(1, Math.floor(this.tmpVec2.x));
    const ph = Math.max(1, Math.floor(this.tmpVec2.y));

    if (this.targetPixelW === pw && this.targetPixelH === ph && this.finalTarget) {
      return;
    }

    this.targetPixelW = pw;
    this.targetPixelH = ph;

    this.sceneTarget?.dispose();
    this.losTarget?.dispose();
    this.lightMaskTarget?.dispose();
    this.finalTarget?.dispose();
    this.probeTarget?.dispose();

    this.sceneTarget = this.createRt(pw, ph, THREE.HalfFloatType);
    this.losTarget = this.createRt(pw, ph, THREE.UnsignedByteType);
    this.lightMaskTarget = this.createRt(pw, ph, THREE.UnsignedByteType);
    this.finalTarget = this.createRt(pw, ph, THREE.HalfFloatType);
    this.probeTarget = this.createRt(pw, ph, THREE.UnsignedByteType);

    if (!this.compositeBundle) {
      this.compositeBundle = createDarknessCompositeMaterial(
        this.sceneTarget.texture,
        this.losTarget.texture,
        this.lightMaskTarget.texture
      );
      this.compositeQuad = new THREE.Mesh(this.ndcQuadGeom, this.compositeBundle.material);
      this.compositeQuad.frustumCulled = false;
      this.compositeScene.add(this.compositeQuad);
    } else {
      this.compositeBundle.sceneTexNode.value = this.sceneTarget.texture;
      this.compositeBundle.losTexNode.value = this.losTarget.texture;
      this.compositeBundle.lightTexNode.value = this.lightMaskTarget.texture;
    }

    if (!this.vignetteBundle) {
      this.vignetteBundle = createVignetteAndDangerMaterial(this.losTarget.texture);
      this.vignetteQuad = new THREE.Mesh(this.ndcQuadGeom, this.vignetteBundle.material);
      this.vignetteQuad.frustumCulled = false;
      this.vignetteScene.add(this.vignetteQuad);
    } else {
      this.vignetteBundle.losTexNode.value = this.losTarget.texture;
    }

    if (!this.screenBlitMat) {
      const blit = createScreenBlitMaterial(this.finalTarget.texture);
      this.screenBlitMat = blit.material;
      this.screenBlitMesh = new THREE.Mesh(this.ndcQuadGeom, this.screenBlitMat);
      this.screenBlitMesh.frustumCulled = false;
      this.blitScene.add(this.screenBlitMesh);
      (this.screenBlitMesh as unknown as { _texNode: ReturnType<typeof createScreenBlitMaterial>['texNode'] })._texNode = blit.texNode;
    } else {
      const texNode = (this.screenBlitMesh as unknown as { _texNode: ReturnType<typeof createScreenBlitMaterial>['texNode'] })._texNode;
      texNode.value = this.finalTarget.texture;
    }

    if (!this.readbackBlitMat) {
      const rb = createSrgbReadbackBlitMaterial(this.finalTarget.texture);
      this.readbackBlitMat = rb.material;
      this.readbackBlitMesh = new THREE.Mesh(this.ndcQuadGeom, this.readbackBlitMat);
      this.readbackBlitMesh.frustumCulled = false;
      this.readbackScene.add(this.readbackBlitMesh);
      (this.readbackBlitMesh as unknown as { _texNode: ReturnType<typeof createSrgbReadbackBlitMaterial>['texNode'] })._texNode = rb.texNode;
    } else {
      const texNode = (this.readbackBlitMesh as unknown as { _texNode: ReturnType<typeof createSrgbReadbackBlitMaterial>['texNode'] })._texNode;
      texNode.value = this.finalTarget.texture;
    }
  }

  private ensurePortalTargets(pixelSpan: number): void {
    const span = Math.max(64, Math.round(pixelSpan));
    if (this.portalPixelSpan === span && this.portalTarget && this.portalLosTarget) return;

    this.portalPixelSpan = span;
    this.portalTarget?.dispose();
    this.portalLosTarget?.dispose();

    this.portalTarget = this.createRt(span, span, THREE.HalfFloatType);
    this.portalLosTarget = this.createRt(span, span, THREE.UnsignedByteType);

    if (!this.portalBundle) {
      this.portalBundle = createStairPortalMaterial(
        this.portalTarget.texture,
        this.portalLosTarget.texture
      );
      this.portalQuad = new THREE.Mesh(this.unitQuadGeom, this.portalBundle.material);
      this.portalQuad.frustumCulled = false;
      this.portalQuad.renderOrder = 0;
      this.screenOverlayScene.add(this.portalQuad);
    } else {
      this.portalBundle.portalTexNode.value = this.portalTarget.texture;
      this.portalBundle.portalLosTexNode.value = this.portalLosTarget.texture;
    }
  }

  private ensureMapBaked(map: ShipMap): void {
    if (this.bakedMapRef === map) return;

    for (const ch of this.deckChunkMeshes) {
      this.worldScene.remove(ch.mesh);
      ch.geom.dispose();
      ch.mat.dispose();
    }
    this.deckChunkMeshes = [];
    this.bakedShip?.dispose();
    this.bakedShip = null;

    this.roomFixturesCache.clear();
    this.lightPolyCache.clear();
    this.staticWarmFans?.clear();
    this.worldWarmFans?.clear();
    this.staticMaskFans?.clear();
    this.lightMaskFans?.clear();
    this.dynamicFansCache.clear();
    this.bakedLightMapRef = null;
    this.bakedLightDeck = null;

    this.bakedShip = bakeShipDeckChunks(map, this.anisotropy);
    this.bakedMapRef = map;

    for (const ch of this.bakedShip.chunks) {
      const geom = new THREE.PlaneGeometry(ch.wPx, ch.hPx);
      const mat = new THREE.MeshBasicMaterial({
        map: ch.texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(ch.xPx + ch.wPx * 0.5, -(ch.yPx + ch.hPx * 0.5), 0);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      this.worldScene.add(mesh);
      this.deckChunkMeshes.push({ deck: ch.deck, mesh, geom, mat });
    }

    // Precompute all room light fixture coordinates once per map
    for (const sw of map.lightSwitches) {
      this.roomFixturesCache.set(sw.id, this.computeRoomLightFixturesOnce(map, sw));
    }
  }

  private findNearestWalkableInRoom(
    map: ShipMap,
    roomId: number,
    targetX: number,
    targetY: number
  ): { x: number; y: number } {
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

  private computeRoomLightFixturesOnce(
    map: ShipMap,
    sw: RoomLightSwitch
  ): Array<{ x: number; y: number; range: number }> {
    const ts = map.tileSize;
    const rm = map.rooms.find((r) => r.id === sw.roomId);
    if (!rm) {
      return [{ x: sw.x, y: sw.y, range: 360 }];
    }

    const rW = (rm.x2 - rm.x1 + 1) * ts;
    const rH = (rm.y2 - rm.y1 + 1) * ts;
    const rcx = ((rm.x1 + rm.x2 + 1) / 2) * ts;
    const rcy = ((rm.y1 + rm.y2 + 1) / 2) * ts;
    const centerPt = this.findNearestWalkableInRoom(map, sw.roomId, rcx, rcy);
    const range = Math.max(310, Math.hypot(rW, rH) * 0.65 + 175);

    const fixtures: Array<{ x: number; y: number; range: number }> = [
      { x: centerPt.x, y: centerPt.y, range },
    ];

    if (rm.x2 - rm.x1 >= 7) {
      const leftPt = this.findNearestWalkableInRoom(map, sw.roomId, (rm.x1 + 1.5) * ts, rcy);
      const rightPt = this.findNearestWalkableInRoom(map, sw.roomId, (rm.x2 - 0.5) * ts, rcy);
      if (Math.hypot(leftPt.x - centerPt.x, leftPt.y - centerPt.y) > ts * 1.8) {
        fixtures.push({ x: leftPt.x, y: leftPt.y, range: range * 0.9 });
      }
      if (Math.hypot(rightPt.x - centerPt.x, rightPt.y - centerPt.y) > ts * 1.8) {
        fixtures.push({ x: rightPt.x, y: rightPt.y, range: range * 0.9 });
      }
    }

    return fixtures;
  }

  private getTextBadge(
    key: string,
    text: string,
    options: {
      font: string;
      textColor: string;
      bgColor?: string;
      borderColor?: string;
      padX?: number;
      height?: number;
    }
  ): SpriteEntry {
    const existing = this.textBadgeCache.get(key);
    if (existing) return existing;

    const c = document.createElement('canvas');
    const measureCtx = c.getContext('2d')!;
    measureCtx.font = options.font;
    const textW = measureCtx.measureText(text).width;
    const padX = options.padX ?? 9;
    const w = Math.ceil(textW + padX * 2);
    const h = options.height ?? 22;
    const scale = 2;
    c.width = w * scale;
    c.height = h * scale;
    const ctx = c.getContext('2d')!;
    ctx.scale(scale, scale);

    if (options.bgColor) {
      ctx.fillStyle = options.bgColor;
      ctx.beginPath();
      ctx.roundRect(0.5, 0.5, w - 1, h - 1, 3);
      ctx.fill();
    }
    if (options.borderColor) {
      ctx.strokeStyle = options.borderColor;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(0.5, 0.5, w - 1, h - 1, 3);
      ctx.stroke();
    }

    ctx.font = options.font;
    ctx.fillStyle = options.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 0.5);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    const entry: SpriteEntry = { texture: tex, w, h };
    this.textBadgeCache.set(key, entry);
    return entry;
  }

  private buildDynamicFan(
    slotKey: string,
    ox: number,
    oy: number,
    poly: Array<{ x: number; y: number }>,
    closedLoop: boolean
  ): FanMeshData {
    const prev = this.dynamicFansCache.get(slotKey);
    const next = buildVisibilityFanBuffers(ox, oy, poly, closedLoop, prev);
    this.dynamicFansCache.set(slotKey, next);
    return next;
  }

  public render(
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    timeSec: number
  ): void {
    if (!this.initialized || !this.renderer || !this.sprites) return;
    if (width <= 0 || height <= 0) return;

    this.lastScreenWidth = width;
    this.lastScreenHeight = height;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.ensureRenderTargets(width, height, dpr);
    this.ensureMapBaked(engine.map);

    const renderer = this.renderer;
    const shakeX = engine.screenShake > 0 ? (Math.random() - 0.5) * engine.screenShake : 0;
    const shakeY = engine.screenShake > 0 ? (Math.random() - 0.5) * engine.screenShake : 0;
    const zoom = engine.getEffectiveZoom(width, height);
    const camWorldX = engine.cameraX - shakeX / zoom;
    const camWorldY = engine.cameraY - shakeY / zoom;
    const viewCenterX = width / 2 + shakeX;
    const viewCenterY = height / 2 + shakeY;

    const halfW = width / (2 * zoom);
    const halfH = height / (2 * zoom);
    this.worldCamera.left = -halfW;
    this.worldCamera.right = halfW;
    this.worldCamera.top = halfH;
    this.worldCamera.bottom = -halfH;
    this.worldCamera.position.set(camWorldX, -camWorldY, 100);
    this.worldCamera.updateProjectionMatrix();

    if (this.oceanBundle && this.oceanMesh) {
      this.oceanBundle.uTime.value = timeSec;
      this.oceanMesh.position.set(camWorldX, -camWorldY, 0);
      this.oceanMesh.scale.set(halfW * 2.4, halfH * 2.4, 1);
    }

    const activeDeck = engine.getCurrentDeck();
    const incomingStairId = engine.getBruteIncomingStairDestId();

    const peekStair =
      engine.player.peekingStairId !== null &&
      engine.player.hidingSpotId === null &&
      engine.player.climbingStairId === null
        ? engine.map.stairwells.find((s) => s.id === engine.player.peekingStairId)
        : undefined;
    const peekDest = peekStair
      ? engine.map.stairwells.find((s) => s.id === peekStair.targetStairId)
      : undefined;

    const activeDeckPowered = engine.poweredDecks[activeDeck];
    if (activeDeckPowered) {
      this.ensureDeckPoweredLightmap(engine, activeDeck);
    }

    // Precompute raycasted lighting polygons (skipped on activeDeck when pre-baked by Master Fuse!)
    const litRoomPolys = this.computeLitRoomPolygons(
      engine,
      timeSec,
      activeDeck,
      camWorldX,
      camWorldY,
      halfW,
      halfH,
      peekDest,
      activeDeckPowered
    );
    const bruteBeam = this.computeBruteBeamPolygon(engine, timeSec);
    const stairGlow = this.computeIncomingStairGlow(engine, incomingStairId, timeSec);
    const doorPeekData = this.computeDoorPeekBeam(engine);

    // 1. Populate & render WORLD SCENE -> sceneTarget
    this.populateWorldScene(
      engine,
      activeDeck,
      camWorldX,
      camWorldY,
      width,
      height,
      zoom,
      timeSec,
      incomingStairId,
      litRoomPolys,
      bruteBeam,
      stairGlow,
      doorPeekData,
      true
    );

    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(this.worldScene, this.worldCamera);

    // 2. Populate & render PLAYER LoS MASK -> losTarget
    const sightPolys = this.computePlayerSightPolys(
      engine,
      width,
      height,
      zoom,
      doorPeekData
    );
    this.lastPlayerSightPolys = sightPolys;
    this.populateLosScene(sightPolys, engine.player.x, engine.player.y);
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.losTarget);
    renderer.render(this.losScene, this.worldCamera);

    // 3. Populate & render LIGHT MASK -> lightMaskTarget
    this.populateLightMaskScene(
      engine,
      timeSec,
      litRoomPolys,
      bruteBeam,
      stairGlow,
      doorPeekData
    );
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.lightMaskTarget);
    renderer.render(this.lightMaskScene, this.worldCamera);

    // 4. Composite scene * (los * light) -> finalTarget
    renderer.setRenderTarget(this.finalTarget);
    renderer.render(this.compositeScene, this.ndcCamera);

    // 5. Post-darkness perceptual overlays (switch LEDs, stair beacons, Brute eyes, ripples, halo, debug)
    this.populatePostScene(
      engine,
      width,
      height,
      zoom,
      camWorldX,
      camWorldY,
      timeSec,
      incomingStairId
    );
    renderer.autoClear = false;
    renderer.render(this.postScene, this.worldCamera);

    // 6. Optional circular stairwell landing peek portal
    this.screenSprites?.beginFrame();
    if (this.portalQuad) this.portalQuad.visible = false;

    if (peekStair && peekDest) {
      this.renderStairPeekPortalPass(
        engine,
        peekStair,
        peekDest,
        viewCenterX,
        viewCenterY,
        zoom,
        width,
        height,
        dpr,
        timeSec,
        litRoomPolys,
        bruteBeam
      );
    }

    this.screenSprites?.endFrame();
    if (peekStair && peekDest) {
      this.screenCamera.left = 0;
      this.screenCamera.right = width;
      this.screenCamera.top = 0;
      this.screenCamera.bottom = -height;
      this.screenCamera.updateProjectionMatrix();
      renderer.setRenderTarget(this.finalTarget);
      renderer.autoClear = false;
      renderer.render(this.screenOverlayScene, this.screenCamera);
    }

    // 7. Screen vignette & LoS-clipped danger / steam condensation fog
    this.updateVignetteUniforms(engine, width, height, timeSec);
    renderer.setRenderTarget(this.finalTarget);
    renderer.autoClear = false;
    renderer.render(this.vignetteScene, this.ndcCamera);

    // 8. Final screen blit -> canvas (null)
    renderer.autoClear = true;
    renderer.setRenderTarget(null);
    renderer.render(this.blitScene, this.ndcCamera);
  }

  private setDeckChunksVisible(deck: ShipDeck): void {
    for (const ch of this.deckChunkMeshes) {
      ch.mesh.visible = ch.deck === deck;
    }
  }

  private populateWorldScene(
    engine: MonstrumGameEngine,
    renderDeck: ShipDeck,
    camX: number,
    camY: number,
    width: number,
    height: number,
    zoom: number,
    timeSec: number,
    incomingStairId: string | null,
    litRoomPolys: RayLightPoly[],
    bruteBeam: BruteBeamData | null,
    stairGlow: StairGlowData | null,
    doorPeekData: DoorPeekBeamData | null,
    includePlayer: boolean
  ): void {
    const sp = this.sprites!;
    const ws = this.worldSprites!;
    const swf = this.staticWarmFans!;
    const wf = this.worldWarmFans!;

    ws.beginFrame();
    swf.beginFrame();
    wf.beginFrame();
    this.wakeLines!.beginFrame();
    this.worldLinesDark!.beginFrame();
    this.worldLinesSteel!.beginFrame();
    this.worldLinesLight!.beginFrame();
    this.worldLinesTeal!.beginFrame();

    this.setDeckChunksVisible(renderDeck);
    if (this.deckWarmQuad) {
      this.deckWarmQuad.visible =
        renderDeck === this.bakedLightDeck && engine.poweredDecks[renderDeck];
    }

    const ts = engine.map.tileSize;
    const halfW = width / (2 * zoom) + 140;
    const halfH = height / (2 * zoom) + 140;

    // Hull-hugging sea-foam wake on active deck
    if (this.bakedShip) {
      const bounds = engine.map.deckBounds[renderDeck];
      if (
        camY + halfH >= bounds.y1 * ts - 40 &&
        camY - halfH <= (bounds.y2 + 1) * ts + 40
      ) {
        for (const we of this.bakedShip.wakeEdges) {
          if (we.deck !== renderDeck) continue;
          if (
            we.x2 < camX - halfW ||
            we.x1 > camX + halfW ||
            we.y1 < camY - halfH - 20 ||
            we.y1 > camY + halfH + 20
          ) {
            continue;
          }
          const wave = Math.sin(timeSec * 1.8 + we.phase) * 2.5;
          const midX = (we.x1 + we.x2) * 0.5;
          const midY = we.y1 + we.midYOffset - (we.midYOffset < 0 ? wave : -wave);
          const endY = we.midYOffset < 0 ? we.y1 + wave : we.y1 - wave;
          this.wakeLines!.addSegment(we.x1, endY, midX, midY);
          this.wakeLines!.addSegment(midX, midY, we.x2, endY);
        }
      }
    }

    // Floodgate lever dynamic sprite (Deck 1)
    for (const prop of engine.map.props) {
      if (prop.deck !== renderDeck || prop.kind !== 'FLOODGATE_LEVER') continue;
      const lx = (prop.tx + 0.5) * ts;
      const ly = (prop.ty + 0.5) * ts;
      if (Math.abs(lx - camX) > halfW || Math.abs(ly - camY) > halfH) continue;
      const subPartsDone = engine.escape.submarineParts.length === 3;
      const subActiveOrReady = engine.escape.submarineState !== 'IDLE';
      const mode = subActiveOrReady ? 'active' : subPartsDone ? 'ready' : 'idle';
      ws.place(sp.floodgateLeverBase[mode], lx, ly, { renderOrder: 8 });
    }

    // Escape Zones (only on their respective decks)
    if (renderDeck === 'DECK_3') {
      this.drawHelideckSprites(engine, timeSec);
    } else if (renderDeck === 'DECK_2') {
      this.drawLifeboatSprites(engine, timeSec);
    } else if (renderDeck === 'DECK_1') {
      this.drawSubmarineSprites(engine, timeSec);
    }

    // Stairwells
    for (const st of engine.map.stairwells) {
      if (st.deck !== renderDeck) continue;
      if (Math.abs(st.x - camX) > halfW || Math.abs(st.y - camY) > halfH) continue;
      const isBruteComing = st.id === incomingStairId;
      const mode = isBruteComing ? 'COMING' : st.direction;
      if (isBruteComing) {
        const pulse = 0.65 + 0.35 * Math.sin(timeSec * 10);
        ws.place(sp.softDisc, st.x, st.y, {
          scaleX: 68 / sp.softDisc.w,
          scaleY: 68 / sp.softDisc.h,
          tint: 0xff7300,
          opacity: 0.78 * pulse,
          renderOrder: 6,
        });
      }
      ws.place(sp.stairwell[mode], st.x, st.y, { renderOrder: 6 });
    }

    // Steam Pipes
    for (const pipe of engine.map.steamPipes) {
      if (pipe.deck !== renderDeck) continue;
      if (Math.abs(pipe.x - camX) > halfW + 100 || Math.abs(pipe.y - camY) > halfH + 100) {
        continue;
      }
      const wallCx = (pipe.wallTx + 0.5) * ts;
      const wallCy = (pipe.wallTy + 0.5) * ts;
      const edgeX = wallCx + pipe.dirX * (ts * 0.48);
      const edgeY = wallCy + pipe.dirY * (ts * 0.48);
      const angle = Math.atan2(pipe.dirY, pipe.dirX);
      const isWarn = pipe.warningTimer > 0;
      const isActive = pipe.activeTimer > 0;
      const mode = isActive ? 'active' : isWarn ? 'warn' : 'idle';
      ws.place(sp.steamNozzle[mode], edgeX, edgeY, { rot2d: angle, renderOrder: 7 });

      if (isWarn) {
        const wPulse = 0.35 + 0.25 * Math.sin(timeSec * 24);
        ws.place(sp.softDisc, edgeX + pipe.dirX * 10, edgeY + pipe.dirY * 10, {
          scaleX: 52 / sp.softDisc.w,
          scaleY: 52 / sp.softDisc.h,
          tint: 0xfde047,
          opacity: wPulse,
          renderOrder: 7,
        });
      }

      if (isActive) {
        const clippedTiles = engine.getSteamPipeClippedRangeTiles(pipe);
        if (clippedTiles > 0) {
          const jetLen = clippedTiles * ts - 4;
          const wobble = Math.sin(timeSec * 36 + pipe.wallTx) * 0.08;
          ws.place(
            sp.steamJet,
            edgeX + pipe.dirX * (jetLen * 0.5),
            edgeY + pipe.dirY * (jetLen * 0.5),
            {
              rot2d: angle,
              scaleX: jetLen / sp.steamJet.w,
              scaleY: 1 + wobble,
              renderOrder: 7,
            }
          );
        }
      }
    }

    // Paper Map Stands
    for (const stand of engine.map.paperMaps) {
      if (stand.deck !== renderDeck) continue;
      if (Math.abs(stand.x - camX) > halfW || Math.abs(stand.y - camY) > halfH) continue;
      ws.place(sp.paperMapBase, stand.x, stand.y, { renderOrder: 8 });
      const pulse = 0.65 + 0.35 * Math.sin(timeSec * 4.5);
      ws.place(sp.softDisc, stand.x + 2, stand.y - 1, {
        scaleX: 4.8 / sp.softDisc.w,
        scaleY: 4.8 / sp.softDisc.h,
        tint: 0xdc2626,
        opacity: pulse,
        renderOrder: 8,
      });
    }

    // Fuse Sockets
    for (const fs of engine.map.fuseSockets) {
      if (fs.deck !== renderDeck) continue;
      if (Math.abs(fs.x - camX) > halfW || Math.abs(fs.y - camY) > halfH) continue;
      ws.place(fs.hasFuse ? sp.fuseSocketLoaded : sp.fuseSocketEmpty, fs.x, fs.y, {
        renderOrder: 8,
      });
      if (fs.hasFuse) {
        const arc = 0.72 + 0.28 * Math.sin(timeSec * 8);
        ws.place(sp.softDisc, fs.x, fs.y, {
          scaleX: 5.5 / sp.softDisc.w,
          scaleY: 5.5 / sp.softDisc.h,
          tint: 0x34d399,
          opacity: arc,
          renderOrder: 8,
        });
      } else {
        const blink = Math.sin(timeSec * 4.5) > 0;
        ws.place(sp.softDisc, fs.x, fs.y - 10, {
          scaleX: 4.5 / sp.softDisc.w,
          scaleY: 4.5 / sp.softDisc.h,
          tint: blink ? 0xef4444 : 0x7f1d1d,
          opacity: 1,
          renderOrder: 8,
        });
      }
    }

    // Containers
    for (const c of engine.map.containers) {
      if ((engine.map.deckGrid[c.ty]?.[c.tx] ?? 'DECK_2') !== renderDeck) continue;
      if (Math.abs(c.x - camX) > halfW || Math.abs(c.y - camY) > halfH) continue;
      const key = `${c.type}:${c.searched ? 1 : 0}` as const;
      ws.place(sp.containers[key], c.x, c.y, { renderOrder: 8 });
    }

    // Hiding Spots
    for (const s of engine.map.hidingSpots) {
      if ((engine.map.deckGrid[s.ty]?.[s.tx] ?? 'DECK_2') !== renderDeck) continue;
      if (Math.abs(s.x - camX) > halfW || Math.abs(s.y - camY) > halfH) continue;
      const mode =
        s.checkedFlash > 0 ? 'flash' : engine.player.hidingSpotId === s.id ? 'occupied' : 'normal';
      const key = `${s.type}:${mode}` as const;
      ws.place(sp.hidingSpots[key], s.x, s.y, { renderOrder: 8 });
    }

    // Light Switches
    for (const sw of engine.map.lightSwitches) {
      const swDeck = engine.map.deckGrid[sw.ty]?.[sw.tx] ?? 'DECK_2';
      if (swDeck !== renderDeck) continue;
      if (Math.abs(sw.x - camX) > halfW || Math.abs(sw.y - camY) > halfH) continue;
      const deckPowered = engine.poweredDecks[swDeck];
      const mode = deckPowered ? 'powered' : sw.isOn ? 'on' : 'off';
      ws.place(sp.lightSwitchBase[mode], sw.x, sw.y, { renderOrder: 8 });
    }

    // Doors
    for (const d of engine.map.doors) {
      if ((engine.map.deckGrid[d.ty]?.[d.tx] ?? 'DECK_2') !== renderDeck) continue;
      const cx = (d.tx + 0.5) * ts;
      const cy = (d.ty + 0.5) * ts;
      if (Math.abs(cx - camX) > halfW || Math.abs(cy - camY) > halfH) continue;

      if (d.isBroken) {
        ws.place(d.orientation === 'H' ? sp.doorBrokenH : sp.doorBrokenV, cx, cy, {
          renderOrder: 9,
        });
        continue;
      }

      const baseRot = d.orientation === 'V' ? Math.PI / 2 : 0;
      ws.place(sp.doorThreshold, cx, cy, { rot2d: baseRot, renderOrder: 9 });

      const kind = d.isLocked ? 'locked' : d.isWatertight ? 'watertight' : 'normal';
      if (d.openProgress > 0.02) {
        const hingeOffset = -ts / 2 + 4;
        const hx = d.orientation === 'H' ? cx + hingeOffset : cx;
        const hy = d.orientation === 'H' ? cy : cy + hingeOffset;
        ws.place(sp.doorLeaf[kind], hx, hy, {
          rot2d: baseRot - d.openProgress * 1.38,
          renderOrder: 9,
        });
      } else {
        ws.place(sp.doorClosed[kind], cx, cy, { rot2d: baseRot, renderOrder: 9 });
      }

      if (d.lockCut) {
        ws.place(sp.doorPadlockDebris, cx, cy, { rot2d: baseRot, renderOrder: 9 });
      }
    }

    // Dropped Lights
    for (const l of engine.droppedLights) {
      const lTx = Math.floor(l.x / ts);
      const lTy = Math.floor(l.y / ts);
      if ((engine.map.deckGrid[lTy]?.[lTx] ?? 'DECK_2') !== renderDeck) continue;
      if (Math.abs(l.x - camX) > halfW || Math.abs(l.y - camY) > halfH) continue;
      if (l.type === 'GLOWSTICK') {
        ws.place(sp.glowstick, l.x, l.y, { renderOrder: 10 });
      } else {
        const flicker = (4 + Math.sin(timeSec * 28) * 1.5) * 2;
        ws.place(sp.softDisc, l.x, l.y, {
          scaleX: flicker / sp.softDisc.w,
          scaleY: flicker / sp.softDisc.h,
          tint: 0xfb7185,
          opacity: 1,
          renderOrder: 10,
        });
      }
    }

    // World Pickups
    for (const wp of engine.worldPickups) {
      if (wp.deck !== renderDeck) continue;
      if (Math.abs(wp.x - camX) > halfW || Math.abs(wp.y - camY) > halfH) continue;
      const pulse = 1 + Math.sin(timeSec * 5 + wp.id) * 0.14;
      const haloColor =
        wp.item === 'BACKPACK'
          ? 0xf97316
          : wp.item === 'MASTER_FUSE' ||
              wp.item === 'AVIATION_FUEL' ||
              wp.item === 'IGNITION_KEY' ||
              wp.item === 'ROTOR_FUSE'
            ? 0xfbbf24
            : wp.item === 'WINCH_CRANK' ||
                wp.item === 'MARINE_BATTERY' ||
                wp.item === 'HULL_PATCH'
              ? 0x38bdf8
              : wp.item === 'SUB_BATTERY' ||
                  wp.item === 'BALLAST_PUMP' ||
                  wp.item === 'DIVE_KEY'
                ? 0x2dd4bf
                : 0xa3e635;
      ws.place(sp.softRing, wp.x, wp.y, {
        scaleX: (24 * pulse) / sp.softRing.w,
        scaleY: (24 * pulse) / sp.softRing.h,
        tint: haloColor,
        opacity: wp.item === 'MASTER_FUSE' ? 0.85 : 0.65,
        renderOrder: 10,
      });
      ws.place(sp.pickups[wp.item], wp.x, wp.y, { renderOrder: 10 });
    }

    // Particles (filtered to renderDeck bounds)
    const bounds = engine.map.deckBounds[renderDeck];
    const deckMinY = bounds.y1 * ts;
    const deckMaxY = (bounds.y2 + 1) * ts;
    for (const pt of engine.particles) {
      if (pt.y < deckMinY || pt.y > deckMaxY) continue;
      if (Math.abs(pt.x - camX) > halfW || Math.abs(pt.y - camY) > halfH) continue;
      const alpha = Math.max(0, pt.life / pt.maxLife);
      this.setColorFromCss(this.tmpColor, pt.color);
      ws.place(sp.softDisc, pt.x, pt.y, {
        scaleX: (pt.size * 2.2) / sp.softDisc.w,
        scaleY: (pt.size * 2.2) / sp.softDisc.h,
        tint: this.tmpColor.getHex(),
        opacity: alpha,
        renderOrder: 11,
      });
    }

    // Player
    if (includePlayer && engine.player.hidingSpotId === null) {
      this.drawPlayerSprites(engine, timeSec);
    }

    // Brute (only if on renderDeck & not climbing)
    const b = engine.brute;
    const bTy = Math.floor(b.y / ts);
    if (b.stairClimbTimer <= 0 && bTy >= bounds.y1 && bTy <= bounds.y2) {
      this.drawBruteSprites(engine, timeSec);
    }

    // Warm Lighting Tints (wall-blocked visibility fans)
    this.populateWarmLightingTints(
      engine,
      renderDeck,
      litRoomPolys,
      bruteBeam,
      stairGlow,
      doorPeekData,
      timeSec
    );

    ws.endFrame();
    swf.endFrame();
    wf.endFrame();
    this.wakeLines!.endFrame();
    this.worldLinesDark!.endFrame();
    this.worldLinesSteel!.endFrame();
    this.worldLinesLight!.endFrame();
    this.worldLinesTeal!.endFrame();
  }

  private drawHelideckSprites(engine: MonstrumGameEngine, timeSec: number): void {
    const sp = this.sprites!;
    const ws = this.worldSprites!;
    const esc = engine.escape;

    const hx = engine.map.heliPos.x + 14;
    const hy = engine.map.heliPos.y;
    const hasFuel = esc.heliParts.includes('AVIATION_FUEL');
    const hasFuse = esc.heliParts.includes('ROTOR_FUSE');
    const hasKey = esc.heliParts.includes('IGNITION_KEY');
    const heliReady = esc.heliState === 'READY';
    const heliActivating = esc.heliState === 'ACTIVATING';
    const heliSpool = heliReady ? 1 : heliActivating ? esc.heliActivationProgress : 0;

    const padMode = heliReady ? 'ready' : esc.heliParts.length === 3 ? 'parts3' : 'idle';
    ws.place(sp.heliPad[padMode], hx, hy, { renderOrder: 3 });

    // Corner strobes
    const strobeOn = Math.sin(timeSec * (heliReady ? 6 : 12)) > 0;
    for (const [sx, sy] of [
      [-52, -48],
      [52, -48],
      [-52, 48],
      [52, 48],
    ]) {
      if (heliReady || (heliActivating && strobeOn)) {
        ws.place(sp.softDisc, hx + sx, hy + sy, {
          scaleX: 6 / sp.softDisc.w,
          scaleY: 6 / sp.softDisc.h,
          tint: heliReady ? 0x34d399 : 0xf59e0b,
          opacity: 1,
          renderOrder: 3,
        });
      } else {
        ws.place(sp.softDisc, hx + sx, hy + sy, {
          scaleX: 4.5 / sp.softDisc.w,
          scaleY: 4.5 / sp.softDisc.h,
          tint: hasFuse ? 0xfbbf24 : 0x334155,
          opacity: hasFuse ? 0.45 : 1,
          renderOrder: 3,
        });
      }
    }

    const lx = engine.map.heliPos.x;
    const ly = engine.map.heliPos.y;
    const heliVibX = heliSpool > 0.15 ? Math.sin(timeSec * 52) * heliSpool * 0.9 : 0;
    const heliVibY = heliSpool > 0.15 ? Math.cos(timeSec * 46) * heliSpool * 0.9 : 0;
    const cx = lx + heliVibX;
    const cy = ly + heliVibY;

    ws.place(sp.heliFuselage, cx, cy, { renderOrder: 4 });
    ws.place(sp.heliFuelPort[hasFuel ? 'filled' : 'empty'], cx - 6, cy - 15, {
      renderOrder: 4,
    });
    ws.place(sp.heliFuseBay[hasFuse ? 'filled' : 'empty'], cx - 1.5, cy + 14.75, {
      renderOrder: 4,
    });
    if (!hasFuse && Math.sin(timeSec * 19) > 0.78) {
      ws.place(sp.softDisc, cx - 2, cy + 14.5, {
        scaleX: 5 / sp.softDisc.w,
        scaleY: 5 / sp.softDisc.h,
        tint: 0xfde047,
        opacity: 1,
        renderOrder: 5,
      });
    }
    ws.place(sp.heliCockpit[hasKey ? 'filled' : 'empty'], cx + 22, cy, { renderOrder: 4 });

    if (hasKey && Math.sin(timeSec * 5) > -0.3) {
      ws.place(sp.softDisc, cx + 8, cy - 14.5, {
        scaleX: 5 / sp.softDisc.w,
        scaleY: 5 / sp.softDisc.h,
        tint: 0xef4444,
        opacity: 1,
        renderOrder: 5,
      });
      ws.place(sp.softDisc, cx + 8, cy + 14.5, {
        scaleX: 5 / sp.softDisc.w,
        scaleY: 5 / sp.softDisc.h,
        tint: 0x22c55e,
        opacity: 1,
        renderOrder: 5,
      });
    }

    // 6 Tie-Down Chains
    const chainSpecs: Array<{ fx: number; fy: number; bx: number; by: number }> = [
      { fx: 20, fy: -12, bx: 44, by: -36 },
      { fx: 20, fy: 12, bx: 44, by: 36 },
      { fx: 2, fy: -15, bx: 4, by: -44 },
      { fx: 2, fy: 15, bx: 4, by: 44 },
      { fx: -18, fy: -11, bx: -42, by: -36 },
      { fx: -18, fy: 11, bx: -42, by: 36 },
    ];
    for (let i = 0; i < chainSpecs.length; i++) {
      const cs = chainSpecs[i];
      const intact = i < esc.heliChainsRemaining;
      ws.place(sp.heliBollard[intact ? 'intact' : 'cut'], cx + cs.bx, cy + cs.by, {
        renderOrder: 3,
      });
      if (intact) {
        this.worldLinesDark!.addSegment(cx + cs.fx, cy + cs.fy, cx + cs.bx, cy + cs.by);
        this.worldLinesLight!.addDashedSegment(
          cx + cs.fx,
          cy + cs.fy,
          cx + cs.bx,
          cy + cs.by,
          4,
          3
        );
        ws.place(
          sp.softDisc,
          cx + (cs.fx + cs.bx) * 0.5,
          cy + (cs.fy + cs.by) * 0.5,
          {
            scaleX: 6 / sp.softDisc.w,
            scaleY: 6 / sp.softDisc.h,
            tint: 0xf59e0b,
            opacity: 1,
            renderOrder: 5,
          }
        );
      } else {
        const dx = cs.fx - cs.bx;
        const dy = cs.fy - cs.by;
        const d = Math.hypot(dx, dy) || 1;
        this.worldLinesSteel!.addSegment(
          cx + cs.bx,
          cy + cs.by,
          cx + cs.bx + (dx / d) * 7,
          cy + cs.by + (dy / d) * 7
        );
      }
    }

    // Rotor assembly
    const rotorAngle = heliSpool > 0 ? timeSec * (2 + heliSpool * 24) : 0.42;
    if (heliSpool > 0.22) {
      const discAlpha = Math.min(0.32, (heliSpool - 0.22) * 0.42) / 0.35;
      ws.place(sp.heliRotorDisc, cx, cy, {
        opacity: Math.min(1, discAlpha),
        renderOrder: 5,
      });
    }
    const bladeAlpha = heliSpool > 0.5 ? 0.45 : 0.85;
    ws.place(sp.heliRotorBlades, cx, cy, {
      rot2d: rotorAngle,
      opacity: bladeAlpha,
      renderOrder: 5,
    });
  }

  private drawLifeboatSprites(engine: MonstrumGameEngine, timeSec: number): void {
    const sp = this.sprites!;
    const ws = this.worldSprites!;
    const ts = engine.map.tileSize;
    const esc = engine.escape;

    const bx = engine.map.lifeboatPos.x;
    const by = engine.map.lifeboatPos.y;
    const bTx = engine.map.lifeboatPos.tx;
    const bTy = engine.map.lifeboatPos.ty;
    const voidNorth = engine.map.tiles[bTy - 1]?.[bTx] === 'VOID';
    const outSign = voidNorth ? -1 : 1;

    const hasPatch = esc.lifeboatParts.includes('HULL_PATCH');
    const hasCrank = esc.lifeboatParts.includes('WINCH_CRANK');
    const hasBattery = esc.lifeboatParts.includes('MARINE_BATTERY');
    const boatReady = esc.lifeboatState === 'READY';
    const boatActivating = esc.lifeboatState === 'ACTIVATING';
    const craneSwing = boatReady ? 1 : boatActivating ? esc.lifeboatActivationProgress : 0;

    const inboardY = by - outSign * 14;
    const swingOutDist = craneSwing * 36;
    const boatY = by - outSign * 2 + outSign * swingOutDist;
    const boatX = bx + 16;
    const boatBob = boatReady ? Math.sin(timeSec * 2.8) * 1.4 : 0;

    const plateMode = boatReady ? 'ready' : esc.lifeboatParts.length === 3 ? 'parts3' : 'idle';
    ws.place(sp.lifeboatDeckPlate[plateMode], bx + ts * 0.5 - 2, by + ts * 0.5 - 16, {
      renderOrder: 3,
    });

    const leftPedX = bx - 8;
    const rightPedX = bx + 40;
    const armReach = 12 + swingOutDist * 1.05;
    const tipY = inboardY + outSign * armReach;
    for (const px of [leftPedX, rightPedX]) {
      ws.place(sp.lifeboatPedestal, px, inboardY, { renderOrder: 4 });
      this.worldLinesDark!.addSegment(px + 2, inboardY + 2, px + 2, tipY + 2);
      this.worldLinesSteel!.addSegment(px, inboardY, px, tipY);
      ws.place(sp.softDisc, px, tipY, {
        scaleX: 7 / sp.softDisc.w,
        scaleY: 7 / sp.softDisc.h,
        tint: 0xf59e0b,
        opacity: 1,
        renderOrder: 5,
      });
    }

    const winchX = (leftPedX + rightPedX) / 2;
    ws.place(sp.lifeboatWinch, winchX, inboardY, { renderOrder: 4 });
    if (hasCrank) {
      const crankAng = boatActivating ? timeSec * 9 : 0.6;
      ws.place(sp.softRing, winchX + 12, inboardY, {
        scaleX: 11 / sp.softRing.w,
        scaleY: 11 / sp.softRing.h,
        tint: 0xcbd5e1,
        opacity: 1,
        renderOrder: 5,
      });
      this.worldLinesLight!.addSegment(
        winchX + 12,
        inboardY,
        winchX + 12 + Math.cos(crankAng) * 7,
        inboardY + Math.sin(crankAng) * 7
      );
    }

    const batX = bx - 14;
    const batY = inboardY - outSign * 4;
    ws.place(sp.lifeboatBattery[hasBattery ? 'filled' : 'empty'], batX, batY, {
      renderOrder: 4,
    });
    if (hasBattery && (boatActivating || boatReady)) {
      ws.place(sp.softDisc, boatX, boatY, {
        scaleX: 84 / sp.softDisc.w,
        scaleY: 84 / sp.softDisc.h,
        tint: boatReady ? 0x34d399 : 0x38bdf8,
        opacity: boatReady ? 0.25 : 0.22,
        renderOrder: 4,
      });
    }

    const hullMode = boatReady ? 'ready' : hasPatch ? 'patched' : 'cracked';
    ws.place(sp.lifeboatHull[hullMode], boatX, boatY + boatBob, { renderOrder: 5 });

    // Hoist cables
    const cableLines = hasCrank ? this.worldLinesLight! : this.worldLinesSteel!;
    cableLines.addSegment(boatX - 22, boatY + boatBob, leftPedX, tipY);
    cableLines.addSegment(boatX + 22, boatY + boatBob, rightPedX, tipY);
  }

  private drawSubmarineSprites(engine: MonstrumGameEngine, timeSec: number): void {
    const sp = this.sprites!;
    const ws = this.worldSprites!;
    const ts = engine.map.tileSize;
    const esc = engine.escape;

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

    const poolMode = subReady ? 'ready' : esc.submarineParts.length === 3 ? 'parts3' : 'idle';
    ws.place(sp.subMoonpool[poolMode], poolX + poolW * 0.5, poolY + poolH * 0.5, {
      renderOrder: 3,
    });

    // Moonpool animated wave ripples
    for (let wy = poolY + 24; wy < poolY + poolH - 18; wy += 36) {
      const drift = Math.sin(timeSec * (subActivating ? 8 : 2.1) + wy * 0.05) * 6;
      const midX = poolX + poolW * 0.5;
      this.worldLinesTeal!.addSegment(poolX + 16 + drift, wy, midX, wy - 4);
      this.worldLinesTeal!.addSegment(midX, wy - 4, poolX + poolW - 16 + drift, wy);
    }

    ws.place(sp.subApron[subReady ? 'ready' : 'idle'], subPos.x, subPos.y, {
      renderOrder: 3,
    });

    const subCx = poolX + poolW * 0.5;
    const subCy = poolY + poolH * 0.5 + (subReady ? Math.sin(timeSec * 3) * 2.5 : 0);
    ws.place(sp.subHull[subReady ? 'ready' : 'idle'], subCx, subCy, { renderOrder: 4 });
    ws.place(sp.subBattery[hasSubBat ? 'filled' : 'empty'], subCx - 23, subCy, {
      renderOrder: 5,
    });
    ws.place(sp.subBallast[hasBallast ? 'filled' : 'empty'], subCx + 23.5, subCy + 31, {
      renderOrder: 5,
    });
    ws.place(sp.subDiveKey[hasDiveKey ? 'filled' : 'empty'], subCx, subCy - 4, {
      renderOrder: 5,
    });

    const leverRingColor =
      esc.submarineState === 'READY'
        ? 0x34d399
        : esc.submarineParts.length === 3
          ? 0x2dd4bf
          : 0x94a3b8;
    const leverRingAlpha =
      esc.submarineState === 'READY'
        ? 0.75
        : esc.submarineParts.length === 3
          ? 0.45 + 0.35 * Math.sin(timeSec * 6)
          : 0.32;
    ws.place(sp.softRing, subPos.leverX, subPos.leverY, {
      scaleX: 52 / sp.softRing.w,
      scaleY: 52 / sp.softRing.h,
      tint: leverRingColor,
      opacity: leverRingAlpha,
      renderOrder: 3,
    });
  }

  private drawPlayerSprites(engine: MonstrumGameEngine, timeSec: number): void {
    const sp = this.sprites!;
    const ws = this.worldSprites!;
    const p = engine.player;
    const stride = p.isMoving ? Math.sin(p.walkPhase) : 0;
    const crouchScale = p.crouching ? 0.87 : 1.0;
    const torsoTwist = p.isMoving ? stride * (p.sprinting ? 0.1 : 0.055) : 0;
    const idleBreath = p.isMoving
      ? 0
      : Math.sin(timeSec * (p.exhausted ? 7.2 : 2.5)) * (p.exhausted ? 0.45 : 0.18);
    const hasLight = p.flashlightOn && p.battery > 0;
    const rot = p.angle + torsoTwist;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    const placeLocal = (
      entry: SpriteEntry,
      lx: number,
      ly: number,
      localRot = 0,
      scaleX = 1,
      scaleY = 1
    ) => {
      const wx = p.x + lx * cos - ly * sin;
      const wy = p.y + lx * sin + ly * cos;
      ws.place(entry, wx, wy, {
        rot2d: rot + localRot,
        scaleX,
        scaleY,
        renderOrder: 12,
      });
    };

    placeLocal(sp.playerShadow, 0, 0, 0, crouchScale, p.crouching ? 11 / 13.5 : 1);

    const leftStride = stride * (p.crouching ? 3.2 : p.sprinting ? 6.2 : 4.8);
    placeLocal(sp.playerBoot, leftStride, -4.4 * crouchScale);
    placeLocal(sp.playerBoot, -leftStride, 4.4 * crouchScale);

    if (p.hasBackpack) {
      placeLocal(sp.playerBackpack, -5.8 * crouchScale, 0, 0, 1, crouchScale);
    } else {
      placeLocal(
        sp.playerSatchel[p.inventory.length > 1 ? 'loaded' : 'empty'],
        -5.8 * crouchScale,
        0,
        0,
        1,
        crouchScale
      );
    }

    const leftArmForward = -stride * (p.crouching ? 2.4 : p.sprinting ? 5.2 : 3.8);
    placeLocal(sp.playerLeftArm, leftArmForward * 0.45, -10.5 * crouchScale, -stride * 0.16);

    const rightArmBob = stride * (p.crouching ? 1.2 : 2.1);
    placeLocal(
      sp.playerRightArm[hasLight ? 'on' : 'off'],
      rightArmBob * 0.35,
      9.6 * crouchScale,
      -0.12 + stride * 0.06
    );

    const shoulderScaleY = ((p.crouching ? 9.8 : 11.8) + idleBreath) / 11.8;
    const torsoScaleX = ((p.crouching ? 7.2 : 7.6) + idleBreath * 0.6) / 7.6;
    placeLocal(sp.playerTorso, 0, 0, 0, torsoScaleX, shoulderScaleY);

    const headX = p.crouching ? 2.4 : p.sprinting ? 2.0 : 1.0;
    const headScale = p.crouching ? 6.1 / 6.6 : 1;
    placeLocal(sp.playerHead, headX, 0, 0, headScale, headScale);
  }

  private drawBruteSprites(engine: MonstrumGameEngine, timeSec: number): void {
    const sp = this.sprites!;
    const ws = this.worldSprites!;
    const b = engine.brute;
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
    const rot = b.angle + torsoTwist;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    const placeLocal = (entry: SpriteEntry, lx: number, ly: number, scaleX = 1) => {
      const wx = b.x + lx * cos - ly * sin;
      const wy = b.y + lx * sin + ly * cos;
      ws.place(entry, wx, wy, { rot2d: rot, scaleX, renderOrder: 13 });
    };

    placeLocal(sp.bruteShadow, 0, 0);

    const leftReach = isLunging ? 11 : stride * (isChasing ? 8 : 5);
    const rightReach = isLunging ? 11 : -stride * (isChasing ? 8 : 5);
    const armMode = isChasing ? 'chase' : 'normal';
    placeLocal(sp.bruteClawArm[armMode], leftReach * 0.5, -18);
    placeLocal(sp.bruteClawArm[armMode], rightReach * 0.5, 18);

    const torsoMode = isStunned
      ? 'stunned'
      : isChasing
        ? 'chase'
        : isStalking
          ? 'stalk'
          : 'roam';
    placeLocal(sp.bruteTorso[torsoMode], 0, 0);

    const headMode = isStunned ? 'stunned' : isChasing ? 'chase' : 'roam';
    placeLocal(sp.bruteHead[headMode], 0, 0);
  }

  private ensureDeckPoweredLightmap(engine: MonstrumGameEngine, deck: ShipDeck): void {
    const renderer = this.renderer;
    const warmFans = this.deckBakeWarmFans;
    const maskFans = this.deckBakeMaskFans;
    if (!renderer || !warmFans || !maskFans) return;

    const map = engine.map;
    const bounds = map.deckBounds[deck];
    let h1 = 2166136261;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < map.doors.length; i++) {
      const d = map.doors[i];
      if (d.ty < bounds.y1 || d.ty > bounds.y2) continue;
      const code = d.isBroken ? 2 : d.openProgress > 0.35 ? 1 : 0;
      const token = ((i + 1) << 2) | code;
      h1 = Math.imul(h1 ^ token, 16777619);
      h2 = Math.imul(h2 ^ (token + i * 31), 2246822519);
    }

    if (
      this.bakedLightMapRef === map &&
      this.bakedLightDeck === deck &&
      this.bakedLightDoorHash1 === h1 &&
      this.bakedLightDoorHash2 === h2 &&
      this.deckWarmTarget &&
      this.deckMaskTarget
    ) {
      return;
    }

    const ts = map.tileSize;
    const worldW = map.width * ts;
    const yMin = bounds.y1 * ts;
    const yMax = (bounds.y2 + 1) * ts;
    const worldH = yMax - yMin;
    const bakeScale = 0.5;
    const pw = Math.max(64, Math.round(worldW * bakeScale));
    const ph = Math.max(64, Math.round(worldH * bakeScale));

    if (!this.deckWarmTarget || !this.deckMaskTarget || this.deckWarmPixelW !== pw || this.deckWarmPixelH !== ph) {
      this.deckWarmPixelW = pw;
      this.deckWarmPixelH = ph;
      this.deckWarmTarget?.dispose();
      this.deckMaskTarget?.dispose();
      this.deckWarmTarget = this.createRt(pw, ph, THREE.HalfFloatType);
      this.deckMaskTarget = this.createRt(pw, ph, THREE.UnsignedByteType);

      if (!this.deckWarmQuad) {
        const wb = createBakedLightmapQuadMaterial(this.deckWarmTarget.texture, true);
        this.deckWarmMat = wb.material;
        this.deckWarmTexNode = wb.texNode;
        this.deckWarmQuad = new THREE.Mesh(this.unitQuadGeom, wb.material);
        this.deckWarmQuad.frustumCulled = false;
        this.deckWarmQuad.renderOrder = 19;
        this.deckWarmQuad.visible = false;
        this.worldScene.add(this.deckWarmQuad);
      } else if (this.deckWarmTexNode) {
        this.deckWarmTexNode.value = this.deckWarmTarget.texture;
      }

      if (!this.deckMaskQuad) {
        const mb = createBakedLightmapQuadMaterial(this.deckMaskTarget.texture, false);
        this.deckMaskMat = mb.material;
        this.deckMaskTexNode = mb.texNode;
        this.deckMaskQuad = new THREE.Mesh(this.unitQuadGeom, mb.material);
        this.deckMaskQuad.frustumCulled = false;
        this.deckMaskQuad.renderOrder = 0;
        this.deckMaskQuad.visible = false;
        this.lightMaskScene.add(this.deckMaskQuad);
      } else if (this.deckMaskTexNode) {
        this.deckMaskTexNode.value = this.deckMaskTarget.texture;
      }
    }

    this.deckBakeCamera.left = 0;
    this.deckBakeCamera.right = worldW;
    this.deckBakeCamera.top = -yMin;
    this.deckBakeCamera.bottom = -yMax;
    this.deckBakeCamera.position.set(0, 0, 100);
    this.deckBakeCamera.updateProjectionMatrix();

    warmFans.beginFrame();
    maskFans.beginFrame();

    for (const sw of map.lightSwitches) {
      const swDeck = map.deckGrid[sw.ty]?.[sw.tx] ?? 'DECK_2';
      if (swDeck !== deck || !sw.isOn) continue;
      const fixtures = this.roomFixturesCache.get(sw.id) ?? [{ x: sw.x, y: sw.y, range: 360 }];
      for (let i = 0; i < fixtures.length; i++) {
        const fx = fixtures[i];
        const cached = this.lightPolyCache.getOrCompute(
          `sw:${sw.id}:${i}`,
          map,
          engine.doorsByTile,
          fx.x,
          fx.y,
          fx.range,
          56
        );
        if (cached.poly.length < 3) continue;
        warmFans.addFan(cached.fan, 14, fx.range, 0.55, 0xfef0c7, 0.145, 0xfde09b, 0.085, 0xfde09b, 0);
        this.addMaskFan(maskFans, cached.fan, 20, fx.range, 0.65, 0.96, 0.78);
      }
    }

    for (let i = 0; i < map.corridorLights.length; i++) {
      const cl = map.corridorLights[i];
      if (cl.deck !== deck) continue;
      const cached = this.lightPolyCache.getOrCompute(
        `cl:${cl.deck}:${i}`,
        map,
        engine.doorsByTile,
        cl.x,
        cl.y,
        cl.range,
        36
      );
      if (cached.poly.length < 3) continue;
      warmFans.addFan(
        cached.fan,
        14,
        cl.range,
        0.55,
        0xfef0c7,
        0.145 * 0.94,
        0xfde09b,
        0.085 * 0.94,
        0xfde09b,
        0
      );
      this.addMaskFan(maskFans, cached.fan, 20, cl.range, 0.65, 0.96 * 0.94, 0.78 * 0.94);
    }

    warmFans.endFrame();
    maskFans.endFrame();

    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.deckWarmTarget);
    renderer.render(this.deckBakeWarmScene, this.deckBakeCamera);

    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.deckMaskTarget);
    renderer.render(this.deckBakeMaskScene, this.deckBakeCamera);

    renderer.setRenderTarget(null);

    if (this.deckWarmQuad) {
      this.deckWarmQuad.position.set(worldW * 0.5, -(yMin + yMax) * 0.5, 0);
      this.deckWarmQuad.scale.set(worldW, worldH, 1);
    }
    if (this.deckMaskQuad) {
      this.deckMaskQuad.position.set(worldW * 0.5, -(yMin + yMax) * 0.5, 0);
      this.deckMaskQuad.scale.set(worldW, worldH, 1);
    }

    this.bakedLightMapRef = map;
    this.bakedLightDeck = deck;
    this.bakedLightDoorHash1 = h1;
    this.bakedLightDoorHash2 = h2;
  }

  private computeLitRoomPolygons(
    engine: MonstrumGameEngine,
    timeSec: number,
    activeDeck: ShipDeck,
    camX: number,
    camY: number,
    halfW: number,
    halfH: number,
    peekDest?: { deck: ShipDeck; x: number; y: number },
    skipActiveDeckStatic = false
  ): RayLightPoly[] {
    const polys: RayLightPoly[] = [];
    const b = engine.brute;

    for (const sw of engine.map.lightSwitches) {
      if (!sw.isOn) continue;
      const swDeck = engine.map.deckGrid[sw.ty]?.[sw.tx] ?? 'DECK_2';
      const allowActive = !skipActiveDeckStatic && swDeck === activeDeck;
      const allowPeek = peekDest !== undefined && swDeck === peekDest.deck;
      if (!allowActive && !allowPeek) continue;

      const fixtures = this.roomFixturesCache.get(sw.id) ?? [
        { x: sw.x, y: sw.y, range: 360 },
      ];
      let cachedIntensity = -1;
      let cachedSputter = 0;

      for (let i = 0; i < fixtures.length; i++) {
        const fx = fixtures[i];
        const dx = Math.max(0, Math.abs(fx.x - camX) - halfW);
        const dy = Math.max(0, Math.abs(fx.y - camY) - halfH);
        const onPlayerView =
          allowActive && dx * dx + dy * dy <= fx.range * fx.range;
        const onPeekView =
          allowPeek &&
          Math.hypot(fx.x - peekDest!.x, fx.y - peekDest!.y) <= 640 + fx.range;
        if (!onPlayerView && !onPeekView) continue;

        if (cachedIntensity < 0) {
          const deckPowered = engine.poweredDecks[swDeck];
          const bruteDist = Math.hypot(b.x - sw.x, b.y - sw.y);
          const flk = deckPowered
            ? { intensity: 1, sputterAmount: 0 }
            : getRoomLightFlicker(sw.id, timeSec, bruteDist);
          cachedIntensity = flk.intensity;
          cachedSputter = flk.sputterAmount;
        }

        const key = `sw:${sw.id}:${i}`;
        const cached = this.lightPolyCache.getOrCompute(
          key,
          engine.map,
          engine.doorsByTile,
          fx.x,
          fx.y,
          fx.range,
          56
        );
        polys.push({
          cacheKey: key,
          deck: swDeck,
          x: fx.x,
          y: fx.y,
          range: fx.range,
          intensity: cachedIntensity,
          sputterAmount: cachedSputter,
          fan: cached.fan,
          poly: cached.poly,
        });
      }
    }

    // Master-Fuse Powered Hallway/Corridor Ceiling Fixtures (only computed when not pre-baked!)
    for (let i = 0; i < engine.map.corridorLights.length; i++) {
      const cl = engine.map.corridorLights[i];
      if (!engine.poweredDecks[cl.deck]) continue;
      const allowActive = !skipActiveDeckStatic && cl.deck === activeDeck;
      const allowPeek = peekDest !== undefined && cl.deck === peekDest.deck;
      if (!allowActive && !allowPeek) continue;

      const dx = Math.max(0, Math.abs(cl.x - camX) - halfW);
      const dy = Math.max(0, Math.abs(cl.y - camY) - halfH);
      const onPlayerView =
        allowActive && dx * dx + dy * dy <= cl.range * cl.range;
      const onPeekView =
        allowPeek &&
        Math.hypot(cl.x - peekDest!.x, cl.y - peekDest!.y) <= 640 + cl.range;
      if (!onPlayerView && !onPeekView) continue;

      const key = `cl:${cl.deck}:${i}`;
      const cached = this.lightPolyCache.getOrCompute(
        key,
        engine.map,
        engine.doorsByTile,
        cl.x,
        cl.y,
        cl.range,
        36
      );
      polys.push({
        cacheKey: key,
        deck: cl.deck,
        x: cl.x,
        y: cl.y,
        range: cl.range,
        intensity: 0.94,
        sputterAmount: 0,
        fan: cached.fan,
        poly: cached.poly,
      });
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
    const poly = [{ x: ox, y: oy }, ...rayPts];
    const fan = this.buildDynamicFan('bruteBeam', ox, oy, rayPts, false);
    return { ox, oy, angle: b.angle, range, intensity, isChasing, fan, poly };
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
    const fan = this.buildDynamicFan('stairGlow', st.x, st.y, poly, true);
    return { x: st.x, y: st.y, range, intensity, fan, poly };
  }

  private computeDoorPeekBeam(engine: MonstrumGameEngine): DoorPeekBeamData | null {
    const p = engine.player;
    if (!p.peekingDoorId || p.hidingSpotId !== null) return null;
    const door = engine.map.doors.find(
      (d) => d.id === p.peekingDoorId && !d.isOpen && !d.isBroken
    );
    if (!door) return null;

    const isLitSide = engine.isDoorFarSideLit(door, p.x, p.y);
    if (!isLitSide && p.battery <= 0) return null;

    const ts = engine.map.tileSize;
    const dcx = (door.tx + 0.5) * ts;
    const dcy = (door.ty + 0.5) * ts;
    const peekAngle = Math.atan2(dcy - p.y, dcx - p.x);
    const crossSign =
      door.orientation === 'H' ? Math.sign(dcy - p.y) || 1 : Math.sign(dcx - p.x) || 1;
    const ox = door.orientation === 'H' ? dcx : dcx + crossSign * 10;
    const oy = door.orientation === 'H' ? dcy + crossSign * 10 : dcy;
    const coneWidth = ((isLitSide ? 54 : 40) * Math.PI) / 180;
    const range = isLitSide ? 420 : 440;
    const rayPts = computeVisibilityPolygon(
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
    const poly = [{ x: ox, y: oy }, ...rayPts];
    const fan = this.buildDynamicFan('doorPeek', ox, oy, rayPts, false);
    return { ox, oy, range, isLitSide, fan, poly };
  }

  private populateWarmLightingTints(
    engine: MonstrumGameEngine,
    renderDeck: ShipDeck,
    litRoomPolys: RayLightPoly[],
    bruteBeam: BruteBeamData | null,
    stairGlow: StairGlowData | null,
    doorPeekData: DoorPeekBeamData | null,
    timeSec: number
  ): void {
    const swf = this.staticWarmFans!;
    const wf = this.worldWarmFans!;

    for (const lp of litRoomPolys) {
      if (lp.poly.length < 3 || lp.deck !== renderDeck) continue;

      if (lp.sputterAmount > 0.35) {
        swf.addFan(
          lp.fan,
          14,
          lp.range,
          0.55,
          0xe2e8f0,
          0.145 * lp.intensity,
          0xcbd5e1,
          0.085 * lp.intensity,
          0xcbd5e1,
          0
        );
      } else {
        swf.addFan(
          lp.fan,
          14,
          lp.range,
          0.55,
          0xfef0c7,
          0.145 * lp.intensity,
          0xfde09b,
          0.085 * lp.intensity,
          0xfde09b,
          0
        );
      }
    }

    if (bruteBeam && bruteBeam.poly.length >= 3) {
      const ty = Math.floor(bruteBeam.oy / engine.map.tileSize);
      if ((engine.map.deckGrid[ty]?.[0] ?? renderDeck) === renderDeck) {
        wf.addFan(
          bruteBeam.fan,
          6,
          bruteBeam.range,
          0.5,
          0xffc369,
          (bruteBeam.isChasing ? 0.44 : 0.34) * bruteBeam.intensity,
          0xf97316,
          (bruteBeam.isChasing ? 0.24 : 0.17) * bruteBeam.intensity,
          0xea580c,
          0
        );
      }
    }

    if (stairGlow && stairGlow.poly.length >= 3) {
      wf.addFan(
        stairGlow.fan,
        10,
        stairGlow.range,
        0.55,
        0xff8c1e,
        0.42 * stairGlow.intensity,
        0xea580c,
        0.18 * stairGlow.intensity,
        0xea580c,
        0
      );
    }

    if (doorPeekData && !doorPeekData.isLitSide && doorPeekData.poly.length >= 3) {
      wf.addFan(
        doorPeekData.fan,
        6,
        doorPeekData.range,
        0.55,
        0xfef9e0,
        0.22,
        0xe2e8f0,
        0.09,
        0xe2e8f0,
        0
      );
    }

    const ts = engine.map.tileSize;
    for (let i = 0; i < engine.droppedLights.length; i++) {
      const l = engine.droppedLights[i];
      const lTx = Math.floor(l.x / ts);
      const lTy = Math.floor(l.y / ts);
      if ((engine.map.deckGrid[lTy]?.[lTx] ?? 'DECK_2') !== renderDeck) continue;
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
      const fan = this.buildDynamicFan(`dropped:${l.id}`, l.x, l.y, poly, true);
      if (l.type === 'FLARE') {
        wf.addFan(fan, 4, r, 0.6, 0xfb7185, 0.24, 0xf43f5e, 0.09, 0xf43f5e, 0);
      } else {
        wf.addFan(fan, 4, r, 0.6, 0x34d399, 0.18, 0x10b981, 0.07, 0x10b981, 0);
      }
    }
  }

  private computePlayerSightPolys(
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number,
    doorPeekData: DoorPeekBeamData | null
  ): Array<Array<{ x: number; y: number }>> {
    const p = engine.player;
    const isHiding = p.hidingSpotId !== null;
    const isPeekingSpot = p.peekingSpotId !== null;
    const sightPolys: Array<Array<{ x: number; y: number }>> = [];

    if (isHiding && !isPeekingSpot) {
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

    if (doorPeekData) {
      sightPolys.push(doorPeekData.poly);
    }

    return sightPolys;
  }

  private populateLosScene(
    sightPolys: Array<Array<{ x: number; y: number }>>,
    playerX: number,
    playerY: number
  ): void {
    const lf = this.losFans!;
    lf.beginFrame();
    this.portalLosFans?.clear();

    for (let i = 0; i < sightPolys.length; i++) {
      const poly = sightPolys[i];
      if (poly.length < 3) continue;
      // poly[0] is the closed 360-deg visibility loop cast around (playerX, playerY);
      // subsequent entries (vent/door peek cones) start with their exact ray origin vertex.
      const ox = poly[0].x;
      const oy = poly[0].y;
      const isClosedLoop = i === 0;
      const fanPts = isClosedLoop ? poly : poly.slice(1);
      const centerX = isClosedLoop ? playerX : ox;
      const centerY = isClosedLoop ? playerY : oy;
      const fan = this.buildDynamicFan(`los:${i}`, centerX, centerY, fanPts, isClosedLoop);
      lf.addFan(fan, 1, 4000, 0.5, 0xffffff, 1, 0xffffff, 1, 0xffffff, 1);
    }

    lf.endFrame();
  }

  private addMaskFan(
    batch: FanBatch,
    fan: FanMeshData,
    innerR: number,
    range: number,
    stopPos: number,
    a0: number,
    a1: number
  ): void {
    batch.addFan(fan, innerR, range, stopPos, 0xffffff, a0, 0xffffff, a1, 0xffffff, 0);
  }

  private populateLightMaskScene(
    engine: MonstrumGameEngine,
    timeSec: number,
    litRoomPolys: RayLightPoly[],
    bruteBeam: BruteBeamData | null,
    stairGlow: StairGlowData | null,
    doorPeekData: DoorPeekBeamData | null
  ): void {
    const smf = this.staticMaskFans!;
    const mf = this.lightMaskFans!;
    smf.beginFrame();
    mf.beginFrame();

    const p = engine.player;
    const isHiding = p.hidingSpotId !== null;
    const isPeekingSpot = p.peekingSpotId !== null;
    const activeDeck = engine.getCurrentDeck();
    if (this.deckMaskQuad) {
      this.deckMaskQuad.visible =
        activeDeck === this.bakedLightDeck && engine.poweredDecks[activeDeck];
    }

    // 1. Close tactile ambient awareness around player
    const ambientRadius = isHiding ? 34 : 92;
    const ambPoly = computeVisibilityPolygon(
      engine.map,
      engine.doorsByTile,
      p.x,
      p.y,
      0,
      Math.PI * 2,
      ambientRadius,
      36
    );
    if (ambPoly.length >= 3) {
      const fan = this.buildDynamicFan('mask:ambient', p.x, p.y, ambPoly, true);
      this.addMaskFan(
        mf,
        fan,
        6,
        ambientRadius,
        0.55,
        isHiding ? 0.86 : 0.9,
        isHiding ? 0.34 : 0.44
      );
    }

    // 2. Flashlight Cone or silent lit-room vent peek
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
      if (conePoly.length >= 2) {
        const fan = this.buildDynamicFan('mask:flashlight', p.x, p.y, conePoly, false);
        this.addMaskFan(
          mf,
          fan,
          12,
          range,
          0.68,
          0.98 * flicker,
          0.82 * flicker
        );
      }
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
      if (conePoly.length >= 2) {
        const fan = this.buildDynamicFan('mask:ventPeek', p.x, p.y, conePoly, false);
        this.addMaskFan(mf, fan, 12, range, 0.65, 0.74, 0.48);
      }
    }

    // 3. Closed-door keyhole/crack peek cone
    if (doorPeekData && doorPeekData.poly.length >= 3) {
      const cutRange = doorPeekData.isLitSide ? 115 : doorPeekData.range;
      this.addMaskFan(
        mf,
        doorPeekData.fan,
        10,
        cutRange,
        0.7,
        doorPeekData.isLitSide ? 0.42 : 0.95,
        doorPeekData.isLitSide ? 0.16 : 0.74
      );
    }

    // 4. Overhead room lights & powered corridor fixtures (viewport-culled, statically cached & batched!)
    for (const lp of litRoomPolys) {
      if (lp.poly.length < 3 || lp.deck !== activeDeck) continue;
      this.addMaskFan(
        smf,
        lp.fan,
        20,
        lp.range,
        0.65,
        0.96 * lp.intensity,
        0.78 * lp.intensity
      );
    }

    // 5. Brute Searchlight Beam
    if (bruteBeam && bruteBeam.poly.length >= 3) {
      const ty = Math.floor(bruteBeam.oy / engine.map.tileSize);
      if ((engine.map.deckGrid[ty]?.[0] ?? activeDeck) === activeDeck) {
        this.addMaskFan(
          mf,
          bruteBeam.fan,
          10,
          bruteBeam.range,
          0.66,
          0.97 * bruteBeam.intensity,
          0.76 * bruteBeam.intensity
        );
      }
    }

    // 6. Incoming Brute Stairwell Glow
    if (stairGlow && stairGlow.poly.length >= 3) {
      this.addMaskFan(
        mf,
        stairGlow.fan,
        8,
        stairGlow.range,
        0.58,
        0.92 * stairGlow.intensity,
        0.56 * stairGlow.intensity
      );
    }

    // 7. Dropped Glowsticks & Flares
    const ts = engine.map.tileSize;
    for (const l of engine.droppedLights) {
      const lTx = Math.floor(l.x / ts);
      const lTy = Math.floor(l.y / ts);
      if ((engine.map.deckGrid[lTy]?.[lTx] ?? 'DECK_2') !== activeDeck) continue;
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
      const fan = this.buildDynamicFan(`mask:drop:${l.id}`, l.x, l.y, lightPoly, true);
      this.addMaskFan(mf, fan, 6, r, 0.7, 0.94, 0.65);
    }

    // 8. Escape Zone Beacons (only active deck)
    const esc = engine.escape;
    const bTx = engine.map.lifeboatPos.tx;
    const bTy = engine.map.lifeboatPos.ty;
    const voidNorth = engine.map.tiles[bTy - 1]?.[bTx] === 'VOID';
    const outSign = voidNorth ? -1 : 1;
    const boatSwing =
      esc.lifeboatState === 'READY'
        ? 1
        : esc.lifeboatState === 'ACTIVATING'
          ? esc.lifeboatActivationProgress
          : 0;
    const hasBoatBattery = esc.lifeboatParts.includes('MARINE_BATTERY');

    const beacons: Array<{ deck: ShipDeck; key: string; x: number; y: number; r: number; alpha: number }> = [
      {
        deck: 'DECK_2',
        key: 'beacon:lifeboat',
        x: engine.map.lifeboatPos.x + 14,
        y: engine.map.lifeboatPos.y + outSign * boatSwing * 32,
        r: hasBoatBattery ? 145 : 115,
        alpha: hasBoatBattery ? 0.85 : 0.65,
      },
      {
        deck: 'DECK_3',
        key: 'beacon:heli',
        x: engine.map.heliPos.x,
        y: engine.map.heliPos.y,
        r: esc.heliState !== 'IDLE' ? 150 : 120,
        alpha: esc.heliState !== 'IDLE' ? 0.82 : 0.65,
      },
      {
        deck: 'DECK_1',
        key: 'beacon:sub',
        x: engine.map.submarinePos.x,
        y: engine.map.submarinePos.y,
        r: esc.submarineState !== 'IDLE' ? 165 : 130,
        alpha: esc.submarineState !== 'IDLE' ? 0.85 : 0.68,
      },
    ];

    for (const bc of beacons) {
      if (bc.deck !== activeDeck) continue;
      const cached = this.lightPolyCache.getOrCompute(
        bc.key,
        engine.map,
        engine.doorsByTile,
        bc.x,
        bc.y,
        bc.r,
        40
      );
      if (cached.poly.length < 3) continue;
      this.addMaskFan(
        smf,
        cached.fan,
        6,
        bc.r,
        0.5,
        bc.alpha,
        bc.alpha * 0.5
      );
    }

    smf.endFrame();
    mf.endFrame();
  }

  private isWithinVentPeekCone(p: MonstrumGameEngine['player'], tx: number, ty: number): boolean {
    const toTarget = Math.atan2(ty - p.y, tx - p.x);
    let diff = toTarget - p.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff) <= (28 * Math.PI) / 180;
  }

  private populatePostScene(
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number,
    camX: number,
    camY: number,
    timeSec: number,
    incomingStairId: string | null
  ): void {
    const sp = this.sprites!;
    const ps = this.postSprites!;
    ps.beginFrame();
    this.postLinesSlate!.beginFrame();
    this.postLinesCyan!.beginFrame();
    this.postLinesAmber!.beginFrame();
    this.postLinesRose!.beginFrame();
    this.postLinesOrange!.beginFrame();
    this.postLinesEmerald!.beginFrame();
    this.postLinesRed!.beginFrame();
    this.postLinesWhite!.beginFrame();
    this.ringBatch?.beginFrame();
    this.bruteFovFanBatch?.clear();

    const p = engine.player;
    const b = engine.brute;
    const activeDeck = engine.getCurrentDeck();
    const canSeeOut = !(p.hidingSpotId !== null && p.peekingSpotId === null);

    // 1. Light switch beacons
    if (canSeeOut) {
      for (const sw of engine.map.lightSwitches) {
        const swDeck = engine.map.deckGrid[sw.ty]?.[sw.tx] ?? 'DECK_2';
        if (swDeck !== activeDeck) continue;
        const dist = Math.hypot(sw.x - p.x, sw.y - p.y);
        if (dist > 460) continue;
        if (p.peekingSpotId !== null && dist > 48 && !this.isWithinVentPeekCone(p, sw.x, sw.y)) {
          continue;
        }
        if (!hasLineOfSightToEntity(engine.map, engine.doorsByTile, p.x, p.y, sw.x, sw.y)) {
          continue;
        }
        const deckPowered = engine.poweredDecks[swDeck];
        const flk = deckPowered
          ? { intensity: 1 }
          : sw.isOn
            ? getRoomLightFlicker(sw.id, timeSec, Math.hypot(b.x - sw.x, b.y - sw.y))
            : { intensity: 1 };
        const color = deckPowered ? 0xfbbf24 : sw.isOn ? 0x34d399 : 0xf59e0b;
        const opacity = deckPowered ? 0.92 : sw.isOn ? 0.4 + 0.55 * flk.intensity : 0.72;
        ps.place(sp.softDisc, sw.x, sw.y, {
          scaleX: 5 / sp.softDisc.w,
          scaleY: 5 / sp.softDisc.h,
          tint: color,
          opacity,
          renderOrder: 0,
        });
      }

      // 2. Stairwell beacons
      for (const st of engine.map.stairwells) {
        if (st.deck !== activeDeck) continue;
        const dist = Math.hypot(st.x - p.x, st.y - p.y);
        if (dist > 460) continue;
        if (p.peekingSpotId !== null && dist > 48 && !this.isWithinVentPeekCone(p, st.x, st.y)) {
          continue;
        }
        if (!hasLineOfSight(engine.map, engine.doorsByTile, p.x, p.y, st.x, st.y)) continue;
        if (st.id === incomingStairId) {
          const pulse = 0.65 + 0.35 * Math.sin(timeSec * 10);
          ps.place(sp.softDisc, st.x, st.y, {
            scaleX: 64 / sp.softDisc.w,
            scaleY: 64 / sp.softDisc.h,
            tint: 0xff8214,
            opacity: 0.75 * pulse,
            renderOrder: 0,
          });
          ps.place(sp.softDisc, st.x, st.y, {
            scaleX: 8 / sp.softDisc.w,
            scaleY: 8 / sp.softDisc.h,
            tint: 0xffedd5,
            opacity: 1,
            renderOrder: 0,
          });
        } else {
          ps.place(sp.softDisc, st.x, st.y, {
            scaleX: 6 / sp.softDisc.w,
            scaleY: 6 / sp.softDisc.h,
            tint: st.direction === 'DOWN' ? 0x38bdf8 : 0xfbbf24,
            opacity: 0.75,
            renderOrder: 0,
          });
        }
      }
    }

    // 3. Stair climb ring
    if (p.climbingStairId) {
      const st = engine.map.stairwells.find((s) => s.id === p.climbingStairId);
      if (st) {
        const progress = Math.max(0, Math.min(1, p.climbProgress));
        const ringBatch =
          st.direction === 'DOWN' ? this.postLinesCyan! : this.postLinesAmber!;
        const segs = 28;
        for (let i = 0; i < segs; i++) {
          const a0 = -Math.PI / 2 + (Math.PI * 2 * i) / segs;
          const a1 = -Math.PI / 2 + (Math.PI * 2 * (i + 1)) / segs;
          this.postLinesSlate!.addSegment(
            st.x + Math.cos(a0) * 30,
            st.y + Math.sin(a0) * 30,
            st.x + Math.cos(a1) * 30,
            st.y + Math.sin(a1) * 30
          );
        }
        const activeSegs = Math.max(1, Math.round(segs * progress));
        for (let i = 0; i < activeSegs; i++) {
          const t0 = i / activeSegs;
          const t1 = (i + 1) / activeSegs;
          const a0 = -Math.PI / 2 + Math.PI * 2 * progress * t0;
          const a1 = -Math.PI / 2 + Math.PI * 2 * progress * t1;
          ringBatch.addSegment(
            st.x + Math.cos(a0) * 30,
            st.y + Math.sin(a0) * 30,
            st.x + Math.cos(a1) * 30,
            st.y + Math.sin(a1) * 30
          );
        }
      }
    }

    // 4. Brute eyes in darkness (LoS-gated)
    this.addBruteEyesPostSprites(engine, timeSec, ps);

    // 5. Acoustic ripples (constant crisp thin stroke width across all radii)
    const ringHalfThick = 0.68 / Math.max(0.75, zoom);
    const ringFeather = 0.52 / Math.max(0.75, zoom);
    for (const r of engine.ripples) {
      this.setColorFromCss(this.tmpColor, r.color);
      this.ringBatch?.addRing(
        r.x,
        r.y,
        r.radius,
        ringHalfThick,
        ringFeather,
        this.tmpColor,
        Math.max(0, r.alpha)
      );
    }

    // 6. Interact halo
    const nearest = engine.findNearestInteractable();
    if (nearest) {
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
      } else if (nearest.kind === 'FUSE_SOCKET') {
        tx = nearest.fuseSocket.x;
        ty = nearest.fuseSocket.y;
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
      ps.place(sp.softRing, tx, ty, {
        scaleX: (pulse * 2) / sp.softRing.w,
        scaleY: (pulse * 2) / sp.softRing.h,
        tint: 0xf8fafc,
        opacity: 0.72,
        renderOrder: 2,
      });
    }

    // 7. Debug Overlays
    if (engine.debugConfig.enabled) {
      this.populateDebugOverlays(engine, width, height, zoom, camX, camY);
    }

    ps.endFrame();
    this.postLinesSlate!.endFrame();
    this.postLinesCyan!.endFrame();
    this.postLinesAmber!.endFrame();
    this.postLinesRose!.endFrame();
    this.postLinesOrange!.endFrame();
    this.postLinesEmerald!.endFrame();
    this.postLinesRed!.endFrame();
    this.postLinesWhite!.endFrame();
    this.ringBatch?.endFrame();
  }

  private addBruteEyesPostSprites(
    engine: MonstrumGameEngine,
    timeSec: number,
    ps: SpritePool
  ): void {
    const sp = this.sprites!;
    const b = engine.brute;
    const p = engine.player;
    if (b.state === 'STUNNED' || b.stairClimbTimer > 0) return;

    const dist = Math.hypot(b.x - p.x, b.y - p.y);
    if (dist > 620) return;
    if (p.hidingSpotId !== null && p.peekingSpotId === null && dist > 48) return;

    let visible = hasLineOfSight(engine.map, engine.doorsByTile, p.x, p.y, b.x, b.y);
    if (visible && p.hidingSpotId !== null && p.peekingSpotId !== null && dist > 48) {
      if (!this.isWithinVentPeekCone(p, b.x, b.y)) visible = false;
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
    const glowR = isChasing ? 34 : isStalking ? 26 : 20;
    const cos = Math.cos(b.angle);
    const sin = Math.sin(b.angle);

    const placeEye = (lx: number, ly: number, size: number, tint: number, opacity: number) => {
      ps.place(sp.softDisc, b.x + lx * cos - ly * sin, b.y + lx * sin + ly * cos, {
        scaleX: size / sp.softDisc.w,
        scaleY: size / sp.softDisc.h,
        tint,
        opacity,
        renderOrder: 1,
      });
    };

    placeEye(
      12,
      0,
      glowR * 2,
      isChasing ? 0xff5500 : isStalking ? 0xfb923c : 0xf97316,
      isChasing ? 0.7 * pulse : isStalking ? 0.52 * pulse : 0.36
    );
    const eyeTint = isChasing ? 0xffedd5 : isStalking ? 0xfdba74 : 0xfb923c;
    placeEye(12.5, -3.5, 5.2, eyeTint, 1);
    placeEye(12.5, 3.5, 5.2, eyeTint, 1);
  }

  private populateDebugOverlays(
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    zoom: number,
    camX: number,
    camY: number
  ): void {
    const cfg = engine.debugConfig;
    const halfW = width / (2 * zoom) + 80;
    const halfH = height / (2 * zoom) + 80;

    if (cfg.showWallSegments) {
      const segs = getLocalOccluders(
        engine.map,
        engine.doorsByTile,
        camX - halfW,
        camY - halfH,
        camX + halfW,
        camY + halfH
      );
      for (const s of segs) {
        if (s.kind === 'DOOR') {
          this.postLinesAmber!.addSegment(s.x1, s.y1, s.x2, s.y2);
        } else {
          this.postLinesRose!.addSegment(s.x1, s.y1, s.x2, s.y2);
        }
      }
    }

    if (cfg.showPlayerLos) {
      for (const poly of this.lastPlayerSightPolys) {
        this.postLinesCyan!.addPolyLoop(poly);
      }
    }

    if (cfg.showBruteFov) {
      const b = engine.brute;
      const senses = getSensesProfile(engine.difficulty, engine.bruteTuning);
      const halfFovRad = (senses.halfFovDeg * Math.PI) / 180;
      const fovRange = 345 * senses.sightMult;
      const arcPts: Array<{ x: number; y: number }> = [];
      const steps = 28;
      for (let i = 0; i <= steps; i++) {
        const a = b.angle - halfFovRad + (2 * halfFovRad * i) / steps;
        arcPts.push({ x: b.x + Math.cos(a) * fovRange, y: b.y + Math.sin(a) * fovRange });
      }
      if (this.bruteFovFanBatch) {
        const fan = this.buildDynamicFan('debugBruteFov', b.x, b.y, arcPts, false);
        this.bruteFovFanBatch.beginFrame();
        this.bruteFovFanBatch.addFan(
          fan,
          1,
          fovRange,
          0.5,
          0xf97316,
          0.08,
          0xf97316,
          0.08,
          0xf97316,
          0.08
        );
        this.bruteFovFanBatch.endFrame();
      }

      this.postLinesOrange!.addSegment(b.x, b.y, arcPts[0].x, arcPts[0].y);
      this.postLinesOrange!.addSegment(b.x, b.y, arcPts[arcPts.length - 1].x, arcPts[arcPts.length - 1].y);
      for (let i = 0; i < arcPts.length - 1; i++) {
        this.postLinesOrange!.addSegment(arcPts[i].x, arcPts[i].y, arcPts[i + 1].x, arcPts[i + 1].y);
      }

      if (b.path.length > 0) {
        const ts = engine.map.tileSize;
        let px = b.x;
        let py = b.y;
        for (const wp of b.path) {
          const nx = (wp.tx + 0.5) * ts;
          const ny = (wp.ty + 0.5) * ts;
          this.postLinesOrange!.addDashedSegment(px, py, nx, ny, 5, 4);
          px = nx;
          py = ny;
        }
      }

      if (b.currentInspectSpotId) {
        const spot = engine.map.hidingSpots.find((s) => s.id === b.currentInspectSpotId);
        if (spot) {
          this.postLinesRed!.addRect(spot.x - 18, spot.y - 18, 36, 36);
        }
      }
    }

    if (cfg.showBlackProbes && engine.debugProbePoints.length > 0) {
      for (let idx = 0; idx < engine.debugProbePoints.length; idx++) {
        const pt = engine.debugProbePoints[idx];
        this.postLinesEmerald!.addSegment(pt.x - 9, pt.y, pt.x - 4, pt.y);
        this.postLinesEmerald!.addSegment(pt.x + 4, pt.y, pt.x + 9, pt.y);
        this.postLinesEmerald!.addSegment(pt.x, pt.y - 9, pt.x, pt.y - 4);
        this.postLinesEmerald!.addSegment(pt.x, pt.y + 4, pt.x, pt.y + 9);
        const labelOffsetY = idx % 2 === 0 ? -16 : 16;
        const badge = this.getTextBadge(`probe:${pt.label}`, pt.label, {
          font: '600 10px "JetBrains Mono", monospace',
          textColor: 'rgba(148, 163, 184, 0.95)',
          padX: 4,
          height: 14,
        });
        this.postSprites!.place(badge, pt.x, pt.y + labelOffsetY, { renderOrder: 6 });
      }
    }
  }

  private renderStairPeekPortalPass(
    engine: MonstrumGameEngine,
    st: MonstrumGameEngine['map']['stairwells'][number],
    dest: MonstrumGameEngine['map']['stairwells'][number],
    viewCenterX: number,
    viewCenterY: number,
    zoom: number,
    width: number,
    height: number,
    dpr: number,
    timeSec: number,
    litRoomPolys: RayLightPoly[],
    bruteBeam: BruteBeamData | null
  ): void {
    const renderer = this.renderer!;
    const sp = this.sprites!;
    const rawPortalX = viewCenterX + (st.x - engine.cameraX) * zoom;
    const rawPortalY = viewCenterY + (st.y - engine.cameraY) * zoom;
    const portalRadius = Math.max(145, Math.min(280, Math.round(200 * zoom)));
    const margin = portalRadius + 16;
    const portalX = Math.max(margin, Math.min(width - margin, rawPortalX));
    const portalY = Math.max(margin, Math.min(height - margin, rawPortalY));
    const viewWorldRadius = portalRadius / zoom;
    const peekRange = Math.min(600, viewWorldRadius + 28);

    this.ensurePortalTargets(portalRadius * 2 * dpr);

    // 1. Render destination world into portalTarget
    this.portalCamera.left = -viewWorldRadius;
    this.portalCamera.right = viewWorldRadius;
    this.portalCamera.top = viewWorldRadius;
    this.portalCamera.bottom = -viewWorldRadius;
    this.portalCamera.position.set(dest.x, -dest.y, 100);
    this.portalCamera.updateProjectionMatrix();

    const destLitPolys = litRoomPolys.filter(
      (lp) =>
        lp.deck === dest.deck &&
        Math.hypot(lp.x - dest.x, lp.y - dest.y) < lp.range + peekRange
    );
    const destBeam =
      bruteBeam &&
      Math.hypot(bruteBeam.ox - dest.x, bruteBeam.oy - dest.y) < bruteBeam.range + peekRange
        ? bruteBeam
        : null;

    this.populateWorldScene(
      engine,
      dest.deck,
      dest.x,
      dest.y,
      portalRadius * 2,
      portalRadius * 2,
      zoom,
      timeSec,
      null,
      destLitPolys,
      destBeam,
      null,
      null,
      false
    );

    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.portalTarget);
    renderer.render(this.worldScene, this.portalCamera);

    // 2. Render destination LoS clip into portalLosTarget
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
    const plf = this.portalLosFans!;
    plf.beginFrame();
    this.losFans!.clear();
    if (destSightPoly.length >= 3) {
      const fan = this.buildDynamicFan('portalLos', dest.x, dest.y, destSightPoly, true);
      plf.addFan(fan, 1, peekRange + 100, 0.5, 0xffffff, 1, 0xffffff, 1, 0xffffff, 1);
    }
    plf.endFrame();

    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.portalLosTarget);
    renderer.render(this.losScene, this.portalCamera);

    // 3. Configure portalQuad in screenOverlayScene
    if (this.portalBundle && this.portalQuad) {
      const hasTorch = engine.player.flashlightOn && engine.player.battery > 0;
      const roomLitNearDest = destLitPolys.some(
        (lp) => Math.hypot(lp.x - dest.x, lp.y - dest.y) < lp.range * 0.9
      );
      this.portalBundle.uCenterDim.value = roomLitNearDest ? 0.05 : hasTorch ? 0.14 : 0.48;
      this.portalBundle.uMidDim.value = roomLitNearDest ? 0.25 : hasTorch ? 0.56 : 0.8;
      this.portalBundle.uAccentColor.value.setHex(
        st.direction === 'DOWN' ? 0x38bdf8 : 0xfbbf24
      );
      this.portalBundle.uPixelSpan.value = portalRadius * 2;

      this.portalQuad.position.set(portalX, -portalY, 0);
      this.portalQuad.scale.set(portalRadius * 2, portalRadius * 2, 1);
      this.portalQuad.visible = true;
    }

    // 4. Destination Switch LEDs & Brute Eyes in screenOverlayScene (above portal dim)
    const ss = this.screenSprites!;
    for (const sw of engine.map.lightSwitches) {
      const sx = portalX + (sw.x - dest.x) * zoom;
      const sy = portalY + (sw.y - dest.y) * zoom;
      if (Math.hypot(sx - portalX, sy - portalY) >= portalRadius - 8) continue;
      if (
        Math.hypot(sw.x - dest.x, sw.y - dest.y) <= peekRange &&
        hasLineOfSightToEntity(engine.map, engine.doorsByTile, dest.x, dest.y, sw.x, sw.y)
      ) {
        ss.place(sp.softDisc, sx, sy, {
          scaleX: 5 * zoom / sp.softDisc.w,
          scaleY: 5 * zoom / sp.softDisc.h,
          tint: sw.isOn ? 0x34d399 : 0xf59e0b,
          opacity: sw.isOn ? 0.9 : 0.85,
          renderOrder: 1,
        });
      }
    }

    const b = engine.brute;
    const bDist = Math.hypot(b.x - dest.x, b.y - dest.y);
    const bInView =
      b.stairClimbTimer <= 0 &&
      bDist <= peekRange + 28 &&
      hasLineOfSight(engine.map, engine.doorsByTile, dest.x, dest.y, b.x, b.y);
    if (bInView && b.state !== 'STUNNED') {
      const isChasing = b.state === 'CHASE' || b.state === 'SMASH_DOOR';
      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);
      const placePortalEye = (lx: number, ly: number, sz: number, tint: number, op: number) => {
        const wx = b.x + lx * cos - ly * sin;
        const wy = b.y + lx * sin + ly * cos;
        const sx = portalX + (wx - dest.x) * zoom;
        const sy = portalY + (wy - dest.y) * zoom;
        if (Math.hypot(sx - portalX, sy - portalY) < portalRadius - 8) {
          ss.place(sp.softDisc, sx, sy, {
            scaleX: (sz * zoom) / sp.softDisc.w,
            scaleY: (sz * zoom) / sp.softDisc.h,
            tint,
            opacity: op,
            renderOrder: 1,
          });
        }
      };
      placePortalEye(12, 0, isChasing ? 64 : 44, isChasing ? 0xff5500 : 0xf97316, isChasing ? 0.72 : 0.45);
      placePortalEye(12.5, -3.5, 5, isChasing ? 0xffedd5 : 0xfdba74, 1);
      placePortalEye(12.5, 3.5, 5, isChasing ? 0xffedd5 : 0xfdba74, 1);
    }

    // 5. Header badge just above portal rim
    const badgeText = `${getDeckLabel(dest.deck).toUpperCase()} · ${dest.room.toUpperCase()}`;
    const accentHex = st.direction === 'DOWN' ? '#38bdf8' : '#fbbf24';
    const badge = this.getTextBadge(`portal:${badgeText}:${accentHex}`, badgeText, {
      font: '600 11px "JetBrains Mono", monospace',
      textColor: '#f8fafc',
      bgColor: 'rgba(7, 10, 15, 0.94)',
      borderColor: accentHex,
      padX: 9,
      height: 22,
    });
    const boxY = Math.max(8, portalY - portalRadius - 14);
    ss.place(badge, portalX, boxY + badge.h * 0.5, { renderOrder: 2 });
  }

  private updateVignetteUniforms(
    engine: MonstrumGameEngine,
    width: number,
    height: number,
    timeSec: number
  ): void {
    if (!this.vignetteBundle) return;
    const bruteDist = engine.getEffectiveBruteDistance();
    const isChasing = engine.brute.state === 'CHASE' || engine.brute.state === 'SMASH_DOOR';
    const prox = Math.max(0, 1 - bruteDist / 450);
    const redBoost = isChasing
      ? 0.28 + Math.sin(timeSec * 10) * 0.08
      : prox > 0.25
        ? (prox - 0.25) * 0.24
        : 0;

    this.vignetteBundle.uResolution.value.set(width, height);
    this.vignetteBundle.uSteamFog.value = engine.player.steamFogAlpha;
    this.vignetteBundle.uRedBoost.value = redBoost;
    this.vignetteBundle.uSpotFlash.value = engine.spotFlashAlpha;
  }

  private enqueueReadback<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.readbackQueue.then(fn, fn);
    this.readbackQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  public async probePixelsAsync(engine: MonstrumGameEngine): Promise<ProbeReading[]> {
    if (
      !this.initialized ||
      !this.renderer ||
      !this.probeTarget ||
      !this.readbackBlitMat ||
      engine.debugProbePoints.length === 0
    ) {
      return [];
    }

    return this.enqueueReadback(async () => {
      if (this.disposed || !this.initialized || !this.renderer || !this.probeTarget) {
        return [];
      }
      const renderer = this.renderer;
      renderer.autoClear = true;
      renderer.setRenderTarget(this.probeTarget);
      renderer.render(this.readbackScene, this.ndcCamera);
      renderer.setRenderTarget(null);

      const pw = this.probeTarget.width;
      const ph = this.probeTarget.height;
      const w = this.lastScreenWidth;
      const h = this.lastScreenHeight;
      const dprX = pw / Math.max(1, w);
      const dprY = ph / Math.max(1, h);
      const zoom = engine.getEffectiveZoom(w, h);
      const results: ProbeReading[] = [];

      for (const pt of engine.debugProbePoints) {
        const sx = (pt.x - engine.cameraX) * zoom + w / 2;
        const sy = (pt.y - engine.cameraY) * zoom + h / 2;
        const px = Math.round(sx * dprX);
        const py = Math.round(sy * dprY);
        if (px < 0 || py < 0 || px >= pw || py >= ph) continue;

        // WebGPU copyTextureToBuffer is top-down (py); WebGL2 gl.readPixels is bottom-up (ph - 1 - py)
        const readY = this.isWebGPU ? py : ph - 1 - py;
        const data = await renderer.readRenderTargetPixelsAsync(
          this.probeTarget,
          px,
          readY,
          1,
          1
        );
        const r = data[0] ?? 0;
        const g = data[1] ?? 0;
        const b = data[2] ?? 0;
        results.push({
          label: pt.label,
          r,
          g,
          b,
          isPureBlack: r === 0 && g === 0 && b === 0,
        });
      }

      return results;
    });
  }

  public async capturePngDataUrlAsync(): Promise<string | null> {
    if (!this.initialized || !this.renderer || !this.probeTarget || !this.readbackBlitMat) {
      return null;
    }
    return this.enqueueReadback(async () => {
      if (this.disposed || !this.initialized || !this.renderer || !this.probeTarget) {
        return null;
      }
      const renderer = this.renderer;
      renderer.autoClear = true;
      renderer.setRenderTarget(this.probeTarget);
      renderer.render(this.readbackScene, this.ndcCamera);
      renderer.setRenderTarget(null);

      const pw = this.probeTarget.width;
      const ph = this.probeTarget.height;
      const raw = await renderer.readRenderTargetPixelsAsync(this.probeTarget, 0, 0, pw, ph);
      const bytes = new Uint8ClampedArray(pw * ph * 4);
      const src = new Uint8Array(raw.buffer, raw.byteOffset, Math.min(raw.byteLength, bytes.length));

      if (this.isWebGPU) {
        bytes.set(src);
      } else {
        const rowBytes = pw * 4;
        for (let y = 0; y < ph; y++) {
          const srcRow = (ph - 1 - y) * rowBytes;
          const dstRow = y * rowBytes;
          bytes.set(src.subarray(srcRow, srcRow + rowBytes), dstRow);
        }
      }

      const outCanvas = document.createElement('canvas');
      outCanvas.width = pw;
      outCanvas.height = ph;
      const ctx = outCanvas.getContext('2d');
      if (!ctx) return null;
      ctx.putImageData(new ImageData(bytes, pw, ph), 0, 0);
      return outCanvas.toDataURL('image/png');
    });
  }

  public dispose(): void {
    this.disposed = true;
    this.initialized = false;

    for (const ch of this.deckChunkMeshes) {
      this.worldScene.remove(ch.mesh);
      ch.geom.dispose();
      ch.mat.dispose();
    }
    this.deckChunkMeshes = [];
    this.bakedShip?.dispose();
    this.bakedShip = null;
    this.bakedMapRef = null;

    this.sprites?.dispose();
    this.sprites = null;

    for (const entry of this.textBadgeCache.values()) {
      entry.texture.dispose();
    }
    this.textBadgeCache.clear();

    this.worldSprites?.dispose();
    this.postSprites?.dispose();
    this.screenSprites?.dispose();
    this.staticWarmFans?.dispose();
    this.worldWarmFans?.dispose();
    this.staticMaskFans?.dispose();
    this.lightMaskFans?.dispose();
    this.deckBakeWarmFans?.dispose();
    this.deckBakeMaskFans?.dispose();
    this.losFans?.dispose();
    this.portalLosFans?.dispose();

    this.wakeLines?.dispose();
    this.worldLinesDark?.dispose();
    this.worldLinesSteel?.dispose();
    this.worldLinesLight?.dispose();
    this.worldLinesTeal?.dispose();
    this.postLinesSlate?.dispose();
    this.postLinesCyan?.dispose();
    this.postLinesAmber?.dispose();
    this.postLinesRose?.dispose();
    this.postLinesOrange?.dispose();
    this.postLinesEmerald?.dispose();
    this.postLinesRed?.dispose();
    this.postLinesWhite?.dispose();
    this.ringBatch?.dispose();
    this.ringBatch = null;

    this.bruteFovFanBatch?.dispose();
    this.bruteFovFanBatch = null;

    this.sceneTarget?.dispose();
    this.losTarget?.dispose();
    this.lightMaskTarget?.dispose();
    this.finalTarget?.dispose();
    this.probeTarget?.dispose();
    this.portalTarget?.dispose();
    this.portalLosTarget?.dispose();
    this.deckWarmTarget?.dispose();
    this.deckMaskTarget?.dispose();

    this.oceanBundle?.material.dispose();
    this.compositeBundle?.material.dispose();
    this.vignetteBundle?.material.dispose();
    this.portalBundle?.material.dispose();
    this.deckWarmMat?.dispose();
    this.deckMaskMat?.dispose();
    this.screenBlitMat?.dispose();
    this.readbackBlitMat?.dispose();

    this.unitQuadGeom.dispose();
    this.ndcQuadGeom.dispose();

    this.renderer?.dispose();
    this.renderer = null;
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
