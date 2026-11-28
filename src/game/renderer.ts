import * as THREE from 'three/webgpu';
import type { ProbeReading } from '../components/DebugPanel';
import { MonstrumGameEngine } from './engine';
import {
  ColorGradePreset,
  DEFAULT_CAMERA_FOV_DEG,
  DEFAULT_CAMERA_PITCH_DEG,
  DEFAULT_CAMERA_YAW_DEG,
  detectHdrCapabilities,
  getDefaultGraphicsSettings,
  GraphicsSettings,
  HdrCapabilities,
  isHdrOutputActive,
  ToneMappingMode,
} from './graphicsSettings';
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
  BloomBlurMaterialBundle,
  BloomExtractMaterialBundle,
  CompositeMaterialBundle,
  createBakedLightmapQuadMaterial,
  createBatchedRadialFanMaterial,
  createBloomBlurMaterial,
  createBloomExtractMaterial,
  createDarknessCompositeMaterial,
  createOceanMaterial,
  createScreenBlitMaterial,
  createSrgbReadbackBlitMaterial,
  createStairPortalMaterial,
  createThinRingBatchMaterial,
  createVignetteAndDangerMaterial,
  OceanMaterialBundle,
  ScreenBlitMaterialBundle,
  StairPortalMaterialBundle,
  VignetteDangerMaterialBundle,
} from './threeTsl';
import { EXTERIOR_DECK3_ROOMS, ShipStructure3D } from './threeStructure';
import { ShipCharacters3D } from './threeCharacters';
import { ShipObjects3D } from './threeObjects';
import { ShipEscapes3D } from './threeEscapes';
import {
  DebugRenderMode,
  DOOR_HEIGHT_PX,
  getDeckLabel,
  getViewportResolutionScale,
  RaycastDebugInfo,
  RaycastInteractTarget,
  RaycastTargetKind,
  RoomLightSwitch,
  RoomName,
  ShipDeck,
  ShipMap,
  WALL_HEIGHT_RATIO,
} from './types';
import {
  buildVisibilityFanBuffers,
  computeVisibilityPolygon,
  FanCurtainOptions,
  FanMeshData,
  getLocalOccluders,
  getSensesProfile,
  hasLineOfSight,
  hasLineOfSightToEntity,
  LightPolygonCache,
  VisibilityVertex,
} from './visibility';

const CAMERA_FOV_DEG = DEFAULT_CAMERA_FOV_DEG;

interface RayLightPoly {
  cacheKey?: string;
  deck: ShipDeck;
  x: number;
  y: number;
  range: number;
  intensity: number;
  sputterAmount: number;
  fan: FanMeshData;
  warmFan: FanMeshData;
  poly: VisibilityVertex[];
}

interface BruteBeamData {
  ox: number;
  oy: number;
  angle: number;
  range: number;
  intensity: number;
  isChasing: boolean;
  fan: FanMeshData;
  warmFan: FanMeshData;
  poly: VisibilityVertex[];
}

interface StairGlowData {
  x: number;
  y: number;
  range: number;
  intensity: number;
  fan: FanMeshData;
  warmFan: FanMeshData;
  poly: VisibilityVertex[];
}

interface DoorPeekBeamData {
  ox: number;
  oy: number;
  range: number;
  isLitSide: boolean;
  fan: FanMeshData;
  warmFan: FanMeshData;
  poly: VisibilityVertex[];
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
    initialCapacity = 16,
    private depthTest = false,
    private zLayering = false
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
      depthTest: this.depthTest,
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
      z?: number;
      billboardQuaternion?: THREE.Quaternion;
    }
  ): void {
    if (this.cursor >= this.slots.length) {
      this.allocateSlot();
    }
    const slot = this.slots[this.cursor++];
    const sx = (options?.scaleX ?? 1) * entry.w;
    const sy = (options?.scaleY ?? 1) * entry.h;
    const ro = options?.renderOrder ?? this.defaultRenderOrder;
    if (slot.mat.map !== entry.texture) {
      slot.mat.map = entry.texture;
      slot.mat.needsUpdate = true;
    }
    slot.mat.color.setHex(options?.tint ?? 0xffffff);
    slot.mat.opacity = options?.opacity ?? 1;
    const zPos =
      options?.z !== undefined ? options.z : this.zLayering ? 0.14 + ro * 0.08 : 0;
    slot.mesh.position.set(wx, -wy, zPos);
    if (options?.billboardQuaternion) {
      slot.mesh.quaternion.copy(options.billboardQuaternion);
    } else {
      slot.mesh.rotation.set(0, 0, -(options?.rot2d ?? 0));
    }
    slot.mesh.scale.set(sx, sy, 1);
    slot.mesh.renderOrder = ro;
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
  private coneAttr: THREE.BufferAttribute;
  private col0Attr: THREE.BufferAttribute;
  private col1Attr: THREE.BufferAttribute;
  private col2Attr: THREE.BufferAttribute;
  private posArr: Float32Array;
  private radialArr: Float32Array;
  private paramsArr: Float32Array;
  private coneArr: Float32Array;
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
    initialVerts = 2048,
    depthTest = false
  ) {
    this.maxVerts = initialVerts;
    this.posArr = new Float32Array(initialVerts * 3);
    this.radialArr = new Float32Array(initialVerts * 2);
    this.paramsArr = new Float32Array(initialVerts * 3);
    this.coneArr = new Float32Array(initialVerts * 4);
    this.col0Arr = new Float32Array(initialVerts * 4);
    this.col1Arr = new Float32Array(initialVerts * 4);
    this.col2Arr = new Float32Array(initialVerts * 4);

    this.posAttr = new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage);
    this.radialAttr = new THREE.BufferAttribute(this.radialArr, 2).setUsage(THREE.DynamicDrawUsage);
    this.paramsAttr = new THREE.BufferAttribute(this.paramsArr, 3).setUsage(THREE.DynamicDrawUsage);
    this.coneAttr = new THREE.BufferAttribute(this.coneArr, 4).setUsage(THREE.DynamicDrawUsage);
    this.col0Attr = new THREE.BufferAttribute(this.col0Arr, 4).setUsage(THREE.DynamicDrawUsage);
    this.col1Attr = new THREE.BufferAttribute(this.col1Arr, 4).setUsage(THREE.DynamicDrawUsage);
    this.col2Attr = new THREE.BufferAttribute(this.col2Arr, 4).setUsage(THREE.DynamicDrawUsage);

    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', this.posAttr);
    this.geom.setAttribute('aRadialOffset', this.radialAttr);
    this.geom.setAttribute('aFanParams', this.paramsAttr);
    this.geom.setAttribute('aConeParams', this.coneAttr);
    this.geom.setAttribute('aColor0', this.col0Attr);
    this.geom.setAttribute('aColor1', this.col1Attr);
    this.geom.setAttribute('aColor2', this.col2Attr);
    this.geom.setDrawRange(0, 0);

    this.mat = createBatchedRadialFanMaterial(depthTest);
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

  public setVisible(vis: boolean): void {
    this.mesh.visible = vis && this.lastUploadedCount > 0;
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
    const nextCone = new Float32Array(nextMax * 4);
    const nextCol0 = new Float32Array(nextMax * 4);
    const nextCol1 = new Float32Array(nextMax * 4);
    const nextCol2 = new Float32Array(nextMax * 4);

    if (this.vertexCursor > 0) {
      nextPos.set(this.posArr.subarray(0, this.vertexCursor * 3));
      nextRadial.set(this.radialArr.subarray(0, this.vertexCursor * 2));
      nextParams.set(this.paramsArr.subarray(0, this.vertexCursor * 3));
      nextCone.set(this.coneArr.subarray(0, this.vertexCursor * 4));
      nextCol0.set(this.col0Arr.subarray(0, this.vertexCursor * 4));
      nextCol1.set(this.col1Arr.subarray(0, this.vertexCursor * 4));
      nextCol2.set(this.col2Arr.subarray(0, this.vertexCursor * 4));
    }

    this.posArr = nextPos;
    this.radialArr = nextRadial;
    this.paramsArr = nextParams;
    this.coneArr = nextCone;
    this.col0Arr = nextCol0;
    this.col1Arr = nextCol1;
    this.col2Arr = nextCol2;

    this.posAttr = new THREE.BufferAttribute(nextPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.radialAttr = new THREE.BufferAttribute(nextRadial, 2).setUsage(THREE.DynamicDrawUsage);
    this.paramsAttr = new THREE.BufferAttribute(nextParams, 3).setUsage(THREE.DynamicDrawUsage);
    this.coneAttr = new THREE.BufferAttribute(nextCone, 4).setUsage(THREE.DynamicDrawUsage);
    this.col0Attr = new THREE.BufferAttribute(nextCol0, 4).setUsage(THREE.DynamicDrawUsage);
    this.col1Attr = new THREE.BufferAttribute(nextCol1, 4).setUsage(THREE.DynamicDrawUsage);
    this.col2Attr = new THREE.BufferAttribute(nextCol2, 4).setUsage(THREE.DynamicDrawUsage);

    this.geom.setAttribute('position', this.posAttr);
    this.geom.setAttribute('aRadialOffset', this.radialAttr);
    this.geom.setAttribute('aFanParams', this.paramsAttr);
    this.geom.setAttribute('aConeParams', this.coneAttr);
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
    a2: number,
    cone?: { angle: number; innerHalfRad: number; outerHalfRad: number }
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
    if (cone) {
      this.mixHash(Math.round(cone.angle * 1000));
      this.mixHash(Math.round(cone.innerHalfRad * 1000));
      this.mixHash(Math.round(cone.outerHalfRad * 1000));
    } else {
      this.mixHash(0x7fffffff);
    }

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

    const cdx = cone ? Math.cos(cone.angle) : 1;
    const cdy = cone ? -Math.sin(cone.angle) : 0;
    const cosIn = cone ? Math.cos(cone.innerHalfRad) : -1.5;
    const cosOut = cone ? Math.min(cosIn - 0.001, Math.cos(cone.outerHalfRad)) : -2.0;

    const paramsArr = this.paramsArr;
    const coneArr = this.coneArr;
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

      coneArr[i4] = cdx;
      coneArr[i4 + 1] = cdy;
      coneArr[i4 + 2] = cosIn;
      coneArr[i4 + 3] = cosOut;

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

    this.coneAttr.clearUpdateRanges();
    this.coneAttr.addUpdateRange(0, count * 4);
    this.coneAttr.needsUpdate = true;

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
  private zPlane: number;

  constructor(
    private parent: THREE.Object3D,
    color: number,
    opacity: number,
    renderOrder: number,
    initialVerts = 512,
    depthTest = false,
    zPlane = 0
  ) {
    this.zPlane = zPlane;
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
      depthTest,
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
    this.posArr[idx++] = this.zPlane;
    this.posArr[idx++] = x2;
    this.posArr[idx++] = -y2;
    this.posArr[idx++] = this.zPlane;
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
  private structure3d: ShipStructure3D | null = null;
  private characters3d: ShipCharacters3D | null = null;
  private objects3d: ShipObjects3D | null = null;
  private escapes3d: ShipEscapes3D | null = null;
  private deckChunkMeshes: Array<{
    deck: ShipDeck;
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    geom: THREE.PlaneGeometry;
    mat: THREE.MeshBasicMaterial;
  }> = [];

  // Precomputed per-map caches
  private roomFixturesCache = new Map<string, Array<{ x: number; y: number; range: number }>>();
  private lightPolyCache = new LightPolygonCache();
  private lastPlayerSightPolys: VisibilityVertex[][] = [];
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
  private bloomExtractScene = new THREE.Scene();
  private bloomBlurHScene = new THREE.Scene();
  private bloomBlurVScene = new THREE.Scene();
  private deckBakeWarmScene = new THREE.Scene();
  private deckBakeMaskScene = new THREE.Scene();

  // Cameras
  private worldCamera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 16 / 9, 10, 4000);
  private portalCamera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 10, 4000);
  private screenCamera = new THREE.OrthographicCamera(0, 1280, 0, -720, 0.1, 500);
  private ndcCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private deckBakeCamera = new THREE.OrthographicCamera(0, 1000, 0, -1000, 0.1, 500);

  // Graphics Settings & HDR Capability State
  private graphicsSettings: GraphicsSettings = getDefaultGraphicsSettings();
  private hdrCapabilities: HdrCapabilities = detectHdrCapabilities();
  private emptyBlackTex = (() => {
    const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  })();

  // Render Targets
  private sceneTarget: THREE.RenderTarget | null = null;
  private losTarget: THREE.RenderTarget | null = null;
  private lightMaskTarget: THREE.RenderTarget | null = null;
  private finalTarget: THREE.RenderTarget | null = null;
  private bloomATarget: THREE.RenderTarget | null = null;
  private bloomBTarget: THREE.RenderTarget | null = null;
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
  private bakedLightCeilingsVisible = false;
  private targetPixelW = 0;
  private targetPixelH = 0;
  private portalPixelSpan = 0;

  // TSL Materials & Quads
  private oceanBundle: OceanMaterialBundle | null = null;
  private oceanMesh: THREE.Mesh | null = null;
  private skyDomeMesh: THREE.Mesh | null = null;
  private skyLosMesh: THREE.Mesh | null = null;
  private skyMaskMesh: THREE.Mesh | null = null;
  private skyDomeTex: THREE.CanvasTexture | null = null;
  private skyDomeMat: THREE.MeshBasicMaterial | null = null;
  private skyLosMat: THREE.MeshBasicMaterial | null = null;
  private skyMaskMat: THREE.MeshBasicMaterial | null = null;
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
  private bloomExtractBundle: BloomExtractMaterialBundle | null = null;
  private bloomBlurHBundle: BloomBlurMaterialBundle | null = null;
  private bloomBlurVBundle: BloomBlurMaterialBundle | null = null;
  private bloomExtractMesh: THREE.Mesh | null = null;
  private bloomBlurHMesh: THREE.Mesh | null = null;
  private bloomBlurVMesh: THREE.Mesh | null = null;
  private screenBlitBundle: ScreenBlitMaterialBundle | null = null;
  private readbackBlitBundle: ScreenBlitMaterialBundle | null = null;
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
  private poweredWarmWallFans: FanBatch | null = null;
  private staticWarmFans: FanBatch | null = null;
  private worldWarmFans: FanBatch | null = null;
  private poweredMaskWallFans: FanBatch | null = null;
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
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private raycastScratch: THREE.Intersection[] = [];
  private raycastOccScratch: THREE.Intersection[] = [];
  private tmpVec2 = new THREE.Vector2();
  private tmpVec3 = new THREE.Vector3();
  private _groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private _hitVec3 = new THREE.Vector3();
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

  public applyGraphicsSettings(settings: GraphicsSettings): void {
    this.graphicsSettings = { ...settings };
    this.hdrCapabilities = detectHdrCapabilities();
  }

  public getDisplayTelemetry(): {
    backend: string;
    hdrSupported: boolean;
    hdrActive: boolean;
    wideGamutP3: boolean;
    colorGamut: string;
  } {
    const hdrActive = isHdrOutputActive(
      this.graphicsSettings,
      this.hdrCapabilities,
      this.isWebGPU
    );
    return {
      backend: this.getBackendLabel(),
      hdrSupported: this.hdrCapabilities.displayHdr,
      hdrActive,
      wideGamutP3: this.hdrCapabilities.wideGamutP3,
      colorGamut: this.hdrCapabilities.wideGamutP3 ? 'Display P3 / scRGB' : 'sRGB / Rec.709',
    };
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
        outputType: THREE.HalfFloatType,
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
      this.hdrCapabilities = detectHdrCapabilities();
      this.anisotropy = Math.min(4, renderer.getMaxAnisotropy?.() ?? 1);

      if (this.isWebGPU && backend?.device?.lost) {
        backend.device.lost.then((info) => {
          if (!this.disposed) {
            console.warn('WebGPU device lost:', info?.message ?? info?.reason);
          }
        });
      }

      this.renderer = renderer;
      this.worldCamera.position.set(0, 0, 900);
      this.portalCamera.position.set(0, 0, 500);
      this.screenCamera.position.set(0, 0, 100);
      this.ndcCamera.position.set(0, 0, 5);
      this.deckBakeCamera.position.set(0, 0, 100);

      this.sprites = createDynamicSpriteLibrary(44, this.anisotropy);
      this.characters3d = new ShipCharacters3D(this.worldScene, this.anisotropy);

      // Ocean background quad
      this.oceanBundle = createOceanMaterial();
      this.oceanMesh = new THREE.Mesh(this.unitQuadGeom, this.oceanBundle.material);
      this.oceanMesh.frustumCulled = false;
      this.oceanMesh.renderOrder = 0;
      this.worldScene.add(this.oceanMesh);

      this.createSkyDomes();

      // Pools
      this.worldSprites = new SpritePool(this.worldScene, this.unitQuadGeom, 8, 96, true, true);
      this.postSprites = new SpritePool(this.postScene, this.unitQuadGeom, 1, 24, false, false);
      this.screenSprites = new SpritePool(this.screenOverlayScene, this.unitQuadGeom, 2, 16, false, false);

      this.poweredWarmWallFans = new FanBatch(this.worldScene, 19, 8192, true);
      this.staticWarmFans = new FanBatch(this.worldScene, 19, 16384, true);
      this.worldWarmFans = new FanBatch(this.worldScene, 20, 4096, true);
      this.poweredMaskWallFans = new FanBatch(this.lightMaskScene, 2, 8192, true);
      this.staticMaskFans = new FanBatch(this.lightMaskScene, 3, 16384, true);
      this.lightMaskFans = new FanBatch(this.lightMaskScene, 4, 4096, true);
      this.deckBakeWarmFans = new FanBatch(this.deckBakeWarmScene, 0, 20480, false);
      this.deckBakeMaskFans = new FanBatch(this.deckBakeMaskScene, 0, 20480, false);
      this.losFans = new FanBatch(this.losScene, 2, 2048, true);
      this.portalLosFans = new FanBatch(this.losScene, 2, 2048, true);

      // Line batches
      this.wakeLines = new DynamicLineBatch(this.worldScene, 0x7dd3fc, 0.14, 1, 1024, true, -0.35);
      this.worldLinesDark = new DynamicLineBatch(this.worldScene, 0x090d14, 0.9, 5, 128, true, 0.48);
      this.worldLinesSteel = new DynamicLineBatch(this.worldScene, 0x64748b, 0.95, 5, 128, true, 0.48);
      this.worldLinesLight = new DynamicLineBatch(this.worldScene, 0xe2e8f0, 0.95, 5, 128, true, 0.48);
      this.worldLinesTeal = new DynamicLineBatch(this.worldScene, 0x2dd4bf, 0.45, 4, 256, true, 0.45);

      this.postLinesSlate = new DynamicLineBatch(this.postScene, 0x0f172a, 0.85, 0, 128);
      this.postLinesCyan = new DynamicLineBatch(this.postScene, 0x38bdf8, 0.85, 5, 512);
      this.postLinesAmber = new DynamicLineBatch(this.postScene, 0xfbbf24, 0.9, 5, 256);
      this.postLinesRose = new DynamicLineBatch(this.postScene, 0xf43f5e, 0.78, 5, 1024);
      this.postLinesOrange = new DynamicLineBatch(this.postScene, 0xf97316, 0.78, 5, 512);
      this.postLinesEmerald = new DynamicLineBatch(this.postScene, 0x34d399, 0.85, 5, 128);
      this.postLinesRed = new DynamicLineBatch(this.postScene, 0xef4444, 0.95, 5, 64);
      this.postLinesWhite = new DynamicLineBatch(this.postScene, 0xf8fafc, 0.72, 2, 128);
      this.ringBatch = new ThinRingBatch(this.postScene, 2, 64);

      this.bruteFovFanBatch = new FanBatch(this.postScene, 4, 512, false);

      const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.graphicsSettings.resolutionScale;
      this.ensureRenderTargets(window.innerWidth, window.innerHeight, dpr);
      this.ensurePortalTargets(400);

      this.initialized = true;
    })();

    return this.initPromise;
  }

  private createRt(
    w: number,
    h: number,
    type: THREE.TextureDataType,
    depthBuffer = false
  ): THREE.RenderTarget {
    const rt = new THREE.RenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type,
      depthBuffer,
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
    const bw = Math.max(64, Math.floor(pw / 4));
    const bh = Math.max(64, Math.floor(ph / 4));

    this.sceneTarget?.dispose();
    this.losTarget?.dispose();
    this.lightMaskTarget?.dispose();
    this.finalTarget?.dispose();
    this.bloomATarget?.dispose();
    this.bloomBTarget?.dispose();
    this.probeTarget?.dispose();

    this.sceneTarget = this.createRt(pw, ph, THREE.HalfFloatType, true);
    this.losTarget = this.createRt(pw, ph, THREE.UnsignedByteType, true);
    this.lightMaskTarget = this.createRt(pw, ph, THREE.HalfFloatType, true);
    this.finalTarget = this.createRt(pw, ph, THREE.HalfFloatType, false);
    this.bloomATarget = this.createRt(bw, bh, THREE.HalfFloatType, false);
    this.bloomBTarget = this.createRt(bw, bh, THREE.HalfFloatType, false);
    this.probeTarget = this.createRt(pw, ph, THREE.UnsignedByteType, false);

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

    if (!this.bloomExtractBundle) {
      this.bloomExtractBundle = createBloomExtractMaterial(this.finalTarget.texture);
      this.bloomExtractBundle.uThreshold.value = 0.78;
      this.bloomExtractBundle.uKnee.value = 0.30;
      this.bloomExtractMesh = new THREE.Mesh(this.ndcQuadGeom, this.bloomExtractBundle.material);
      this.bloomExtractMesh.frustumCulled = false;
      this.bloomExtractScene.add(this.bloomExtractMesh);
    } else {
      this.bloomExtractBundle.texNode.value = this.finalTarget.texture;
    }

    if (!this.bloomBlurHBundle) {
      this.bloomBlurHBundle = createBloomBlurMaterial(this.bloomATarget.texture);
      this.bloomBlurHMesh = new THREE.Mesh(this.ndcQuadGeom, this.bloomBlurHBundle.material);
      this.bloomBlurHMesh.frustumCulled = false;
      this.bloomBlurHScene.add(this.bloomBlurHMesh);
    } else {
      this.bloomBlurHBundle.texNode.value = this.bloomATarget.texture;
    }
    this.bloomBlurHBundle.uTexelStep.value.set(1 / bw, 0);

    if (!this.bloomBlurVBundle) {
      this.bloomBlurVBundle = createBloomBlurMaterial(this.bloomBTarget.texture);
      this.bloomBlurVMesh = new THREE.Mesh(this.ndcQuadGeom, this.bloomBlurVBundle.material);
      this.bloomBlurVMesh.frustumCulled = false;
      this.bloomBlurVScene.add(this.bloomBlurVMesh);
    } else {
      this.bloomBlurVBundle.texNode.value = this.bloomBTarget.texture;
    }
    this.bloomBlurVBundle.uTexelStep.value.set(0, 1 / bh);

    if (!this.screenBlitBundle) {
      this.screenBlitBundle = createScreenBlitMaterial(
        this.finalTarget.texture,
        this.bloomATarget.texture,
        this.losTarget.texture
      );
      this.screenBlitMesh = new THREE.Mesh(this.ndcQuadGeom, this.screenBlitBundle.material);
      this.screenBlitMesh.frustumCulled = false;
      this.blitScene.add(this.screenBlitMesh);
    } else {
      this.screenBlitBundle.texNode.value = this.finalTarget.texture;
      this.screenBlitBundle.bloomTexNode.value = this.bloomATarget.texture;
      this.screenBlitBundle.losTexNode.value = this.losTarget.texture;
    }

    if (!this.readbackBlitBundle) {
      this.readbackBlitBundle = createSrgbReadbackBlitMaterial(
        this.finalTarget.texture,
        this.bloomATarget.texture,
        this.losTarget.texture
      );
      this.readbackBlitMesh = new THREE.Mesh(this.ndcQuadGeom, this.readbackBlitBundle.material);
      this.readbackBlitMesh.frustumCulled = false;
      this.readbackScene.add(this.readbackBlitMesh);
    } else {
      this.readbackBlitBundle.texNode.value = this.finalTarget.texture;
      this.readbackBlitBundle.bloomTexNode.value = this.bloomATarget.texture;
      this.readbackBlitBundle.losTexNode.value = this.losTarget.texture;
    }
  }

  private ensurePortalTargets(pixelSpan: number): void {
    const span = Math.max(64, Math.round(pixelSpan));
    if (this.portalPixelSpan === span && this.portalTarget && this.portalLosTarget) return;

    this.portalPixelSpan = span;
    this.portalTarget?.dispose();
    this.portalLosTarget?.dispose();

    this.portalTarget = this.createRt(span, span, THREE.HalfFloatType, true);
    this.portalLosTarget = this.createRt(span, span, THREE.UnsignedByteType, true);

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
    this.structure3d?.dispose();
    this.structure3d = null;
    this.objects3d?.dispose();
    this.objects3d = null;
    this.escapes3d?.dispose();
    this.escapes3d = null;

    this.roomFixturesCache.clear();
    this.lightPolyCache.clear();
    this.poweredWarmWallFans?.clear();
    this.staticWarmFans?.clear();
    this.worldWarmFans?.clear();
    this.poweredMaskWallFans?.clear();
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
        alphaTest: 0.5,
        transparent: false,
        depthWrite: true,
        depthTest: true,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(ch.xPx + ch.wPx * 0.5, -(ch.yPx + ch.hPx * 0.5), 0);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      this.worldScene.add(mesh);
      this.deckChunkMeshes.push({ deck: ch.deck, mesh, geom, mat });
    }

    this.structure3d = new ShipStructure3D(
      map,
      this.anisotropy,
      this.worldScene,
      this.losScene,
      this.lightMaskScene
    );
    this.objects3d = new ShipObjects3D(map, this.worldScene);
    this.escapes3d = new ShipEscapes3D(map, this.worldScene);

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

  private createSkyDomes(): void {
    const w = 512;
    const h = 256;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, '#0e1b30');
    grad.addColorStop(0.45, '#1a304d');
    grad.addColorStop(0.82, '#2d4c70');
    grad.addColorStop(1.0, '#162840');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Procedural stormy cloud bands, subtle cold stars & moonlight rift
    let seed = 42031;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 42; i++) {
      const sx = rnd() * w;
      const sy = rnd() * h * 0.55;
      const sz = rnd() > 0.72 ? 1.5 : 1.0;
      ctx.fillStyle = `rgba(219, 234, 254, ${(0.22 + rnd() * 0.45).toFixed(2)})`;
      ctx.fillRect(sx, sy, sz, sz);
    }
    for (let i = 0; i < 65; i++) {
      const cx = rnd() * w;
      const cy = h * (0.18 + rnd() * 0.72);
      const rx = 28 + rnd() * 78;
      const ry = 8 + rnd() * 22;
      const bright = rnd() > 0.65;
      const cg = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
      cg.addColorStop(0, bright ? 'rgba(96, 134, 178, 0.28)' : 'rgba(12, 22, 38, 0.34)');
      cg.addColorStop(1, 'rgba(12, 22, 38, 0)');
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const moonG = ctx.createRadialGradient(w * 0.72, h * 0.32, 4, w * 0.72, h * 0.32, 110);
    moonG.addColorStop(0, 'rgba(198, 222, 248, 0.45)');
    moonG.addColorStop(0.35, 'rgba(110, 146, 190, 0.22)');
    moonG.addColorStop(1, 'rgba(22, 40, 64, 0)');
    ctx.fillStyle = moonG;
    ctx.fillRect(0, 0, w, h);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.skyDomeTex = tex;

    // Upper hemisphere + slight sub-horizon margin (Z-up)
    const skyGeom = new THREE.SphereGeometry(2800, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.525);
    skyGeom.rotateX(Math.PI * 0.5);

    this.skyDomeMat = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.BackSide,
      depthWrite: true,
      depthTest: true,
    });
    this.skyDomeMesh = new THREE.Mesh(skyGeom, this.skyDomeMat);
    this.skyDomeMesh.frustumCulled = false;
    this.skyDomeMesh.renderOrder = 0;
    this.skyDomeMesh.visible = false;
    this.worldScene.add(this.skyDomeMesh);

    this.skyLosMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
    });
    this.skyLosMesh = new THREE.Mesh(skyGeom, this.skyLosMat);
    this.skyLosMesh.frustumCulled = false;
    this.skyLosMesh.renderOrder = 1;
    this.skyLosMesh.visible = false;
    this.losScene.add(this.skyLosMesh);

    this.skyMaskMat = new THREE.MeshBasicMaterial({
      color: 0xd8e6f8,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
    });
    this.skyMaskMesh = new THREE.Mesh(skyGeom, this.skyMaskMat);
    this.skyMaskMesh.frustumCulled = false;
    this.skyMaskMesh.renderOrder = 1;
    this.skyMaskMesh.visible = false;
    this.lightMaskScene.add(this.skyMaskMesh);
  }

  public getCeilingStats(): Record<ShipDeck, { tiles: number; visible: boolean }> | null {
    return this.structure3d?.getCeilingStats() ?? null;
  }

  private isCeilingsVisible(engine: MonstrumGameEngine): boolean {
    if (engine.debugConfig.enabled) {
      return engine.debugConfig.showCeilings;
    }
    return engine.viewMode === 'FIRST_PERSON';
  }

  private isDeck3ExteriorPos(map: ShipMap, wx: number, wy: number): boolean {
    const tx = Math.floor(wx / map.tileSize);
    const ty = Math.floor(wy / map.tileSize);
    const bounds = map.deckBounds.DECK_3;
    if (tx < 0 || tx >= map.width || ty < bounds.y1 || ty > bounds.y2) return true;
    const tile = map.tiles[ty]?.[tx];
    if (!tile || tile === 'VOID' || tile === 'EXTERIOR_DECK') return true;
    const room = map.roomGrid[ty]?.[tx];
    return !room || EXTERIOR_DECK3_ROOMS.has(room);
  }

  private getMaskCurtainOpts(
    tileSize: number,
    withCeilings = false,
    map?: ShipMap,
    activeDeck?: ShipDeck
  ): FanCurtainOptions {
    const canCap =
      withCeilings && map && activeDeck === 'DECK_3'
        ? (wx: number, wy: number) => !this.isDeck3ExteriorPos(map, wx, wy)
        : undefined;
    return {
      wallHeight: tileSize * WALL_HEIGHT_RATIO - 0.15,
      doorHeight: withCeilings ? tileSize * WALL_HEIGHT_RATIO - 0.15 : DOOR_HEIGHT_PX + 0.4,
      floorZ: 0.04,
      pushInwardPx: 0,
      ceilingCapZ: withCeilings ? tileSize * WALL_HEIGHT_RATIO - 0.5 : undefined,
      canCapCeiling: canCap,
    };
  }

  private getWarmCurtainOpts(
    tileSize: number,
    withCeilings = false,
    map?: ShipMap,
    activeDeck?: ShipDeck
  ): FanCurtainOptions {
    const canCap =
      withCeilings && map && activeDeck === 'DECK_3'
        ? (wx: number, wy: number) => !this.isDeck3ExteriorPos(map, wx, wy)
        : undefined;
    return {
      wallHeight: tileSize * WALL_HEIGHT_RATIO - 0.15,
      doorHeight: withCeilings ? tileSize * WALL_HEIGHT_RATIO - 0.15 : DOOR_HEIGHT_PX + 0.4,
      floorZ: 0.04,
      pushInwardPx: 0.28,
      ceilingCapZ: withCeilings ? tileSize * WALL_HEIGHT_RATIO - 0.5 : undefined,
      canCapCeiling: canCap,
    };
  }

  private buildDynamicFan(
    slotKey: string,
    ox: number,
    oy: number,
    poly: VisibilityVertex[],
    closedLoop: boolean,
    curtainOpts?: FanCurtainOptions
  ): FanMeshData {
    const prev = this.dynamicFansCache.get(slotKey);
    const next = buildVisibilityFanBuffers(ox, oy, poly, closedLoop, prev, curtainOpts);
    this.dynamicFansCache.set(slotKey, next);
    return next;
  }

  public screenToWorldGround(
    screenX: number,
    screenY: number,
    width: number,
    height: number,
    out: { x: number; y: number },
    planeZ = 16
  ): boolean {
    if (!this.initialized || width <= 0 || height <= 0) return false;
    this.pointerNdc.set((screenX / width) * 2 - 1, -(screenY / height) * 2 + 1);
    this.worldCamera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointerNdc, this.worldCamera);
    this._groundPlane.setComponents(0, 0, 1, -planeZ);
    const hit = this.raycaster.ray.intersectPlane(this._groundPlane, this._hitVec3);
    if (!hit) return false;
    out.x = hit.x;
    out.y = -hit.y;
    return true;
  }

  public updatePointerHover(
    engine: MonstrumGameEngine,
    screenX: number,
    screenY: number,
    width: number,
    height: number
  ): void {
    const emptyDbg: RaycastDebugInfo = {
      hitKind: null,
      targetId: null,
      subTarget: null,
      inReach: false,
      hasLos: false,
      blockedBy: null,
      hitDist: null,
      occDist: null,
      hitZ: null,
      dist2d: null,
    };
    if (!this.initialized || !this.objects3d || !this.structure3d || width <= 0 || height <= 0) {
      engine.setRaycastTarget(null, emptyDbg);
      return;
    }
    const p = engine.player;
    if (
      p.hidingSpotId !== null ||
      p.climbingStairId !== null ||
      engine.isEnded() ||
      engine.journalOpen ||
      p.openPaperMapDeck !== null
    ) {
      engine.setRaycastTarget(null, emptyDbg);
      return;
    }

    const activeDeck = engine.getCurrentDeck();
    const targets: THREE.Object3D[] = [
      ...this.structure3d.getRaycastTargets(activeDeck),
      ...this.objects3d.getRaycastTargets(activeDeck),
      ...(this.escapes3d ? this.escapes3d.getRaycastTargets(activeDeck) : []),
    ];
    if (targets.length === 0) {
      engine.setRaycastTarget(null, emptyDbg);
      return;
    }

    const useCenterReticle =
      engine.viewMode === 'FIRST_PERSON' &&
      !(engine.debugConfig.enabled && engine.debugConfig.freeCamEnabled);
    if (useCenterReticle) {
      this.pointerNdc.set(0, 0);
    } else {
      this.pointerNdc.set((screenX / width) * 2 - 1, -(screenY / height) * 2 + 1);
    }
    this.worldCamera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointerNdc, this.worldCamera);
    this.raycastScratch.length = 0;
    this.raycaster.intersectObjects(targets, false, this.raycastScratch);
    if (this.raycastScratch.length === 0) {
      engine.setRaycastTarget(null, emptyDbg);
      return;
    }

    let chosen = this.raycastScratch[0];
    const firstUd = chosen.object.userData as {
      pickKind?: RaycastTargetKind;
      targetId?: string;
      containerId?: string;
    };
    if (firstUd.pickKind === 'CONTAINER') {
      for (let i = 0; i < this.raycastScratch.length; i++) {
        const cand = this.raycastScratch[i];
        const candUd = cand.object.userData as {
          pickKind?: RaycastTargetKind;
          containerId?: string;
        };
        if (
          candUd.pickKind === 'CONTAINER_ITEM' &&
          candUd.containerId === firstUd.containerId &&
          cand.distance <= chosen.distance + 14
        ) {
          chosen = cand;
          break;
        }
      }
    } else if (firstUd.pickKind === 'ESCAPE_HELI') {
      for (let i = 0; i < this.raycastScratch.length; i++) {
        const cand = this.raycastScratch[i];
        const candUd = cand.object.userData as {
          pickKind?: RaycastTargetKind;
          subTarget?: string;
        };
        if (
          candUd.pickKind === 'ESCAPE_HELI' &&
          candUd.subTarget === 'CHAIN' &&
          cand.distance <= chosen.distance + 20
        ) {
          chosen = cand;
          break;
        }
      }
    }

    const ud = chosen.object.userData as {
      pickKind?: RaycastTargetKind;
      targetId?: string;
      subTarget?: 'DOCK' | 'LEVER' | 'CHAIN' | 'HULL';
      chainIndex?: number;
      ownerKey?: string;
      containerId?: string;
    };
    if (!ud.pickKind || !ud.targetId) {
      engine.setRaycastTarget(null, emptyDbg);
      return;
    }

    const ownerKey = ud.ownerKey ?? `${ud.pickKind}:${ud.targetId}`;

    // Check 3D occlusion against walls, ceilings, closed doors, props, and furniture
    const occluders: THREE.Object3D[] = [
      ...this.structure3d.getRaycastOccluders(activeDeck),
      ...this.objects3d.getRaycastOccluders(activeDeck),
      ...(this.escapes3d ? this.escapes3d.getRaycastOccluders(activeDeck) : []),
    ];
    this.raycastOccScratch.length = 0;
    if (occluders.length > 0) {
      this.raycaster.intersectObjects(occluders, false, this.raycastOccScratch);
    }

    let occHit: THREE.Intersection | null = null;
    for (let i = 0; i < this.raycastOccScratch.length; i++) {
      const candidate = this.raycastOccScratch[i];
      const occKey = candidate.object.userData?.occluderOwnerKey as string | undefined;
      if (occKey && occKey === ownerKey) continue;
      occHit = candidate;
      break;
    }

    const ts = engine.map.tileSize;
    let entityX = chosen.point.x;
    let entityY = -chosen.point.y;
    let maxReach = 70;
    let item: RaycastInteractTarget['item'] | undefined;

    if (ud.pickKind === 'DOOR') {
      const door = engine.map.doors.find((d) => d.id === ud.targetId);
      if (!door || door.isBroken) {
        engine.setRaycastTarget(null, emptyDbg);
        return;
      }
      entityX = (door.tx + 0.5) * ts;
      entityY = (door.ty + 0.5) * ts;
      maxReach = 70;
    } else if (ud.pickKind === 'STAIRWELL') {
      const st = engine.map.stairwells.find((s) => s.id === ud.targetId);
      if (!st) {
        engine.setRaycastTarget(null, emptyDbg);
        return;
      }
      entityX = st.x;
      entityY = st.y;
      maxReach = 52;
    } else if (ud.pickKind === 'FUSE_SOCKET') {
      const fs = engine.map.fuseSockets.find((f) => f.id === ud.targetId);
      if (!fs) {
        engine.setRaycastTarget(null, emptyDbg);
        return;
      }
      entityX = fs.x;
      entityY = fs.y;
      maxReach = 54;
    } else if (ud.pickKind === 'LIGHT_SWITCH') {
      const sw = engine.map.lightSwitches.find((s) => s.id === ud.targetId);
      if (!sw) {
        engine.setRaycastTarget(null, emptyDbg);
        return;
      }
      entityX = sw.x;
      entityY = sw.y;
      maxReach = 48;
    } else if (ud.pickKind === 'PICKUP') {
      const wpId = Number(ud.targetId);
      const wp = engine.worldPickups.find((w) => w.id === wpId);
      if (!wp) {
        engine.setRaycastTarget(null, emptyDbg);
        return;
      }
      entityX = wp.x;
      entityY = wp.y;
      item = wp.item;
      maxReach = 48;
    } else if (ud.pickKind === 'HIDING') {
      const hs = engine.map.hidingSpots.find((h) => h.id === ud.targetId);
      if (!hs) {
        engine.setRaycastTarget(null, emptyDbg);
        return;
      }
      entityX = hs.x;
      entityY = hs.y;
      maxReach = 50;
    } else if (ud.pickKind === 'PAPER_MAP') {
      const pm = engine.map.paperMaps.find((m) => m.id === ud.targetId);
      if (!pm) {
        engine.setRaycastTarget(null, emptyDbg);
        return;
      }
      entityX = pm.x;
      entityY = pm.y;
      maxReach = 56;
    } else if (ud.pickKind === 'CONTAINER' || ud.pickKind === 'CONTAINER_ITEM') {
      const cont = engine.map.containers.find((c) => c.id === ud.targetId);
      if (!cont) {
        engine.setRaycastTarget(null, emptyDbg);
        return;
      }
      entityX = cont.x;
      entityY = cont.y;
      item = cont.item ?? undefined;
      maxReach = 86;
    } else if (ud.pickKind === 'ESCAPE_LIFEBOAT') {
      entityX = engine.map.lifeboatPos.x;
      entityY = engine.map.lifeboatPos.y;
      maxReach = 76;
    } else if (ud.pickKind === 'ESCAPE_HELI') {
      entityX = engine.map.heliPos.x;
      entityY = engine.map.heliPos.y;
      maxReach = 82;
    } else if (ud.pickKind === 'ESCAPE_SUBMARINE') {
      if (ud.subTarget === 'LEVER') {
        entityX = engine.map.submarinePos.leverX;
        entityY = engine.map.submarinePos.leverY;
        maxReach = 78;
      } else {
        entityX = engine.map.submarinePos.x;
        entityY = engine.map.submarinePos.y;
        maxReach = 96;
      }
    }

    let dist2d = Math.hypot(entityX - p.x, entityY - p.y);
    if (ud.pickKind === 'ESCAPE_HELI' && ud.subTarget === 'CHAIN') {
      dist2d = Math.min(dist2d, Math.hypot(chosen.point.x - p.x, -chosen.point.y - p.y));
    }
    const inReach = dist2d <= maxReach;
    const hasLos2d = hasLineOfSightToEntity(engine.map, engine.doorsByTile, p.x, p.y, entityX, entityY);
    const occTolerance = ud.pickKind === 'DOOR' || ud.pickKind === 'LIGHT_SWITCH' || ud.pickKind === 'FUSE_SOCKET' ? 1.2 : 0.6;
    const occluded3d = occHit !== null && occHit.distance + occTolerance < chosen.distance;
    const blockedBy = occluded3d
      ? ((occHit!.object.userData?.occluderOwnerKey as string | undefined) ?? 'OCCLUDER')
      : !hasLos2d
        ? '2D_LOS'
        : dist2d > 260
          ? 'OUT_OF_RANGE'
          : null;

    const dbgInfo: RaycastDebugInfo = {
      hitKind: ud.pickKind,
      targetId: ud.targetId,
      subTarget: ud.subTarget ?? null,
      inReach,
      hasLos: hasLos2d && !occluded3d,
      blockedBy,
      hitDist: chosen.distance,
      occDist: occHit ? occHit.distance : null,
      hitZ: chosen.point.z,
      dist2d,
    };

    if (occluded3d || !hasLos2d || dist2d > 260) {
      engine.setRaycastTarget(null, dbgInfo);
      return;
    }

    const effectiveKind: RaycastTargetKind =
      ud.pickKind === 'CONTAINER_ITEM'
        ? engine.map.containers.find((c) => c.id === ud.targetId && c.isOpen && c.item !== null)
          ? 'CONTAINER_ITEM'
          : 'CONTAINER'
        : ud.pickKind;

    engine.setRaycastTarget(
      {
        kind: effectiveKind,
        targetId: ud.targetId,
        subTarget: ud.subTarget,
        chainIndex: ud.chainIndex,
        ownerKey,
        dist: dist2d,
        inReach,
        hasLos: true,
        hitX: chosen.point.x,
        hitY: -chosen.point.y,
        hitZ: chosen.point.z,
        hitDist: chosen.distance,
        item,
      },
      dbgInfo
    );
  }

  public getInteractableScreenPoint(
    kind: RaycastTargetKind,
    targetId: string,
    subTarget: RaycastInteractTarget['subTarget'] | undefined,
    width: number,
    height: number,
    engine?: MonstrumGameEngine
  ): { x: number; y: number } | null {
    if (width <= 0 || height <= 0) return null;
    let found = false;
    if (
      (kind === 'CONTAINER' ||
        kind === 'CONTAINER_ITEM' ||
        kind === 'HIDING' ||
        kind === 'PAPER_MAP' ||
        kind === 'FUSE_SOCKET' ||
        kind === 'LIGHT_SWITCH' ||
        kind === 'PICKUP') &&
      this.objects3d
    ) {
      found = this.objects3d.getTargetWorldHitCenter(kind, targetId, this.tmpVec3);
    } else if (
      (kind === 'ESCAPE_HELI' || kind === 'ESCAPE_LIFEBOAT' || kind === 'ESCAPE_SUBMARINE') &&
      this.escapes3d
    ) {
      found = this.escapes3d.getTargetWorldHitCenter(kind, subTarget, this.tmpVec3);
    } else if (kind === 'DOOR' && engine) {
      const door = engine.map.doors.find((d) => d.id === targetId);
      if (door) {
        this.tmpVec3.set(
          (door.tx + 0.5) * engine.map.tileSize,
          -(door.ty + 0.5) * engine.map.tileSize,
          20
        );
        found = true;
      }
    } else if (kind === 'STAIRWELL' && engine) {
      const st = engine.map.stairwells.find((s) => s.id === targetId);
      if (st) {
        this.tmpVec3.set(st.x, -st.y, 10);
        found = true;
      }
    }
    if (!found) return null;
    this.worldCamera.updateMatrixWorld();
    this.tmpVec3.project(this.worldCamera);
    return {
      x: (this.tmpVec3.x * 0.5 + 0.5) * width,
      y: (-this.tmpVec3.y * 0.5 + 0.5) * height,
    };
  }

  public getContainerScreenPoint(
    containerId: string,
    targetPart: 'CONTAINER' | 'CONTAINER_ITEM',
    width: number,
    height: number
  ): { x: number; y: number } | null {
    return this.getInteractableScreenPoint(targetPart, containerId, undefined, width, height);
  }

  private colorGradeToIndex(grade: ColorGradePreset): number {
    switch (grade) {
      case 'AMBER_RUST':
        return 1;
      case 'NOIR_CONTRAST':
        return 2;
      case 'NEUTRAL':
        return 3;
      default:
        return 0; // COLD_HORROR
    }
  }

  private toneMapToIndex(tm: ToneMappingMode): number {
    switch (tm) {
      case 'NEUTRAL':
        return 1;
      case 'REINHARD_EXTENDED':
        return 2;
      default:
        return 0; // ACES_FILMIC
    }
  }

  private syncPostUniforms(
    bundle: ScreenBlitMaterialBundle,
    timeSec: number,
    renderMode: DebugRenderMode,
    bloomActive: boolean,
    allowHdrOutput: boolean
  ): void {
    const gfx = this.graphicsSettings;
    const inspectionBypass = renderMode !== 'NORMAL';
    bundle.bloomTexNode.value =
      bloomActive && this.bloomATarget ? this.bloomATarget.texture : this.emptyBlackTex;
    bundle.uBloomIntensity.value =
      inspectionBypass || !bloomActive ? 0 : gfx.bloomIntensity;
    bundle.uExposure.value = inspectionBypass ? 1.0 : 1.06;
    bundle.uToneMappingMode.value = inspectionBypass
      ? 1
      : this.toneMapToIndex(gfx.toneMapping);
    bundle.uColorGradeMode.value = inspectionBypass
      ? 3
      : this.colorGradeToIndex(gfx.colorGrade);
    bundle.uFilmGrain.value = inspectionBypass ? 0 : gfx.filmGrain;
    bundle.uTime.value = timeSec;

    const hdrOn = !inspectionBypass && allowHdrOutput;
    bundle.uHdrActive.value = hdrOn ? 1 : 0;
    bundle.uPaperWhiteScale.value = hdrOn
      ? Math.max(0.35, gfx.hdrPaperWhiteNits / 203)
      : 1.0;
    bundle.uHdrPeakRatio.value = hdrOn
      ? Math.max(1.0, gfx.hdrPeakNits / Math.max(80, gfx.hdrPaperWhiteNits))
      : 1.0;
    bundle.uBypassLosBloomGate.value = inspectionBypass ? 1 : 0;
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

    const gfx = this.graphicsSettings;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * gfx.resolutionScale;
    this.ensureRenderTargets(width, height, dpr);
    this.ensureMapBaked(engine.map);

    const renderer = this.renderer;
    const dbg = engine.debugConfig;
    const debugActive = dbg.enabled;
    const freeCam = debugActive && dbg.freeCamEnabled;
    const isFirstPerson = !freeCam && engine.viewMode === 'FIRST_PERSON';
    const ceilVis = this.isCeilingsVisible(engine);
    const shakeX = engine.screenShake > 0 && !freeCam ? (Math.random() - 0.5) * engine.screenShake : 0;
    const shakeY = engine.screenShake > 0 && !freeCam ? (Math.random() - 0.5) * engine.screenShake : 0;
    const zoom = freeCam
      ? Math.max(0.25, dbg.freeCamZoom * getViewportResolutionScale(width, height))
      : engine.getEffectiveZoom(width, height);
    let camWorldX = freeCam ? dbg.freeCamX : engine.cameraX - shakeX / zoom;
    let camWorldY = freeCam ? dbg.freeCamY : engine.cameraY - shakeY / zoom;
    const viewCenterX = width / 2 + shakeX;
    const viewCenterY = height / 2 + shakeY;

    const baseFov = gfx.cameraFovDeg ?? DEFAULT_CAMERA_FOV_DEG;
    const basePitch = gfx.cameraPitchDeg ?? DEFAULT_CAMERA_PITCH_DEG;
    const baseYaw = gfx.cameraYawDeg ?? DEFAULT_CAMERA_YAW_DEG;
    const halfW = width / (2 * zoom);
    const halfH = height / (2 * zoom);

    let camZ = 0;
    let cullHalfW = halfW;
    let cullHalfH = halfH;
    let tiltExpand = 1;
    const activeDeck = engine.getCurrentDeck();
    const renderDeck = debugActive && dbg.debugDeckOverride !== 'AUTO' ? dbg.debugDeckOverride : activeDeck;

    if (isFirstPerson) {
      const p = engine.player;
      const fpBaseFov = gfx.cameraFovDeg > 55 ? gfx.cameraFovDeg : 75;
      const fovDeg = THREE.MathUtils.clamp(debugActive ? dbg.cameraFovDeg : fpBaseFov, 55, 100);
      if (this.worldCamera.fov !== fovDeg) {
        this.worldCamera.fov = fovDeg;
      }
      this.worldCamera.near = 1.6;
      this.worldCamera.aspect = width / Math.max(1, height);
      this.worldCamera.far = 5200;

      let eyeX = p.x;
      let eyeY = p.y;
      const eyeZ =
        engine.fpEyeZ +
        (engine.screenShake > 0 ? (Math.random() - 0.5) * engine.screenShake * 0.16 : 0);

      if (p.peekingDoorId) {
        const pDoor = engine.map.doors.find((d) => d.id === p.peekingDoorId);
        if (pDoor) {
          const dcx = (pDoor.tx + 0.5) * engine.map.tileSize;
          const dcy = (pDoor.ty + 0.5) * engine.map.tileSize;
          if (pDoor.orientation === 'H') {
            const crossSign = Math.sign(dcy - p.y) || 1;
            eyeX = dcx;
            eyeY = dcy + crossSign * 9;
          } else {
            const crossSign = Math.sign(dcx - p.x) || 1;
            eyeX = dcx + crossSign * 9;
            eyeY = dcy;
          }
        }
      } else if (p.peekingSpotId) {
        eyeX += Math.cos(p.angle) * 6;
        eyeY += Math.sin(p.angle) * 6;
      }

      camWorldX = eyeX;
      camWorldY = eyeY;
      camZ = eyeZ;

      const pitchRadFp = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(engine.fpPitchDeg, -75, 75));
      const cosPitch = Math.cos(pitchRadFp);
      const lookDx = Math.cos(p.angle) * cosPitch;
      const lookDy = -Math.sin(p.angle) * cosPitch;
      const lookDz = Math.sin(pitchRadFp);

      this.worldCamera.position.set(eyeX, -eyeY, eyeZ);
      this.worldCamera.up.set(0, 0, 1);
      this.worldCamera.lookAt(eyeX + lookDx * 120, -eyeY + lookDy * 120, eyeZ + lookDz * 120);
      this.worldCamera.updateProjectionMatrix();

      cullHalfW = renderDeck === 'DECK_3' ? 1900 : 1050;
      cullHalfH = renderDeck === 'DECK_3' ? 1900 : 1050;
    } else {
      const fovDeg = THREE.MathUtils.clamp(debugActive ? dbg.cameraFovDeg : baseFov, 25, 92);
      const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(fovDeg * 0.5));
      const pitchRad = THREE.MathUtils.degToRad(
        THREE.MathUtils.clamp(debugActive ? dbg.cameraPitchDeg : basePitch, 0, 82)
      );
      const yawRad = THREE.MathUtils.degToRad(debugActive ? dbg.cameraYawDeg : baseYaw);

      camZ = halfH / Math.max(0.08, tanHalfFov);
      if (this.worldCamera.fov !== fovDeg) {
        this.worldCamera.fov = fovDeg;
      }
      this.worldCamera.near = 10;
      this.worldCamera.aspect = width / Math.max(1, height);
      this.worldCamera.far = Math.max(4000, camZ * 4.5);
      const orbitR = camZ * Math.sin(pitchRad);
      const orbitZ = camZ * Math.cos(pitchRad);
      this.worldCamera.position.set(
        camWorldX + Math.sin(yawRad) * orbitR,
        -camWorldY - Math.cos(yawRad) * orbitR,
        orbitZ
      );
      this.worldCamera.up.set(-Math.sin(yawRad), Math.cos(yawRad), 0);
      this.worldCamera.lookAt(camWorldX, -camWorldY, 0);
      this.worldCamera.updateProjectionMatrix();

      tiltExpand = pitchRad > 0.01 ? 1 + Math.tan(pitchRad) * 1.45 : 1;
      cullHalfW = halfW * tiltExpand;
      cullHalfH = halfH * tiltExpand;
    }

    if (this.oceanBundle && this.oceanMesh) {
      this.oceanBundle.uTime.value = timeSec;
      this.oceanMesh.position.set(camWorldX, -camWorldY, -45);
      if (isFirstPerson) {
        this.oceanMesh.scale.set(5600, 5600, 1);
      } else {
        const oceanScale = ((camZ + 45) / Math.max(1, camZ)) * Math.max(1, tiltExpand * 1.15);
        this.oceanMesh.scale.set(halfW * 2.5 * oceanScale, halfH * 2.5 * oceanScale, 1);
      }
    }

    const incomingStairId = engine.getBruteIncomingStairDestId();

    const showDeck3Sky = renderDeck === 'DECK_3' && (isFirstPerson || ceilVis);
    const skyZ = isFirstPerson ? camZ : 0;
    if (this.skyDomeMesh) {
      this.skyDomeMesh.visible = showDeck3Sky;
      this.skyDomeMesh.position.set(camWorldX, -camWorldY, skyZ);
    }
    if (this.skyLosMesh) {
      this.skyLosMesh.visible = showDeck3Sky;
      this.skyLosMesh.position.set(camWorldX, -camWorldY, skyZ);
    }
    if (this.skyMaskMesh) {
      this.skyMaskMesh.visible = showDeck3Sky;
      this.skyMaskMesh.position.set(camWorldX, -camWorldY, skyZ);
    }

    const peekStair =
      engine.player.peekingStairId !== null &&
      engine.player.hidingSpotId === null &&
      engine.player.climbingStairId === null
        ? engine.map.stairwells.find((s) => s.id === engine.player.peekingStairId)
        : undefined;
    const peekDest = peekStair
      ? engine.map.stairwells.find((s) => s.id === peekStair.targetStairId)
      : undefined;

    const renderDeckPowered = engine.poweredDecks[renderDeck];
    if (renderDeckPowered) {
      this.ensureDeckPoweredLightmap(engine, renderDeck, ceilVis);
    }

    // Precompute raycasted lighting polygons (skipped on renderDeck when pre-baked by Master Fuse!)
    const litRoomPolys = this.computeLitRoomPolygons(
      engine,
      timeSec,
      renderDeck,
      camWorldX,
      camWorldY,
      cullHalfW,
      cullHalfH,
      peekDest,
      renderDeckPowered,
      ceilVis
    );
    const bruteBeam = this.computeBruteBeamPolygon(engine, timeSec, ceilVis, renderDeck);
    const stairGlow = this.computeIncomingStairGlow(engine, incomingStairId, timeSec, ceilVis, renderDeck);
    const doorPeekData = this.computeDoorPeekBeam(engine, ceilVis, renderDeck);
    const activePeekDoorId = doorPeekData ? engine.player.peekingDoorId : null;

    this.structure3d?.setDebugVisualOptions(
      debugActive && dbg.wireframeStructure,
      debugActive && dbg.hideWallCaps
    );
    this.characters3d?.setDebugWireframe(debugActive && dbg.wireframeStructure);
    this.structure3d?.updateForFrame(
      engine,
      renderDeck,
      camWorldX,
      camWorldY,
      cullHalfW + 140,
      cullHalfH + 140,
      incomingStairId,
      timeSec,
      activePeekDoorId,
      ceilVis,
      isFirstPerson
    );

    // 1. Populate & render WORLD SCENE -> sceneTarget
    this.populateWorldScene(
      engine,
      renderDeck,
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
      true,
      cullHalfW,
      cullHalfH,
      ceilVis,
      isFirstPerson
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
      doorPeekData,
      isFirstPerson,
      renderDeck
    );
    this.lastPlayerSightPolys = sightPolys;
    this.populateLosScene(
      sightPolys,
      engine.player.x,
      engine.player.y,
      engine.map.tileSize,
      ceilVis
    );
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.losTarget);
    renderer.render(this.losScene, this.worldCamera);

    // 3. Populate & render LIGHT MASK -> lightMaskTarget
    this.populateLightMaskScene(
      engine,
      renderDeck,
      timeSec,
      litRoomPolys,
      bruteBeam,
      stairGlow,
      doorPeekData,
      sightPolys,
      ceilVis,
      isFirstPerson
    );
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.lightMaskTarget);
    renderer.render(this.lightMaskScene, this.worldCamera);

    // 4. Composite scene * (los * light) + Wall Contact AO -> finalTarget
    const renderMode: DebugRenderMode = debugActive ? dbg.renderMode : 'NORMAL';
    if (this.compositeBundle) {
      const modeVal =
        renderMode === 'FULLBRIGHT'
          ? 1
          : renderMode === 'LOS_ONLY'
            ? 2
            : renderMode === 'LOS_MASK'
              ? 3
              : renderMode === 'LIGHT_MASK'
                ? 4
                : 0;
      this.compositeBundle.uMode.value = modeVal;
      this.compositeBundle.uAoStrength.value =
        gfx.aoQuality === 'OFF' ? 0 : gfx.aoQuality === 'LOW' ? 0.5 : 1.0;
      this.compositeBundle.uTexelStep.value.set(
        1 / Math.max(1, this.targetPixelW),
        1 / Math.max(1, this.targetPixelH)
      );
    }
    renderer.setRenderTarget(this.finalTarget);
    renderer.render(this.compositeScene, this.ndcCamera);

    // 5. Post-darkness perceptual overlays (switch LEDs, stair beacons, Brute eyes, ripples, halo, debug)
    this.populatePostScene(
      engine,
      renderDeck,
      width,
      height,
      zoom,
      camWorldX,
      camWorldY,
      timeSec,
      incomingStairId,
      cullHalfW,
      cullHalfH,
      isFirstPerson
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

    // 7. Screen vignette & LoS-clipped danger / steam condensation fog (skipped in non-normal debug view modes)
    if (renderMode === 'NORMAL') {
      this.updateVignetteUniforms(engine, width, height, timeSec);
      renderer.setRenderTarget(this.finalTarget);
      renderer.autoClear = false;
      renderer.render(this.vignetteScene, this.ndcCamera);
    }

    // 8. Half-Float Bloom Extraction & Separable Gaussian Blur (quarter resolution)
    const bloomActive =
      renderMode === 'NORMAL' && gfx.bloomEnabled && gfx.bloomIntensity > 0.005;
    if (
      bloomActive &&
      this.bloomATarget &&
      this.bloomBTarget &&
      this.bloomExtractBundle &&
      this.bloomBlurHBundle &&
      this.bloomBlurVBundle
    ) {
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(this.bloomATarget);
      renderer.render(this.bloomExtractScene, this.ndcCamera);

      renderer.setRenderTarget(this.bloomBTarget);
      renderer.render(this.bloomBlurHScene, this.ndcCamera);

      renderer.setRenderTarget(this.bloomATarget);
      renderer.render(this.bloomBlurVScene, this.ndcCamera);
    }

    // 9. Color Grade + ACES/Neutral/Reinhard Tone Mapping + HDR1000 Peak/PaperWhite + Film Grain -> canvas (null)
    const hdrActive = isHdrOutputActive(gfx, this.hdrCapabilities, this.isWebGPU);
    if (this.screenBlitBundle) {
      this.syncPostUniforms(this.screenBlitBundle, timeSec, renderMode, bloomActive, hdrActive);
    }
    if (this.readbackBlitBundle) {
      this.syncPostUniforms(this.readbackBlitBundle, timeSec, renderMode, bloomActive, false);
    }

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
    includePlayer: boolean,
    cullHalfW?: number,
    cullHalfH?: number,
    ceilingsVisible = false,
    isFirstPerson = false
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
    const poweredDeckVisible =
      renderDeck === this.bakedLightDeck && engine.poweredDecks[renderDeck];
    if (this.deckWarmQuad) {
      this.deckWarmQuad.visible = poweredDeckVisible;
    }
    this.poweredWarmWallFans?.setVisible(poweredDeckVisible);

    const ts = engine.map.tileSize;
    const halfW = (cullHalfW ?? width / (2 * zoom)) + 140;
    const halfH = (cullHalfH ?? height / (2 * zoom)) + 140;

    // Hull-hugging sea-foam wake on active deck (follows curved Deck 3 bow/stern/chamfer normals)
    if (this.bakedShip) {
      const bounds = engine.map.deckBounds[renderDeck];
      if (
        camY + halfH >= bounds.y1 * ts - 40 &&
        camY - halfH <= (bounds.y2 + 1) * ts + 40
      ) {
        for (const we of this.bakedShip.wakeEdges) {
          if (we.deck !== renderDeck) continue;
          const minEx = Math.min(we.x1, we.x2);
          const maxEx = Math.max(we.x1, we.x2);
          const minEy = Math.min(we.y1, we.y2);
          const maxEy = Math.max(we.y1, we.y2);
          if (
            maxEx < camX - halfW ||
            minEx > camX + halfW ||
            maxEy < camY - halfH - 25 ||
            minEy > camY + halfH + 25
          ) {
            continue;
          }
          const wave = Math.sin(timeSec * 1.8 + we.phase) * 2.5;
          const midX = (we.x1 + we.x2) * 0.5 + we.nx * (we.midYOffset - wave);
          const midY = (we.y1 + we.y2) * 0.5 + we.ny * (we.midYOffset - wave);
          const sx1 = we.x1 + we.nx * wave;
          const sy1 = we.y1 + we.ny * wave;
          const sx2 = we.x2 + we.nx * wave;
          const sy2 = we.y2 + we.ny * wave;
          this.wakeLines!.addSegment(sx1, sy1, midX, midY);
          this.wakeLines!.addSegment(midX, midY, sx2, sy2);
        }
      }
    }

    // 3D Articulated Escape Routes (Helideck Chopper, Lifeboat Davit, Submarine Moonpool & Floodgate Lever)
    this.escapes3d?.updateForFrame(
      engine,
      renderDeck,
      camX,
      camY,
      halfW,
      halfH,
      timeSec
    );

    // 3D Objects (Containers + revealed items, Hiding Spots, Paper Maps, Fuse Controls, Switches, Steam Pipes, Pickups, Props)
    this.objects3d?.updateForFrame(
      engine,
      renderDeck,
      camX,
      camY,
      halfW,
      halfH,
      timeSec,
      includePlayer ? engine.raycastTarget : null
    );

    // Stairwells are 3D recessed/ascending assemblies in ShipStructure3D; preserve incoming floor warning aura in Top-Down
    if (incomingStairId && !isFirstPerson) {
      for (const st of engine.map.stairwells) {
        if (st.deck !== renderDeck || st.id !== incomingStairId) continue;
        if (Math.abs(st.x - camX) > halfW || Math.abs(st.y - camY) > halfH) continue;
        const pulse = 0.65 + 0.35 * Math.sin(timeSec * 10);
        ws.place(sp.softDisc, st.x, st.y, {
          scaleX: 72 / sp.softDisc.w,
          scaleY: 72 / sp.softDisc.h,
          tint: 0xff7300,
          opacity: 0.65 * pulse,
          renderOrder: 6,
        });
      }
    }

    // Steam Pipe warning telegraph glow (3D nozzles & volumetric plumes are in ShipObjects3D)
    for (const pipe of engine.map.steamPipes) {
      if (pipe.deck !== renderDeck || pipe.warningTimer <= 0) continue;
      if (Math.abs(pipe.x - camX) > halfW + 100 || Math.abs(pipe.y - camY) > halfH + 100) {
        continue;
      }
      const wallCx = (pipe.wallTx + 0.5) * ts;
      const wallCy = (pipe.wallTy + 0.5) * ts;
      const edgeX = wallCx + pipe.dirX * (ts * 0.48);
      const edgeY = wallCy + pipe.dirY * (ts * 0.48);
      const wPulse = 0.35 + 0.25 * Math.sin(timeSec * 24);
      ws.place(sp.softDisc, edgeX + pipe.dirX * 10, edgeY + pipe.dirY * 10, {
        scaleX: 52 / sp.softDisc.w,
        scaleY: 52 / sp.softDisc.h,
        tint: 0xfde047,
        opacity: wPulse,
        renderOrder: 7,
      });
    }

    // Particles (filtered to renderDeck bounds)
    const bounds = engine.map.deckBounds[renderDeck];
    const deckMinY = bounds.y1 * ts;
    const deckMaxY = (bounds.y2 + 1) * ts;
    const camQ = isFirstPerson ? this.worldCamera.quaternion : undefined;
    for (const pt of engine.particles) {
      if (pt.y < deckMinY || pt.y > deckMaxY) continue;
      if (Math.abs(pt.x - camX) > halfW || Math.abs(pt.y - camY) > halfH) continue;
      const alpha = Math.max(0, pt.life / pt.maxLife);
      this.setColorFromCss(this.tmpColor, pt.color);
      ws.place(sp.softDisc, pt.x, pt.y, {
        z: isFirstPerson ? 10 : undefined,
        billboardQuaternion: camQ,
        scaleX: (pt.size * 2.2) / sp.softDisc.w,
        scaleY: (pt.size * 2.2) / sp.softDisc.h,
        tint: this.tmpColor.getHex(),
        opacity: alpha,
        renderOrder: 11,
      });
    }

    // Subtle glowing overhead fixture discs inside illuminated rooms/corridors (clipped strictly by LoS composite)
    const fixtureZ = ceilingsVisible ? ts * WALL_HEIGHT_RATIO - 0.6 : 38;
    for (const lp of litRoomPolys) {
      if (lp.poly.length < 3 || lp.deck !== renderDeck || lp.intensity < 0.08) continue;
      ws.place(sp.softDisc, lp.x, lp.y, {
        z: fixtureZ,
        scaleX: 20 / sp.softDisc.w,
        scaleY: 20 / sp.softDisc.h,
        tint: lp.sputterAmount > 0.35 ? 0xe2e8f0 : 0xfff3d1,
        opacity: 0.42 * Math.min(1, lp.intensity),
        renderOrder: 18,
      });
    }

    // 3D Articulated Player & Brute Characters
    this.characters3d?.updateForFrame(engine, renderDeck, timeSec, includePlayer);

    // Warm Lighting Tints (wall-blocked visibility fans)
    this.populateWarmLightingTints(
      engine,
      renderDeck,
      litRoomPolys,
      bruteBeam,
      stairGlow,
      doorPeekData,
      timeSec,
      ceilingsVisible,
      isFirstPerson
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

  private ensureDeckPoweredLightmap(
    engine: MonstrumGameEngine,
    deck: ShipDeck,
    ceilingsVisible = false
  ): void {
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
      this.bakedLightCeilingsVisible === ceilingsVisible &&
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
      this.deckMaskTarget = this.createRt(pw, ph, THREE.HalfFloatType);

      if (!this.deckWarmQuad) {
        const wb = createBakedLightmapQuadMaterial(this.deckWarmTarget.texture, true, true);
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
        const mb = createBakedLightmapQuadMaterial(this.deckMaskTarget.texture, false, true);
        this.deckMaskMat = mb.material;
        this.deckMaskTexNode = mb.texNode;
        this.deckMaskQuad = new THREE.Mesh(this.unitQuadGeom, mb.material);
        this.deckMaskQuad.frustumCulled = false;
        this.deckMaskQuad.renderOrder = 1;
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

    const maskOpts = this.getMaskCurtainOpts(ts, false);
    const warmOpts = this.getWarmCurtainOpts(ts, false);
    const curtainCapZ =
      ceilingsVisible && deck !== 'DECK_3' ? ts * WALL_HEIGHT_RATIO - 0.16 : undefined;

    warmFans.beginFrame();
    maskFans.beginFrame();
    this.poweredWarmWallFans?.beginFrame();
    this.poweredMaskWallFans?.beginFrame();

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
          56,
          maskOpts,
          warmOpts,
          curtainCapZ
        );
        if (cached.poly.length < 3) continue;
        warmFans.addFan(
          cached.warmFan ?? cached.fan,
          14,
          fx.range,
          0.55,
          0xfef0c7,
          0.145,
          0xfde09b,
          0.085,
          0xfde09b,
          0
        );
        this.addMaskFan(maskFans, cached.fan, 20, fx.range, 0.65, 0.96, 0.78);
        if (cached.warmCurtainFan && this.poweredWarmWallFans) {
          this.poweredWarmWallFans.addFan(
            cached.warmCurtainFan,
            14,
            fx.range,
            0.55,
            0xfef0c7,
            0.145,
            0xfde09b,
            0.085,
            0xfde09b,
            0
          );
        }
        if (cached.curtainFan && this.poweredMaskWallFans) {
          this.addMaskFan(this.poweredMaskWallFans, cached.curtainFan, 20, fx.range, 0.65, 0.96, 0.78);
        }
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
        36,
        maskOpts,
        warmOpts,
        curtainCapZ
      );
      if (cached.poly.length < 3) continue;
      warmFans.addFan(
        cached.warmFan ?? cached.fan,
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
      if (cached.warmCurtainFan && this.poweredWarmWallFans) {
        this.poweredWarmWallFans.addFan(
          cached.warmCurtainFan,
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
      }
      if (cached.curtainFan && this.poweredMaskWallFans) {
        this.addMaskFan(
          this.poweredMaskWallFans,
          cached.curtainFan,
          20,
          cl.range,
          0.65,
          0.96 * 0.94,
          0.78 * 0.94
        );
      }
    }

    warmFans.endFrame();
    maskFans.endFrame();
    this.poweredWarmWallFans?.endFrame();
    this.poweredMaskWallFans?.endFrame();

    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.deckWarmTarget);
    renderer.render(this.deckBakeWarmScene, this.deckBakeCamera);

    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.deckMaskTarget);
    renderer.render(this.deckBakeMaskScene, this.deckBakeCamera);

    renderer.setRenderTarget(null);

    if (this.deckWarmQuad) {
      this.deckWarmQuad.position.set(worldW * 0.5, -(yMin + yMax) * 0.5, 0.03);
      this.deckWarmQuad.scale.set(worldW, worldH, 1);
    }
    if (this.deckMaskQuad) {
      this.deckMaskQuad.position.set(worldW * 0.5, -(yMin + yMax) * 0.5, 0.03);
      this.deckMaskQuad.scale.set(worldW, worldH, 1);
    }

    this.bakedLightMapRef = map;
    this.bakedLightDeck = deck;
    this.bakedLightDoorHash1 = h1;
    this.bakedLightDoorHash2 = h2;
    this.bakedLightCeilingsVisible = ceilingsVisible;
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
    skipActiveDeckStatic = false,
    ceilingsVisible = false
  ): RayLightPoly[] {
    const polys: RayLightPoly[] = [];
    const b = engine.brute;
    const ts = engine.map.tileSize;
    const maskOpts = this.getMaskCurtainOpts(ts, ceilingsVisible, engine.map, activeDeck);
    const warmOpts = this.getWarmCurtainOpts(ts, ceilingsVisible, engine.map, activeDeck);

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
          56,
          maskOpts,
          warmOpts
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
          warmFan: cached.warmFan ?? cached.fan,
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
        36,
        maskOpts,
        warmOpts
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
        warmFan: cached.warmFan ?? cached.fan,
        poly: cached.poly,
      });
    }

    return polys;
  }

  private computeBruteBeamPolygon(
    engine: MonstrumGameEngine,
    timeSec: number,
    ceilingsVisible = false,
    renderDeck?: ShipDeck
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
    const poly: VisibilityVertex[] = [{ x: ox, y: oy }, ...rayPts];
    const deck = renderDeck ?? engine.getCurrentDeck();
    const bruteMaskOpts = this.getMaskCurtainOpts(engine.map.tileSize, ceilingsVisible, engine.map, deck);
    if (engine.viewMode === 'FIRST_PERSON') {
      bruteMaskOpts.ceilingCapZ = undefined;
    }
    const fan = this.buildDynamicFan(
      'bruteBeam',
      ox,
      oy,
      rayPts,
      false,
      bruteMaskOpts
    );
    const warmFan = this.buildDynamicFan(
      'bruteBeam:warm',
      ox,
      oy,
      rayPts,
      false,
      this.getWarmCurtainOpts(engine.map.tileSize, false, engine.map, deck)
    );
    return { ox, oy, angle: b.angle, range, intensity, isChasing, fan, warmFan, poly };
  }

  private computeIncomingStairGlow(
    engine: MonstrumGameEngine,
    incomingStairId: string | null,
    timeSec: number,
    ceilingsVisible = false,
    renderDeck?: ShipDeck
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
    const deck = renderDeck ?? st.deck;
    const fan = this.buildDynamicFan(
      'stairGlow',
      st.x,
      st.y,
      poly,
      true,
      this.getMaskCurtainOpts(engine.map.tileSize, ceilingsVisible, engine.map, deck)
    );
    const warmFan = this.buildDynamicFan(
      'stairGlow:warm',
      st.x,
      st.y,
      poly,
      true,
      this.getWarmCurtainOpts(engine.map.tileSize, false, engine.map, deck)
    );
    return { x: st.x, y: st.y, range, intensity, fan, warmFan, poly };
  }

  private computeDoorPeekBeam(
    engine: MonstrumGameEngine,
    ceilingsVisible = false,
    renderDeck?: ShipDeck
  ): DoorPeekBeamData | null {
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
    const poly: VisibilityVertex[] = [{ x: ox, y: oy }, ...rayPts];
    const deck = renderDeck ?? engine.getCurrentDeck();
    const fan = this.buildDynamicFan(
      'doorPeek',
      ox,
      oy,
      rayPts,
      false,
      this.getMaskCurtainOpts(ts, ceilingsVisible, engine.map, deck)
    );
    const warmFan = this.buildDynamicFan(
      'doorPeek:warm',
      ox,
      oy,
      rayPts,
      false,
      this.getWarmCurtainOpts(ts, false, engine.map, deck)
    );
    return { ox, oy, range, isLitSide, fan, warmFan, poly };
  }

  private populateWarmLightingTints(
    engine: MonstrumGameEngine,
    renderDeck: ShipDeck,
    litRoomPolys: RayLightPoly[],
    bruteBeam: BruteBeamData | null,
    stairGlow: StairGlowData | null,
    doorPeekData: DoorPeekBeamData | null,
    timeSec: number,
    _ceilingsVisible = false,
    isFirstPerson = false
  ): void {
    const swf = this.staticWarmFans!;
    const wf = this.worldWarmFans!;

    const roomA0 = isFirstPerson ? 0.11 : 0.145;
    const roomA1 = isFirstPerson ? 0.06 : 0.085;
    for (const lp of litRoomPolys) {
      if (lp.poly.length < 3 || lp.deck !== renderDeck) continue;

      if (lp.sputterAmount > 0.35) {
        swf.addFan(
          lp.warmFan,
          14,
          lp.range,
          0.55,
          0xe2e8f0,
          roomA0 * lp.intensity,
          0xcbd5e1,
          roomA1 * lp.intensity,
          0xcbd5e1,
          0
        );
      } else {
        swf.addFan(
          lp.warmFan,
          14,
          lp.range,
          0.55,
          0xfef0c7,
          roomA0 * lp.intensity,
          0xfde09b,
          roomA1 * lp.intensity,
          0xfde09b,
          0
        );
      }
    }

    if (bruteBeam && bruteBeam.poly.length >= 3) {
      const ty = Math.floor(bruteBeam.oy / engine.map.tileSize);
      if ((engine.map.deckGrid[ty]?.[0] ?? renderDeck) === renderDeck) {
        const bruteCone = isFirstPerson
          ? {
              angle: bruteBeam.angle,
              innerHalfRad: (10 * Math.PI) / 180,
              outerHalfRad: ((bruteBeam.isChasing ? 33 : 29) * Math.PI) / 180,
            }
          : undefined;
        wf.addFan(
          bruteBeam.warmFan,
          6,
          bruteBeam.range,
          0.5,
          0xffc369,
          (isFirstPerson
            ? bruteBeam.isChasing
              ? 0.16
              : 0.12
            : bruteBeam.isChasing
              ? 0.44
              : 0.34) * bruteBeam.intensity,
          0xf97316,
          (isFirstPerson
            ? bruteBeam.isChasing
              ? 0.07
              : 0.05
            : bruteBeam.isChasing
              ? 0.24
              : 0.17) * bruteBeam.intensity,
          0xea580c,
          0,
          bruteCone
        );
      }
    }

    if (stairGlow && stairGlow.poly.length >= 3) {
      wf.addFan(
        stairGlow.warmFan,
        10,
        stairGlow.range,
        0.55,
        0xff8c1e,
        (isFirstPerson ? 0.18 : 0.42) * stairGlow.intensity,
        0xea580c,
        (isFirstPerson ? 0.06 : 0.18) * stairGlow.intensity,
        0xea580c,
        0
      );
    }

    if (doorPeekData && !doorPeekData.isLitSide && doorPeekData.poly.length >= 3) {
      wf.addFan(
        doorPeekData.warmFan,
        6,
        doorPeekData.range,
        0.55,
        0xfef9e0,
        isFirstPerson ? 0.1 : 0.22,
        0xe2e8f0,
        isFirstPerson ? 0.03 : 0.09,
        0xe2e8f0,
        0
      );
    }

    const ts = engine.map.tileSize;
    const warmOpts = this.getWarmCurtainOpts(ts, false, engine.map, renderDeck);
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
      const fan = this.buildDynamicFan(`dropped:${l.id}`, l.x, l.y, poly, true, warmOpts);
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
    doorPeekData: DoorPeekBeamData | null,
    isFirstPerson = false,
    renderDeck?: ShipDeck
  ): VisibilityVertex[][] {
    const p = engine.player;
    const isHiding = p.hidingSpotId !== null;
    const isPeekingSpot = p.peekingSpotId !== null;
    const sightPolys: VisibilityVertex[][] = [];

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
      const coneWidth = ((isFirstPerson ? 108 : 54) * Math.PI) / 180;
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
          isFirstPerson ? 64 : 48
        ),
      ]);
    } else {
      const deck = renderDeck ?? engine.getCurrentDeck();
      const maxSightDist = isFirstPerson
        ? deck === 'DECK_3'
          ? 2600
          : 980
        : Math.hypot(width, height) / (2 * zoom) + 260;
      sightPolys.push(
        computeVisibilityPolygon(
          engine.map,
          engine.doorsByTile,
          p.x,
          p.y,
          0,
          Math.PI * 2,
          maxSightDist,
          isFirstPerson ? (deck === 'DECK_3' ? 180 : 140) : 120
        )
      );
    }

    if (doorPeekData) {
      sightPolys.push(doorPeekData.poly);
    }

    return sightPolys;
  }

  private populateLosScene(
    sightPolys: VisibilityVertex[][],
    playerX: number,
    playerY: number,
    tileSize: number,
    ceilingsVisible = false,
    map?: ShipMap,
    renderDeck?: ShipDeck
  ): void {
    const lf = this.losFans!;
    lf.beginFrame();
    this.portalLosFans?.clear();
    const maskOpts = this.getMaskCurtainOpts(tileSize, ceilingsVisible, map, renderDeck);

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
      const fan = this.buildDynamicFan(`los:${i}`, centerX, centerY, fanPts, isClosedLoop, maskOpts);
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
    a1: number,
    cone?: { angle: number; innerHalfRad: number; outerHalfRad: number }
  ): void {
    batch.addFan(fan, innerR, range, stopPos, 0xffffff, a0, 0xffffff, a1, 0xffffff, 0, cone);
  }

  private populateLightMaskScene(
    engine: MonstrumGameEngine,
    activeDeck: ShipDeck,
    timeSec: number,
    litRoomPolys: RayLightPoly[],
    bruteBeam: BruteBeamData | null,
    stairGlow: StairGlowData | null,
    doorPeekData: DoorPeekBeamData | null,
    sightPolys: VisibilityVertex[][],
    ceilingsVisible = false,
    isFirstPerson = false
  ): void {
    const smf = this.staticMaskFans!;
    const mf = this.lightMaskFans!;
    smf.beginFrame();
    mf.beginFrame();

    const p = engine.player;
    const ts = engine.map.tileSize;
    const maskOpts = this.getMaskCurtainOpts(ts, ceilingsVisible, engine.map, activeDeck);
    const isHiding = p.hidingSpotId !== null;
    const isPeekingSpot = p.peekingSpotId !== null;
    const poweredMaskVisible =
      activeDeck === this.bakedLightDeck && engine.poweredDecks[activeDeck];
    if (this.deckMaskQuad) {
      this.deckMaskQuad.visible = poweredMaskVisible;
    }
    this.poweredMaskWallFans?.setVisible(poweredMaskVisible);

    // 0. Exterior Deck 3 moonlit base across visible outdoor walls & weather decks
    if (
      activeDeck === 'DECK_3' &&
      (isFirstPerson || ceilingsVisible) &&
      !isHiding &&
      this.isDeck3ExteriorPos(engine.map, p.x, p.y) &&
      sightPolys[0]?.length >= 3
    ) {
      const moonCurtainOpts: FanCurtainOptions = {
        ...this.getMaskCurtainOpts(ts, false),
        pushInwardPx: 0,
      };
      const moonFan = this.buildDynamicFan(
        'mask:deck3Moon',
        p.x,
        p.y,
        sightPolys[0],
        true,
        moonCurtainOpts
      );
      smf.addFan(
        moonFan,
        24,
        2600,
        0.5,
        0xa2b9d8,
        0.95,
        0xa2b9d8,
        0.86,
        0xa2b9d8,
        0.76
      );
    }

    // 1. Close tactile ambient awareness around player
    const ambientRadius = isHiding ? 34 : isFirstPerson ? 128 : 92;
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
      const fan = this.buildDynamicFan('mask:ambient', p.x, p.y, ambPoly, true, maskOpts);
      this.addMaskFan(
        mf,
        fan,
        6,
        ambientRadius,
        isFirstPerson && !isHiding ? 0.42 : 0.55,
        isHiding ? 0.86 : isFirstPerson ? 0.85 : 0.9,
        isHiding ? 0.34 : isFirstPerson ? 0.4 : 0.44
      );
    }

    // 2. Flashlight double-cone (broad spill + focused HDR hotspot core) or silent lit-room vent peek
    if (p.flashlightOn && p.battery > 0 && (!isHiding || isPeekingSpot)) {
      const range = isFirstPerson
        ? isPeekingSpot
          ? 480
          : 580
        : isPeekingSpot
          ? 460
          : 520;
      const coneWidthDeg = isFirstPerson
        ? isPeekingSpot
          ? 70
          : 136
        : isPeekingSpot
          ? 54
          : 82;
      const coneWidth = (coneWidthDeg * Math.PI) / 180;
      const flicker = p.battery < 18 && Math.sin(timeSec * 37) > 0.72 ? 0.45 : 1.0;
      const conePoly = computeVisibilityPolygon(
        engine.map,
        engine.doorsByTile,
        p.x,
        p.y,
        p.angle - coneWidth / 2,
        coneWidth,
        range,
        isFirstPerson ? 88 : 72
      );
      if (conePoly.length >= 2) {
        const fan = this.buildDynamicFan('mask:flashlight', p.x, p.y, conePoly, false, maskOpts);
        const fpCone = isFirstPerson
          ? {
              angle: p.angle,
              innerHalfRad: ((isPeekingSpot ? 18 : 30) * Math.PI) / 180,
              outerHalfRad: ((isPeekingSpot ? 34 : 66) * Math.PI) / 180,
            }
          : undefined;
        this.addMaskFan(
          mf,
          fan,
          12,
          range,
          0.68,
          0.98 * flicker,
          0.82 * flicker,
          fpCone
        );
      }

      const coreRange = isFirstPerson
        ? isPeekingSpot
          ? 520
          : 600
        : isPeekingSpot
          ? 500
          : 560;
      const coreWidthDeg = isFirstPerson
        ? isPeekingSpot
          ? 28
          : 44
        : isPeekingSpot
          ? 26
          : 34;
      const coreWidth = (coreWidthDeg * Math.PI) / 180;
      const corePoly = computeVisibilityPolygon(
        engine.map,
        engine.doorsByTile,
        p.x,
        p.y,
        p.angle - coreWidth / 2,
        coreWidth,
        coreRange,
        36
      );
      if (corePoly.length >= 2) {
        const coreMaskOpts = isFirstPerson ? { ...maskOpts, ceilingCapZ: undefined } : maskOpts;
        const coreFan = this.buildDynamicFan('mask:flashlightCore', p.x, p.y, corePoly, false, coreMaskOpts);
        const fpCoreCone = isFirstPerson
          ? {
              angle: p.angle,
              innerHalfRad: (8 * Math.PI) / 180,
              outerHalfRad: ((isPeekingSpot ? 13 : 20) * Math.PI) / 180,
            }
          : undefined;
        this.addMaskFan(
          mf,
          coreFan,
          10,
          coreRange,
          0.56,
          0.74 * flicker,
          0.46 * flicker,
          fpCoreCone
        );
      }
    } else if (
      isHiding &&
      isPeekingSpot &&
      !p.flashlightOn &&
      engine.isHidingSpotRoomLit(p.hidingSpotId)
    ) {
      const range = 420;
      const coneWidth = ((isFirstPerson ? 108 : 54) * Math.PI) / 180;
      const conePoly = computeVisibilityPolygon(
        engine.map,
        engine.doorsByTile,
        p.x,
        p.y,
        p.angle - coneWidth / 2,
        coneWidth,
        range,
        isFirstPerson ? 68 : 56
      );
      if (conePoly.length >= 2) {
        const fan = this.buildDynamicFan('mask:ventPeek', p.x, p.y, conePoly, false, maskOpts);
        const ventCone = isFirstPerson
          ? {
              angle: p.angle,
              innerHalfRad: (24 * Math.PI) / 180,
              outerHalfRad: (52 * Math.PI) / 180,
            }
          : undefined;
        this.addMaskFan(mf, fan, 12, range, 0.65, 0.74, 0.48, ventCone);
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
        1.12 * lp.intensity,
        0.84 * lp.intensity
      );
    }

    // 5. Brute Searchlight Beam (+ soft wide ceiling bounce in FP so ceiling isn't laser-streaked)
    if (bruteBeam && bruteBeam.poly.length >= 3) {
      const ty = Math.floor(bruteBeam.oy / engine.map.tileSize);
      if ((engine.map.deckGrid[ty]?.[0] ?? activeDeck) === activeDeck) {
        const bruteCone = isFirstPerson
          ? {
              angle: bruteBeam.angle,
              innerHalfRad: (10 * Math.PI) / 180,
              outerHalfRad: ((bruteBeam.isChasing ? 33 : 29) * Math.PI) / 180,
            }
          : undefined;
        this.addMaskFan(
          mf,
          bruteBeam.fan,
          10,
          bruteBeam.range,
          0.66,
          1.14 * bruteBeam.intensity,
          0.84 * bruteBeam.intensity,
          bruteCone
        );
        if (isFirstPerson && ceilingsVisible) {
          const bounceR = Math.min(220, bruteBeam.range * 0.65);
          const bouncePoly = computeVisibilityPolygon(
            engine.map,
            engine.doorsByTile,
            bruteBeam.ox,
            bruteBeam.oy,
            0,
            Math.PI * 2,
            bounceR,
            32
          );
          if (bouncePoly.length >= 3) {
            const bounceFan = this.buildDynamicFan(
              'mask:bruteBounce',
              bruteBeam.ox,
              bruteBeam.oy,
              bouncePoly,
              true,
              maskOpts
            );
            this.addMaskFan(
              mf,
              bounceFan,
              10,
              bounceR,
              0.55,
              0.46 * bruteBeam.intensity,
              0.16 * bruteBeam.intensity
            );
          }
        }
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
      const fan = this.buildDynamicFan(`mask:drop:${l.id}`, l.x, l.y, lightPoly, true, maskOpts);
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
        40,
        maskOpts
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
    activeDeck: ShipDeck,
    width: number,
    height: number,
    zoom: number,
    camX: number,
    camY: number,
    timeSec: number,
    incomingStairId: string | null,
    cullHalfW: number,
    cullHalfH: number,
    isFirstPerson = false
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
    const canSeeOut = !(p.hidingSpotId !== null && p.peekingSpotId === null);

    // 1. Light switch beacons (Top-Down / FreeCam floor dots; 3D switches carry emissive LEDs in FP)
    if (canSeeOut && !isFirstPerson) {
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

      // 2. Stairwell beacons (Top-Down / FreeCam floor beacons)
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

    // 4. Brute visor eyes & furnace core gleam in darkness (LoS-gated, aligned to 3D rig anchors)
    const renderMode = engine.debugConfig.enabled ? engine.debugConfig.renderMode : 'NORMAL';
    if (renderMode !== 'FULLBRIGHT') {
      this.addBruteEyesPostSprites(engine, activeDeck, timeSec, ps);
    }

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

    // 6. Interact halo (Top-Down / FreeCam only; First-Person uses crisp HUD crosshair reticle)
    const rt = engine.raycastTarget;
    if (rt && rt.inReach && rt.hasLos && !isFirstPerson && p.peekingDoorId === null && p.hidingSpotId === null) {
      let tx = rt.hitX;
      let ty = rt.hitY;
      let tz = Math.max(0.5, rt.hitZ);
      if (rt.kind === 'PICKUP') {
        const wp = engine.worldPickups.find((w) => w.id === Number(rt.targetId));
        if (wp) {
          tx = wp.x;
          ty = wp.y;
          tz = 8;
        }
      } else if (rt.kind === 'HIDING') {
        const hs = engine.map.hidingSpots.find((h) => h.id === rt.targetId);
        if (hs) {
          tx = hs.x;
          ty = hs.y;
          tz = 14;
        }
      } else if (rt.kind === 'PAPER_MAP') {
        const pm = engine.map.paperMaps.find((m) => m.id === rt.targetId);
        if (pm) {
          tx = pm.x;
          ty = pm.y;
          tz = 16;
        }
      } else if (rt.kind === 'FUSE_SOCKET') {
        const fs = engine.map.fuseSockets.find((f) => f.id === rt.targetId);
        if (fs) {
          tx = fs.x;
          ty = fs.y;
          tz = 18;
        }
      } else if (rt.kind === 'LIGHT_SWITCH') {
        const sw = engine.map.lightSwitches.find((s) => s.id === rt.targetId);
        if (sw) {
          tx = sw.x;
          ty = sw.y;
          tz = 22;
        }
      } else if (rt.kind === 'STAIRWELL') {
        const st = engine.map.stairwells.find((s) => s.id === rt.targetId);
        if (st) {
          tx = st.x;
          ty = st.y;
          tz = 4;
        }
      } else if (rt.kind === 'DOOR') {
        const door = engine.map.doors.find((d) => d.id === rt.targetId);
        if (door) {
          tx = (door.tx + 0.5) * engine.map.tileSize;
          ty = (door.ty + 0.5) * engine.map.tileSize;
          tz = 18;
        }
      } else if (rt.kind === 'ESCAPE_LIFEBOAT') {
        tx = engine.map.lifeboatPos.x;
        ty = engine.map.lifeboatPos.y;
        tz = 16;
      } else if (rt.kind === 'ESCAPE_HELI' && rt.subTarget !== 'CHAIN') {
        tx = engine.map.heliPos.x;
        ty = engine.map.heliPos.y;
        tz = 20;
      } else if (rt.kind === 'ESCAPE_SUBMARINE') {
        tx = rt.subTarget === 'LEVER' ? engine.map.submarinePos.leverX : engine.map.submarinePos.x;
        ty = rt.subTarget === 'LEVER' ? engine.map.submarinePos.leverY : engine.map.submarinePos.y;
        tz = rt.subTarget === 'LEVER' ? 18 : 10;
      }
      const pulse = 16 + Math.sin(timeSec * 6) * 2.5;
      ps.place(sp.softRing, tx, ty, {
        z: engine.viewMode === 'FIRST_PERSON' ? tz : 0,
        billboardQuaternion: engine.viewMode === 'FIRST_PERSON' ? this.worldCamera.quaternion : undefined,
        scaleX: (pulse * 2) / sp.softRing.w,
        scaleY: (pulse * 2) / sp.softRing.h,
        tint: 0xf8fafc,
        opacity: 0.72,
        renderOrder: 2,
      });
    }

    // 7. Debug Overlays
    if (engine.debugConfig.enabled) {
      this.populateDebugOverlays(
        engine,
        activeDeck,
        width,
        height,
        zoom,
        camX,
        camY,
        cullHalfW,
        cullHalfH
      );
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
    activeDeck: ShipDeck,
    timeSec: number,
    ps: SpritePool
  ): void {
    const sp = this.sprites!;
    const b = engine.brute;
    const p = engine.player;
    if (b.state === 'STUNNED' || b.stairClimbTimer > 0) return;

    const bTy = Math.floor(b.y / engine.map.tileSize);
    const bounds = engine.map.deckBounds[activeDeck];
    if (bTy < bounds.y1 || bTy > bounds.y2) return;

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
    const pulse = 0.78 + Math.sin(timeSec * 10) * 0.22;
    const glowR = isChasing ? 24 : isStalking ? 18 : 14;
    const eyeTint = isChasing ? 0xffedd5 : isStalking ? 0xfdba74 : 0xfb923c;
    const camQ = this.worldCamera.quaternion;
    const anchors = this.characters3d?.getBruteGleamAnchors();

    const placeGlow3d = (
      wx: number,
      wy: number,
      wz: number,
      sizeX: number,
      sizeY: number,
      tint: number,
      opacity: number,
      renderOrder: number
    ) => {
      ps.place(sp.softDisc, wx, wy, {
        z: wz,
        billboardQuaternion: camQ,
        scaleX: sizeX / sp.softDisc.w,
        scaleY: sizeY / sp.softDisc.h,
        tint,
        opacity,
        renderOrder,
      });
    };

    if (anchors && anchors.valid) {
      // Subtle visor ember aura + razor-narrow eye slits at exact 3D helm coordinates
      placeGlow3d(
        anchors.browX,
        anchors.browY,
        anchors.browZ,
        glowR * 0.85,
        glowR * 0.65,
        isChasing ? 0xff5500 : isStalking ? 0xfb923c : 0xea580c,
        isChasing ? 0.28 * pulse : isStalking ? 0.2 * pulse : 0.14,
        1
      );
      placeGlow3d(anchors.leftEyeX, anchors.leftEyeY, anchors.leftEyeZ, 4.4, 2.0, eyeTint, 0.92, 2);
      placeGlow3d(anchors.rightEyeX, anchors.rightEyeY, anchors.rightEyeZ, 4.4, 2.0, eyeTint, 0.92, 2);

      // Subtle molten furnace core gleam on sternum in darkness
      placeGlow3d(
        anchors.chestX,
        anchors.chestY,
        anchors.chestZ,
        (isChasing ? 18 : isStalking ? 14 : 11) * (0.94 + 0.06 * pulse),
        (isChasing ? 18 : isStalking ? 14 : 11) * (0.94 + 0.06 * pulse),
        isChasing ? 0xff5500 : isStalking ? 0xea580c : 0xc2410c,
        (isChasing ? 0.28 : isStalking ? 0.19 : 0.12) * pulse,
        1
      );
      placeGlow3d(
        anchors.chestX,
        anchors.chestY,
        anchors.chestZ,
        isChasing ? 7.5 : isStalking ? 6.0 : 4.6,
        isChasing ? 6.5 : isStalking ? 5.2 : 4.0,
        isChasing ? 0xfdba74 : 0xf97316,
        (isChasing ? 0.48 : isStalking ? 0.34 : 0.22) * pulse,
        2
      );
    } else {
      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);
      placeGlow3d(
        b.x + 12 * cos,
        b.y + 12 * sin,
        36,
        glowR * 1.1,
        glowR * 0.9,
        isChasing ? 0xff5500 : isStalking ? 0xfb923c : 0xf97316,
        isChasing ? 0.38 * pulse : isStalking ? 0.28 * pulse : 0.2,
        1
      );
      placeGlow3d(
        b.x + 12.5 * cos - -3.5 * sin,
        b.y + 12.5 * sin + -3.5 * cos,
        36,
        4.4,
        2.0,
        eyeTint,
        0.92,
        2
      );
      placeGlow3d(
        b.x + 12.5 * cos - 3.5 * sin,
        b.y + 12.5 * sin + 3.5 * cos,
        36,
        4.4,
        2.0,
        eyeTint,
        0.92,
        2
      );
    }
  }

  private populateDebugOverlays(
    engine: MonstrumGameEngine,
    renderDeck: ShipDeck,
    width: number,
    height: number,
    zoom: number,
    camX: number,
    camY: number,
    cullHalfW: number,
    cullHalfH: number
  ): void {
    const cfg = engine.debugConfig;
    const halfW = cullHalfW + 80;
    const halfH = cullHalfH + 80;

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

    if (cfg.showStructureGizmos) {
      const ts = engine.map.tileSize;
      const bounds = engine.map.deckBounds[renderDeck];
      for (const door of engine.map.doors) {
        if (door.ty < bounds.y1 || door.ty > bounds.y2) continue;
        const cx = (door.tx + 0.5) * ts;
        const cy = (door.ty + 0.5) * ts;
        if (Math.abs(cx - camX) > halfW || Math.abs(cy - camY) > halfH) continue;

        const tileX = door.tx * ts;
        const tileY = door.ty * ts;
        const lineBatch = door.isBroken
          ? this.postLinesRed!
          : door.isLocked
            ? this.postLinesRose!
            : door.isWatertight
              ? this.postLinesCyan!
              : this.postLinesEmerald!;
        lineBatch.addRect(tileX + 0.5, tileY + 0.5, ts - 1, ts - 1);

        // Draw centerline axis & open swing arc
        if (door.orientation === 'H') {
          this.postLinesWhite!.addSegment(tileX + 4, cy, tileX + ts - 4, cy);
        } else {
          this.postLinesWhite!.addSegment(cx, tileY + 4, cx, tileY + ts - 4);
        }

        const leafW = ts - 8;
        const hingeX = door.orientation === 'H' ? cx - ts / 2 + 4 : cx;
        const hingeY = door.orientation === 'H' ? cy : cy - ts / 2 + 4;
        const closedAng = door.orientation === 'H' ? 0 : Math.PI / 2;
        const openAng = closedAng - 1.38;
        for (let s = 0; s < 10; s++) {
          const a0 = closedAng + ((openAng - closedAng) * s) / 10;
          const a1 = closedAng + ((openAng - closedAng) * (s + 1)) / 10;
          this.postLinesAmber!.addSegment(
            hingeX + Math.cos(a0) * leafW,
            hingeY + Math.sin(a0) * leafW,
            hingeX + Math.cos(a1) * leafW,
            hingeY + Math.sin(a1) * leafW
          );
        }

        const kindTag = door.isBroken
          ? 'BRK'
          : door.isLocked
            ? 'LCK'
            : door.isWatertight
              ? 'WTR'
              : 'NRM';
        const badgeText = `${door.orientation}·${kindTag}`;
        const badge = this.getTextBadge(`gizmo:d:${badgeText}`, badgeText, {
          font: '700 9px "JetBrains Mono", monospace',
          textColor: '#f8fafc',
          bgColor: 'rgba(2, 6, 23, 0.86)',
          borderColor:
            door.isBroken ? '#ef4444' : door.isLocked ? '#f43f5e' : door.isWatertight ? '#38bdf8' : '#34d399',
          padX: 4,
          height: 14,
        });
        this.postSprites!.place(badge, cx, cy - ts * 0.5 - 8, { renderOrder: 6 });
      }

      for (const st of engine.map.stairwells) {
        if (st.deck !== renderDeck) continue;
        if (Math.abs(st.x - camX) > halfW || Math.abs(st.y - camY) > halfH) continue;
        const tileX = st.tx * ts;
        const tileY = st.ty * ts;
        const stLines = st.direction === 'DOWN' ? this.postLinesCyan! : this.postLinesAmber!;
        stLines.addRect(tileX + 0.5, tileY + 0.5, ts - 1, ts - 1);

        // Show exact approach vector into stairwell (local +Y_three = inward)
        const rotZ = this.structure3d?.getStairRotation(st.id) ?? 0;
        // Three local approach inward is (0, +1) -> world2D: (-sin(-rotZ?), ...). Earlier verified:
        // Entrance is Three (sin(rotZ), -cos(rotZ)) = world2D (sin(rotZ), cos(rotZ)).
        // So inward vector from entrance toward stairwell center is (-sin(rotZ), -cos(rotZ)).
        const inX = -Math.sin(rotZ);
        const inY = -Math.cos(rotZ);
        const startX = st.x - inX * 28;
        const startY = st.y - inY * 28;
        const endX = st.x + inX * 14;
        const endY = st.y + inY * 14;
        this.postLinesWhite!.addSegment(startX, startY, endX, endY);
        const px = -inY * 6;
        const py = inX * 6;
        this.postLinesWhite!.addSegment(endX, endY, endX - inX * 7 + px, endY - inY * 7 + py);
        this.postLinesWhite!.addSegment(endX, endY, endX - inX * 7 - px, endY - inY * 7 - py);

        const stText = st.direction === 'DOWN' ? '↓ DN' : '↑ UP';
        const stBadge = this.getTextBadge(`gizmo:st:${stText}`, stText, {
          font: '700 9px "JetBrains Mono", monospace',
          textColor: '#f8fafc',
          bgColor: 'rgba(2, 6, 23, 0.88)',
          borderColor: st.direction === 'DOWN' ? '#38bdf8' : '#fbbf24',
          padX: 4,
          height: 14,
        });
        this.postSprites!.place(stBadge, st.x, st.y - ts * 0.5 - 8, { renderOrder: 6 });
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
    const rawPortalX =
      engine.viewMode === 'FIRST_PERSON' ? width * 0.5 : viewCenterX + (st.x - engine.cameraX) * zoom;
    const rawPortalY =
      engine.viewMode === 'FIRST_PERSON' ? height * 0.5 : viewCenterY + (st.y - engine.cameraY) * zoom;
    const portalRadius = Math.max(145, Math.min(280, Math.round(200 * zoom)));
    const margin = portalRadius + 16;
    const portalX = Math.max(margin, Math.min(width - margin, rawPortalX));
    const portalY = Math.max(margin, Math.min(height - margin, rawPortalY));
    const viewWorldRadius = portalRadius / zoom;
    const peekRange = Math.min(600, viewWorldRadius + 28);

    if (this.skyDomeMesh) this.skyDomeMesh.visible = false;
    if (this.skyLosMesh) this.skyLosMesh.visible = false;
    if (this.skyMaskMesh) this.skyMaskMesh.visible = false;

    this.ensurePortalTargets(portalRadius * 2 * dpr);

    // 1. Render destination world into portalTarget with 3D perspective camera matching active FOV
    const activeFov = CAMERA_FOV_DEG;
    const portalTanHalfFov = Math.max(0.08, Math.tan(THREE.MathUtils.degToRad(activeFov * 0.5)));
    if (this.portalCamera.fov !== activeFov) {
      this.portalCamera.fov = activeFov;
    }
    const portalCamZ = viewWorldRadius / portalTanHalfFov;
    this.portalCamera.aspect = 1;
    this.portalCamera.far = Math.max(4000, portalCamZ * 4.5);
    this.portalCamera.position.set(dest.x, -dest.y, portalCamZ);
    this.portalCamera.lookAt(dest.x, -dest.y, 0);
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

    this.structure3d?.updateForFrame(
      engine,
      dest.deck,
      dest.x,
      dest.y,
      viewWorldRadius + 140,
      viewWorldRadius + 140,
      null,
      timeSec,
      null,
      false
    );

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
      false,
      undefined,
      undefined,
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
      const fan = this.buildDynamicFan(
        'portalLos',
        dest.x,
        dest.y,
        destSightPoly,
        true,
        this.getMaskCurtainOpts(engine.map.tileSize)
      );
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
      const isStalking = b.state === 'STALK' || b.state === 'CHECK_HIDING';
      const pulse = 0.78 + Math.sin(timeSec * 10) * 0.22;
      const anchors = this.characters3d?.getBruteGleamAnchors();
      const placePortal3d = (
        wx: number,
        wy: number,
        wz: number,
        sz: number,
        tint: number,
        op: number,
        ro = 1
      ) => {
        this.tmpVec3.set(wx, -wy, wz).project(this.portalCamera);
        const sx = portalX + this.tmpVec3.x * portalRadius;
        const sy = portalY - this.tmpVec3.y * portalRadius;
        if (Math.hypot(sx - portalX, sy - portalY) < portalRadius - 8) {
          ss.place(sp.softDisc, sx, sy, {
            scaleX: (sz * zoom) / sp.softDisc.w,
            scaleY: (sz * zoom) / sp.softDisc.h,
            tint,
            opacity: op,
            renderOrder: ro,
          });
        }
      };

      if (anchors && anchors.valid) {
        placePortal3d(
          anchors.browX,
          anchors.browY,
          anchors.browZ,
          isChasing ? 24 : isStalking ? 18 : 14,
          isChasing ? 0xff5500 : 0xf97316,
          (isChasing ? 0.28 : 0.18) * pulse,
          1
        );
        const eyeTint = isChasing ? 0xffedd5 : 0xfdba74;
        placePortal3d(anchors.leftEyeX, anchors.leftEyeY, anchors.leftEyeZ, 3.6, eyeTint, 0.92, 2);
        placePortal3d(anchors.rightEyeX, anchors.rightEyeY, anchors.rightEyeZ, 3.6, eyeTint, 0.92, 2);
        placePortal3d(
          anchors.chestX,
          anchors.chestY,
          anchors.chestZ,
          isChasing ? 14 : 10,
          isChasing ? 0xff5500 : 0xea580c,
          (isChasing ? 0.28 : 0.15) * pulse,
          1
        );
      } else {
        const cos = Math.cos(b.angle);
        const sin = Math.sin(b.angle);
        placePortal3d(
          b.x + 12 * cos,
          b.y + 12 * sin,
          38,
          isChasing ? 60 : 42,
          isChasing ? 0xff5500 : 0xf97316,
          isChasing ? 0.72 : 0.45,
          1
        );
        placePortal3d(
          b.x + 12.5 * cos - -3.5 * sin,
          b.y + 12.5 * sin + -3.5 * cos,
          38,
          5,
          isChasing ? 0xffedd5 : 0xfdba74,
          1,
          2
        );
        placePortal3d(
          b.x + 12.5 * cos - 3.5 * sin,
          b.y + 12.5 * sin + 3.5 * cos,
          38,
          5,
          isChasing ? 0xffedd5 : 0xfdba74,
          1,
          2
        );
      }
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
    this.vignetteBundle.uVignetteIntensity.value = this.graphicsSettings.vignetteIntensity;
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
      !this.readbackBlitBundle ||
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
      const results: ProbeReading[] = [];

      this.worldCamera.updateMatrixWorld();
      for (const pt of engine.debugProbePoints) {
        this.tmpVec3.set(pt.x, -pt.y, 0).project(this.worldCamera);
        const sx = (this.tmpVec3.x * 0.5 + 0.5) * w;
        const sy = (-this.tmpVec3.y * 0.5 + 0.5) * h;
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
    if (!this.initialized || !this.renderer || !this.probeTarget || !this.readbackBlitBundle) {
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

    this.structure3d?.dispose();
    this.structure3d = null;
    this.characters3d?.dispose();
    this.characters3d = null;
    this.objects3d?.dispose();
    this.objects3d = null;
    this.escapes3d?.dispose();
    this.escapes3d = null;

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
    this.poweredWarmWallFans?.dispose();
    this.staticWarmFans?.dispose();
    this.worldWarmFans?.dispose();
    this.poweredMaskWallFans?.dispose();
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
    this.bloomATarget?.dispose();
    this.bloomBTarget?.dispose();
    this.probeTarget?.dispose();
    this.portalTarget?.dispose();
    this.portalLosTarget?.dispose();
    this.deckWarmTarget?.dispose();
    this.deckMaskTarget?.dispose();
    this.emptyBlackTex.dispose();

    this.oceanBundle?.material.dispose();
    this.skyDomeMesh?.geometry.dispose();
    this.skyDomeMat?.dispose();
    this.skyLosMat?.dispose();
    this.skyMaskMat?.dispose();
    this.skyDomeTex?.dispose();
    this.compositeBundle?.material.dispose();
    this.vignetteBundle?.material.dispose();
    this.portalBundle?.material.dispose();
    this.bloomExtractBundle?.material.dispose();
    this.bloomBlurHBundle?.material.dispose();
    this.bloomBlurVBundle?.material.dispose();
    this.deckWarmMat?.dispose();
    this.deckMaskMat?.dispose();
    this.screenBlitBundle?.material.dispose();
    this.readbackBlitBundle?.material.dispose();

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
