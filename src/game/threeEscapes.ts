import * as THREE from 'three/webgpu';
import { MonstrumGameEngine } from './engine';
import { createShadedCharacterMaterial, ShadedCharacterMaterialBundle } from './threeTsl';
import { RaycastInteractTarget, ShipDeck, ShipMap } from './types';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Unable to create offscreen canvas for 3D escape textures');
  return [c, ctx];
}

function makeTexture(
  canvas: HTMLCanvasElement,
  repeat = false,
  anisotropy = 8
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function scaleGeometryUVs(geom: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geom.attributes.uv;
  if (uv) {
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
    uv.needsUpdate = true;
  }
  return geom;
}

function makeBox(w: number, d: number, h: number, centerZ = false): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, d, h);
  if (!centerZ) g.translate(0, 0, h * 0.5);
  return g;
}

// Cylinder strictly aligned along +Z (vertical up)
function makeCylZ(
  rt: number,
  rb: number,
  h: number,
  seg = 16,
  centerZ = false
): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.rotateX(Math.PI * 0.5);
  if (!centerZ) g.translate(0, 0, h * 0.5);
  return g;
}

// Cylinder strictly aligned along +X (rt at +X, rb at -X)
function makeCylX(rt: number, rb: number, len: number, seg = 16): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, len, seg);
  g.rotateZ(-Math.PI * 0.5);
  return g;
}

// Cylinder strictly aligned along +Y (rt at +Y, rb at -Y)
function makeCylY(rt: number, rb: number, len: number, seg = 16): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(rt, rb, len, seg);
}

// Extrudes a 2D (x, z) side silhouette horizontally along Y (-width/2 .. +width/2) with Z upward
function makeExtrudeXZ(
  shape: THREE.Shape,
  widthY: number,
  bevelSize = 1.2,
  bevelThickness = 1.2,
  bevelSegments = 2,
  uvScale = 1 / 48
): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.2, widthY - bevelThickness * 2),
    bevelEnabled: bevelSize > 0 && bevelThickness > 0,
    bevelSize,
    bevelThickness,
    bevelSegments,
    curveSegments: 14,
  });
  g.translate(0, 0, -Math.max(0.2, widthY - bevelThickness * 2) * 0.5);
  g.rotateX(Math.PI * 0.5);
  scaleGeometryUVs(g, uvScale, uvScale);
  g.computeVertexNormals();
  return g;
}

// Extrudes a 2D (x, y) planform footprint vertically upward (+Z)
function makeExtrudeXY(
  shape: THREE.Shape,
  heightZ: number,
  bevelSize = 1.0,
  bevelThickness = 1.0,
  bevelSegments = 2,
  centerZ = false,
  uvScale = 1 / 48
): THREE.ExtrudeGeometry {
  const coreDepth = Math.max(0.2, heightZ - bevelThickness * 2);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: coreDepth,
    bevelEnabled: bevelSize > 0 && bevelThickness > 0,
    bevelSize,
    bevelThickness,
    bevelSegments,
    curveSegments: 16,
  });
  if (centerZ) {
    g.translate(0, 0, -coreDepth * 0.5);
  } else {
    g.translate(0, 0, bevelThickness);
  }
  scaleGeometryUVs(g, uvScale, uvScale);
  g.computeVertexNormals();
  return g;
}

function mergeNonIndexedGeoms(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  let totalVerts = 0;
  for (const g of nonIndexed) {
    totalVerts += g.attributes.position.count;
  }
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  let offset = 0;
  for (const g of nonIndexed) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const idx3 = (offset + i) * 3;
      const idx2 = (offset + i) * 2;
      positions[idx3] = pos.getX(i);
      positions[idx3 + 1] = pos.getY(i);
      positions[idx3 + 2] = pos.getZ(i);
      if (norm) {
        normals[idx3] = norm.getX(i);
        normals[idx3 + 1] = norm.getY(i);
        normals[idx3 + 2] = norm.getZ(i);
      }
      if (uv) {
        uvs[idx2] = uv.getX(i);
        uvs[idx2 + 1] = uv.getY(i);
      }
    }
    offset += pos.count;
    if (g !== geoms[geoms.indexOf(g)]) g.dispose();
  }
  for (const g of geoms) g.dispose();
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return merged;
}

function makeForgedChainGeometry(
  linkCount: number,
  refLenPx: number,
  normalizeZ = true
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const half = refLenPx * 0.5;
  const step = linkCount > 1 ? (refLenPx - 3.6) / (linkCount - 1) : 0;
  for (let i = 0; i < linkCount; i++) {
    const link = new THREE.TorusGeometry(1.25, 0.52, 6, 12);
    // Elongate ring into an oval chain link along Z
    link.rotateY(Math.PI * 0.5);
    link.scale(1, 0.92, 1.85);
    if (i % 2 === 1) {
      link.rotateZ(Math.PI * 0.5);
    }
    const zPos = linkCount > 1 ? -half + 1.8 + i * step : 0;
    link.translate(0, 0, zPos);
    parts.push(link);
  }
  const merged = mergeNonIndexedGeoms(parts);
  if (normalizeZ) {
    merged.scale(1, 1, 1 / refLenPx);
  }
  merged.computeVertexNormals();
  return merged;
}

function makeChainCableMesh(geom: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geom, mat);
  m.frustumCulled = false;
  return m;
}

const AXIS_Z = new THREE.Vector3(0, 0, 1);
const _linkDir = new THREE.Vector3();

function orientAxisZ(
  mesh: THREE.Mesh,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.001) return;
  _linkDir.set(dx / len, dy / len, dz / len);
  mesh.quaternion.setFromUnitVectors(AXIS_Z, _linkDir);
}

function orientLinkMesh(
  mesh: THREE.Mesh,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.001) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.set((x1 + x2) * 0.5, (y1 + y2) * 0.5, (z1 + z2) * 0.5);
  mesh.scale.set(1, 1, len);
  _linkDir.set(dx / len, dy / len, dz / len);
  mesh.quaternion.setFromUnitVectors(AXIS_Z, _linkDir);
}

// --- Procedural Texture Generators ---

function createContactShadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(2, 6, 14, 0.72)');
  g.addColorStop(0.55, 'rgba(2, 6, 14, 0.42)');
  g.addColorStop(1, 'rgba(2, 6, 14, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return makeTexture(c, false, 4);
}

function createHelipadTexture(): THREE.CanvasTexture {
  const s = 512;
  const [c, ctx] = makeCanvas(s, s);
  const cx = s * 0.5;
  const cy = s * 0.5;

  // Non-skid weathered steel & dark marine coating
  ctx.fillStyle = '#1b2432';
  ctx.fillRect(0, 0, s, s);

  // Subtle plate seams & grit
  ctx.strokeStyle = 'rgba(10, 15, 24, 0.55)';
  ctx.lineWidth = 2;
  for (let i = 64; i < s; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(s, i);
    ctx.stroke();
  }

  // Random surface scuffing & skid wear
  let seed = 1337;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 420; i++) {
    const x = rng() * s;
    const y = rng() * s;
    ctx.fillStyle = rng() > 0.5 ? 'rgba(148, 163, 184, 0.04)' : 'rgba(5, 8, 14, 0.14)';
    ctx.fillRect(x, y, 4 + rng() * 14, 2 + rng() * 6);
  }

  // Outer deck perimeter hazard band
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 14;
  ctx.setLineDash([28, 14]);
  ctx.beginPath();
  ctx.arc(cx, cy, 232, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Solid outer safety rim
  ctx.strokeStyle = '#eab308';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, 212, 0, Math.PI * 2);
  ctx.stroke();

  // Inner aiming circle (muted maritime white)
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, 138, 0, Math.PI * 2);
  ctx.stroke();

  // Bold Helideck 'H'
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(cx - 58, cy - 66, 24, 132);
  ctx.fillRect(cx + 34, cy - 66, 24, 132);
  ctx.fillRect(cx - 34, cy - 12, 68, 24);

  // Subtle stenciled tonnage / deck code
  ctx.fillStyle = 'rgba(226, 232, 240, 0.72)';
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('6.5T', cx, cy + 178);
  ctx.fillText('AFT-03', cx, cy - 160);

  // Oil/soot wear ring under center
  const wear = ctx.createRadialGradient(cx, cy, 20, cx, cy, 150);
  wear.addColorStop(0, 'rgba(6, 9, 14, 0.42)');
  wear.addColorStop(1, 'rgba(6, 9, 14, 0)');
  ctx.fillStyle = wear;
  ctx.beginPath();
  ctx.arc(cx, cy, 150, 0, Math.PI * 2);
  ctx.fill();

  return makeTexture(c, false, 8);
}

function createWeatheredHullTexture(
  baseHex: string,
  accentHex: string,
  stripeColor: string,
  panelScale = 64
): THREE.CanvasTexture {
  const s = 256;
  const [c, ctx] = makeCanvas(s, s);
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, s, s);

  // Welded panel grid
  ctx.strokeStyle = 'rgba(5, 9, 16, 0.42)';
  ctx.lineWidth = 2;
  for (let i = 0; i < s; i += panelScale) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(s, i);
    ctx.stroke();
  }

  // Subtle accent trim stripe band
  ctx.fillStyle = stripeColor;
  ctx.fillRect(0, s * 0.46, s, 14);
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, s * 0.46 - 4, s, 3);

  // Rivets & salt streaks
  let seed = 9001;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 180; i++) {
    const x = rng() * s;
    const y = rng() * s;
    ctx.fillStyle = rng() > 0.6 ? 'rgba(203, 213, 225, 0.05)' : 'rgba(6, 10, 18, 0.14)';
    ctx.fillRect(x, y, 2 + rng() * 8, 4 + rng() * 18);
  }
  ctx.fillStyle = 'rgba(226, 232, 240, 0.25)';
  for (let y = 8; y < s; y += panelScale) {
    for (let x = 8; x < s; x += 16) {
      ctx.fillRect(x, y, 2, 2);
    }
  }
  return makeTexture(c, true, 8);
}

function createGrateAndHazardTexture(): THREE.CanvasTexture {
  const s = 256;
  const [c, ctx] = makeCanvas(s, s);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, s, s);

  // Industrial steel diamond/mesh grating
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.lineWidth = 3;
  for (let i = 0; i < s; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(s, i);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
  for (let y = 4; y < s; y += 16) {
    for (let x = 4; x < s; x += 16) {
      ctx.fillRect(x, y, 4, 2);
      ctx.fillRect(x + 6, y + 6, 4, 2);
    }
  }
  return makeTexture(c, true, 8);
}

function createHazardStripeTexture(): THREE.CanvasTexture {
  const s = 128;
  const [c, ctx] = makeCanvas(s, s);
  ctx.fillStyle = '#1e2430';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#d97706';
  for (let i = -s; i < s * 2; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 16, 0);
    ctx.lineTo(i - 16, s);
    ctx.lineTo(i - 32, s);
    ctx.closePath();
    ctx.fill();
  }
  return makeTexture(c, true, 8);
}

function createWinchCableTexture(): THREE.CanvasTexture {
  const s = 128;
  const [c, ctx] = makeCanvas(s, s);
  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 6) {
    ctx.fillStyle = '#64748b';
    ctx.fillRect(x, 0, 3, s);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x + 3, 0, 2, s);
  }
  return makeTexture(c, true, 8);
}

function createMoonpoolWaterTexture(): THREE.CanvasTexture {
  const s = 256;
  const [c, ctx] = makeCanvas(s, s);
  ctx.fillStyle = '#082735';
  ctx.fillRect(0, 0, s, s);

  let seed = 4040;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Soft deep ocean caustics & surface swell streaks
  for (let i = 0; i < 60; i++) {
    const x = rng() * s;
    const y = rng() * s;
    const rw = 24 + rng() * 44;
    const rh = 10 + rng() * 20;
    const g = ctx.createRadialGradient(x, y, 1, x, y, rw * 0.5);
    g.addColorStop(0, 'rgba(45, 212, 191, 0.22)');
    g.addColorStop(1, 'rgba(13, 148, 136, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rw * 0.5, rh * 0.5, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 40; i++) {
    const x = rng() * s;
    const y = rng() * s;
    ctx.strokeStyle = 'rgba(153, 246, 228, 0.14)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, 8 + rng() * 20, 0.2, 2.1);
    ctx.stroke();
  }
  return makeTexture(c, true, 8);
}

function createConsoleGaugeTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 120, 120);

  // Two analog pressure dials
  for (const cx of [38, 90]) {
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(cx, 44, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(cx, 44);
    ctx.lineTo(cx + 11, 33);
    ctx.stroke();
  }
  // Warning label plaque
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(16, 82, 96, 28);
  ctx.fillStyle = '#090d14';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('FLOODGATE', 64, 101);
  return makeTexture(c, false, 4);
}

function createWakeFoamTexture(): THREE.CanvasTexture {
  const s = 256;
  const [c, ctx] = makeCanvas(s, s);
  ctx.clearRect(0, 0, s, s);
  const cx = s * 0.5;
  const cy = s * 0.5;
  const g = ctx.createRadialGradient(cx, cy, 72, cx, cy, 124);
  g.addColorStop(0.0, 'rgba(153, 246, 228, 0.0)');
  g.addColorStop(0.32, 'rgba(94, 234, 212, 0.24)');
  g.addColorStop(0.62, 'rgba(204, 251, 241, 0.32)');
  g.addColorStop(0.84, 'rgba(94, 234, 212, 0.14)');
  g.addColorStop(1.0, 'rgba(45, 212, 191, 0.0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, 126, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(240, 253, 250, 0.28)';
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2 + (i % 3) * 0.1;
    ctx.beginPath();
    ctx.arc(cx, cy, 94 + (i % 4) * 5, a0, a0 + 0.26);
    ctx.stroke();
  }
  return makeTexture(c, false, 4);
}

interface HeliChainVisual {
  fx: number;
  fy: number;
  fz: number;
  bx: number;
  by: number;
  bz: number;
  bollardCap: THREE.Mesh;
  chainMesh: THREE.Mesh;
  turnbuckleMesh: THREE.Mesh;
  cutStub: THREE.Mesh;
  heliDangleStub: THREE.Mesh;
  hitMesh: THREE.Mesh;
}

export class ShipEscapes3D {
  private map: ShipMap;
  private worldScene: THREE.Scene;
  private disposed = false;

  private sharedGeoms: THREE.BufferGeometry[] = [];
  private sharedMats: ShadedCharacterMaterialBundle[] = [];
  private basicMats: THREE.Material[] = [];
  private sharedTexs: THREE.Texture[] = [];

  // Shared materials
  private matSteelDark: ShadedCharacterMaterialBundle;
  private matSteelMid: ShadedCharacterMaterialBundle;
  private matSteelLight: ShadedCharacterMaterialBundle;
  private matHeliHull: ShadedCharacterMaterialBundle;
  private matBoatHull: ShadedCharacterMaterialBundle;
  private matSubHull: ShadedCharacterMaterialBundle;
  private matGrate: ShadedCharacterMaterialBundle;
  private matHazard: ShadedCharacterMaterialBundle;
  private matWinchCable: ShadedCharacterMaterialBundle;
  private matGaugePanel: ShadedCharacterMaterialBundle;
  private matYellow: ShadedCharacterMaterialBundle;
  private matOrange: ShadedCharacterMaterialBundle;
  private matRed: ShadedCharacterMaterialBundle;
  private matWhite: ShadedCharacterMaterialBundle;
  private matRubber: ShadedCharacterMaterialBundle;
  private matBrass: ShadedCharacterMaterialBundle;
  private matTeal: ShadedCharacterMaterialBundle;
  private matEmerald: ShadedCharacterMaterialBundle;
  private matCyanGlow: ShadedCharacterMaterialBundle;
  private matCanopy: ShadedCharacterMaterialBundle;
  private matCavity: ShadedCharacterMaterialBundle;
  private matChainLink: ShadedCharacterMaterialBundle;
  private matShadow: THREE.MeshBasicMaterial;
  private hitProxyMat: THREE.MeshBasicMaterial;

  // --- DECK 3: HELIDECK ---
  private heliRoot = new THREE.Group();
  private heliPadRingMat: ShadedCharacterMaterialBundle;
  private heliStrobeMats: ShadedCharacterMaterialBundle[] = [];
  private heliBodyGroup = new THREE.Group();
  private heliFuelEmptyGroup = new THREE.Group();
  private heliFuelFilledGroup = new THREE.Group();
  private heliFuseEmptyGroup = new THREE.Group();
  private heliFuseFilledGroup = new THREE.Group();
  private heliFuseSparkMesh!: THREE.Mesh;
  private heliAvionicsMesh!: THREE.Mesh;
  private heliNavPortMat: ShadedCharacterMaterialBundle;
  private heliNavStbdMat: ShadedCharacterMaterialBundle;
  private heliRotorHub = new THREE.Group();
  private heliTailRotor = new THREE.Group();
  private heliRotorBlurMat: THREE.MeshBasicMaterial;
  private heliRotorBlurDisc!: THREE.Mesh;
  private heliChains: HeliChainVisual[] = [];
  private heliHitMesh!: THREE.Mesh;
  private heliOccluderMeshes: THREE.Mesh[] = [];

  // --- DECK 2: LIFEBOAT DAVIT ---
  private boatRoot = new THREE.Group();
  private boatOutSign = 1;
  private boatStatusLedMat: ShadedCharacterMaterialBundle;
  private boatBoomLeft = new THREE.Group();
  private boatBoomRight = new THREE.Group();
  private boatTipSheaveL!: THREE.Mesh;
  private boatTipSheaveR!: THREE.Mesh;
  private boatRamCylL!: THREE.Mesh;
  private boatRamCylR!: THREE.Mesh;
  private boatRamRodL!: THREE.Mesh;
  private boatRamRodR!: THREE.Mesh;
  private boatRamAnchorL!: THREE.Vector3;
  private boatRamAnchorR!: THREE.Vector3;
  private boatBoomRamPinL!: THREE.Object3D;
  private boatBoomRamPinR!: THREE.Object3D;
  private boatCrankGroup = new THREE.Group();
  private boatBatteryFilledGroup = new THREE.Group();
  private boatBatteryEmptyMesh!: THREE.Mesh;
  private boatHullGroup = new THREE.Group();
  private boatCrackMesh!: THREE.Mesh;
  private boatPatchGroup = new THREE.Group();
  private boatBeaconMat: ShadedCharacterMaterialBundle;
  private boatCableL!: THREE.Mesh;
  private boatCableR!: THREE.Mesh;
  private boatHitMesh!: THREE.Mesh;
  private boatHullHitMesh!: THREE.Mesh;
  private boatOccluderMeshes: THREE.Mesh[] = [];

  // --- DECK 1: SUBMARINE MOONPOOL ---
  private subRoot = new THREE.Group();
  private subLeverRoot = new THREE.Group();
  private subPoolStatusMat: ShadedCharacterMaterialBundle;
  private subWaterTex: THREE.CanvasTexture;
  private subWaterMat: THREE.MeshBasicMaterial;
  private subWaterMesh!: THREE.Mesh;
  private subWakeRingMat: THREE.MeshBasicMaterial;
  private subWakeRing!: THREE.Mesh;
  private subHullGroup = new THREE.Group();
  private subPropellerGroup = new THREE.Group();
  private subBatteryEmpty!: THREE.Mesh;
  private subBatteryFilled = new THREE.Group();
  private subBallastEmpty!: THREE.Mesh;
  private subBallastFilled = new THREE.Group();
  private subImpeller!: THREE.Mesh;
  private subDiveKeyMat: ShadedCharacterMaterialBundle;
  private subBowLightMat: ShadedCharacterMaterialBundle;
  private subLeverArmGroup = new THREE.Group();
  private subLeverHandleMat: ShadedCharacterMaterialBundle;
  private subLeverLampMat: ShadedCharacterMaterialBundle;
  private subDockHitMesh!: THREE.Mesh;
  private subHullHitMesh!: THREE.Mesh;
  private subLeverHitMesh!: THREE.Mesh;
  private subDockOccluderMeshes: THREE.Mesh[] = [];
  private subLeverOccluderMeshes: THREE.Mesh[] = [];

  // Scratch arrays & vectors to avoid per-frame allocations
  private raycastHitMeshes: THREE.Object3D[] = [];
  private raycastOccluderMeshes: THREE.Object3D[] = [];
  private tmpV1 = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();

  constructor(map: ShipMap, worldScene: THREE.Scene) {
    this.map = map;
    this.worldScene = worldScene;

    const regTex = <T extends THREE.Texture>(t: T): T => {
      this.sharedTexs.push(t);
      return t;
    };
    const regMat = (opts: Parameters<typeof createShadedCharacterMaterial>[0]) => {
      const b = createShadedCharacterMaterial(opts);
      this.sharedMats.push(b);
      return b;
    };

    const texShadow = regTex(createContactShadowTexture());
    const texHeliHull = regTex(createWeatheredHullTexture('#384659', '#d97706', '#eab308', 64));
    const texBoatHull = regTex(createWeatheredHullTexture('#ea580c', '#ffffff', '#f8fafc', 64));
    const texSubHull = regTex(createWeatheredHullTexture('#2b3646', '#94a3b8', '#f59e0b', 64));
    const texGrate = regTex(createGrateAndHazardTexture());
    const texHazard = regTex(createHazardStripeTexture());
    const texWinch = regTex(createWinchCableTexture());
    const texGauge = regTex(createConsoleGaugeTexture());
    this.subWaterTex = regTex(createMoonpoolWaterTexture());

    this.matShadow = new THREE.MeshBasicMaterial({
      map: texShadow,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.hitProxyMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.basicMats.push(this.matShadow, this.hitProxyMat);

    this.matSteelDark = regMat({ color: 0x1b2432, roughness: 0.68, metalness: 0.52 });
    this.matSteelMid = regMat({ color: 0x475569, roughness: 0.52, metalness: 0.64 });
    this.matSteelLight = regMat({ color: 0x94a3b8, roughness: 0.28, metalness: 0.84 });
    this.matHeliHull = regMat({ color: 0xffffff, map: texHeliHull, roughness: 0.44, metalness: 0.48 });
    this.matBoatHull = regMat({ color: 0xffffff, map: texBoatHull, roughness: 0.36, metalness: 0.16 });
    this.matSubHull = regMat({ color: 0xffffff, map: texSubHull, roughness: 0.46, metalness: 0.58 });
    this.matGrate = regMat({ color: 0xffffff, map: texGrate, roughness: 0.65, metalness: 0.55 });
    this.matHazard = regMat({ color: 0xffffff, map: texHazard, roughness: 0.55, metalness: 0.3 });
    this.matWinchCable = regMat({ color: 0xffffff, map: texWinch, roughness: 0.42, metalness: 0.75 });
    this.matGaugePanel = regMat({ color: 0xffffff, map: texGauge, roughness: 0.4, metalness: 0.3 });

    this.matYellow = regMat({ color: 0xf59e0b, roughness: 0.38, metalness: 0.25 });
    this.matOrange = regMat({ color: 0xea580c, roughness: 0.42, metalness: 0.18 });
    this.matRed = regMat({ color: 0xb91c1c, roughness: 0.45, metalness: 0.22 });
    this.matWhite = regMat({ color: 0xe2e8f0, roughness: 0.48, metalness: 0.12 });
    this.matRubber = regMat({ color: 0x11161f, roughness: 0.9, metalness: 0.05 });
    this.matBrass = regMat({ color: 0xd97706, roughness: 0.26, metalness: 0.88 });
    this.matTeal = regMat({ color: 0x0f766e, roughness: 0.42, metalness: 0.35 });
    this.matEmerald = regMat({
      color: 0x34d399,
      roughness: 0.25,
      metalness: 0.2,
      emissiveColor: 0x10b981,
      emissiveStrength: 0.75,
    });
    this.matCyanGlow = regMat({
      color: 0x38bdf8,
      roughness: 0.22,
      metalness: 0.25,
      emissiveColor: 0x0284c7,
      emissiveStrength: 0.85,
    });
    this.matCanopy = regMat({
      color: 0x0c4a6e,
      roughness: 0.12,
      metalness: 0.38,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    this.matCavity = regMat({ color: 0x070a10, roughness: 0.94, metalness: 0.08 });
    this.matChainLink = regMat({
      color: 0x94a3b8,
      roughness: 0.34,
      metalness: 0.86,
    });

    this.heliPadRingMat = regMat({
      color: 0xfbbf24,
      roughness: 0.42,
      metalness: 0.32,
      emissiveColor: 0xf59e0b,
      emissiveStrength: 0.08,
    });
    this.heliNavPortMat = regMat({
      color: 0xef4444,
      roughness: 0.2,
      metalness: 0.1,
      emissiveColor: 0xef4444,
      emissiveStrength: 0,
    });
    this.heliNavStbdMat = regMat({
      color: 0x22c55e,
      roughness: 0.2,
      metalness: 0.1,
      emissiveColor: 0x22c55e,
      emissiveStrength: 0,
    });
    this.heliRotorBlurMat = new THREE.MeshBasicMaterial({
      color: 0xcbd5e1,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.basicMats.push(this.heliRotorBlurMat);

    this.boatStatusLedMat = regMat({
      color: 0x38bdf8,
      roughness: 0.25,
      metalness: 0.2,
      emissiveColor: 0x0284c7,
      emissiveStrength: 0.45,
    });
    this.boatBeaconMat = regMat({
      color: 0x38bdf8,
      roughness: 0.2,
      metalness: 0.2,
      emissiveColor: 0x0284c7,
      emissiveStrength: 0.65,
    });

    this.subPoolStatusMat = regMat({
      color: 0x14b8a6,
      roughness: 0.28,
      metalness: 0.3,
      emissiveColor: 0x0d9488,
      emissiveStrength: 0.35,
    });
    this.subWaterMat = new THREE.MeshBasicMaterial({
      map: this.subWaterTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.basicMats.push(this.subWaterMat);

    const texWakeFoam = regTex(createWakeFoamTexture());
    this.subWakeRingMat = new THREE.MeshBasicMaterial({
      map: texWakeFoam,
      color: 0xffffff,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.basicMats.push(this.subWakeRingMat);

    this.subDiveKeyMat = regMat({
      color: 0x334155,
      roughness: 0.25,
      metalness: 0.3,
      emissiveColor: 0x000000,
      emissiveStrength: 0,
    });
    this.subBowLightMat = regMat({
      color: 0x0e7490,
      roughness: 0.15,
      metalness: 0.2,
      emissiveColor: 0x22d3ee,
      emissiveStrength: 0.3,
    });
    this.subLeverHandleMat = regMat({
      color: 0xef4444,
      roughness: 0.32,
      metalness: 0.25,
      emissiveColor: 0xef4444,
      emissiveStrength: 0.42,
    });
    this.subLeverLampMat = regMat({
      color: 0xef4444,
      roughness: 0.2,
      metalness: 0.1,
      emissiveColor: 0xef4444,
      emissiveStrength: 0.6,
    });

    this.buildHelicopter();
    this.buildLifeboat();
    this.buildSubmarine();
  }

  private g<T extends THREE.BufferGeometry>(geom: T): T {
    this.sharedGeoms.push(geom);
    return geom;
  }

  private setRenderOrderRecursive(obj: THREE.Object3D, order: number): void {
    obj.traverse((child) => {
      child.renderOrder = order;
      child.frustumCulled = false;
    });
  }

  // =========================================================================
  // 1. DECK 3 UTILITY HELICOPTER + HELIDECK + 6 MOORING BOLLARDS
  // =========================================================================
  private buildHelicopter(): void {
    const { x: lx, y: ly } = this.map.heliPos;
    this.heliRoot.position.set(lx, -ly, 0);

    const texPad = createHelipadTexture();
    this.sharedTexs.push(texPad);
    const matPadDeck = createShadedCharacterMaterial({
      color: 0xffffff,
      map: texPad,
      roughness: 0.72,
      metalness: 0.28,
    });
    this.sharedMats.push(matPadDeck);

    // Helipad Landing Platform centered +14 X from heliPos
    const padCenter = new THREE.Group();
    padCenter.position.set(14, 0, 0);

    const padBevelRim = new THREE.Mesh(
      this.g(makeCylZ(76, 78, 1.2, 40)),
      this.matSteelDark.material
    );
    const padDeck = new THREE.Mesh(
      this.g(makeCylZ(74, 74, 1.5, 40)),
      matPadDeck.material
    );
    const padStatusRing = new THREE.Mesh(
      this.g(new THREE.RingGeometry(68.5, 70.5, 48)),
      this.heliPadRingMat.material
    );
    padStatusRing.position.z = 1.6;
    const heliContactShadow = new THREE.Mesh(
      this.g(new THREE.CircleGeometry(54, 32)),
      this.matShadow
    );
    heliContactShadow.position.set(-4, 0, 1.7);
    padCenter.add(padBevelRim, padDeck, padStatusRing, heliContactShadow);

    // 4 Perimeter Flush Strobe / Floodlight Housings
    for (const [sx, sy] of [
      [-55, -50],
      [55, -50],
      [-55, 50],
      [55, 50],
    ]) {
      const ped = new THREE.Mesh(this.g(makeBox(10, 10, 2.2)), this.matSteelDark.material);
      ped.position.set(sx, -sy, 0.8);
      const bezel = new THREE.Mesh(this.g(makeCylZ(3.6, 4.2, 2.4, 12)), this.matSteelMid.material);
      bezel.position.set(sx, -sy, 2.2);
      const sMat = createShadedCharacterMaterial({
        color: 0x334155,
        roughness: 0.22,
        metalness: 0.2,
        emissiveColor: 0xf59e0b,
        emissiveStrength: 0,
      });
      this.sharedMats.push(sMat);
      this.heliStrobeMats.push(sMat);
      const lens = new THREE.Mesh(this.g(makeCylZ(2.2, 2.5, 1.8, 12)), sMat.material);
      lens.position.set(sx, -sy, 3.4);
      padCenter.add(ped, bezel, lens);
    }
    this.heliRoot.add(padCenter);

    // --- Helicopter Body Group (96px fuselage + 50px tail = 146px total scale) ---
    // Tubular Steel Landing Skids (strictly along X via makeCylX!)
    for (const side of [-1, 1]) {
      const skidY = side * 19;
      const skidMain = new THREE.Mesh(
        this.g(makeCylX(1.75, 1.75, 62, 12)),
        this.matSteelLight.material
      );
      skidMain.position.set(8, skidY, 3.2);

      // Upturned front ski tip
      const skiTip = new THREE.Mesh(
        this.g(makeCylX(1.3, 1.75, 11, 10)),
        this.matRubber.material
      );
      skiTip.position.set(42.5, skidY, 5.4);
      skiTip.rotation.y = -0.45;

      // Rubber wear shoes on underside
      for (const sx of [-16, 10, 32]) {
        const shoe = new THREE.Mesh(this.g(makeBox(6, 3.8, 1.4)), this.matRubber.material);
        shoe.position.set(sx, skidY, 1.4);
        this.heliBodyGroup.add(shoe);
      }

      // Angled cross-struts connecting skids cleanly INWARD into belly sponsons
      for (const sx of [-10, 22]) {
        const strut = new THREE.Mesh(
          this.g(makeCylZ(1.35, 1.35, 13.5, 10)),
          this.matSteelMid.material
        );
        strut.position.set(sx, side * 19, 3.2);
        strut.rotation.x = -side * 0.48;
        this.heliBodyGroup.add(strut);
      }
      // Boarding stirrup step
      const step = new THREE.Mesh(this.g(makeBox(8, 3.5, 1.2)), this.matSteelLight.material);
      step.position.set(10, side * 20.5, 6.5);

      this.heliBodyGroup.add(skidMain, skiTip, step);
    }

    // Sculpted Fuselage Profile (notched cockpit bay so seats & MFD glow through tinted canopy!)
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-24, 12); // Lower tail cone root
    hullShape.lineTo(28, 9.5); // Belly keel
    hullShape.quadraticCurveTo(44, 10, 49, 17); // Rounded chin nose
    hullShape.lineTo(46, 20.5); // Forward cockpit sill
    hullShape.lineTo(27.5, 20.5); // Cockpit floor deck
    hullShape.lineTo(26, 35.5); // Cockpit bulkhead frame
    hullShape.lineTo(14, 36.5); // Upper cockpit brow
    hullShape.lineTo(-18, 35); // Aft cabin roof
    hullShape.lineTo(-28, 28); // Clamshell aft fairing
    hullShape.lineTo(-24, 12);

    const fuselage = new THREE.Mesh(
      this.g(makeExtrudeXZ(hullShape, 28, 3.2, 3.2, 3, 1 / 52)),
      this.matHeliHull.material
    );
    this.heliBodyGroup.add(fuselage);

    // Lower belly armor & cargo floor sill
    const bellySkidPlate = new THREE.Mesh(
      this.g(makeBox(52, 20, 2.4)),
      this.matSteelDark.material
    );
    bellySkidPlate.position.set(4, 0, 7.8);

    // Side sponsons / landing gear fairings
    for (const side of [-1, 1]) {
      const sponson = new THREE.Mesh(
        this.g(makeBox(30, 5.2, 7.5)),
        this.matSteelDark.material
      );
      sponson.position.set(4, side * 14.5, 10);

      // Recessed cargo cabin sliding door + tinted window
      const doorFrame = new THREE.Mesh(
        this.g(makeBox(22, 1.4, 16.5)),
        this.matSteelMid.material
      );
      doorFrame.position.set(3, side * 14.2, 15);
      const cabinWin = new THREE.Mesh(
        this.g(makeBox(15, 1.8, 6.5)),
        this.matCanopy.material
      );
      cabinWin.position.set(4, side * 14.5, 22.5);
      this.heliBodyGroup.add(sponson, doorFrame, cabinWin);
    }

    // Raised Twin-Turboshaft Engine Doghouse + Forward Intakes + Rear X-Aligned Exhausts
    const doghouseShape = new THREE.Shape();
    doghouseShape.moveTo(-22, 34);
    doghouseShape.lineTo(18, 34);
    doghouseShape.lineTo(14, 42);
    doghouseShape.lineTo(-17, 42);
    doghouseShape.lineTo(-22, 34);
    const doghouse = new THREE.Mesh(
      this.g(makeExtrudeXZ(doghouseShape, 17, 1.4, 1.4, 2, 1 / 40)),
      this.matSteelDark.material
    );
    this.heliBodyGroup.add(doghouse);

    for (const side of [-1, 1]) {
      // Forward turbine intake scoop
      const scoop = new THREE.Mesh(
        this.g(makeCylX(3.2, 3.6, 7, 12)),
        this.matSteelMid.material
      );
      scoop.position.set(16.5, side * 5.2, 37.5);
      const scoopVoid = new THREE.Mesh(
        this.g(makeCylX(2.4, 2.4, 1.2, 10)),
        this.matCavity.material
      );
      scoopVoid.position.set(19.6, side * 5.2, 37.5);

      // Rear turbine exhaust nozzle (strictly along X!)
      const exhaust = new THREE.Mesh(
        this.g(makeCylX(2.8, 3.4, 11, 12)),
        this.matSteelLight.material
      );
      exhaust.position.set(-21, side * 5.2, 37.5);
      exhaust.rotation.z = side * 0.16;
      const exhVoid = new THREE.Mesh(
        this.g(makeCylX(2.1, 2.1, 1.4, 10)),
        this.matCavity.material
      );
      exhVoid.position.set(-26, side * 6.0, 37.5);
      exhVoid.rotation.z = side * 0.16;

      this.heliBodyGroup.add(scoop, scoopVoid, exhaust, exhVoid);
    }

    // Swept Cockpit Bubble Windshield + Interior Seats + Avionics MFD
    const canopyShape = new THREE.Shape();
    canopyShape.moveTo(29, 20);
    canopyShape.lineTo(47.5, 20);
    canopyShape.lineTo(46, 23);
    canopyShape.lineTo(31, 34.5);
    canopyShape.lineTo(27, 34.5);
    canopyShape.lineTo(29, 20);
    const cockpitCanopy = new THREE.Mesh(
      this.g(makeExtrudeXZ(canopyShape, 23.5, 1.2, 1.2, 2, 1 / 32)),
      this.matCanopy.material
    );
    // Pilot & co-pilot seats inside cockpit
    for (const side of [-1, 1]) {
      const seat = new THREE.Mesh(this.g(makeBox(5.5, 5.5, 8.5)), this.matRubber.material);
      seat.position.set(32, side * 5.5, 20.5);
      this.heliBodyGroup.add(seat);
    }
    // Avionics MFD Panel (illuminates on IGNITION_KEY)
    const dashConsole = new THREE.Mesh(this.g(makeBox(6, 14, 5)), this.matSteelDark.material);
    dashConsole.position.set(39, 0, 21);
    this.heliAvionicsMesh = new THREE.Mesh(this.g(makeBox(4, 11, 3.5)), this.matCyanGlow.material);
    this.heliAvionicsMesh.position.set(39.2, 0, 24.5);
    this.heliAvionicsMesh.visible = false;

    // Nose chin landing spotlight & pitot probe
    const noseLamp = new THREE.Mesh(this.g(makeCylX(2.2, 2.2, 2.5, 10)), this.matSteelLight.material);
    noseLamp.position.set(49, 0, 14);
    const noseLens = new THREE.Mesh(this.g(makeCylX(1.6, 1.6, 1.0, 10)), this.matYellow.material);
    noseLens.position.set(50.2, 0, 14);

    // Nav lights on forward sponson tips
    const navPort = new THREE.Mesh(this.g(makeBox(3.5, 3, 2.5)), this.heliNavPortMat.material);
    navPort.position.set(16, 17.5, 14);
    const navStbd = new THREE.Mesh(this.g(makeBox(3.5, 3, 2.5)), this.heliNavStbdMat.material);
    navStbd.position.set(16, -17.5, 14);

    // --- Tapered Horizontal Tail Boom (strictly along X via makeCylX!) ---
    const tailBoom = new THREE.Mesh(
      this.g(makeCylX(2.8, 5.8, 54, 14)),
      this.matHeliHull.material
    );
    tailBoom.position.set(-48, 0, 28);
    // High-vis orange rescue tail band
    const tailBand = new THREE.Mesh(
      this.g(makeCylX(3.3, 3.8, 9, 14)),
      this.matOrange.material
    );
    tailBand.position.set(-64, 0, 28);

    // Horizontal Stabilizer Airfoils + Endplate Winglets
    const hStabShape = new THREE.Shape();
    hStabShape.moveTo(-4, -15);
    hStabShape.lineTo(4, -12);
    hStabShape.lineTo(4, 12);
    hStabShape.lineTo(-4, 15);
    hStabShape.lineTo(-4, -15);
    const hStab = new THREE.Mesh(
      this.g(makeExtrudeXY(hStabShape, 1.8, 0.4, 0.4, 1, true)),
      this.matSteelMid.material
    );
    hStab.position.set(-60, 0, 28);
    for (const side of [-1, 1]) {
      const endPlate = new THREE.Mesh(this.g(makeBox(8, 1.4, 6.5)), this.matYellow.material);
      endPlate.position.set(-60, side * 14.5, 25);
      this.heliBodyGroup.add(endPlate);
    }

    // Swept Vertical Tail Fin (XZ profile extruded across Y = 2.8px)
    const finShape = new THREE.Shape();
    finShape.moveTo(-66, 26);
    finShape.lineTo(-77, 46);
    finShape.lineTo(-82, 46);
    finShape.lineTo(-75, 26);
    finShape.lineTo(-66, 26);
    const tailFin = new THREE.Mesh(
      this.g(makeExtrudeXZ(finShape, 3.2, 0.6, 0.6, 1, 1 / 32)),
      this.matSteelMid.material
    );
    const tailTipCap = new THREE.Mesh(this.g(makeBox(7, 2.8, 3)), this.matOrange.material);
    tailTipCap.position.set(-79.5, 0, 45);
    const tailBeacon = new THREE.Mesh(this.g(makeCylZ(1.4, 1.4, 2.2, 8)), this.matRed.material);
    tailBeacon.position.set(-79.5, 0, 48);

    // Tail Rotor Gearbox + Spinner Cap + 4-Blade Tail Rotor (spinning around Y!)
    this.heliTailRotor.position.set(-75.5, -3.4, 41);
    const trGearbox = new THREE.Mesh(this.g(makeCylY(2.2, 2.8, 3.5, 10)), this.matSteelLight.material);
    const trSpinner = new THREE.Mesh(this.g(makeCylY(1.2, 2.0, 2.4, 10)), this.matSteelDark.material);
    trSpinner.position.set(0, -2.0, 0);
    this.heliTailRotor.add(trGearbox, trSpinner);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(this.g(makeBox(1.8, 0.7, 9)), this.matYellow.material);
      const bladeWrap = new THREE.Group();
      bladeWrap.rotation.y = (i * Math.PI) / 2;
      b.position.set(0, -1.6, 4.8);
      bladeWrap.add(b);
      this.heliTailRotor.add(bladeWrap);
    }

    // --- Fuel Transfer Port + Grounded Aviation Fuel Pump Cart (AVIATION_FUEL) ---
    this.heliFuelEmptyGroup.position.set(-2, 16.5, 14);
    const fuelSocketRing = new THREE.Mesh(this.g(makeCylY(3.4, 3.4, 1.8, 12)), this.matSteelLight.material);
    const fuelRecess = new THREE.Mesh(this.g(makeCylY(2.3, 2.3, 2.1, 10)), this.matCavity.material);
    this.heliFuelEmptyGroup.add(fuelSocketRing, fuelRecess);

    this.heliFuelFilledGroup.position.set(0, 0, 0);
    // Compact red wheeled fuel cart resting cleanly on the helipad beside port sponson
    const cartBase = new THREE.Mesh(this.g(makeBox(16, 11, 2.5)), this.matSteelDark.material);
    cartBase.position.set(-6, 31, 2.4);
    const fuelDrum = new THREE.Mesh(this.g(makeCylZ(4.8, 4.8, 12, 14)), this.matRed.material);
    fuelDrum.position.set(-7, 31, 4.5);
    const pumpHead = new THREE.Mesh(this.g(makeBox(5, 5, 4.5)), this.matSteelLight.material);
    pumpHead.position.set(-1, 31, 4.5);
    const fuelLed = new THREE.Mesh(this.g(makeBox(2.2, 2.2, 1.6)), this.matEmerald.material);
    fuelLed.position.set(-1, 31, 9.2);
    // Curved flexible braided TubeGeometry fuel hose from cart to fuselage port!
    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1, 29, 7.2),
      new THREE.Vector3(-1, 23, 3.5),
      new THREE.Vector3(-2, 19, 8.5),
      new THREE.Vector3(-2, 16.8, 14),
    ]);
    const fuelHose = new THREE.Mesh(
      this.g(new THREE.TubeGeometry(hoseCurve, 16, 1.15, 8, false)),
      this.matRubber.material
    );
    this.heliFuelFilledGroup.add(cartBase, fuelDrum, pumpHead, fuelLed, fuelHose);
    this.heliFuelFilledGroup.visible = false;

    // --- Rotor Fuse Avionics Bay (starboard flank -Y) ---
    this.heliFuseEmptyGroup.position.set(-4, -14.8, 19);
    const fuseBayFrame = new THREE.Mesh(this.g(makeBox(13, 2.0, 7.5, true)), this.matSteelDark.material);
    const fuseBayRecess = new THREE.Mesh(this.g(makeBox(10.5, 2.2, 5.4, true)), this.matCavity.material);
    fuseBayRecess.position.set(0, -0.3, 0);
    const copperRail = new THREE.Mesh(this.g(makeBox(8, 1.2, 1.4, true)), this.matBrass.material);
    copperRail.position.set(0, -0.8, 0);
    this.heliFuseSparkMesh = new THREE.Mesh(this.g(makeBox(2.8, 1.4, 2.8, true)), this.matYellow.material);
    this.heliFuseSparkMesh.position.set(0, -1.2, 0);
    this.heliFuseEmptyGroup.add(fuseBayFrame, fuseBayRecess, copperRail, this.heliFuseSparkMesh);

    this.heliFuseFilledGroup.position.set(-4, -15.2, 19);
    const fuseModule = new THREE.Mesh(this.g(makeBox(12, 2.8, 6.5, true)), this.matSteelMid.material);
    const fuseHandle = new THREE.Mesh(this.g(makeBox(6, 1.8, 1.4, true)), this.matSteelLight.material);
    fuseHandle.position.set(0, -1.5, 0);
    const fuseLed = new THREE.Mesh(this.g(makeBox(2.4, 1.2, 2.0, true)), this.matEmerald.material);
    fuseLed.position.set(3.5, -1.5, 1.5);
    this.heliFuseFilledGroup.add(fuseModule, fuseHandle, fuseLed);
    this.heliFuseFilledGroup.visible = false;

    // --- Main Rotor Mast, Swashplate & 4 Tapered Cambered Blades (z = 44) ---
    this.heliRotorHub.position.set(2, 0, 42);
    const mastShaft = new THREE.Mesh(this.g(makeCylZ(3.2, 4.0, 5.5, 14)), this.matSteelLight.material);
    const swashplate = new THREE.Mesh(this.g(makeCylZ(6.2, 6.2, 1.6, 16)), this.matSteelMid.material);
    swashplate.position.z = 2.4;
    const hubCap = new THREE.Mesh(this.g(makeCylZ(4.2, 5.8, 3.2, 16)), this.matSteelDark.material);
    hubCap.position.z = 4.6;
    this.heliRotorHub.add(mastShaft, swashplate, hubCap);

    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(6, -1.6);
    bladeShape.lineTo(54, -2.4);
    bladeShape.lineTo(56, 2.2);
    bladeShape.lineTo(6, 1.4);
    bladeShape.lineTo(6, -1.6);
    const bladeGeom = this.g(makeExtrudeXY(bladeShape, 0.9, 0.2, 0.2, 1, true));

    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      const grip = new THREE.Mesh(this.g(makeBox(7, 3.4, 2.2)), this.matSteelMid.material);
      grip.position.set(6, 0, 3.6);
      const blade = new THREE.Mesh(bladeGeom, this.matSteelDark.material);
      blade.position.set(0, 0, 4.7);
      const tip = new THREE.Mesh(this.g(makeBox(7.5, 4.4, 1.0)), this.matYellow.material);
      tip.position.set(57.5, 0, 4.2);
      arm.add(grip, blade, tip);
      this.heliRotorHub.add(arm);
    }

    this.heliRotorBlurDisc = new THREE.Mesh(
      this.g(new THREE.RingGeometry(12, 62, 48)),
      this.heliRotorBlurMat
    );
    this.heliRotorBlurDisc.position.set(2, 0, 46.8);
    this.heliRotorBlurDisc.visible = false;

    this.heliBodyGroup.add(
      bellySkidPlate,
      cockpitCanopy,
      dashConsole,
      this.heliAvionicsMesh,
      noseLamp,
      noseLens,
      navPort,
      navStbd,
      tailBoom,
      tailBand,
      hStab,
      tailFin,
      tailTipCap,
      tailBeacon,
      this.heliFuelEmptyGroup,
      this.heliFuelFilledGroup,
      this.heliFuseEmptyGroup,
      this.heliFuseFilledGroup,
      this.heliRotorHub,
      this.heliRotorBlurDisc,
      this.heliTailRotor
    );

    this.heliBodyGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj !== this.heliRotorBlurDisc) {
        obj.userData.occluderOwnerKey = 'ESCAPE_HELI:HULL';
        this.heliOccluderMeshes.push(obj);
      }
    });

    this.heliHitMesh = new THREE.Mesh(
      this.g(makeBox(108, 44, 42)),
      this.hitProxyMat
    );
    this.heliHitMesh.position.set(2, 0, 2);
    this.heliHitMesh.userData = {
      pickKind: 'ESCAPE_HELI',
      targetId: 'HELI',
      subTarget: 'HULL',
      ownerKey: 'ESCAPE_HELI:HULL',
    };
    this.heliBodyGroup.add(this.heliHitMesh);
    this.heliRoot.add(this.heliBodyGroup);

    // --- 6 Cast-Iron Deck Bollards + Forged Helicopter Fuselage Padeyes + Interlocking Tie-Down Chains ---
    const bollardProfile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(4.6, 0),
      new THREE.Vector2(4.4, 1.2),
      new THREE.Vector2(2.6, 2.0),
      new THREE.Vector2(2.2, 6.2),
      new THREE.Vector2(3.4, 7.2),
      new THREE.Vector2(3.4, 8.2),
      new THREE.Vector2(0, 8.2),
    ];
    const bollardGeom = this.g(new THREE.LatheGeometry(bollardProfile, 14));
    bollardGeom.rotateX(Math.PI * 0.5);
    const bollardCollarGeom = this.g(new THREE.TorusGeometry(2.9, 0.85, 8, 16));

    const chainSpecs: Array<{
      fx: number;
      fy: number;
      fz: number;
      bx: number;
      by: number;
      outrigger: boolean;
    }> = [
      // Right (forward) -> Right-biased
      { fx: 28, fy: -15.8, fz: 12.0, bx: 48, by: -40, outrigger: true },
      { fx: 28, fy: 15.8, fz: 12.0, bx: 48, by: 40, outrigger: true },
      // Middle -> No directional bias (straight perpendicular)
      { fx: 8, fy: -17.6, fz: 12.6, bx: 8, by: -56, outrigger: false },
      { fx: 8, fy: 17.6, fz: 12.6, bx: 8, by: 56, outrigger: false },
      // Left (aft) -> Left-biased
      { fx: -16, fy: -15.8, fz: 12.0, bx: -34, by: -42, outrigger: true },
      { fx: -16, fy: 15.8, fz: 12.0, bx: -34, by: 42, outrigger: true },
    ];
    const chainGeom = this.g(makeForgedChainGeometry(11, 38, true));
    const stubGeom = this.g(makeForgedChainGeometry(3, 9.5, false));
    const turnbuckleGeom = this.g(makeCylZ(1.85, 1.85, 1.0, 10, true));
    const lugRingGeom = this.g(new THREE.TorusGeometry(2.1, 0.65, 8, 14));

    for (const cs of chainSpecs) {
      const sideSign = cs.fy < 0 ? 1 : -1; // Three.js Y sign (+Y when cs.fy < 0)
      const fX = cs.fx;
      const fY = -cs.fy;
      const bX = cs.bx;
      const bY = -cs.by;

      // Bolted fuselage/sponson padeye bracket + forged D-ring on heliBodyGroup
      if (cs.outrigger) {
        const outrigger = new THREE.Mesh(
          this.g(makeBox(4.8, 3.6, 3.2, true)),
          this.matSteelDark.material
        );
        outrigger.position.set(fX, sideSign * 14.2, cs.fz);
        this.heliBodyGroup.add(outrigger);
      } else {
        const flange = new THREE.Mesh(
          this.g(makeBox(5.2, 1.8, 4.0, true)),
          this.matSteelDark.material
        );
        flange.position.set(fX, sideSign * 16.8, cs.fz);
        this.heliBodyGroup.add(flange);
      }
      const lugRing = new THREE.Mesh(lugRingGeom, this.matSteelLight.material);
      lugRing.position.set(fX, fY, cs.fz);
      lugRing.rotation.y = Math.PI * 0.5;
      this.heliBodyGroup.add(lugRing);

      // Severed dangle chain hanging from helicopter D-ring when cut
      const heliDangleStub = new THREE.Mesh(stubGeom, this.matChainLink.material);
      heliDangleStub.position.set(fX, fY + sideSign * 0.8, cs.fz - 4.4);
      heliDangleStub.rotation.x = sideSign * -0.18;
      heliDangleStub.visible = false;
      this.heliBodyGroup.add(heliDangleStub);

      // Cast-iron bollard + waist mooring collar ring
      const bollardBody = new THREE.Mesh(bollardGeom, this.matSteelDark.material);
      bollardBody.position.set(bX, bY, 0.8);
      const bollardCollar = new THREE.Mesh(bollardCollarGeom, this.matChainLink.material);
      bollardCollar.position.set(bX, bY, 4.2);
      const bollardCap = new THREE.Mesh(
        this.g(makeCylZ(2.8, 2.8, 1.2, 12)),
        this.matYellow.material
      );
      bollardCap.position.set(bX, bY, 8.8);

      const dx = fX - bX;
      const dy = fY - bY;
      const dist = Math.hypot(dx, dy) || 1;
      const collarAnchorX = bX + (dx / dist) * 2.5;
      const collarAnchorY = bY + (dy / dist) * 2.5;

      const chainMesh = makeChainCableMesh(chainGeom, this.matChainLink.material);
      const turnbuckleMesh = makeChainCableMesh(turnbuckleGeom, this.matBrass.material);

      const cutStub = new THREE.Mesh(stubGeom, this.matChainLink.material);
      const stubX = bX + (dx / dist) * 6.5;
      const stubY = bY + (dy / dist) * 6.5;
      cutStub.position.set(stubX, stubY, 2.3);
      orientAxisZ(cutStub, stubX, stubY, 2.3, fX, fY, 1.8);
      cutStub.visible = false;

      const chainIndex = this.heliChains.length;
      const chainHitMesh = new THREE.Mesh(
        this.g(makeBox(30, 30, 20, true)),
        this.hitProxyMat
      );
      chainHitMesh.position.set(
        (fX + collarAnchorX) * 0.5,
        (fY + collarAnchorY) * 0.5,
        (cs.fz + 4.4) * 0.5
      );
      chainHitMesh.userData = {
        pickKind: 'ESCAPE_HELI',
        targetId: 'HELI',
        subTarget: 'CHAIN',
        chainIndex,
        ownerKey: `ESCAPE_HELI:CHAIN:${chainIndex}`,
      };

      this.heliRoot.add(
        bollardBody,
        bollardCollar,
        bollardCap,
        chainMesh,
        turnbuckleMesh,
        cutStub,
        chainHitMesh
      );
      this.heliChains.push({
        fx: fX,
        fy: fY,
        fz: cs.fz,
        bx: collarAnchorX,
        by: collarAnchorY,
        bz: 4.4,
        bollardCap,
        chainMesh,
        turnbuckleMesh,
        cutStub,
        heliDangleStub,
        hitMesh: chainHitMesh,
      });
    }

    this.heliRoot.visible = false;
    this.setRenderOrderRecursive(this.heliRoot, 6);
    heliContactShadow.renderOrder = 5;
    cockpitCanopy.renderOrder = 14;
    this.heliRotorBlurDisc.renderOrder = 15;
    this.heliHitMesh.renderOrder = 16;
    for (const ch of this.heliChains) ch.hitMesh.renderOrder = 16;
    this.worldScene.add(this.heliRoot);
  }

  // =========================================================================
  // 2. DECK 2 SOLAS ENCLOSED LIFEBOAT & DUAL HYDRAULIC A-FRAME DAVIT CRANES
  // =========================================================================
  private buildLifeboat(): void {
    const { x: bx, y: by, tx: bTx, ty: bTy } = this.map.lifeboatPos;
    const voidNorth = this.map.tiles[bTy - 1]?.[bTx] === 'VOID';
    this.boatOutSign = voidNorth ? -1 : 1;

    this.boatRoot.position.set(bx, -by, 0);

    const ts = this.map.tileSize;
    const inDir = this.boatOutSign; // +Y toward deck interior if ocean is -Y (south)
    const outDir = -inDir; // Ocean side in Three.js Y

    // Welded Non-Skid Steel Gantry Baseplate (flush on gunwale rail)
    const gantryX = 16;
    const gantryY = inDir * 12;
    const gantryW = 104;
    const gantryD = 50;

    const gantryDeck = new THREE.Mesh(
      this.g(makeBox(gantryW, gantryD, 1.8)),
      this.matGrate.material
    );
    gantryDeck.position.set(gantryX, gantryY, 0);

    // Hazard stripe gunwale toe-curb along ocean drop-off + bolted edge trim
    const hazardCurb = new THREE.Mesh(
      this.g(makeBox(gantryW + 2, 4.5, 2.2)),
      this.matHazard.material
    );
    hazardCurb.position.set(gantryX, gantryY + outDir * (gantryD * 0.5 - 1.5), 0);

    // Boarding Steps & Safety Stanchions facing inboard deck
    const stepDeck = new THREE.Mesh(this.g(makeBox(34, 10, 1.4)), this.matSteelMid.material);
    stepDeck.position.set(gantryX, gantryY + inDir * (gantryD * 0.5 + 4), 0);
    const statusLedBar = new THREE.Mesh(
      this.g(makeBox(16, 2.2, 1.8)),
      this.boatStatusLedMat.material
    );
    statusLedBar.position.set(gantryX, gantryY + inDir * (gantryD * 0.5 - 1.5), 1.6);

    const boatShadow = new THREE.Mesh(
      this.g(new THREE.CircleGeometry(36, 28)),
      this.matShadow
    );
    boatShadow.scale.set(1.4, 0.72, 1);
    boatShadow.position.set(gantryX, gantryY + outDir * 6, 1.9);

    this.boatRoot.add(gantryDeck, hazardCurb, stepDeck, statusLedBar, boatShadow);

    // Tapered Structural A-Frame Davit Boom Profile (XZ profile extruded across width)
    const boomShape = new THREE.Shape();
    boomShape.moveTo(0, 0);
    boomShape.lineTo(44, 24);
    boomShape.lineTo(44, 29.5);
    boomShape.lineTo(14, 17);
    boomShape.lineTo(0, 7.5);
    boomShape.lineTo(0, 0);
    const boomGeom = this.g(makeExtrudeXZ(boomShape, 6.2, 0.7, 0.7, 1, 1 / 36));
    // Orient boom profile from +X into outDir (+Y or -Y)
    boomGeom.rotateZ(outDir > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);

    const ramCylGeom = this.g(makeCylZ(1.9, 2.1, 18, 10));
    const ramRodGeom = this.g(makeCylZ(1.05, 1.05, 1.0, 10, true));

    const buildDavit = (
      px: number
    ): {
      boom: THREE.Group;
      sheave: THREE.Mesh;
      ramPin: THREE.Object3D;
      ramCyl: THREE.Mesh;
      ramRod: THREE.Mesh;
      ramAnchor: THREE.Vector3;
    } => {
      const pedY = gantryY + inDir * 4;
      // Heavy welded pedestal base + gusset cheeks
      const baseFoot = new THREE.Mesh(this.g(makeBox(18, 22, 2.6)), this.matSteelDark.material);
      baseFoot.position.set(px, pedY, 1.4);
      const cheekL = new THREE.Mesh(this.g(makeBox(3.4, 16, 19)), this.matSteelMid.material);
      cheekL.position.set(px - 5.2, pedY, 3.6);
      const cheekR = new THREE.Mesh(this.g(makeBox(3.4, 16, 19)), this.matSteelMid.material);
      cheekR.position.set(px + 5.2, pedY, 3.6);
      const crossBrace = new THREE.Mesh(this.g(makeBox(10, 8, 11)), this.matSteelDark.material);
      crossBrace.position.set(px, pedY + inDir * 2, 3.6);

      // Boom pivot pin at top of pedestal cheeks
      const pivotPin = new THREE.Mesh(this.g(makeCylX(2.4, 2.4, 16, 12)), this.matYellow.material);
      pivotPin.position.set(px, pedY, 19.5);

      const boom = new THREE.Group();
      boom.position.set(px, pedY, 19.5);
      const armBeam = new THREE.Mesh(boomGeom, this.matSteelLight.material);
      const sheaveBracket = new THREE.Mesh(
        this.g(makeBox(8, 8, 6)),
        this.matSteelDark.material
      );
      sheaveBracket.position.set(0, outDir * 43, 25);
      const sheave = new THREE.Mesh(
        this.g(makeCylX(4.0, 4.0, 4.2, 14)),
        this.matYellow.material
      );
      sheave.position.set(0, outDir * 44, 24.5);

      const ramPin = new THREE.Object3D();
      ramPin.position.set(0, outDir * 16, 13);
      boom.add(armBeam, sheaveBracket, sheave, ramPin);

      // Hydraulic luffing ram anchored inboard behind pedestal
      const ramAnchor = new THREE.Vector3(px, pedY + inDir * 11, 5.5);
      const ramCyl = makeChainCableMesh(ramCylGeom, this.matYellow.material);
      ramCyl.position.copy(ramAnchor);
      const ramRod = makeChainCableMesh(ramRodGeom, this.matSteelLight.material);

      this.boatRoot.add(baseFoot, cheekL, cheekR, crossBrace, pivotPin, boom, ramCyl, ramRod);
      return { boom, sheave, ramPin, ramCyl, ramRod, ramAnchor };
    };

    const davL = buildDavit(-14);
    const davR = buildDavit(46);
    this.boatBoomLeft = davL.boom;
    this.boatBoomRight = davR.boom;
    this.boatTipSheaveL = davL.sheave;
    this.boatTipSheaveR = davR.sheave;
    this.boatRamCylL = davL.ramCyl;
    this.boatRamCylR = davR.ramCyl;
    this.boatRamRodL = davL.ramRod;
    this.boatRamRodR = davR.ramRod;
    this.boatRamAnchorL = davL.ramAnchor;
    this.boatRamAnchorR = davR.ramAnchor;
    this.boatBoomRamPinL = davL.ramPin;
    this.boatBoomRamPinR = davR.ramPin;

    // Central Heavy Winch Drum + Gear Reducer + Manual Crank
    const winchX = 16;
    const winchY = gantryY + inDir * 6;
    const winchBed = new THREE.Mesh(this.g(makeBox(30, 18, 2.6)), this.matSteelDark.material);
    winchBed.position.set(winchX, winchY, 1.4);
    const cheekW1 = new THREE.Mesh(this.g(makeBox(3, 14, 12)), this.matSteelMid.material);
    cheekW1.position.set(winchX - 11, winchY, 3.6);
    const cheekW2 = new THREE.Mesh(this.g(makeBox(3, 14, 12)), this.matSteelMid.material);
    cheekW2.position.set(winchX + 11, winchY, 3.6);
    const winchDrum = new THREE.Mesh(
      this.g(makeCylX(5.4, 5.4, 19, 18)),
      this.matWinchCable.material
    );
    winchDrum.position.set(winchX, winchY, 10);
    const gearBox = new THREE.Mesh(this.g(makeBox(5.5, 11, 11)), this.matSteelDark.material);
    gearBox.position.set(winchX + 13.5, winchY, 4.5);

    this.boatCrankGroup.position.set(winchX + 17, winchY, 10);
    const crankHub = new THREE.Mesh(this.g(makeCylX(2.4, 2.4, 3, 10)), this.matBrass.material);
    const crankArm = new THREE.Mesh(this.g(makeBox(2.0, 2.4, 10.5)), this.matSteelLight.material);
    crankArm.position.set(1.2, 0, 0);
    const crankGrip = new THREE.Mesh(this.g(makeCylX(1.3, 1.3, 5.5, 10)), this.matYellow.material);
    crankGrip.position.set(4.0, 0, 9.5);
    this.boatCrankGroup.add(crankHub, crankArm, crankGrip);
    this.boatCrankGroup.visible = false;
    this.boatRoot.add(winchBed, cheekW1, cheekW2, winchDrum, gearBox, this.boatCrankGroup);

    // Marine Deep-Cycle Battery Cradle + Terminal Posts (MARINE_BATTERY)
    const batX = -32;
    const batY = gantryY + inDir * 8;
    this.boatBatteryEmptyMesh = new THREE.Mesh(
      this.g(makeBox(14, 12, 5.5)),
      this.matCavity.material
    );
    this.boatBatteryEmptyMesh.position.set(batX, batY, 1.5);
    const emptyTrayRim = new THREE.Mesh(this.g(makeBox(16, 14, 2.0)), this.matSteelDark.material);
    emptyTrayRim.position.set(batX, batY, 1.2);

    this.boatBatteryFilledGroup.position.set(batX, batY, 1.6);
    const batCase = new THREE.Mesh(this.g(makeBox(14, 12, 9)), this.matSteelDark.material);
    const batLid = new THREE.Mesh(this.g(makeBox(14.5, 12.5, 2.2)), this.matTeal.material);
    batLid.position.z = 8.8;
    const postPos = new THREE.Mesh(this.g(makeCylZ(1.1, 1.1, 2.0, 8)), this.matRed.material);
    postPos.position.set(4, -3, 10.5);
    const postNeg = new THREE.Mesh(this.g(makeCylZ(1.1, 1.1, 2.0, 8)), this.matCyanGlow.material);
    postNeg.position.set(-4, 3, 10.5);
    const batGauge = new THREE.Mesh(this.g(makeBox(4.5, 4.5, 1.2)), this.matCyanGlow.material);
    batGauge.position.set(0, 0, 10.8);
    this.boatBatteryFilledGroup.add(batCase, batLid, postPos, postNeg, batGauge);
    this.boatBatteryFilledGroup.visible = false;
    this.boatRoot.add(emptyTrayRim, this.boatBatteryEmptyMesh, this.boatBatteryFilledGroup);

    // --- Sculpted 84px SOLAS Totally Enclosed Survival Craft (TEMPSC) ---
    // Pointed bow (+X) & curved stern (-X) extruded hull planform
    const hullPlan = new THREE.Shape();
    hullPlan.moveTo(-36, -11);
    hullPlan.quadraticCurveTo(-44, 0, -36, 11);
    hullPlan.lineTo(14, 15.5);
    hullPlan.quadraticCurveTo(36, 13, 44, 0); // Pointed wave-piercing bow
    hullPlan.quadraticCurveTo(36, -13, 14, -15.5);
    hullPlan.lineTo(-36, -11);

    const boatLowerHull = new THREE.Mesh(
      this.g(makeExtrudeXY(hullPlan, 10.5, 2.2, 2.2, 2, false, 1 / 46)),
      this.matBoatHull.material
    );
    // Heavy black rubber rub-rail fender wrapping around sheerline
    const rubRail = new THREE.Mesh(
      this.g(makeExtrudeXY(hullPlan, 2.4, 2.9, 0.7, 1, false, 1 / 46)),
      this.matRubber.material
    );
    rubRail.position.z = 8.4;

    // Ribbed Enclosed Fiberglass Canopy Shell
    const canopyPlan = new THREE.Shape();
    canopyPlan.moveTo(-30, -9);
    canopyPlan.quadraticCurveTo(-36, 0, -30, 9);
    canopyPlan.lineTo(14, 12.5);
    canopyPlan.quadraticCurveTo(30, 10, 36, 0);
    canopyPlan.quadraticCurveTo(30, -10, 14, -12.5);
    canopyPlan.lineTo(-30, -9);
    const canopyShell = new THREE.Mesh(
      this.g(makeExtrudeXY(canopyPlan, 9.0, 2.4, 2.4, 2, false, 1 / 42)),
      this.matOrange.material
    );
    canopyShell.position.z = 9.5;

    // Stepped Raised Aft Helmsman Cupola + Wraparound Tinted Windows
    const cupolaPlan = new THREE.Shape();
    cupolaPlan.moveTo(-22, -7.2);
    cupolaPlan.lineTo(8, -8.2);
    cupolaPlan.quadraticCurveTo(16, 0, 8, 8.2);
    cupolaPlan.lineTo(-22, 7.2);
    cupolaPlan.quadraticCurveTo(-26, 0, -22, -7.2);
    const helmCupola = new THREE.Mesh(
      this.g(makeExtrudeXY(cupolaPlan, 7.2, 1.5, 1.5, 2, false, 1 / 32)),
      this.matWhite.material
    );
    helmCupola.position.z = 17.2;

    const helmWindow = new THREE.Mesh(
      this.g(makeBox(9, 13.5, 4.2)),
      this.matCanopy.material
    );
    helmWindow.position.set(7.5, 0, 19.6);

    // Side Portholes + Orange Lifebuoy Rings mounted on flanks
    for (const side of [-1, 1]) {
      const porthole = new THREE.Mesh(
        this.g(makeCylY(2.0, 2.0, 1.8, 12)),
        this.matCanopy.material
      );
      porthole.position.set(-6, side * 12.6, 14.5);
      const lifebuoy = new THREE.Mesh(
        this.g(new THREE.TorusGeometry(3.2, 1.0, 8, 16)),
        this.matWhite.material
      );
      lifebuoy.rotation.x = Math.PI * 0.5;
      lifebuoy.position.set(-18, side * 13.0, 14.5);
      this.boatHullGroup.add(porthole, lifebuoy);
    }

    // Rooftop Strobe Beacon + Aft Brass Propeller & Rudder
    const beaconBase = new THREE.Mesh(this.g(makeCylZ(2.8, 3.2, 1.8, 12)), this.matSteelDark.material);
    beaconBase.position.set(-10, 0, 24.2);
    const beacon = new THREE.Mesh(this.g(makeCylZ(2.0, 2.2, 3.2, 12)), this.boatBeaconMat.material);
    beacon.position.set(-10, 0, 25.6);

    const sternSkeg = new THREE.Mesh(this.g(makeBox(7, 2.2, 5.5)), this.matSteelDark.material);
    sternSkeg.position.set(-40, 0, 1.5);
    const sternProp = new THREE.Mesh(this.g(makeCylX(2.4, 2.4, 2.8, 10)), this.matBrass.material);
    sternProp.position.set(-43.5, 0, 3.6);

    // Bow & Stern Forged Lifting Hooks / Shackles (aligned directly beneath davits at X = -14 & +46)
    for (const hx of [-30, 30]) {
      const hookLug = new THREE.Mesh(this.g(makeBox(4.5, 4.5, 3.4)), this.matYellow.material);
      hookLug.position.set(hx, 0, 17.5);
      this.boatHullGroup.add(hookLug);
    }

    // Structural Hull Breach (unpatched) vs. Bolted Riveted Steel Patch (HULL_PATCH) on forward deck/bow slope
    this.boatCrackMesh = new THREE.Mesh(
      this.g(makeBox(15, 16, 2.2)),
      this.matCavity.material
    );
    this.boatCrackMesh.position.set(20, 0, 18.2);
    this.boatCrackMesh.rotation.z = 0.24;

    this.boatPatchGroup.position.set(20, 0, 18.6);
    const patchPlate = new THREE.Mesh(this.g(makeBox(16.5, 15, 1.8)), this.matSteelLight.material);
    this.boatPatchGroup.add(patchPlate);
    for (const [rx, ry] of [
      [-6.2, -5.5],
      [6.2, -5.5],
      [-6.2, 5.5],
      [6.2, 5.5],
      [0, -5.5],
      [0, 5.5],
    ]) {
      const rivet = new THREE.Mesh(this.g(makeCylZ(0.9, 0.9, 2.2, 8)), this.matBrass.material);
      rivet.position.set(rx, ry, 0.2);
      this.boatPatchGroup.add(rivet);
    }
    this.boatPatchGroup.visible = false;

    this.boatHullGroup.add(
      boatLowerHull,
      rubRail,
      canopyShell,
      helmCupola,
      helmWindow,
      beaconBase,
      beacon,
      sternSkeg,
      sternProp,
      this.boatCrackMesh,
      this.boatPatchGroup
    );
    this.boatRoot.add(this.boatHullGroup);

    // 2 Dual Steel Hoist Fall Cables connecting boom tip sheaves down to lifeboat hooks
    const cableGeom = this.g(makeCylZ(1.35, 1.35, 1, 8, true));
    this.boatCableL = makeChainCableMesh(cableGeom, this.matSteelLight.material);
    this.boatCableR = makeChainCableMesh(cableGeom, this.matSteelLight.material);
    this.boatRoot.add(this.boatCableL, this.boatCableR);

    this.boatRoot.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj !== boatShadow) {
        obj.userData.occluderOwnerKey = 'ESCAPE_LIFEBOAT';
        this.boatOccluderMeshes.push(obj);
      }
    });

    this.boatHitMesh = new THREE.Mesh(
      this.g(makeBox(100, 56, 36)),
      this.hitProxyMat
    );
    this.boatHitMesh.position.set(gantryX, gantryY + inDir * 4, 0);
    this.boatHitMesh.userData = {
      pickKind: 'ESCAPE_LIFEBOAT',
      targetId: 'LIFEBOAT',
      ownerKey: 'ESCAPE_LIFEBOAT',
    };
    this.boatHullHitMesh = new THREE.Mesh(
      this.g(makeBox(88, 36, 28)),
      this.hitProxyMat
    );
    this.boatHullHitMesh.position.set(0, 0, 0);
    this.boatHullHitMesh.userData = {
      pickKind: 'ESCAPE_LIFEBOAT',
      targetId: 'LIFEBOAT',
      ownerKey: 'ESCAPE_LIFEBOAT',
    };
    this.boatRoot.add(this.boatHitMesh);
    this.boatHullGroup.add(this.boatHullHitMesh);

    this.boatRoot.visible = false;
    this.setRenderOrderRecursive(this.boatRoot, 6);
    boatShadow.renderOrder = 5;
    helmWindow.renderOrder = 14;
    this.boatHitMesh.renderOrder = 16;
    this.boatHullHitMesh.renderOrder = 16;
    this.worldScene.add(this.boatRoot);
  }

  // =========================================================================
  // 3. DECK 1 MOONPOOL CAISSON, BOARDING GANTRY & DSRV SUBMERSIBLE + LEVER
  // =========================================================================
  private buildSubmarine(): void {
    const ts = this.map.tileSize;
    const subPool = this.map.props.find((p) => p.kind === 'SUBMARINE_HULL');
    const poolX = (subPool?.tx ?? 101) * ts;
    const poolY = (subPool?.ty ?? 92) * ts;
    const poolW = (subPool?.tw ?? 4) * ts;
    const poolH = (subPool?.th ?? 6) * ts;
    const poolCx = poolX + poolW * 0.5;
    const poolCy = poolY + poolH * 0.5;

    this.subRoot.position.set(poolCx, -poolCy, 0);

    // --- Recessed Steel Caisson Moonpool Basin (-34 .. +2.5) ---
    const basinFloor = new THREE.Mesh(
      this.g(makeBox(poolW + 4, poolH + 4, 2)),
      this.matCavity.material
    );
    basinFloor.position.set(0, 0, -34);

    const wallN = new THREE.Mesh(this.g(makeBox(poolW + 12, 7, 34)), this.matSteelDark.material);
    wallN.position.set(0, poolH * 0.5 + 2.5, -34);
    const wallS = new THREE.Mesh(this.g(makeBox(poolW + 12, 7, 34)), this.matSteelDark.material);
    wallS.position.set(0, -poolH * 0.5 - 2.5, -34);
    const wallW = new THREE.Mesh(this.g(makeBox(7, poolH + 12, 34)), this.matSteelDark.material);
    wallW.position.set(-poolW * 0.5 - 2.5, 0, -34);
    const wallE = new THREE.Mesh(this.g(makeBox(7, poolH + 12, 34)), this.matSteelDark.material);
    wallE.position.set(poolW * 0.5 + 2.5, 0, -34);

    // Vertical structural steel I-beam caisson ribs along inner walls
    for (let i = -2; i <= 2; i++) {
      const ry = i * 48;
      const ribW = new THREE.Mesh(this.g(makeBox(3.5, 5, 32)), this.matSteelMid.material);
      ribW.position.set(-poolW * 0.5 + 1.5, ry, -33);
      const ribE = new THREE.Mesh(this.g(makeBox(3.5, 5, 32)), this.matSteelMid.material);
      ribE.position.set(poolW * 0.5 - 1.5, ry, -33);
      this.subRoot.add(ribW, ribE);
    }

    // Industrial Coping Curb around Moonpool (hazard-striped steel + dark cap, subtle status corner lamps)
    const curbN = new THREE.Mesh(this.g(makeBox(poolW + 16, 8, 2.4)), this.matHazard.material);
    curbN.position.set(0, poolH * 0.5 + 3, 0);
    const curbS = new THREE.Mesh(this.g(makeBox(poolW + 16, 8, 2.4)), this.matHazard.material);
    curbS.position.set(0, -poolH * 0.5 - 3, 0);
    const curbW = new THREE.Mesh(this.g(makeBox(8, poolH + 16, 2.4)), this.matHazard.material);
    curbW.position.set(-poolW * 0.5 - 3, 0, 0);
    const curbE = new THREE.Mesh(this.g(makeBox(8, poolH + 16, 2.4)), this.matHazard.material);
    curbE.position.set(poolW * 0.5 + 3, 0, 0);

    // 4 Corner Recessed Dock Stanchion Lights
    for (const [cx, cy] of [
      [-poolW * 0.5 - 3, -poolH * 0.5 - 3],
      [poolW * 0.5 + 3, -poolH * 0.5 - 3],
      [-poolW * 0.5 - 3, poolH * 0.5 + 3],
      [poolW * 0.5 + 3, poolH * 0.5 + 3],
    ]) {
      const post = new THREE.Mesh(this.g(makeCylZ(3.2, 3.8, 5.5, 10)), this.matSteelMid.material);
      post.position.set(cx, cy, 1.5);
      const lamp = new THREE.Mesh(this.g(makeCylZ(2.0, 2.2, 2.0, 10)), this.subPoolStatusMat.material);
      lamp.position.set(cx, cy, 6.8);
      this.subRoot.add(post, lamp);
    }

    // Animated Abyssal Ocean Water + Wake Ring
    this.subWaterMesh = new THREE.Mesh(
      this.g(new THREE.PlaneGeometry(poolW - 2, poolH - 2)),
      this.subWaterMat
    );
    this.subWaterMesh.position.set(0, 0, -5.0);

    this.subWakeRing = new THREE.Mesh(
      this.g(new THREE.PlaneGeometry(118, 224)),
      this.subWakeRingMat
    );
    this.subWakeRing.position.set(0, 0, -4.4);

    this.subRoot.add(
      basinFloor,
      wallN,
      wallS,
      wallW,
      wallE,
      curbN,
      curbS,
      curbW,
      curbE,
      this.subWaterMesh,
      this.subWakeRing
    );

    // --- Continuous Industrial Steel Boarding Gantry Bridge (connects subPos dock seamlessly to Moonpool curb!) ---
    const subPos = this.map.submarinePos;
    const dockX = subPos.x - poolCx; // ~ -198
    const dockY = -(subPos.y - poolCy); // ~ -22
    const poolWestEdgeX = -poolW * 0.5 - 3; // ~ -91
    const bridgeStartX = dockX - 24; // ~ -222
    const bridgeEndX = poolWestEdgeX + 26; // Cantilevers cleanly onto Moonpool curb + gangway overhang!
    const bridgeCenterX = (bridgeStartX + bridgeEndX) * 0.5;
    const bridgeLen = bridgeEndX - bridgeStartX;
    const bridgeW = 46;

    const gantryDeck = new THREE.Mesh(
      this.g(makeBox(bridgeLen, bridgeW, 2.2)),
      this.matGrate.material
    );
    gantryDeck.position.set(bridgeCenterX, dockY, 0.2);

    // Boarding Pad Threshold Plaque right at player stand spot (dockX, dockY)
    const padBorder = new THREE.Mesh(
      this.g(makeBox(36, 36, 2.5)),
      this.matHazard.material
    );
    padBorder.position.set(dockX, dockY, 0.3);
    const padInner = new THREE.Mesh(
      this.g(makeBox(30, 30, 2.8)),
      this.matSteelDark.material
    );
    padInner.position.set(dockX, dockY, 0.3);

    // Cantilevered Boarding Gangway Apron bridging from West Curb toward Sub Sail
    const gangwayDeck = new THREE.Mesh(
      this.g(makeBox(38, 30, 2.2)),
      this.matSteelMid.material
    );
    gangwayDeck.position.set(poolWestEdgeX + 26, dockY, 2.8);
    gangwayDeck.rotation.y = -0.14;

    // Yellow Tubular Safety Handrails along North & South flanks of the Gantry
    for (const side of [-1, 1]) {
      const railY = dockY + side * (bridgeW * 0.5 - 2.2);
      const topBar = new THREE.Mesh(
        this.g(makeCylX(1.2, 1.2, bridgeLen - 16, 8)),
        this.matYellow.material
      );
      topBar.position.set(bridgeCenterX + 4, railY, 15);
      const midBar = new THREE.Mesh(
        this.g(makeCylX(0.9, 0.9, bridgeLen - 16, 8)),
        this.matYellow.material
      );
      midBar.position.set(bridgeCenterX + 4, railY, 8.5);
      this.subRoot.add(topBar, midBar);

      for (let i = 0; i <= 3; i++) {
        const sx = bridgeStartX + 12 + (i * (bridgeLen - 24)) / 3;
        const post = new THREE.Mesh(
          this.g(makeCylZ(1.3, 1.3, 15, 8)),
          this.matYellow.material
        );
        post.position.set(sx, railY, 1.5);
        this.subRoot.add(post);
      }
    }
    this.subRoot.add(gantryDeck, padBorder, padInner, gangwayDeck);

    // --- Sculpted 188px Deep-Sea Rescue Submersible (DSRV) via LatheGeometry + ExtrudeGeometry ---
    // Smooth Myring teardrop hull profile revolved around +Y axis
    const hullProfile: THREE.Vector2[] = [];
    const hullHalfLen = 90;
    const maxR = 26;
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps; // 0 (stern -90) .. 1 (bow +90)
      const yPos = -hullHalfLen + t * hullHalfLen * 2;
      let r: number;
      if (t < 0.28) {
        // Parabolic stern tail taper down to Kort nozzle hub
        const u = t / 0.28;
        r = 7.5 + (maxR - 7.5) * Math.pow(Math.sin(u * Math.PI * 0.5), 0.78);
      } else if (t > 0.72) {
        // Smooth elliptical rounded nose bow
        const u = (1 - t) / 0.28;
        r = maxR * Math.pow(Math.sin(u * Math.PI * 0.5), 0.65);
      } else {
        r = maxR;
      }
      hullProfile.push(new THREE.Vector2(Math.max(0.01, r), yPos));
    }
    const hullLathe = this.g(new THREE.LatheGeometry(hullProfile, 28));
    scaleGeometryUVs(hullLathe, 2.0, 2.5);
    hullLathe.computeVertexNormals();
    const pressureHull = new THREE.Mesh(hullLathe, this.matSubHull.material);
    pressureHull.position.set(0, 0, 8);

    // Forward Acrylic Observation Hemisphere + Brass Viewport Collar (+Y = +86)
    const bowViewport = new THREE.Mesh(
      this.g(new THREE.SphereGeometry(11.5, 18, 14)),
      this.subBowLightMat.material
    );
    bowViewport.scale.set(1, 0.75, 1);
    bowViewport.position.set(0, 85, 8);
    const bowCollar = new THREE.Mesh(
      this.g(new THREE.TorusGeometry(11.6, 1.8, 10, 22)),
      this.matBrass.material
    );
    bowCollar.position.set(0, 81, 8);

    // Circumferential Structural Weld Rib Rings
    for (const ry of [-46, -16, 18, 48]) {
      const rib = new THREE.Mesh(
        this.g(new THREE.TorusGeometry(26.1, 1.1, 8, 28)),
        this.matSteelDark.material
      );
      rib.position.set(0, ry, 8);
      this.subHullGroup.add(rib);
    }

    // Streamlined Hydrodynamic Teardrop Conning Tower Sail (ExtrudeGeometry!)
    const sailPlan = new THREE.Shape();
    sailPlan.moveTo(0, 24); // Rounded leading edge (+Y)
    sailPlan.quadraticCurveTo(10.5, 14, 9.5, -10);
    sailPlan.quadraticCurveTo(6, -24, 0, -28); // Tapered trailing edge (-Y)
    sailPlan.quadraticCurveTo(-6, -24, -9.5, -10);
    sailPlan.quadraticCurveTo(-10.5, 14, 0, 24);

    const sail = new THREE.Mesh(
      this.g(makeExtrudeXY(sailPlan, 22, 1.4, 1.4, 2, false, 1 / 40)),
      this.matSteelMid.material
    );
    sail.position.set(0, 4, 22);

    // Rescue Yellow Sail Crown Collar
    const sailCrown = new THREE.Mesh(
      this.g(makeExtrudeXY(sailPlan, 2.2, 1.6, 0.4, 1, false, 1 / 40)),
      this.matYellow.material
    );
    sailCrown.position.set(0, 4, 42.2);

    // Fairwater Sail-Mounted Swept Dive Planes + Cruciform Stern Stabilizer Fins
    const fwPlaneShape = new THREE.Shape();
    fwPlaneShape.moveTo(0, 7);
    fwPlaneShape.lineTo(24, 2);
    fwPlaneShape.lineTo(24, -5);
    fwPlaneShape.lineTo(0, -6);
    fwPlaneShape.lineTo(0, 7);
    const fwPlaneGeom = this.g(makeExtrudeXY(fwPlaneShape, 2.2, 0.4, 0.4, 1, true));
    for (const side of [-1, 1]) {
      const fw = new THREE.Mesh(fwPlaneGeom, this.matSteelLight.material);
      fw.scale.x = side;
      fw.position.set(side * 6, 8, 35);
      this.subHullGroup.add(fw);
    }

    // Cruciform Stern Stabilizers (horizontal & vertical fins at y = -74)
    const sternHoriz = new THREE.Mesh(this.g(makeBox(52, 11, 2.4)), this.matSteelMid.material);
    sternHoriz.position.set(0, -72, 8);
    const sternVert = new THREE.Mesh(this.g(makeBox(2.4, 11, 38)), this.matSteelMid.material);
    sternVert.position.set(0, -72, -11);

    // Brass Rescue Hatch Coaming, Spoked Handwheel, Periscope & Snorkel Masts
    const hatchCoaming = new THREE.Mesh(this.g(makeCylZ(7.2, 8.2, 2.8, 16)), this.matSteelDark.material);
    hatchCoaming.position.set(0, 14, 44);
    const hatchWheel = new THREE.Mesh(
      this.g(new THREE.TorusGeometry(5.2, 0.9, 8, 18)),
      this.matBrass.material
    );
    hatchWheel.position.set(0, 14, 47.4);
    const hatchSpokeA = new THREE.Mesh(this.g(makeBox(10, 1.2, 1.0)), this.matBrass.material);
    hatchSpokeA.position.set(0, 14, 47.4);
    const hatchSpokeB = new THREE.Mesh(this.g(makeBox(1.2, 10, 1.0)), this.matBrass.material);
    hatchSpokeB.position.set(0, 14, 47.4);

    const periscopeMast = new THREE.Mesh(this.g(makeCylZ(1.9, 2.4, 13, 12)), this.matBrass.material);
    periscopeMast.position.set(-2.5, -10, 44);
    const periscopeHead = new THREE.Mesh(this.g(makeBox(3.4, 6.2, 3.0)), this.matSteelLight.material);
    periscopeHead.position.set(-2.5, -8.5, 55.5);
    const snorkelMast = new THREE.Mesh(this.g(makeCylZ(1.3, 1.6, 10, 10)), this.matSteelLight.material);
    snorkelMast.position.set(3.2, -14, 44);

    // Open Hollow Kort-Nozzle Shroud Duct (LatheGeometry annulus!) + 5-Blade Pitched Brass Propeller
    const nozzleWallProfile = [
      new THREE.Vector2(11.6, -5.5),
      new THREE.Vector2(14.6, -5.5),
      new THREE.Vector2(15.2, 0),
      new THREE.Vector2(14.2, 5.5),
      new THREE.Vector2(11.4, 5.5),
      new THREE.Vector2(12.2, 0),
      new THREE.Vector2(11.6, -5.5),
    ];
    const kortNozzle = new THREE.Mesh(
      this.g(new THREE.LatheGeometry(nozzleWallProfile, 26)),
      this.matSteelDark.material
    );
    kortNozzle.position.set(0, -93, 8);
    const nozzleRing = new THREE.Mesh(
      this.g(new THREE.TorusGeometry(13.6, 1.6, 10, 26)),
      this.matYellow.material
    );
    nozzleRing.position.set(0, -98.5, 8);
    // Support struts anchoring nozzle shroud to stern tailcone
    const strutV = new THREE.Mesh(this.g(makeBox(1.8, 6, 26, true)), this.matSteelMid.material);
    strutV.position.set(0, -91, 8);
    const strutH = new THREE.Mesh(this.g(makeBox(26, 6, 1.8, true)), this.matSteelMid.material);
    strutH.position.set(0, -91, 8);
    this.subHullGroup.add(strutV, strutH);

    this.subPropellerGroup.position.set(0, -94, 8);
    const propHub = new THREE.Mesh(
      this.g(makeCylY(3.4, 1.2, 7.5, 12)),
      this.matBrass.material
    );
    this.subPropellerGroup.add(propHub);
    for (let i = 0; i < 5; i++) {
      const bladePivot = new THREE.Group();
      bladePivot.rotation.y = (i * Math.PI * 2) / 5;
      const blade = new THREE.Mesh(
        this.g(makeBox(11.5, 1.4, 3.6, true)),
        this.matBrass.material
      );
      blade.position.set(6.8, -0.5, 0);
      blade.rotation.x = 0.48; // Hydrodynamic pitch angle!
      bladePivot.add(blade);
      this.subPropellerGroup.add(bladePivot);
    }

    // 1. Port External Pressurized Battery Pod (-26, 0)
    this.subBatteryEmpty = new THREE.Mesh(this.g(makeBox(8, 36, 10)), this.matCavity.material);
    this.subBatteryEmpty.position.set(-24, 0, 10);
    this.subBatteryFilled.position.set(-25, 0, 13);
    const sbCyl = new THREE.Mesh(this.g(makeCylY(5.6, 5.6, 32, 14)), this.matTeal.material);
    const sbCapF = new THREE.Mesh(this.g(new THREE.SphereGeometry(5.6, 12, 10)), this.matSteelLight.material);
    sbCapF.position.y = 16;
    const sbCapR = new THREE.Mesh(this.g(new THREE.SphereGeometry(5.6, 12, 10)), this.matSteelLight.material);
    sbCapR.position.y = -16;
    const sbGlow = new THREE.Mesh(this.g(makeBox(3.8, 18, 2.2)), this.matCyanGlow.material);
    sbGlow.position.set(0, 0, 5.2);
    this.subBatteryFilled.add(sbCyl, sbCapF, sbCapR, sbGlow);
    this.subBatteryFilled.visible = false;

    // 2. Starboard Centrifugal Ballast Pump Unit (+25, -28)
    this.subBallastEmpty = new THREE.Mesh(this.g(makeBox(8, 28, 10)), this.matCavity.material);
    this.subBallastEmpty.position.set(24, -28, 10);
    this.subBallastFilled.position.set(25, -28, 13);
    const pumpVolute = new THREE.Mesh(this.g(makeCylZ(7.5, 7.5, 9, 14)), this.matSteelLight.material);
    const pumpManifold = new THREE.Mesh(this.g(makeCylY(3.2, 3.2, 22, 10)), this.matBrass.material);
    pumpManifold.position.set(0, 0, 4.5);
    this.subImpeller = new THREE.Mesh(this.g(makeBox(10, 2.4, 2.2)), this.matCyanGlow.material);
    this.subImpeller.position.set(0, 0, 9.2);
    const impCross = new THREE.Mesh(this.g(makeBox(2.4, 10, 2.2)), this.matCyanGlow.material);
    this.subImpeller.add(impCross);
    this.subBallastFilled.add(pumpVolute, pumpManifold, this.subImpeller);
    this.subBallastFilled.visible = false;

    // 3. Dive Key Brass Ignition Lock on Forward Sail Deck
    const diveBezel = new THREE.Mesh(this.g(makeCylZ(5.2, 6.0, 2.4, 16)), this.matBrass.material);
    diveBezel.position.set(0, 1, 44);
    const diveLens = new THREE.Mesh(this.g(makeCylZ(3.6, 3.6, 2.8, 16)), this.subDiveKeyMat.material);
    diveLens.position.set(0, 1, 44.6);

    this.subHullGroup.add(
      pressureHull,
      bowViewport,
      bowCollar,
      sail,
      sailCrown,
      sternHoriz,
      sternVert,
      hatchCoaming,
      hatchWheel,
      hatchSpokeA,
      hatchSpokeB,
      periscopeMast,
      periscopeHead,
      snorkelMast,
      kortNozzle,
      nozzleRing,
      this.subPropellerGroup,
      this.subBatteryEmpty,
      this.subBatteryFilled,
      this.subBallastEmpty,
      this.subBallastFilled,
      diveBezel,
      diveLens
    );
    this.subRoot.add(this.subHullGroup);

    this.subRoot.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj !== this.subWaterMesh && obj !== this.subWakeRing) {
        obj.userData.occluderOwnerKey = 'ESCAPE_SUBMARINE:DOCK';
        this.subDockOccluderMeshes.push(obj);
      }
    });

    this.subDockHitMesh = new THREE.Mesh(
      this.g(makeBox(112, 48, 28)),
      this.hitProxyMat
    );
    this.subDockHitMesh.position.set(dockX + 32, dockY, 0);
    this.subDockHitMesh.userData = {
      pickKind: 'ESCAPE_SUBMARINE',
      targetId: 'SUBMARINE',
      subTarget: 'DOCK',
      ownerKey: 'ESCAPE_SUBMARINE:DOCK',
    };
    this.subHullHitMesh = new THREE.Mesh(
      this.g(makeBox(56, 178, 52)),
      this.hitProxyMat
    );
    this.subHullHitMesh.position.set(0, 0, -2);
    this.subHullHitMesh.userData = {
      pickKind: 'ESCAPE_SUBMARINE',
      targetId: 'SUBMARINE',
      subTarget: 'DOCK',
      ownerKey: 'ESCAPE_SUBMARINE:DOCK',
    };
    this.subRoot.add(this.subDockHitMesh);
    this.subHullGroup.add(this.subHullHitMesh);

    this.subRoot.visible = false;
    this.setRenderOrderRecursive(this.subRoot, 6);
    this.setRenderOrderRecursive(this.subHullGroup, 9);
    this.subWaterMesh.renderOrder = 14;
    this.subWakeRing.renderOrder = 15;
    this.subDockHitMesh.renderOrder = 16;
    this.subHullHitMesh.renderOrder = 16;
    this.worldScene.add(this.subRoot);

    // --- Grounded Industrial Hydraulic Floodgate Lever Console (no floating translucent disc!) ---
    this.subLeverRoot.position.set(subPos.leverX, -subPos.leverY, 0);
    const leverShadow = new THREE.Mesh(
      this.g(new THREE.CircleGeometry(20, 24)),
      this.matShadow
    );
    leverShadow.position.set(0, 0, 0.25);

    const plinth = new THREE.Mesh(this.g(makeBox(30, 28, 2.4)), this.matSteelDark.material);
    for (const [ax, ay] of [
      [-12, -11],
      [12, -11],
      [-12, 11],
      [12, 11],
    ]) {
      const bolt = new THREE.Mesh(this.g(makeCylZ(1.1, 1.1, 3.2, 6)), this.matSteelLight.material);
      bolt.position.set(ax, ay, 0);
      this.subLeverRoot.add(bolt);
    }

    const cabinet = new THREE.Mesh(this.g(makeBox(22, 20, 17)), this.matSteelMid.material);
    cabinet.position.set(0, 1, 2.2);
    const bezelTop = new THREE.Mesh(this.g(makeBox(24, 22, 2.8)), this.matSteelDark.material);
    bezelTop.position.set(0, 1, 18.5);
    const gaugeFace = new THREE.Mesh(this.g(makeBox(20, 12, 1.2)), this.matGaugePanel.material);
    gaugeFace.position.set(0, -6.5, 19);
    gaugeFace.rotation.x = 0.55;

    // Hydraulic pipes descending from cabinet into deck floor
    for (const px of [-6, 6]) {
      const pipe = new THREE.Mesh(this.g(makeCylZ(1.4, 1.4, 14, 10)), this.matBrass.material);
      pipe.position.set(px, 11.5, 2.0);
      this.subLeverRoot.add(pipe);
    }

    const statusLamp = new THREE.Mesh(
      this.g(makeCylZ(2.2, 2.6, 2.8, 12)),
      this.subLeverLampMat.material
    );
    statusLamp.position.set(-7, 6, 21.2);

    const slotQuadrant = new THREE.Mesh(this.g(makeBox(6, 15, 2.2)), this.matCavity.material);
    slotQuadrant.position.set(3, 3, 21);

    this.subLeverArmGroup.position.set(3, 3, 21.5);
    const leverRod = new THREE.Mesh(this.g(makeCylZ(1.6, 1.8, 16, 10)), this.matSteelLight.material);
    const leverGrip = new THREE.Mesh(
      this.g(makeCylX(2.4, 2.4, 11, 12)),
      this.subLeverHandleMat.material
    );
    leverGrip.position.set(0, 0, 16);
    this.subLeverArmGroup.add(leverRod, leverGrip);

    this.subLeverRoot.add(
      leverShadow,
      plinth,
      cabinet,
      bezelTop,
      gaugeFace,
      statusLamp,
      slotQuadrant,
      this.subLeverArmGroup
    );
    this.subLeverRoot.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj !== leverShadow) {
        obj.userData.occluderOwnerKey = 'ESCAPE_SUBMARINE:LEVER';
        this.subLeverOccluderMeshes.push(obj);
      }
    });
    this.subLeverHitMesh = new THREE.Mesh(
      this.g(makeBox(36, 36, 38)),
      this.hitProxyMat
    );
    this.subLeverHitMesh.userData = {
      pickKind: 'ESCAPE_SUBMARINE',
      targetId: 'SUBMARINE',
      subTarget: 'LEVER',
      ownerKey: 'ESCAPE_SUBMARINE:LEVER',
    };
    this.subLeverRoot.add(this.subLeverHitMesh);

    this.subLeverRoot.visible = false;
    this.setRenderOrderRecursive(this.subLeverRoot, 6);
    leverShadow.renderOrder = 5;
    this.subLeverHitMesh.renderOrder = 16;
    this.worldScene.add(this.subLeverRoot);
  }

  public getRaycastTargets(activeDeck: ShipDeck): THREE.Object3D[] {
    this.raycastHitMeshes.length = 0;
    if (activeDeck === 'DECK_3' && this.heliRoot.visible) {
      for (let i = 0; i < this.heliChains.length; i++) {
        if (this.heliChains[i].hitMesh.visible) {
          this.raycastHitMeshes.push(this.heliChains[i].hitMesh);
        }
      }
      this.raycastHitMeshes.push(this.heliHitMesh);
    } else if (activeDeck === 'DECK_2' && this.boatRoot.visible) {
      this.raycastHitMeshes.push(this.boatHullHitMesh, this.boatHitMesh);
    } else if (activeDeck === 'DECK_1') {
      if (this.subRoot.visible) {
        this.raycastHitMeshes.push(this.subHullHitMesh, this.subDockHitMesh);
      }
      if (this.subLeverRoot.visible) {
        this.raycastHitMeshes.push(this.subLeverHitMesh);
      }
    }
    return this.raycastHitMeshes;
  }

  public getRaycastOccluders(activeDeck: ShipDeck): THREE.Object3D[] {
    this.raycastOccluderMeshes.length = 0;
    if (activeDeck === 'DECK_3' && this.heliRoot.visible) {
      for (let i = 0; i < this.heliOccluderMeshes.length; i++) {
        this.raycastOccluderMeshes.push(this.heliOccluderMeshes[i]);
      }
    } else if (activeDeck === 'DECK_2' && this.boatRoot.visible) {
      for (let i = 0; i < this.boatOccluderMeshes.length; i++) {
        this.raycastOccluderMeshes.push(this.boatOccluderMeshes[i]);
      }
    } else if (activeDeck === 'DECK_1') {
      if (this.subRoot.visible) {
        for (let i = 0; i < this.subDockOccluderMeshes.length; i++) {
          this.raycastOccluderMeshes.push(this.subDockOccluderMeshes[i]);
        }
      }
      if (this.subLeverRoot.visible) {
        for (let i = 0; i < this.subLeverOccluderMeshes.length; i++) {
          this.raycastOccluderMeshes.push(this.subLeverOccluderMeshes[i]);
        }
      }
    }
    return this.raycastOccluderMeshes;
  }

  public getTargetWorldHitCenter(
    kind: RaycastInteractTarget['kind'],
    subTarget: RaycastInteractTarget['subTarget'] | undefined,
    outVec: THREE.Vector3
  ): boolean {
    if (kind === 'ESCAPE_HELI' && this.heliRoot.visible) {
      this.heliRoot.updateMatrixWorld(true);
      if (subTarget === 'CHAIN') {
        const ch = this.heliChains.find((c) => c.hitMesh.visible);
        if (ch) {
          ch.hitMesh.getWorldPosition(outVec);
          return true;
        }
      }
      this.heliHitMesh.getWorldPosition(outVec);
      outVec.z = 22;
      return true;
    }
    if (kind === 'ESCAPE_LIFEBOAT' && this.boatRoot.visible) {
      this.boatRoot.updateMatrixWorld(true);
      this.boatHitMesh.getWorldPosition(outVec);
      outVec.z = 16;
      return true;
    }
    if (kind === 'ESCAPE_SUBMARINE') {
      if (subTarget === 'LEVER' && this.subLeverRoot.visible) {
        this.subLeverRoot.updateMatrixWorld(true);
        this.subLeverHitMesh.getWorldPosition(outVec);
        outVec.z = 18;
        return true;
      }
      if (this.subRoot.visible) {
        this.subRoot.updateMatrixWorld(true);
        this.subDockHitMesh.getWorldPosition(outVec);
        outVec.z = 12;
        return true;
      }
    }
    return false;
  }

  public updateForFrame(
    engine: MonstrumGameEngine,
    renderDeck: ShipDeck,
    camX: number,
    camY: number,
    halfW: number,
    halfH: number,
    timeSec: number
  ): void {
    if (this.disposed) return;

    const esc = engine.escape;

    // --- 1. DECK 3 HELIDECK ---
    if (renderDeck === 'DECK_3') {
      const hx = this.map.heliPos.x;
      const hy = this.map.heliPos.y;
      const visible = Math.abs(hx - camX) <= halfW + 185 && Math.abs(hy - camY) <= halfH + 185;
      this.heliRoot.visible = visible;
      if (visible) {
        const hasFuel = esc.heliParts.includes('AVIATION_FUEL');
        const hasFuse = esc.heliParts.includes('ROTOR_FUSE');
        const hasKey = esc.heliParts.includes('IGNITION_KEY');
        const ready = esc.heliState === 'READY';
        const activating = esc.heliState === 'ACTIVATING';
        const spool = ready ? 1 : activating ? esc.heliActivationProgress : 0;

        this.heliPadRingMat.uTint.value.setHex(
          ready ? 0x34d399 : esc.heliParts.length === 3 ? 0xfbbf24 : 0xd97706
        );
        this.heliPadRingMat.uEmissive.value.setHex(ready ? 0x10b981 : 0xf59e0b);
        this.heliPadRingMat.uEmissiveStrength.value = ready
          ? 0.65
          : esc.heliParts.length === 3
            ? 0.35
            : 0.08;

        const strobeOn = Math.sin(timeSec * (ready ? 6 : 12)) > 0;
        for (const sMat of this.heliStrobeMats) {
          if (ready || (activating && strobeOn)) {
            sMat.uTint.value.setHex(ready ? 0x34d399 : 0xf59e0b);
            sMat.uEmissive.value.setHex(ready ? 0x34d399 : 0xf59e0b);
            sMat.uEmissiveStrength.value = 0.95;
          } else {
            sMat.uTint.value.setHex(hasFuse ? 0xfbbf24 : 0x334155);
            sMat.uEmissive.value.setHex(0xfbbf24);
            sMat.uEmissiveStrength.value = hasFuse ? 0.35 : 0;
          }
        }

        const vibX = spool > 0.15 ? Math.sin(timeSec * 52) * spool * 0.8 : 0;
        const vibY = spool > 0.15 ? Math.cos(timeSec * 46) * spool * 0.8 : 0;
        this.heliBodyGroup.position.set(
          vibX,
          -vibY,
          ready ? 1.5 + Math.sin(timeSec * 4) * 0.7 : 0
        );

        this.heliFuelEmptyGroup.visible = !hasFuel;
        this.heliFuelFilledGroup.visible = hasFuel;
        this.heliFuseEmptyGroup.visible = !hasFuse;
        this.heliFuseFilledGroup.visible = hasFuse;
        this.heliFuseSparkMesh.visible = !hasFuse && Math.sin(timeSec * 19) > 0.78;
        this.heliAvionicsMesh.visible = hasKey;

        const navOn = hasKey && Math.sin(timeSec * 5) > -0.3;
        this.heliNavPortMat.uEmissiveStrength.value = navOn ? 0.9 : 0;
        this.heliNavStbdMat.uEmissiveStrength.value = navOn ? 0.9 : 0;

        const rotorAng = spool > 0 ? timeSec * (2 + spool * 26) : 0.42;
        this.heliRotorHub.rotation.z = rotorAng;
        this.heliTailRotor.rotation.y = rotorAng * 1.4;
        if (spool > 0.22) {
          this.heliRotorBlurDisc.visible = true;
          this.heliRotorBlurMat.opacity = Math.min(0.28, (spool - 0.22) * 0.38);
        } else {
          this.heliRotorBlurDisc.visible = false;
        }

        const liftZ = this.heliBodyGroup.position.z;
        for (let i = 0; i < this.heliChains.length; i++) {
          const ch = this.heliChains[i];
          const intact = i < esc.heliChainsRemaining;
          ch.bollardCap.material = intact ? this.matYellow.material : this.matSteelMid.material;
          ch.cutStub.visible = !intact;
          ch.heliDangleStub.visible = !intact;
          ch.hitMesh.visible = intact;
          if (intact) {
            const fx = ch.fx + vibX;
            const fy = ch.fy - vibY;
            const fz = ch.fz + liftZ;
            const mx = (fx + ch.bx) * 0.5;
            const my = (fy + ch.by) * 0.5;
            const mz = (fz + ch.bz) * 0.5;
            orientLinkMesh(ch.chainMesh, fx, fy, fz, ch.bx, ch.by, ch.bz);
            ch.hitMesh.position.set(mx, my, mz);
            const tDx = (ch.bx - fx) * 0.12;
            const tDy = (ch.by - fy) * 0.12;
            const tDz = (ch.bz - fz) * 0.12;
            orientLinkMesh(
              ch.turnbuckleMesh,
              mx - tDx,
              my - tDy,
              mz - tDz,
              mx + tDx,
              my + tDy,
              mz + tDz
            );
          } else {
            ch.chainMesh.visible = false;
            ch.turnbuckleMesh.visible = false;
          }
        }
      }
    } else {
      this.heliRoot.visible = false;
    }

    // --- 2. DECK 2 LIFEBOAT ---
    if (renderDeck === 'DECK_2') {
      const bx = this.map.lifeboatPos.x;
      const by = this.map.lifeboatPos.y;
      const visible = Math.abs(bx - camX) <= halfW + 185 && Math.abs(by - camY) <= halfH + 185;
      this.boatRoot.visible = visible;
      if (visible) {
        const hasPatch = esc.lifeboatParts.includes('HULL_PATCH');
        const hasCrank = esc.lifeboatParts.includes('WINCH_CRANK');
        const hasBattery = esc.lifeboatParts.includes('MARINE_BATTERY');
        const ready = esc.lifeboatState === 'READY';
        const activating = esc.lifeboatState === 'ACTIVATING';
        const craneSwing = ready ? 1 : activating ? esc.lifeboatActivationProgress : 0;

        this.boatStatusLedMat.uTint.value.setHex(
          ready ? 0x34d399 : esc.lifeboatParts.length === 3 ? 0x38bdf8 : 0xf59e0b
        );
        this.boatStatusLedMat.uEmissive.value.setHex(
          ready ? 0x10b981 : esc.lifeboatParts.length === 3 ? 0x0284c7 : 0xd97706
        );

        // Luff davit booms outward over ocean edge
        const outDir = -this.boatOutSign;
        const boomPitch = -outDir * (0.1 + craneSwing * 0.56);
        this.boatBoomLeft.rotation.x = boomPitch;
        this.boatBoomRight.rotation.x = boomPitch;

        this.boatCrankGroup.visible = hasCrank;
        if (hasCrank) {
          this.boatCrankGroup.rotation.x = activating ? timeSec * 9 : 0.55;
        }

        this.boatBatteryEmptyMesh.visible = !hasBattery;
        this.boatBatteryFilledGroup.visible = hasBattery;

        // Lifeboat sits cradled cleanly at gunwale edge (outDir * 12) when IDLE, swings out to outDir * 52 when READY
        const swingOutDist = 12 + craneSwing * 40;
        const boatBob = ready ? Math.sin(timeSec * 2.8) * 1.4 : 0;
        const boatLocalY = outDir * swingOutDist - boatBob;
        const boatZ = ready ? 1.5 + Math.sin(timeSec * 2.8) * 1.1 : 6.0 - craneSwing * 4.0;
        this.boatHullGroup.position.set(16, boatLocalY, boatZ);

        this.boatCrackMesh.visible = !hasPatch;
        this.boatPatchGroup.visible = hasPatch;
        this.boatBeaconMat.uTint.value.setHex(ready ? 0x34d399 : hasBattery ? 0x38bdf8 : 0x475569);
        this.boatBeaconMat.uEmissive.value.setHex(ready ? 0x10b981 : 0x0284c7);
        this.boatBeaconMat.uEmissiveStrength.value = ready ? 0.9 : hasBattery ? 0.65 : 0.15;

        // Reorient hoist cables & hydraulic ram piston rods cleanly in boatRoot space
        this.boatRoot.updateMatrixWorld(true);
        this.boatTipSheaveL.getWorldPosition(this.tmpV1);
        this.boatRoot.worldToLocal(this.tmpV1);
        orientLinkMesh(
          this.boatCableL,
          -14,
          boatLocalY,
          boatZ + 18,
          this.tmpV1.x,
          this.tmpV1.y,
          this.tmpV1.z
        );

        this.boatTipSheaveR.getWorldPosition(this.tmpV2);
        this.boatRoot.worldToLocal(this.tmpV2);
        orientLinkMesh(
          this.boatCableR,
          46,
          boatLocalY,
          boatZ + 18,
          this.tmpV2.x,
          this.tmpV2.y,
          this.tmpV2.z
        );

        this.boatBoomRamPinL.getWorldPosition(this.tmpV1);
        this.boatRoot.worldToLocal(this.tmpV1);
        orientAxisZ(
          this.boatRamCylL,
          this.boatRamAnchorL.x,
          this.boatRamAnchorL.y,
          this.boatRamAnchorL.z,
          this.tmpV1.x,
          this.tmpV1.y,
          this.tmpV1.z
        );
        orientLinkMesh(
          this.boatRamRodL,
          this.boatRamAnchorL.x,
          this.boatRamAnchorL.y,
          this.boatRamAnchorL.z,
          this.tmpV1.x,
          this.tmpV1.y,
          this.tmpV1.z
        );

        this.boatBoomRamPinR.getWorldPosition(this.tmpV2);
        this.boatRoot.worldToLocal(this.tmpV2);
        orientAxisZ(
          this.boatRamCylR,
          this.boatRamAnchorR.x,
          this.boatRamAnchorR.y,
          this.boatRamAnchorR.z,
          this.tmpV2.x,
          this.tmpV2.y,
          this.tmpV2.z
        );
        orientLinkMesh(
          this.boatRamRodR,
          this.boatRamAnchorR.x,
          this.boatRamAnchorR.y,
          this.boatRamAnchorR.z,
          this.tmpV2.x,
          this.tmpV2.y,
          this.tmpV2.z
        );
      }
    } else {
      this.boatRoot.visible = false;
    }

    // --- 3. DECK 1 SUBMARINE ---
    if (renderDeck === 'DECK_1') {
      const subPos = this.map.submarinePos;
      const sx = subPos.x;
      const sy = subPos.y;
      const visible = Math.abs(sx - camX) <= halfW + 270 && Math.abs(sy - camY) <= halfH + 270;
      this.subRoot.visible = visible;
      this.subLeverRoot.visible = visible;

      if (visible) {
        const hasSubBat = esc.submarineParts.includes('SUB_BATTERY');
        const hasBallast = esc.submarineParts.includes('BALLAST_PUMP');
        const hasDiveKey = esc.submarineParts.includes('DIVE_KEY');
        const ready = esc.submarineState === 'READY';
        const activating = esc.submarineState === 'ACTIVATING';

        this.subPoolStatusMat.uTint.value.setHex(
          ready ? 0x34d399 : esc.submarineParts.length === 3 ? 0x2dd4bf : 0x0d9488
        );
        this.subPoolStatusMat.uEmissive.value.setHex(ready ? 0x10b981 : 0x0d9488);
        this.subPoolStatusMat.uEmissiveStrength.value = ready ? 0.85 : activating ? 0.55 : 0.3;

        // Subtle scrolling caustics + gentle bobbing wake ring
        this.subWaterTex.offset.set(
          Math.sin(timeSec * 0.28) * 0.04,
          (timeSec * (activating ? 0.14 : 0.04)) % 1
        );
        this.subWaterMat.opacity = ready ? 0.86 : 0.76;
        this.subWaterMesh.position.z = -5.0 + Math.sin(timeSec * (activating ? 5 : 1.8)) * 0.6;
        const wakePulse = ready ? 0.85 : activating ? 0.65 : 0.42;
        this.subWakeRingMat.opacity = wakePulse + Math.sin(timeSec * 3.2) * 0.08;
        const wakeScale = 1 + Math.sin(timeSec * 2.4) * 0.03;
        this.subWakeRing.scale.set(wakeScale, wakeScale, 1);

        const riseZ = ready
          ? Math.sin(timeSec * 2.8) * 1.4 + 2.0
          : activating
            ? esc.submarineActivationProgress * 2.6 - 1.2
            : -2.0;
        const hullBobY = ready ? -Math.sin(timeSec * 2.8) * 1.8 : 0;
        this.subHullGroup.position.set(0, hullBobY, riseZ);

        this.subBatteryEmpty.visible = !hasSubBat;
        this.subBatteryFilled.visible = hasSubBat;
        this.subBallastEmpty.visible = !hasBallast;
        this.subBallastFilled.visible = hasBallast;
        if (hasBallast) {
          this.subImpeller.rotation.z = timeSec * (ready ? 14 : activating ? 10 : 3);
        }
        if (ready || activating) {
          this.subPropellerGroup.rotation.y = timeSec * (ready ? 18 : 10);
        }

        if (hasDiveKey) {
          this.subDiveKeyMat.uTint.value.setHex(0x34d399);
          this.subDiveKeyMat.uEmissive.value.setHex(0x10b981);
          this.subDiveKeyMat.uEmissiveStrength.value = 0.85;
          this.subBowLightMat.uEmissiveStrength.value = 0.75;
        } else {
          this.subDiveKeyMat.uTint.value.setHex(0x1e293b);
          this.subDiveKeyMat.uEmissiveStrength.value = 0;
          this.subBowLightMat.uEmissiveStrength.value = 0.25;
        }

        const leverThrown = esc.submarineState !== 'IDLE';
        this.subLeverArmGroup.rotation.x = leverThrown ? 0.62 : -0.62;
        const statusHex = ready ? 0x34d399 : esc.submarineParts.length === 3 ? 0xf59e0b : 0xef4444;
        this.subLeverHandleMat.uTint.value.setHex(statusHex);
        this.subLeverHandleMat.uEmissive.value.setHex(statusHex);
        this.subLeverLampMat.uTint.value.setHex(statusHex);
        this.subLeverLampMat.uEmissive.value.setHex(statusHex);
      }
    } else {
      this.subRoot.visible = false;
      this.subLeverRoot.visible = false;
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.worldScene.remove(this.heliRoot);
    this.worldScene.remove(this.boatRoot);
    this.worldScene.remove(this.subRoot);
    this.worldScene.remove(this.subLeverRoot);

    for (const g of this.sharedGeoms) g.dispose();
    this.sharedGeoms = [];
    for (const m of this.sharedMats) m.material.dispose();
    this.sharedMats = [];
    for (const m of this.basicMats) m.dispose();
    this.basicMats = [];
    for (const t of this.sharedTexs) t.dispose();
    this.sharedTexs = [];
  }
}
