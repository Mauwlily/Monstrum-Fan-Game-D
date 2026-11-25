import * as THREE from 'three/webgpu';
import { MonstrumGameEngine } from './engine';
import {
  createShadedCharacterMaterial,
  ShadedCharacterMaterialBundle,
} from './threeTsl';
import { ShipDeck, ShipMap } from './types';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Unable to create offscreen character canvas');
  return [c, ctx];
}

function makeSoftRadialTexture(
  size: number,
  stops: Array<[number, string]>
): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  const r = size * 0.5;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  for (const [offset, color] of stops) {
    g.addColorStop(offset, color);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function makeJacketTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#2c5588');
  g.addColorStop(0.5, '#1e3a5f');
  g.addColorStop(1, '#14263f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  // Subtle heavy canvas weave + stitched seams
  ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
  for (let y = 0; y < 128; y += 6) {
    ctx.fillRect(0, y, 128, 1);
  }
  ctx.fillStyle = 'rgba(15, 23, 42, 0.42)';
  ctx.fillRect(0, 92, 128, 4);
  ctx.fillRect(62, 0, 4, 128);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.fillRect(0, 4, 128, 3);

  ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 44, 30, 26);
  ctx.strokeRect(82, 44, 30, 26);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function makeHardHatTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(28, 24, 2, 32, 32, 32);
  g.addColorStop(0, '#8596ad');
  g.addColorStop(0.58, '#4f5f75');
  g.addColorStop(1, '#222e42');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);

  ctx.fillStyle = 'rgba(226, 232, 240, 0.18)';
  ctx.fillRect(29, 4, 6, 56);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.24)';
  ctx.fillRect(26, 4, 2, 56);
  ctx.fillRect(36, 4, 2, 56);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function makeBruteArmorTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#f0eae6');
  g.addColorStop(0.55, '#b8aea7');
  g.addColorStop(1, '#6f6560');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  // Forged boiler-plate seams & welded grooves
  ctx.fillStyle = 'rgba(8, 5, 4, 0.48)';
  ctx.fillRect(0, 40, 128, 3);
  ctx.fillRect(0, 84, 128, 3);
  ctx.fillRect(62, 0, 3, 128);

  ctx.fillStyle = 'rgba(255, 237, 213, 0.12)';
  ctx.fillRect(0, 43, 128, 2);
  ctx.fillRect(0, 87, 128, 2);

  let s = 913;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 64; i++) {
    const x = rng() * 128;
    const y = rng() * 128;
    ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.34)';
    ctx.fillRect(x, y, 4 + rng() * 18, 1.4);
  }
  for (let rx = 12; rx < 128; rx += 24) {
    for (const ry of [12, 34, 52, 78, 96, 116]) {
      ctx.fillStyle = 'rgba(0,0,0,0.58)';
      ctx.beginPath();
      ctx.arc(rx + 0.9, ry + 0.9, 2.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(203,213,225,0.34)';
      ctx.beginPath();
      ctx.arc(rx, ry, 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function makeFurnaceGrateTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, '#fff7ed');
  g.addColorStop(0.32, '#fdba74');
  g.addColorStop(0.68, '#ea580c');
  g.addColorStop(1, '#5a1b08');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);

  // Heavy vertical & horizontal boiler grate bars
  ctx.fillStyle = 'rgba(14, 8, 7, 0.9)';
  for (let x = 9; x < 60; x += 12) {
    ctx.fillRect(x, 0, 3.5, 64);
  }
  ctx.fillRect(0, 0, 64, 5);
  ctx.fillRect(0, 59, 64, 5);
  ctx.fillRect(0, 29, 64, 4);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Elliptical tapered cylinder aligned along local Z (-height/2 .. +height/2)
 */
function makeTaperedCylinder(
  rTopX: number,
  rTopY: number,
  rBotX: number,
  rBotY: number,
  height: number,
  radialSegments = 12
): THREE.BufferGeometry {
  const geom = new THREE.CylinderGeometry(1, 1, height, radialSegments, 1, false);
  geom.rotateX(Math.PI / 2); // Align cylinder length along Z axis
  const pos = geom.attributes.position;
  const halfH = height * 0.5;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = halfH > 1e-4 ? (z + halfH) / height : 0.5;
    const rx = rBotX + (rTopX - rBotX) * t;
    const ry = rBotY + (rTopY - rBotY) * t;
    pos.setXY(i, x * rx, y * ry);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

/**
 * Beveled extruded shape centered along local Z
 */
function makeBeveledShapeGeom(
  buildShape: (shape: THREE.Shape) => void,
  depth: number,
  bevelThickness = 0.7,
  bevelSize = 0.65,
  bevelSegments = 2,
  curveSegments = 8
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  buildShape(shape);
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevelThickness > 0 && bevelSize > 0,
    bevelThickness,
    bevelSize,
    bevelSegments,
    curveSegments,
  });
  geom.translate(0, 0, -depth * 0.5);
  geom.computeVertexNormals();
  return geom;
}

/**
 * True tapered 3D curved predator scythe talon pointing down (-Z) and hooking forward (+X)
 */
function makeHookedTalonGeom(length = 7.2, baseRadius = 1.25, forwardHook = 4.2): THREE.BufferGeometry {
  const segsAlong = 10;
  const segsAround = 6;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segsAlong; i++) {
    const t = i / segsAlong;
    const cx = Math.pow(t, 1.85) * forwardHook;
    const cz = -Math.sin(t * Math.PI * 0.48) * length;
    const r = baseRadius * Math.pow(1 - t, 0.78) + 0.03;
    const rx = r * 1.15;
    const ry = r * 0.62;

    // Local tangent tilt for cross-section orientation along hook curve
    const dx = 1.85 * Math.pow(Math.max(t, 0.01), 0.85) * forwardHook;
    const dz = -Math.cos(t * Math.PI * 0.48) * (Math.PI * 0.48) * length;
    const tangAngle = Math.atan2(dx, -dz);
    const cosA = Math.cos(tangAngle);
    const sinA = Math.sin(tangAngle);

    for (let j = 0; j <= segsAround; j++) {
      const a = (j / segsAround) * Math.PI * 2;
      const lx = Math.cos(a) * rx;
      const ly = Math.sin(a) * ry;
      const vx = cx + lx * cosA;
      const vz = cz + lx * sinA;
      positions.push(vx, ly, vz);
      uvs.push(j / segsAround, t);
    }
  }

  const stride = segsAround + 1;
  for (let i = 0; i < segsAlong; i++) {
    for (let j = 0; j < segsAround; j++) {
      const a = i * stride + j;
      const b = a + stride;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

export interface BruteGleamAnchors {
  valid: boolean;
  isChasing: boolean;
  isStalking: boolean;
  browX: number;
  browY: number;
  browZ: number;
  leftEyeX: number;
  leftEyeY: number;
  leftEyeZ: number;
  rightEyeX: number;
  rightEyeY: number;
  rightEyeZ: number;
  chestX: number;
  chestY: number;
  chestZ: number;
}

export class ShipCharacters3D {
  private disposed = false;
  private debugWireframe = false;

  private sharedGeoms: THREE.BufferGeometry[] = [];
  private sharedTextures: THREE.Texture[] = [];
  private sharedMaterials: THREE.Material[] = [];
  private wireMaterials: THREE.MeshBasicNodeMaterial[] = [];

  // Player Rig (~34px standing, ~23px crouching)
  private playerRoot = new THREE.Group();
  private playerShadow!: THREE.Mesh;
  private playerPelvis = new THREE.Group();
  private playerLeftLegHip = new THREE.Group();
  private playerLeftKnee = new THREE.Group();
  private playerLeftAnkle = new THREE.Group();
  private playerRightLegHip = new THREE.Group();
  private playerRightKnee = new THREE.Group();
  private playerRightAnkle = new THREE.Group();
  private playerSpine = new THREE.Group();
  private playerTorsoGroup = new THREE.Group();
  private playerSatchelGroup = new THREE.Group();
  private playerBackpackGroup = new THREE.Group();
  private playerLeftArm = new THREE.Group();
  private playerLeftElbow = new THREE.Group();
  private playerRightArm = new THREE.Group();
  private playerRightElbow = new THREE.Group();
  private playerHead = new THREE.Group();
  private playerSatchelClaspBundle!: ShadedCharacterMaterialBundle;
  private playerTorchLensBundle!: ShadedCharacterMaterialBundle;
  private playerTorchGlowMesh!: THREE.Mesh;
  private playerTorchGlowMat!: THREE.MeshBasicMaterial;

  // Brute Rig (~44px standing, ~40px stalking hunch)
  private bruteRoot = new THREE.Group();
  private bruteShadow!: THREE.Mesh;
  private brutePelvis = new THREE.Group();
  private bruteLeftLegHip = new THREE.Group();
  private bruteLeftKnee = new THREE.Group();
  private bruteLeftAnkle = new THREE.Group();
  private bruteRightLegHip = new THREE.Group();
  private bruteRightKnee = new THREE.Group();
  private bruteRightAnkle = new THREE.Group();
  private bruteSpine = new THREE.Group();
  private bruteHead = new THREE.Group();
  private bruteLeftArm = new THREE.Group();
  private bruteLeftElbow = new THREE.Group();
  private bruteRightArm = new THREE.Group();
  private bruteRightElbow = new THREE.Group();

  private bruteHullBundle!: ShadedCharacterMaterialBundle;
  private bruteTrimBundle!: ShadedCharacterMaterialBundle;
  private brutePauldronBundle!: ShadedCharacterMaterialBundle;
  private brutePauldronRimBundle!: ShadedCharacterMaterialBundle;
  private bruteGauntletBundle!: ShadedCharacterMaterialBundle;
  private bruteGauntletRimBundle!: ShadedCharacterMaterialBundle;
  private bruteHelmBundle!: ShadedCharacterMaterialBundle;
  private bruteHelmTrimBundle!: ShadedCharacterMaterialBundle;
  private bruteClawBundle!: ShadedCharacterMaterialBundle;
  private bruteFurnaceBundle!: ShadedCharacterMaterialBundle;
  private bruteEyeBundle!: ShadedCharacterMaterialBundle;
  private bruteLeftEyeMesh!: THREE.Mesh;
  private bruteRightEyeMesh!: THREE.Mesh;

  // Anchors for exact 3D post-darkness LoS gleam projection
  private bruteBrowAnchor = new THREE.Object3D();
  private bruteLeftEyeAnchor = new THREE.Object3D();
  private bruteRightEyeAnchor = new THREE.Object3D();
  private bruteChestCoreAnchor = new THREE.Object3D();
  private bruteGleam: BruteGleamAnchors = {
    valid: false,
    isChasing: false,
    isStalking: false,
    browX: 0,
    browY: 0,
    browZ: 36,
    leftEyeX: 0,
    leftEyeY: 0,
    leftEyeZ: 36,
    rightEyeX: 0,
    rightEyeY: 0,
    rightEyeZ: 36,
    chestX: 0,
    chestY: 0,
    chestZ: 27,
  };

  // Smooth crouch interpolation
  private playerCrouchBlend = 0;
  private bruteCrouchBlend = 0;
  private tmpVec3 = new THREE.Vector3();
  private tmpColorA = new THREE.Color();
  private tmpColorB = new THREE.Color();

  constructor(private worldScene: THREE.Scene, anisotropy: number) {
    this.buildPlayerRig(anisotropy);
    this.buildBruteRig(anisotropy);

    this.setRenderOrderRecursive(this.playerRoot, 12);
    this.setRenderOrderRecursive(this.bruteRoot, 13);

    this.playerRoot.visible = false;
    this.bruteRoot.visible = false;
    this.playerRoot.frustumCulled = false;
    this.bruteRoot.frustumCulled = false;

    this.worldScene.add(this.playerRoot);
    this.worldScene.add(this.bruteRoot);
  }

  private trackGeom<T extends THREE.BufferGeometry>(g: T): T {
    this.sharedGeoms.push(g);
    return g;
  }

  private trackTex<T extends THREE.Texture>(t: T): T {
    this.sharedTextures.push(t);
    return t;
  }

  private makeShadedMat(
    opts: Parameters<typeof createShadedCharacterMaterial>[0],
    allowWireframe = true
  ): ShadedCharacterMaterialBundle {
    const bundle = createShadedCharacterMaterial(opts);
    this.sharedMaterials.push(bundle.material);
    if (allowWireframe) {
      this.wireMaterials.push(bundle.material);
    }
    return bundle;
  }

  private makeUnshadedMat(
    params: THREE.MeshBasicMaterialParameters
  ): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({
      depthTest: true,
      depthWrite: true,
      ...params,
    });
    this.sharedMaterials.push(m);
    return m;
  }

  private setRenderOrderRecursive(obj: THREE.Object3D, order: number): void {
    obj.traverse((child) => {
      child.renderOrder = order;
      child.frustumCulled = false;
    });
  }

  public setDebugWireframe(enabled: boolean): void {
    if (this.debugWireframe === enabled) return;
    this.debugWireframe = enabled;
    for (const m of this.wireMaterials) {
      m.wireframe = enabled;
      m.needsUpdate = true;
    }
  }

  private buildPlayerRig(anisotropy: number): void {
    const shadowTex = this.trackTex(
      makeSoftRadialTexture(64, [
        [0, 'rgba(0, 0, 0, 0.64)'],
        [0.62, 'rgba(0, 0, 0, 0.34)'],
        [1, 'rgba(0, 0, 0, 0)'],
      ])
    );
    const torchGlowTex = this.trackTex(
      makeSoftRadialTexture(64, [
        [0, 'rgba(254, 249, 195, 0.95)'],
        [0.45, 'rgba(254, 240, 138, 0.42)'],
        [1, 'rgba(253, 224, 71, 0)'],
      ])
    );
    const jacketTex = this.trackTex(makeJacketTexture(anisotropy));
    const hardHatTex = this.trackTex(makeHardHatTexture(anisotropy));

    const jacketMat = this.makeShadedMat({
      map: jacketTex,
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.08,
    }).material;
    const jacketDarkMat = this.makeShadedMat({
      color: 0x152842,
      roughness: 0.76,
      metalness: 0.08,
    }).material;
    const safetyOrangeMat = this.makeShadedMat({
      color: 0xea7a28,
      roughness: 0.55,
      metalness: 0.12,
    }).material;
    const cargoPantsMat = this.makeShadedMat({
      color: 0x1e293b,
      roughness: 0.8,
      metalness: 0.06,
    }).material;
    const bootMat = this.makeShadedMat({
      color: 0x0f172a,
      roughness: 0.62,
      metalness: 0.15,
    }).material;
    const toeCapMat = this.makeShadedMat({
      color: 0x334155,
      roughness: 0.4,
      metalness: 0.45,
    }).material;
    const skinMat = this.makeShadedMat({
      color: 0xcfa987,
      roughness: 0.68,
      metalness: 0.04,
    }).material;
    const gloveMat = this.makeShadedMat({
      color: 0x3b4859,
      roughness: 0.72,
      metalness: 0.1,
    }).material;
    const hardHatDomeMat = this.makeShadedMat({
      map: hardHatTex,
      color: 0xffffff,
      roughness: 0.34,
      metalness: 0.28,
    }).material;
    const hardHatRimMat = this.makeShadedMat({
      color: 0x1e293b,
      roughness: 0.45,
      metalness: 0.25,
    }).material;
    const hardHatVisorMat = this.makeShadedMat({
      color: 0x475569,
      roughness: 0.38,
      metalness: 0.35,
    }).material;

    const satchelBodyMat = this.makeShadedMat({
      color: 0x1f2d27,
      roughness: 0.78,
      metalness: 0.08,
    }).material;
    const satchelFlapMat = this.makeShadedMat({
      color: 0x2d3f37,
      roughness: 0.74,
      metalness: 0.1,
    }).material;
    this.playerSatchelClaspBundle = this.makeShadedMat({
      color: 0x475569,
      roughness: 0.32,
      metalness: 0.65,
    });

    const packShellMat = this.makeShadedMat({
      color: 0x7c2d12,
      roughness: 0.72,
      metalness: 0.1,
    }).material;
    const packPouchMat = this.makeShadedMat({
      color: 0xb84010,
      roughness: 0.68,
      metalness: 0.1,
    }).material;
    const packFrameMat = this.makeShadedMat({
      color: 0x334155,
      roughness: 0.42,
      metalness: 0.55,
    }).material;

    const torchBodyMat = this.makeShadedMat({
      color: 0x2c3849,
      roughness: 0.36,
      metalness: 0.68,
    }).material;
    const torchBezelMat = this.makeShadedMat({
      color: 0x94a3b8,
      roughness: 0.22,
      metalness: 0.85,
    }).material;
    this.playerTorchLensBundle = this.makeShadedMat({
      color: 0x1e293b,
      roughness: 0.18,
      metalness: 0.2,
      emissiveColor: 0xfef08a,
      emissiveStrength: 0.0,
    });

    const shadowMat = this.makeUnshadedMat({
      map: shadowTex,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    this.playerTorchGlowMat = this.makeUnshadedMat({
      map: torchGlowTex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // 1. Contact floor shadow
    const shadowGeom = this.trackGeom(new THREE.PlaneGeometry(24, 28));
    this.playerShadow = new THREE.Mesh(shadowGeom, shadowMat);
    this.playerShadow.position.set(-0.8, 0, 0.25);
    this.playerRoot.add(this.playerShadow);

    // 2. Contoured Pelvis & Utility Belt
    this.playerPelvis.position.set(0, 0, 15.0);
    this.playerRoot.add(this.playerPelvis);

    const waistGeom = this.trackGeom(makeTaperedCylinder(4.7, 7.0, 4.9, 7.2, 3.6, 12));
    const waistMesh = new THREE.Mesh(waistGeom, jacketDarkMat);
    waistMesh.position.set(0, 0, 0.8);
    this.playerPelvis.add(waistMesh);

    const beltGeom = this.trackGeom(makeTaperedCylinder(5.05, 7.35, 5.05, 7.35, 1.35, 12));
    const beltMesh = new THREE.Mesh(beltGeom, bootMat);
    beltMesh.position.set(0, 0, 0.35);
    const beltBuckle = new THREE.Mesh(
      this.trackGeom(
        makeBeveledShapeGeom((s) => {
          s.moveTo(-1.4, -1.0);
          s.lineTo(1.4, -1.0);
          s.lineTo(1.4, 1.0);
          s.lineTo(-1.4, 1.0);
          s.closePath();
        }, 0.8, 0.25, 0.2, 1)
      ),
      toeCapMat
    );
    beltBuckle.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    beltBuckle.position.set(4.95, 0, 0.35);
    this.playerPelvis.add(beltMesh, beltBuckle);

    // 3. Sculpted Legs (thigh 7.4 + calf 7.6 = 15.0 standing)
    const thighGeom = this.trackGeom(makeTaperedCylinder(2.55, 2.65, 2.15, 2.25, 7.6, 10));
    const kneePadGeom = this.trackGeom(new THREE.SphereGeometry(2.15, 10, 8));
    const calfGeom = this.trackGeom(makeTaperedCylinder(2.2, 2.25, 1.75, 1.85, 6.4, 10));
    const bootShaftGeom = this.trackGeom(makeTaperedCylinder(2.15, 2.0, 2.4, 2.15, 2.6, 10));
    const bootSoleGeom = this.trackGeom(
      makeBeveledShapeGeom((s) => {
        s.moveTo(-2.3, -2.0);
        s.lineTo(3.3, -1.85);
        s.quadraticCurveTo(4.6, 0, 3.3, 1.85);
        s.lineTo(-2.3, 2.0);
        s.quadraticCurveTo(-3.0, 0, -2.3, -2.0);
        s.closePath();
      }, 1.45, 0.38, 0.35, 1, 8)
    );
    const toeGeom = this.trackGeom(new THREE.SphereGeometry(1.75, 10, 8));

    const setupLeg = (
      hip: THREE.Group,
      knee: THREE.Group,
      ankle: THREE.Group,
      yOffset: number
    ) => {
      hip.position.set(0, yOffset, 0);
      this.playerPelvis.add(hip);

      const thigh = new THREE.Mesh(thighGeom, cargoPantsMat);
      thigh.position.set(0, 0, -3.7);
      hip.add(thigh);

      knee.position.set(0, 0, -7.4);
      hip.add(knee);

      const kneeCap = new THREE.Mesh(kneePadGeom, cargoPantsMat);
      kneeCap.scale.set(1.05, 0.96, 1.0);
      kneeCap.position.set(0.2, 0, 0);

      const calf = new THREE.Mesh(calfGeom, cargoPantsMat);
      calf.position.set(0, 0, -3.0);
      knee.add(kneeCap, calf);

      ankle.position.set(0, 0, -7.6);
      knee.add(ankle);

      const bootShaft = new THREE.Mesh(bootShaftGeom, bootMat);
      bootShaft.position.set(0, 0, 1.9);
      const bootSole = new THREE.Mesh(bootSoleGeom, bootMat);
      bootSole.position.set(0.7, 0, 0.9);
      const toe = new THREE.Mesh(toeGeom, toeCapMat);
      toe.scale.set(1.2, 0.95, 0.72);
      toe.position.set(3.1, 0, 1.05);
      ankle.add(bootShaft, bootSole, toe);
    };

    setupLeg(this.playerLeftLegHip, this.playerLeftKnee, this.playerLeftAnkle, 3.6);
    setupLeg(this.playerRightLegHip, this.playerRightKnee, this.playerRightAnkle, -3.6);

    // 4. Spine & Contoured Foul-Weather Jacket Torso
    this.playerSpine.position.set(0, 0, 1.8);
    this.playerPelvis.add(this.playerSpine);
    this.playerSpine.add(this.playerTorsoGroup);

    const torsoHullGeom = this.trackGeom(makeTaperedCylinder(5.45, 8.75, 4.75, 7.15, 11.4, 14));
    const torsoMesh = new THREE.Mesh(torsoHullGeom, jacketMat);
    torsoMesh.position.set(0, 0, 5.7);
    this.playerTorsoGroup.add(torsoMesh);

    // Draped rounded shoulder yoke
    const shoulderYokeGeom = this.trackGeom(new THREE.SphereGeometry(5.3, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5));
    shoulderYokeGeom.rotateX(Math.PI / 2);
    const yokeMesh = new THREE.Mesh(shoulderYokeGeom, jacketDarkMat);
    yokeMesh.scale.set(1.02, 1.66, 0.42);
    yokeMesh.position.set(0, 0, 10.0);
    this.playerTorsoGroup.add(yokeMesh);

    const hemGeom = this.trackGeom(makeTaperedCylinder(5.1, 7.45, 5.3, 7.75, 2.7, 14));
    const hemMesh = new THREE.Mesh(hemGeom, jacketDarkMat);
    hemMesh.position.set(-0.05, 0, 1.35);
    this.playerTorsoGroup.add(hemMesh);

    const collarGeom = this.trackGeom(makeTaperedCylinder(3.9, 4.3, 4.4, 4.8, 2.1, 14));
    const collarMesh = new THREE.Mesh(collarGeom, jacketDarkMat);
    collarMesh.position.set(0.3, 0, 11.4);
    this.playerTorsoGroup.add(collarMesh);

    const placketGeom = this.trackGeom(
      makeBeveledShapeGeom((s) => {
        s.moveTo(-1.2, -4.8);
        s.lineTo(1.2, -4.8);
        s.lineTo(1.2, 4.8);
        s.lineTo(-1.2, 4.8);
        s.closePath();
      }, 0.9, 0.25, 0.25, 1)
    );
    const placketMesh = new THREE.Mesh(placketGeom, jacketDarkMat);
    placketMesh.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    placketMesh.position.set(4.85, 0, 5.8);
    this.playerTorsoGroup.add(placketMesh);

    // High-vis curved shoulder reflective bands
    const stripeGeom = this.trackGeom(
      makeBeveledShapeGeom((s) => {
        s.moveTo(-3.1, -1.05);
        s.lineTo(3.1, -1.05);
        s.quadraticCurveTo(3.6, 0, 3.1, 1.05);
        s.lineTo(-3.1, 1.05);
        s.quadraticCurveTo(-3.6, 0, -3.1, -1.05);
        s.closePath();
      }, 0.8, 0.25, 0.2, 1)
    );
    const leftStripe = new THREE.Mesh(stripeGeom, safetyOrangeMat);
    leftStripe.position.set(0.1, 6.5, 11.45);
    leftStripe.rotation.set(0.18, 0, -0.14);
    const rightStripe = new THREE.Mesh(stripeGeom, safetyOrangeMat);
    rightStripe.position.set(0.1, -6.5, 11.45);
    rightStripe.rotation.set(-0.18, 0, 0.14);
    this.playerTorsoGroup.add(leftStripe, rightStripe);

    // 5. Back Gear: Sculpted Satchel vs Crew Backpack
    this.playerSatchelGroup.position.set(-6.0, 0, 4.5);
    this.playerSpine.add(this.playerSatchelGroup);

    const satchelBody = new THREE.Mesh(
      this.trackGeom(
        makeBeveledShapeGeom((s) => {
          s.moveTo(-5.4, -3.3);
          s.lineTo(5.4, -3.3);
          s.quadraticCurveTo(6.1, 0, 5.4, 3.3);
          s.lineTo(-5.4, 3.3);
          s.quadraticCurveTo(-6.1, 0, -5.4, -3.3);
          s.closePath();
        }, 3.6, 0.45, 0.45, 2)
      ),
      satchelBodyMat
    );
    satchelBody.rotation.set(Math.PI / 2, Math.PI / 2, 0);

    const satchelFlap = new THREE.Mesh(
      this.trackGeom(
        makeBeveledShapeGeom((s) => {
          s.moveTo(-4.8, -2.2);
          s.lineTo(4.8, -2.2);
          s.lineTo(4.4, 2.2);
          s.lineTo(-4.4, 2.2);
          s.closePath();
        }, 1.4, 0.35, 0.3, 1)
      ),
      satchelFlapMat
    );
    satchelFlap.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    satchelFlap.position.set(-1.55, 0, 0.45);

    const satchelClasp = new THREE.Mesh(
      this.trackGeom(
        makeBeveledShapeGeom((s) => {
          s.moveTo(-4.8, -0.7);
          s.lineTo(4.8, -0.7);
          s.lineTo(4.8, 0.7);
          s.lineTo(-4.8, 0.7);
          s.closePath();
        }, 0.9, 0.2, 0.2, 1)
      ),
      this.playerSatchelClaspBundle.material
    );
    satchelClasp.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    satchelClasp.position.set(-2.2, 0, -0.15);
    this.playerSatchelGroup.add(satchelBody, satchelFlap, satchelClasp);

    this.playerBackpackGroup.position.set(-6.6, 0, 6.2);
    this.playerSpine.add(this.playerBackpackGroup);

    const packFrame = new THREE.Mesh(
      this.trackGeom(
        makeBeveledShapeGeom((s) => {
          s.moveTo(-5.8, -5.4);
          s.lineTo(5.8, -5.4);
          s.lineTo(5.8, 5.4);
          s.lineTo(-5.8, 5.4);
          s.closePath();
        }, 1.6, 0.35, 0.35, 1)
      ),
      packFrameMat
    );
    packFrame.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    packFrame.position.set(0.6, 0, 0);

    const packShell = new THREE.Mesh(
      this.trackGeom(
        makeBeveledShapeGeom((s) => {
          s.moveTo(-7.2, -4.8);
          s.lineTo(7.2, -4.8);
          s.quadraticCurveTo(8.0, 0, 7.2, 4.8);
          s.lineTo(-7.2, 4.8);
          s.quadraticCurveTo(-8.0, 0, -7.2, -4.8);
          s.closePath();
        }, 5.2, 0.75, 0.7, 2)
      ),
      packShellMat
    );
    packShell.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    packShell.position.set(-1.9, 0, -0.1);

    const packPouch = new THREE.Mesh(
      this.trackGeom(
        makeBeveledShapeGeom((s) => {
          s.moveTo(-5.6, -3.0);
          s.lineTo(5.6, -3.0);
          s.quadraticCurveTo(6.2, 0, 5.6, 3.0);
          s.lineTo(-5.6, 3.0);
          s.quadraticCurveTo(-6.2, 0, -5.6, -3.0);
          s.closePath();
        }, 2.4, 0.45, 0.45, 2)
      ),
      packPouchMat
    );
    packPouch.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    packPouch.position.set(-4.35, 0, -1.0);

    const packRollGeom = this.trackGeom(new THREE.CylinderGeometry(1.85, 1.85, 14.4, 12));
    const packRoll = new THREE.Mesh(packRollGeom, safetyOrangeMat);
    packRoll.position.set(-2.2, 0, 5.7);

    const packStrapGeom = this.trackGeom(new THREE.TorusGeometry(4.2, 0.65, 6, 14, Math.PI * 1.4));
    const packStrapL = new THREE.Mesh(packStrapGeom, safetyOrangeMat);
    packStrapL.scale.set(0.65, 1.25, 0.85);
    packStrapL.position.set(-1.8, 4.3, 0);
    const packStrapR = new THREE.Mesh(packStrapGeom, safetyOrangeMat);
    packStrapR.scale.set(0.65, 1.25, 0.85);
    packStrapR.position.set(-1.8, -4.3, 0);
    this.playerBackpackGroup.add(packFrame, packShell, packPouch, packRoll, packStrapL, packStrapR);
    this.playerBackpackGroup.visible = false;

    // 6. Rounded Articulated Arms + Sculpted Gloves + Right Torch
    const shoulderGeom = this.trackGeom(new THREE.SphereGeometry(2.55, 10, 8));
    const upperArmGeom = this.trackGeom(makeTaperedCylinder(2.3, 2.3, 1.95, 1.95, 5.8, 10));
    const elbowCapGeom = this.trackGeom(new THREE.SphereGeometry(1.95, 10, 8));
    const forearmGeom = this.trackGeom(makeTaperedCylinder(2.0, 2.0, 1.65, 1.65, 5.3, 10));
    const handGeom = this.trackGeom(new THREE.SphereGeometry(1.95, 10, 8));

    this.playerLeftArm.position.set(0.2, 9.6, 9.9);
    this.playerSpine.add(this.playerLeftArm);
    const lSh = new THREE.Mesh(shoulderGeom, jacketMat);
    const lUpper = new THREE.Mesh(upperArmGeom, jacketMat);
    lUpper.position.set(0, 0, -2.9);
    this.playerLeftArm.add(lSh, lUpper);

    this.playerLeftElbow.position.set(0, 0, -5.6);
    this.playerLeftArm.add(this.playerLeftElbow);
    const lElbow = new THREE.Mesh(elbowCapGeom, jacketDarkMat);
    const lFore = new THREE.Mesh(forearmGeom, jacketMat);
    lFore.position.set(0, 0, -2.6);
    const lHand = new THREE.Mesh(handGeom, gloveMat);
    lHand.scale.set(1.1, 0.88, 1.15);
    lHand.position.set(0.2, 0, -5.5);
    this.playerLeftElbow.add(lElbow, lFore, lHand);

    this.playerRightArm.position.set(0.2, -9.4, 9.9);
    this.playerSpine.add(this.playerRightArm);
    const rSh = new THREE.Mesh(shoulderGeom, jacketMat);
    const rUpper = new THREE.Mesh(upperArmGeom, jacketMat);
    rUpper.position.set(0, 0, -2.9);
    this.playerRightArm.add(rSh, rUpper);

    this.playerRightElbow.position.set(0, 0, -5.6);
    this.playerRightArm.add(this.playerRightElbow);
    const rElbow = new THREE.Mesh(elbowCapGeom, jacketDarkMat);
    const rFore = new THREE.Mesh(forearmGeom, jacketMat);
    rFore.position.set(0, 0, -2.6);
    const rHand = new THREE.Mesh(handGeom, gloveMat);
    rHand.scale.set(1.1, 0.88, 1.15);
    rHand.position.set(0.2, 0, -5.5);
    this.playerRightElbow.add(rElbow, rFore, rHand);

    // Torch extends down-axis (-Z of forearm) which rotates forward toward +X during aim
    const torchGroup = new THREE.Group();
    torchGroup.position.set(0, 0, -5.5);
    this.playerRightElbow.add(torchGroup);

    const torchBarrelGeom = this.trackGeom(new THREE.CylinderGeometry(1.4, 1.35, 7.0, 12));
    torchBarrelGeom.rotateX(Math.PI / 2);
    const torchBarrel = new THREE.Mesh(torchBarrelGeom, torchBodyMat);
    torchBarrel.position.set(0, 0, -2.7);

    const torchBezelGeom = this.trackGeom(new THREE.CylinderGeometry(1.45, 2.25, 2.4, 12));
    torchBezelGeom.rotateX(Math.PI / 2);
    const torchBezel = new THREE.Mesh(torchBezelGeom, torchBezelMat);
    torchBezel.position.set(0, 0, -7.1);

    const torchLensGeom = this.trackGeom(new THREE.CylinderGeometry(1.85, 1.85, 0.6, 12));
    torchLensGeom.rotateX(Math.PI / 2);
    const torchLens = new THREE.Mesh(torchLensGeom, this.playerTorchLensBundle.material);
    torchLens.position.set(0, 0, -8.2);

    const torchGlowGeom = this.trackGeom(new THREE.PlaneGeometry(11, 11));
    const glowRoot = new THREE.Group();
    glowRoot.position.set(0, 0, -9.0);
    const glowPlaneA = new THREE.Mesh(torchGlowGeom, this.playerTorchGlowMat);
    const glowPlaneB = new THREE.Mesh(torchGlowGeom, this.playerTorchGlowMat);
    glowPlaneB.rotation.y = Math.PI * 0.5;
    const glowPlaneC = new THREE.Mesh(torchGlowGeom, this.playerTorchGlowMat);
    glowPlaneC.rotation.x = Math.PI * 0.5;
    glowRoot.add(glowPlaneA, glowPlaneB, glowPlaneC);
    glowRoot.visible = false;
    this.playerTorchGlowMesh = glowRoot as unknown as THREE.Mesh;

    torchGroup.add(torchBarrel, torchBezel, torchLens, glowRoot);

    // 7. Contoured Head & Slate-Steel Hard Hat (34.0px apex)
    this.playerHead.position.set(0.6, 0, 11.4);
    this.playerSpine.add(this.playerHead);

    const neckGeom = this.trackGeom(makeTaperedCylinder(2.05, 2.05, 2.35, 2.35, 2.4, 10));
    const neckMesh = new THREE.Mesh(neckGeom, skinMat);
    neckMesh.position.set(0, 0, 0.9);

    const craniumGeom = this.trackGeom(new THREE.SphereGeometry(3.75, 14, 12));
    const craniumMesh = new THREE.Mesh(craniumGeom, skinMat);
    craniumMesh.position.set(0.75, 0, 2.55);
    craniumMesh.scale.set(1.06, 0.94, 0.94);

    // Molded wrap-around hard hat brim + curved peak
    const brimGeom = this.trackGeom(
      makeBeveledShapeGeom((s) => {
        s.absellipse(0, 0, 6.2, 5.75, 0, Math.PI * 2, false, 0);
      }, 0.65, 0.22, 0.22, 1, 16)
    );
    const brimMesh = new THREE.Mesh(brimGeom, hardHatRimMat);
    brimMesh.position.set(0.25, 0, 3.3);

    const visorGeom = this.trackGeom(
      makeBeveledShapeGeom((s) => {
        s.moveTo(-0.4, -3.7);
        s.quadraticCurveTo(3.6, -2.5, 4.0, 0);
        s.quadraticCurveTo(3.6, 2.5, -0.4, 3.7);
        s.closePath();
      }, 0.55, 0.2, 0.2, 1, 10)
    );
    const visorMesh = new THREE.Mesh(visorGeom, hardHatVisorMat);
    visorMesh.position.set(3.2, 0, 3.15);

    const domeGeom = this.trackGeom(
      new THREE.SphereGeometry(5.25, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.56)
    );
    domeGeom.rotateX(Math.PI / 2);
    const domeMesh = new THREE.Mesh(domeGeom, hardHatDomeMat);
    domeMesh.position.set(0.2, 0, 3.18);
    domeMesh.scale.set(1.04, 0.98, 0.5); // 3.18 + 5.25 * 0.5 = 5.80 above headPivot -> 34.0px!

    const ridgeGeom = this.trackGeom(
      makeBeveledShapeGeom((s) => {
        s.moveTo(-3.4, -0.65);
        s.lineTo(3.2, -0.55);
        s.quadraticCurveTo(3.8, 0, 3.2, 0.55);
        s.lineTo(-3.4, 0.65);
        s.closePath();
      }, 0.85, 0.22, 0.2, 1)
    );
    const ridgeMesh = new THREE.Mesh(ridgeGeom, hardHatVisorMat);
    ridgeMesh.position.set(-0.2, 0, 5.42);

    this.playerHead.add(neckMesh, craniumMesh, brimMesh, visorMesh, domeMesh, ridgeMesh);
  }

  private buildBruteRig(anisotropy: number): void {
    const shadowTex = this.trackTex(
      makeSoftRadialTexture(64, [
        [0, 'rgba(0, 0, 0, 0.72)'],
        [0.64, 'rgba(0, 0, 0, 0.42)'],
        [1, 'rgba(0, 0, 0, 0)'],
      ])
    );
    const armorTex = this.trackTex(makeBruteArmorTexture(anisotropy));
    const grateTex = this.trackTex(makeFurnaceGrateTexture(anisotropy));

    // Charred furnace-iron armor palette with subtle gunmetal & heat-forged bronze bevels
    this.bruteHullBundle = this.makeShadedMat({
      map: armorTex,
      color: 0x2a1b18,
      roughness: 0.58,
      metalness: 0.38,
    });
    this.bruteTrimBundle = this.makeShadedMat({
      color: 0x5c2414,
      roughness: 0.46,
      metalness: 0.48,
    });
    const darkIronMat = this.makeShadedMat({
      map: armorTex,
      color: 0x160f0e,
      roughness: 0.62,
      metalness: 0.42,
    }).material;
    this.brutePauldronBundle = this.makeShadedMat({
      map: armorTex,
      color: 0x281a17,
      roughness: 0.48,
      metalness: 0.5,
    });
    this.brutePauldronRimBundle = this.makeShadedMat({
      color: 0x475569,
      roughness: 0.32,
      metalness: 0.72,
    });
    this.bruteGauntletBundle = this.makeShadedMat({
      map: armorTex,
      color: 0x301d18,
      roughness: 0.48,
      metalness: 0.48,
    });
    this.bruteGauntletRimBundle = this.makeShadedMat({
      color: 0x612816,
      roughness: 0.4,
      metalness: 0.55,
    });
    this.bruteHelmBundle = this.makeShadedMat({
      map: armorTex,
      color: 0x1e1412,
      roughness: 0.46,
      metalness: 0.54,
    });
    this.bruteHelmTrimBundle = this.makeShadedMat({
      color: 0x5e2816,
      roughness: 0.38,
      metalness: 0.58,
    });
    this.bruteClawBundle = this.makeShadedMat({
      color: 0x7c8a9b,
      roughness: 0.24,
      metalness: 0.88,
    });
    this.bruteFurnaceBundle = this.makeShadedMat({
      map: grateTex,
      color: 0xff8c2b,
      roughness: 0.4,
      metalness: 0.2,
      emissiveColor: 0xff6b00,
      emissiveStrength: 0.9,
    });
    this.bruteEyeBundle = this.makeShadedMat({
      color: 0xfdba74,
      roughness: 0.18,
      metalness: 0.1,
      emissiveColor: 0xff8a1c,
      emissiveStrength: 1.15,
    });

    const shadowMat = this.makeUnshadedMat({
      map: shadowTex,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });

    // 1. Wide heavy floor shadow
    this.bruteShadow = new THREE.Mesh(
      this.trackGeom(new THREE.PlaneGeometry(38, 48)),
      shadowMat
    );
    this.bruteShadow.position.set(-1.5, 0, 0.25);
    this.bruteRoot.add(this.bruteShadow);

    // 2. Pelvis & Heavy Tapered Armored Legs (thigh 9.2 + calf 8.8 = 18.0 standing)
    this.brutePelvis.position.set(0, 0, 18.0);
    this.bruteRoot.add(this.brutePelvis);

    const pelvisHull = new THREE.Mesh(
      this.trackGeom(makeTaperedCylinder(8.2, 10.8, 7.6, 9.8, 5.2, 14)),
      darkIronMat
    );
    pelvisHull.position.set(0, 0, 1.3);

    const waistArmorBand = new THREE.Mesh(
      this.trackGeom(makeTaperedCylinder(8.6, 11.4, 8.3, 11.0, 1.9, 14)),
      this.bruteTrimBundle.material
    );
    waistArmorBand.position.set(0, 0, 3.0);

    const groinGuard = new THREE.Mesh(
      this.trackGeom(
        makeBeveledShapeGeom((s) => {
          s.moveTo(-4.4, 1.5);
          s.lineTo(4.4, 1.5);
          s.lineTo(2.8, -4.6);
          s.lineTo(0, -5.8);
          s.lineTo(-2.8, -4.6);
          s.closePath();
        }, 1.8, 0.55, 0.5, 2)
      ),
      this.bruteHullBundle.material
    );
    groinGuard.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    groinGuard.position.set(7.8, 0, 0.2);
    this.brutePelvis.add(pelvisHull, waistArmorBand, groinGuard);

    const bThighGeom = this.trackGeom(makeTaperedCylinder(4.1, 4.1, 3.4, 3.4, 9.4, 10));
    const bKneeGuardGeom = this.trackGeom(
      makeBeveledShapeGeom((s) => {
        s.moveTo(-3.3, 2.1);
        s.lineTo(0, 3.1);
        s.lineTo(3.3, 2.1);
        s.lineTo(2.7, -2.1);
        s.lineTo(0, -2.9);
        s.lineTo(-2.7, -2.1);
        s.closePath();
      }, 2.4, 0.55, 0.5, 2)
    );
    const bCalfGeom = this.trackGeom(makeTaperedCylinder(3.45, 3.45, 2.85, 2.85, 8.2, 10));
    const bBootGeom = this.trackGeom(
      makeBeveledShapeGeom((s) => {
        s.moveTo(-3.6, -3.2);
        s.lineTo(4.6, -2.9);
        s.quadraticCurveTo(6.2, 0, 4.6, 2.9);
        s.lineTo(-3.6, 3.2);
        s.quadraticCurveTo(-4.6, 0, -3.6, -3.2);
        s.closePath();
      }, 2.6, 0.6, 0.55, 2)
    );
    const bToePlateGeom = this.trackGeom(
      makeBeveledShapeGeom((s) => {
        s.moveTo(-1.2, -2.5);
        s.lineTo(2.6, -2.0);
        s.lineTo(3.2, 0);
        s.lineTo(2.6, 2.0);
        s.lineTo(-1.2, 2.5);
        s.closePath();
      }, 1.9, 0.45, 0.4, 1)
    );

    const setupBruteLeg = (
      hip: THREE.Group,
      knee: THREE.Group,
      ankle: THREE.Group,
      yOffset: number
    ) => {
      hip.position.set(0, yOffset, 0);
      this.brutePelvis.add(hip);

      const thigh = new THREE.Mesh(bThighGeom, this.bruteHullBundle.material);
      thigh.position.set(0, 0, -4.6);
      hip.add(thigh);

      knee.position.set(0, 0, -9.2);
      hip.add(knee);

      const kneeGuard = new THREE.Mesh(bKneeGuardGeom, this.brutePauldronBundle.material);
      kneeGuard.rotation.set(Math.PI / 2, Math.PI / 2, 0);
      kneeGuard.position.set(3.2, 0, 0.2);
      const calf = new THREE.Mesh(bCalfGeom, darkIronMat);
      calf.position.set(0, 0, -4.1);
      knee.add(kneeGuard, calf);

      ankle.position.set(0, 0, -8.8);
      knee.add(ankle);

      const boot = new THREE.Mesh(bBootGeom, darkIronMat);
      boot.position.set(1.2, 0, 1.7);
      const toePlate = new THREE.Mesh(bToePlateGeom, this.brutePauldronRimBundle.material);
      toePlate.position.set(5.4, 0, 1.2);
      ankle.add(boot, toePlate);
    };

    setupBruteLeg(this.bruteLeftLegHip, this.bruteLeftKnee, this.bruteLeftAnkle, 6.4);
    setupBruteLeg(this.bruteRightLegHip, this.bruteRightKnee, this.bruteRightAnkle, -6.4);

    // 3. Sculpted Hunched Boiler-Plate Torso
    this.bruteSpine.position.set(0, 0, 2.2);
    this.brutePelvis.add(this.bruteSpine);

    // Muscular V-tapered barrel ribcage (tapers down to waist, swells wide at upper chest)
    const abdomen = new THREE.Mesh(
      this.trackGeom(makeTaperedCylinder(8.8, 11.4, 7.6, 9.6, 5.6, 14)),
      darkIronMat
    );
    abdomen.position.set(0, 0, 2.6);

    const chestHull = new THREE.Mesh(
      this.trackGeom(makeTaperedCylinder(10.6, 13.8, 8.8, 11.2, 13.2, 16)),
      this.bruteHullBundle.material
    );
    chestHull.position.set(0.6, 0, 9.8);

    // Sculpted upper collarbone armor ridge (frames neck cleanly ABOVE sternum furnace)
    const pectoralPlate = new THREE.Mesh(
      this.trackGeom(
        makeBeveledShapeGeom((s) => {
          s.moveTo(-10.2, 1.8);
          s.lineTo(10.2, 1.8);
          s.lineTo(8.4, -1.6);
          s.lineTo(0, -2.2);
          s.lineTo(-8.4, -1.6);
          s.closePath();
        }, 2.2, 0.7, 0.65, 2)
      ),
      this.bruteTrimBundle.material
    );
    pectoralPlate.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    pectoralPlate.position.set(7.8, 0, 14.0);

    // Hunched trapezius boiler shroud behind neck/shoulders (visible heavily from Top 0° & Iso 38°)
    const dorsalHumpGeom = this.trackGeom(
      new THREE.SphereGeometry(10.4, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62)
    );
    dorsalHumpGeom.rotateX(Math.PI / 2);
    const dorsalHump = new THREE.Mesh(dorsalHumpGeom, darkIronMat);
    dorsalHump.scale.set(0.95, 1.24, 0.62);
    dorsalHump.position.set(-2.4, 0, 14.4);
    dorsalHump.rotation.y = -0.22;

    const gorgetCowl = new THREE.Mesh(
      this.trackGeom(makeTaperedCylinder(6.2, 7.6, 8.2, 10.2, 3.0, 14)),
      this.bruteTrimBundle.material
    );
    gorgetCowl.position.set(1.4, 0, 15.0);
    gorgetCowl.rotation.y = 0.2;

    this.bruteSpine.add(abdomen, chestHull, pectoralPlate, dorsalHump, gorgetCowl);

    // Twin curved iron boiler exhaust stacks arcing over the hunched back
    for (const side of [-1, 1]) {
      const pipeCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-4.5, side * 5.8, 13.5),
        new THREE.Vector3(-8.4, side * 6.4, 18.2),
        new THREE.Vector3(-10.2, side * 5.6, 21.8),
        new THREE.Vector3(-12.2, side * 5.0, 20.6),
      ]);
      const pipeGeom = this.trackGeom(new THREE.TubeGeometry(pipeCurve, 12, 1.45, 8, false));
      const pipeMesh = new THREE.Mesh(pipeGeom, this.brutePauldronRimBundle.material);
      const capRing = new THREE.Mesh(
        this.trackGeom(new THREE.CylinderGeometry(1.7, 1.7, 1.1, 10)),
        this.bruteFurnaceBundle.material
      );
      capRing.rotation.z = Math.PI * 0.35;
      capRing.position.set(-12.2, side * 5.0, 20.6);
      this.bruteSpine.add(pipeMesh, capRing);
    }

    // Recessed Heavy Iron Sternum Furnace Core (prominent & unobstructed on chest)
    const chestHousing = new THREE.Mesh(
      this.trackGeom(
        makeBeveledShapeGeom((s) => {
          s.moveTo(-4.8, -3.5);
          s.lineTo(4.8, -3.5);
          s.lineTo(5.4, 0);
          s.lineTo(4.8, 3.5);
          s.lineTo(-4.8, 3.5);
          s.lineTo(-5.4, 0);
          s.closePath();
        }, 2.4, 0.55, 0.5, 2)
      ),
      darkIronMat
    );
    chestHousing.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    chestHousing.position.set(10.0, 0, 8.8);

    const chestCore = new THREE.Mesh(
      this.trackGeom(new THREE.CylinderGeometry(4.1, 4.1, 2.2, 12)),
      this.bruteFurnaceBundle.material
    );
    chestCore.rotation.z = Math.PI / 2;
    chestCore.scale.set(0.82, 1.0, 1.1);
    chestCore.position.set(10.5, 0, 8.8);

    // Iron vertical cage bars across furnace core
    const barGeom = this.trackGeom(new THREE.CylinderGeometry(0.42, 0.42, 6.4, 6));
    barGeom.rotateX(Math.PI / 2);
    for (const by of [-2.4, 0, 2.4]) {
      const bar = new THREE.Mesh(barGeom, darkIronMat);
      bar.position.set(11.6, by, 8.8);
      this.bruteSpine.add(bar);
    }

    this.bruteChestCoreAnchor.position.set(12.2, 0, 8.8);
    this.bruteSpine.add(chestHousing, chestCore, this.bruteChestCoreAnchor);

    // Three Glowing Furnace Rib-Vents contoured along each curved flank
    const ribSlotGeom = this.trackGeom(new THREE.CylinderGeometry(1.1, 1.1, 5.4, 8));
    for (const side of [-1, 1]) {
      for (let v = 0; v < 3; v++) {
        const vent = new THREE.Mesh(ribSlotGeom, this.bruteFurnaceBundle.material);
        vent.position.set(-2.5 + v * 4.4, side * (11.6 - v * 0.4), 8.2 + v * 0.6);
        vent.rotation.set(side * 0.15, 0.18, side * 0.25);
        this.bruteSpine.add(vent);
      }
    }

    // Dorsal Boiler Spine Clamps along the back (iconic in Top 0° and Iso 38°)
    const spineClampGeom = this.trackGeom(
      makeBeveledShapeGeom((s) => {
        s.moveTo(-3.4, -1.3);
        s.lineTo(3.4, -1.3);
        s.lineTo(2.4, 1.3);
        s.lineTo(-2.4, 1.3);
        s.closePath();
      }, 3.2, 0.45, 0.4, 1)
    );
    const spineCoreGeom = this.trackGeom(new THREE.CylinderGeometry(1.4, 1.4, 3.6, 8));
    for (let s = 0; s < 3; s++) {
      const sz = 5.4 + s * 3.8;
      const sx = -9.4 + s * 0.3;
      const clamp = new THREE.Mesh(spineClampGeom, darkIronMat);
      clamp.rotation.set(Math.PI / 2, Math.PI / 2, 0);
      clamp.position.set(sx, 0, sz);
      const core = new THREE.Mesh(spineCoreGeom, this.bruteFurnaceBundle.material);
      core.position.set(sx - 1.1, 0, sz + 0.3);
      this.bruteSpine.add(clamp, core);
    }

    // Curved Sculpted Shoulder Pauldrons (draped iron domes + gunmetal trim + studs)
    const pauldronDomeGeom = this.trackGeom(
      new THREE.SphereGeometry(7.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56)
    );
    pauldronDomeGeom.rotateX(Math.PI / 2);
    const pauldronTrimArcGeom = this.trackGeom(
      new THREE.TorusGeometry(6.3, 0.72, 6, 14, Math.PI * 1.15)
    );
    const rivetGeom = this.trackGeom(new THREE.SphereGeometry(0.7, 6, 6));

    for (const side of [-1, 1]) {
      const pGroup = new THREE.Group();
      pGroup.position.set(0.4, side * 14.2, 13.0);
      pGroup.rotation.set(side * -0.52, 0, 0);

      const pDome = new THREE.Mesh(pauldronDomeGeom, this.brutePauldronBundle.material);
      pDome.scale.set(1.12, 0.85, 0.78);

      const pLowerTrim = new THREE.Mesh(
        pauldronTrimArcGeom,
        this.brutePauldronRimBundle.material
      );
      pLowerTrim.rotation.set(Math.PI / 2, -Math.PI * 0.08, side > 0 ? 0 : Math.PI);
      pLowerTrim.scale.set(1.08, 0.9, 1.0);
      pLowerTrim.position.set(0, side * 1.2, 0.4);

      pGroup.add(pDome, pLowerTrim);

      for (const rx of [-3.4, 0, 3.4]) {
        const rivet = new THREE.Mesh(rivetGeom, this.brutePauldronRimBundle.material);
        rivet.position.set(rx, side * 1.8, 5.1);
        pGroup.add(rivet);
      }

      this.bruteSpine.add(pGroup);
    }

    // 4. Hunched Iron-Cage Skull Helm & Narrow Glowing Visor Slits
    // Seated forward inside the hunched cowl! Standing apex: 18.0 + 2.2 + 12.6 + 11.2 = 44.0px
    this.bruteHead.position.set(5.4, 0, 12.8);
    this.bruteSpine.add(this.bruteHead);

    const bNeck = new THREE.Mesh(
      this.trackGeom(makeTaperedCylinder(4.8, 4.8, 5.8, 5.8, 3.6, 12)),
      darkIronMat
    );
    bNeck.position.set(-0.5, 0, 1.4);

    const bHelmDome = new THREE.Mesh(
      this.trackGeom(new THREE.SphereGeometry(5.8, 16, 12)),
      this.bruteHelmBundle.material
    );
    bHelmDome.position.set(0.4, 0, 4.6);
    bHelmDome.scale.set(1.08, 0.94, 0.96);

    const bHelmCrest = new THREE.Mesh(
      this.trackGeom(
        makeBeveledShapeGeom((s) => {
          s.moveTo(-4.6, -1.0);
          s.lineTo(4.6, -0.8);
          s.lineTo(5.2, 0);
          s.lineTo(4.6, 0.8);
          s.lineTo(-4.6, 1.0);
          s.closePath();
        }, 2.4, 0.45, 0.4, 1)
      ),
      this.bruteHelmTrimBundle.material
    );
    bHelmCrest.position.set(0.2, 0, 9.6);

    // Deep dark recessed eye-slit cavity
    const bEyeRecess = new THREE.Mesh(
      this.trackGeom(new THREE.BoxGeometry(2.0, 7.6, 2.2)),
      darkIronMat
    );
    bEyeRecess.position.set(5.1, 0, 5.1);

    // Angry V-scowling brow plates (short overhang so eye slits stay fiercely visible from 38-55 deg!)
    const browPlateGeom = this.trackGeom(
      makeBeveledShapeGeom((s) => {
        s.moveTo(-1.4, -2.4);
        s.lineTo(1.5, -2.1);
        s.lineTo(1.6, 2.1);
        s.lineTo(-1.4, 2.4);
        s.closePath();
      }, 1.1, 0.3, 0.25, 1)
    );
    const leftBrow = new THREE.Mesh(browPlateGeom, this.bruteHelmTrimBundle.material);
    leftBrow.position.set(5.1, 2.1, 6.45);
    leftBrow.rotation.set(0.28, 0.14, -0.2);
    const rightBrow = new THREE.Mesh(browPlateGeom, this.bruteHelmTrimBundle.material);
    rightBrow.position.set(5.1, -2.1, 6.45);
    rightBrow.rotation.set(-0.28, 0.14, 0.2);

    // Heavy riveted jaw-respirator & iron muzzle cage bars below the eyes
    const bJaw = new THREE.Mesh(
      this.trackGeom(
        makeBeveledShapeGeom((s) => {
          s.moveTo(-4.0, -1.6);
          s.lineTo(4.0, -1.6);
          s.lineTo(3.2, 1.8);
          s.lineTo(-3.2, 1.8);
          s.closePath();
        }, 3.4, 0.45, 0.4, 2)
      ),
      darkIronMat
    );
    bJaw.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    bJaw.position.set(4.5, 0, 2.3);

    const cageBarGeom = this.trackGeom(new THREE.CylinderGeometry(0.4, 0.4, 2.8, 6));
    cageBarGeom.rotateX(Math.PI / 2);
    for (const cy of [-2.4, -0.8, 0.8, 2.4]) {
      const bar = new THREE.Mesh(cageBarGeom, this.brutePauldronRimBundle.material);
      bar.position.set(6.35, cy, 2.75);
      this.bruteHead.add(bar);
    }

    const bHelmEarBolts = new THREE.Mesh(
      this.trackGeom(new THREE.CylinderGeometry(1.8, 1.8, 11.6, 10)),
      this.brutePauldronRimBundle.material
    );
    bHelmEarBolts.position.set(0.5, 0, 4.5);

    // Razor-narrow tilted glowing predator visor slits clearly readable from all angles!
    const slitGeom = this.trackGeom(
      makeBeveledShapeGeom((s) => {
        s.moveTo(-1.5, -0.45);
        s.lineTo(1.5, -0.45);
        s.lineTo(1.5, 0.45);
        s.lineTo(-1.5, 0.45);
        s.closePath();
      }, 0.9, 0.1, 0.1, 1)
    );
    slitGeom.rotateY(Math.PI / 2);
    slitGeom.rotateX(Math.PI / 2);

    this.bruteLeftEyeMesh = new THREE.Mesh(slitGeom, this.bruteEyeBundle.material);
    this.bruteLeftEyeMesh.position.set(6.45, 2.05, 5.25);
    this.bruteLeftEyeMesh.rotation.set(0.26, -0.14, 0.16);

    this.bruteRightEyeMesh = new THREE.Mesh(slitGeom, this.bruteEyeBundle.material);
    this.bruteRightEyeMesh.position.set(6.45, -2.05, 5.25);
    this.bruteRightEyeMesh.rotation.set(-0.26, -0.14, -0.16);

    this.bruteBrowAnchor.position.set(6.8, 0, 5.25);
    this.bruteLeftEyeAnchor.position.set(6.8, 2.05, 5.25);
    this.bruteRightEyeAnchor.position.set(6.8, -2.05, 5.25);

    this.bruteHead.add(
      bNeck,
      bHelmDome,
      bHelmCrest,
      bEyeRecess,
      leftBrow,
      rightBrow,
      bJaw,
      bHelmEarBolts,
      this.bruteLeftEyeMesh,
      this.bruteRightEyeMesh,
      this.bruteBrowAnchor,
      this.bruteLeftEyeAnchor,
      this.bruteRightEyeAnchor
    );

    // 5. Muscular Tapered Arms, Elbow Guards & Curved Hooked Scythe Talons
    const bShoulderBallGeom = this.trackGeom(new THREE.SphereGeometry(3.8, 10, 8));
    const bUpperArmGeom = this.trackGeom(makeTaperedCylinder(3.45, 3.35, 2.85, 2.85, 8.6, 12));
    const bElbowPlateGeom = this.trackGeom(
      makeBeveledShapeGeom((s) => {
        s.moveTo(-2.6, 1.8);
        s.lineTo(2.6, 1.8);
        s.lineTo(1.8, -2.8);
        s.lineTo(-1.8, -2.8);
        s.closePath();
      }, 2.0, 0.45, 0.4, 1)
    );
    const bForearmGeom = this.trackGeom(makeTaperedCylinder(3.85, 3.7, 3.2, 3.1, 8.8, 12));
    const bCuffGeom = this.trackGeom(makeTaperedCylinder(4.1, 3.9, 4.3, 4.1, 2.2, 12));
    const bGauntletGeom = this.trackGeom(new THREE.SphereGeometry(4.4, 12, 10));
    const bClawGeom = this.trackGeom(makeHookedTalonGeom(7.4, 1.25, 4.2));

    const setupBruteArm = (shoulder: THREE.Group, elbow: THREE.Group, yOffset: number) => {
      shoulder.position.set(0.4, yOffset, 12.2);
      this.bruteSpine.add(shoulder);

      const shBall = new THREE.Mesh(bShoulderBallGeom, darkIronMat);
      const upper = new THREE.Mesh(bUpperArmGeom, this.bruteHullBundle.material);
      upper.position.set(0, 0, -4.1);
      shoulder.add(shBall, upper);

      elbow.position.set(0, 0, -8.2);
      shoulder.add(elbow);

      const elbowGuard = new THREE.Mesh(bElbowPlateGeom, this.brutePauldronRimBundle.material);
      elbowGuard.rotation.set(Math.PI / 2, -Math.PI / 2, 0);
      elbowGuard.position.set(-2.6, 0, 0);

      const fore = new THREE.Mesh(bForearmGeom, this.bruteGauntletBundle.material);
      fore.position.set(0, 0, -4.3);

      const cuff = new THREE.Mesh(bCuffGeom, this.bruteGauntletRimBundle.material);
      cuff.position.set(0.1, 0, -7.8);

      const gauntlet = new THREE.Mesh(bGauntletGeom, this.bruteGauntletBundle.material);
      gauntlet.position.set(0.4, 0, -9.2);
      gauntlet.scale.set(1.05, 0.92, 1.0);

      elbow.add(elbowGuard, fore, cuff, gauntlet);

      for (const [idx, cy] of [-2.2, 0, 2.2].entries()) {
        const claw = new THREE.Mesh(bClawGeom, this.bruteClawBundle.material);
        claw.position.set(1.4, cy, -11.2);
        claw.rotation.set(0, 0.06, idx === 0 ? 0.16 : idx === 2 ? -0.16 : 0);
        elbow.add(claw);
      }
    };

    setupBruteArm(this.bruteLeftArm, this.bruteLeftElbow, 15.8);
    setupBruteArm(this.bruteRightArm, this.bruteRightElbow, -15.8);
  }

  public getBruteGleamAnchors(): BruteGleamAnchors {
    return this.bruteGleam;
  }

  public updateForFrame(
    engine: MonstrumGameEngine,
    renderDeck: ShipDeck,
    timeSec: number,
    includePlayer: boolean
  ): void {
    if (this.disposed) return;

    this.updatePlayer(engine, timeSec, includePlayer);
    this.updateBrute(engine, renderDeck, timeSec);
  }

  private updatePlayer(
    engine: MonstrumGameEngine,
    timeSec: number,
    includePlayer: boolean
  ): void {
    const p = engine.player;
    if (!includePlayer || p.hidingSpotId !== null) {
      this.playerRoot.visible = false;
      return;
    }

    this.playerRoot.visible = true;

    const crouchTarget = p.crouching ? 1 : 0;
    this.playerCrouchBlend += (crouchTarget - this.playerCrouchBlend) * 0.28;
    const cb = this.playerCrouchBlend;

    const stride = p.isMoving ? Math.sin(p.walkPhase) : 0;
    const doubleStep = p.isMoving ? Math.abs(Math.sin(p.walkPhase)) : 0;
    const sprintFactor = p.sprinting && !p.crouching ? 1 : 0;
    const torsoTwist = p.isMoving ? stride * (p.sprinting ? 0.1 : 0.055) : 0;
    const breathFreq = p.exhausted ? 7.2 : 2.5;
    const breathAmp = p.isMoving ? 0 : p.exhausted ? 0.032 : 0.012;
    const idleBreath = Math.sin(timeSec * breathFreq) * breathAmp;

    this.playerRoot.position.set(p.x, -p.y, 0);
    this.playerRoot.rotation.set(0, 0, -p.angle);

    const shadowScale = 1 - cb * 0.14;
    this.playerShadow.scale.set(shadowScale, 1 - cb * 0.16, 1);

    const swingAmp = p.crouching ? 0.36 : p.sprinting ? 0.68 : 0.5;
    const leftSwing = -stride * swingAmp;
    const rightSwing = stride * swingAmp;

    const crouchThigh = -1.05 * cb;
    const crouchKnee = 1.85 * cb;

    const leftHipPitch = crouchThigh + leftSwing;
    const rightHipPitch = crouchThigh + rightSwing;
    const leftKneePitch = crouchKnee + Math.max(0, -stride) * (0.42 - cb * 0.18);
    const rightKneePitch = crouchKnee + Math.max(0, stride) * (0.42 - cb * 0.18);

    this.playerLeftLegHip.rotation.y = leftHipPitch;
    this.playerLeftKnee.rotation.y = leftKneePitch;
    this.playerLeftAnkle.rotation.y = -(leftHipPitch + leftKneePitch);

    this.playerRightLegHip.rotation.y = rightHipPitch;
    this.playerRightKnee.rotation.y = rightKneePitch;
    this.playerRightAnkle.rotation.y = -(rightHipPitch + rightKneePitch);

    const leftDrop =
      7.4 * Math.cos(leftHipPitch) + 7.6 * Math.cos(leftHipPitch + leftKneePitch);
    const rightDrop =
      7.4 * Math.cos(rightHipPitch) + 7.6 * Math.cos(rightHipPitch + rightKneePitch);
    const hipZ = Math.max(leftDrop, rightDrop) + (1 - cb) * doubleStep * 0.35;
    this.playerPelvis.position.z = hipZ;
    this.playerPelvis.rotation.z = -torsoTwist * 0.4;

    const spinePitch = 0.03 + cb * 0.53 + sprintFactor * 0.19;
    this.playerSpine.rotation.set(0, spinePitch, -torsoTwist * 0.6);
    this.playerTorsoGroup.scale.set(1 + idleBreath * 0.7, 1 + idleBreath, 1 + idleBreath * 0.4);

    this.playerHead.rotation.set(0, -spinePitch * 0.65, torsoTwist * 0.45);
    this.playerHead.position.z = 11.4 - cb * 0.7;

    this.playerBackpackGroup.visible = p.hasBackpack;
    this.playerSatchelGroup.visible = !p.hasBackpack;
    if (!p.hasBackpack) {
      this.playerSatchelClaspBundle.uTint.value.setHex(
        p.inventory.length > 1 ? 0xd97706 : 0x475569
      );
    }

    const leftArmSwing = stride * (p.crouching ? 0.25 : p.sprinting ? 0.65 : 0.45);
    this.playerLeftArm.rotation.set(-0.08, leftArmSwing - spinePitch * 0.45, 0);
    this.playerLeftElbow.rotation.y = -0.32 - cb * 0.35 - Math.max(0, -leftArmSwing) * 0.4;

    const hasLight = p.flashlightOn && p.battery > 0;
    const rightAimLift = hasLight ? -0.92 : -0.45;
    const rightBob = stride * (hasLight ? 0.05 : 0.24);
    this.playerRightArm.rotation.set(0.06, rightAimLift - spinePitch * 0.9 + rightBob, -0.1);
    this.playerRightElbow.rotation.y = hasLight ? -0.65 : -0.45;

    if (hasLight) {
      const lowBatFlicker = p.battery < 18 && Math.sin(timeSec * 37) > 0.72 ? 0.45 : 1;
      this.playerTorchLensBundle.uTint.value.setHex(
        lowBatFlicker < 0.7 ? 0x948c4f : 0xfef08a
      );
      this.playerTorchLensBundle.uEmissiveStrength.value = 0.9 * lowBatFlicker;
      this.playerTorchGlowMat.opacity = 0.85 * lowBatFlicker;
      this.playerTorchGlowMesh.visible = true;
    } else {
      this.playerTorchLensBundle.uTint.value.setHex(0x1e293b);
      this.playerTorchLensBundle.uEmissiveStrength.value = 0.0;
      this.playerTorchGlowMesh.visible = false;
    }
  }

  private updateBrute(
    engine: MonstrumGameEngine,
    renderDeck: ShipDeck,
    timeSec: number
  ): void {
    const b = engine.brute;
    const ts = engine.map.tileSize;
    const bounds = engine.map.deckBounds[renderDeck];
    const bTy = Math.floor(b.y / ts);

    if (b.stairClimbTimer > 0 || bTy < bounds.y1 || bTy > bounds.y2) {
      this.bruteRoot.visible = false;
      this.bruteGleam.valid = false;
      return;
    }

    this.bruteRoot.visible = true;

    const isChasing = b.state === 'CHASE' || b.state === 'SMASH_DOOR';
    const isStalking = b.state === 'STALK' || b.state === 'CHECK_HIDING';
    const isStunned = b.state === 'STUNNED';
    const isLunging =
      b.state === 'SMASH_DOOR' ||
      (b.state === 'CHECK_HIDING' && b.inspectTimer > 0 && b.inspectTimer < 0.72);

    const targetCrouch = isStunned ? 1.0 : isStalking ? 0.55 : isChasing ? 0.35 : 0;
    this.bruteCrouchBlend += (targetCrouch - this.bruteCrouchBlend) * 0.22;
    const cb = this.bruteCrouchBlend;

    const stride = isStunned ? 0 : Math.sin(b.walkPhase);
    const doubleStep = isStunned ? 0 : Math.abs(Math.sin(b.walkPhase));
    const torsoTwist = isStunned
      ? Math.sin(timeSec * 16) * 0.06
      : stride * (isChasing ? 0.12 : 0.065);
    const stunJitterX = isStunned ? Math.sin(timeSec * 32) * 1.1 : 0;
    const stunJitterY = isStunned ? Math.cos(timeSec * 29) * 1.1 : 0;

    this.bruteRoot.position.set(b.x + stunJitterX, -(b.y + stunJitterY), 0);
    this.bruteRoot.rotation.set(0, 0, -b.angle);

    // Heavy hydraulic stride (thigh 9.2 + calf 8.8 = 18.0 standing)
    const strideAmp = isStunned ? 0 : isChasing ? 0.56 : isStalking ? 0.38 : 0.34;
    const lSwing = -stride * strideAmp;
    const rSwing = stride * strideAmp;
    const stanceBend = isStunned ? -0.58 : -0.32 * cb;
    const kneeBend = isStunned ? 1.02 : 0.58 * cb;

    const lHip = stanceBend + lSwing;
    const rHip = stanceBend + rSwing;
    const lKnee = kneeBend + Math.max(0, -stride) * 0.32;
    const rKnee = kneeBend + Math.max(0, stride) * 0.32;

    this.bruteLeftLegHip.rotation.y = lHip;
    this.bruteLeftKnee.rotation.y = lKnee;
    this.bruteLeftAnkle.rotation.y = -(lHip + lKnee);

    this.bruteRightLegHip.rotation.y = rHip;
    this.bruteRightKnee.rotation.y = rKnee;
    this.bruteRightAnkle.rotation.y = -(rHip + rKnee);

    const lDrop = 9.2 * Math.cos(lHip) + 8.8 * Math.cos(lHip + lKnee);
    const rDrop = 9.2 * Math.cos(rHip) + 8.8 * Math.cos(rHip + rKnee);
    const hipZ = Math.max(lDrop, rDrop) + (isStunned ? 0 : doubleStep * 0.55);
    this.brutePelvis.position.z = hipZ;
    this.brutePelvis.rotation.z = -torsoTwist * 0.4;

    // Torso hunch / lunge / stunned slump
    const lungePulse = isLunging ? 0.14 + Math.sin(timeSec * 14) * 0.12 : 0;
    const spinePitch = isStunned
      ? 0.56 + Math.sin(timeSec * 18) * 0.04
      : isChasing
        ? 0.24 + lungePulse
        : isStalking
          ? 0.28
          : 0.08;
    const spineRoll = isStunned
      ? Math.sin(timeSec * 14) * 0.08
      : stride * (isChasing ? 0.08 : 0.04);
    this.bruteSpine.rotation.set(spineRoll, spinePitch, -torsoTwist * 0.75);

    this.bruteHead.rotation.set(
      isStunned ? Math.sin(timeSec * 22) * 0.1 : -spineRoll * 0.5,
      isStunned ? 0.38 : -spinePitch * 0.52,
      isStunned ? Math.sin(timeSec * 11) * 0.18 : torsoTwist * 0.4
    );

    // Clawed Gauntlet Arms
    if (isLunging) {
      const hammerL = Math.sin(timeSec * 14) * 0.22;
      const hammerR = Math.cos(timeSec * 14) * 0.22;
      this.bruteLeftArm.rotation.set(0.18, -1.35 + hammerL, -0.18);
      this.bruteLeftElbow.rotation.y = -0.35;
      this.bruteRightArm.rotation.set(-0.18, -1.35 + hammerR, 0.18);
      this.bruteRightElbow.rotation.y = -0.35;
    } else if (isStunned) {
      this.bruteLeftArm.rotation.set(-0.12, -0.12 + Math.sin(timeSec * 19) * 0.05, 0.05);
      this.bruteLeftElbow.rotation.y = -0.25;
      this.bruteRightArm.rotation.set(0.12, -0.12 - Math.sin(timeSec * 19) * 0.05, -0.05);
      this.bruteRightElbow.rotation.y = -0.25;
    } else if (isChasing) {
      const pump = stride * 0.65;
      this.bruteLeftArm.rotation.set(0.14, -0.78 + pump, -0.16);
      this.bruteLeftElbow.rotation.y = -0.58 - Math.max(0, -stride) * 0.25;
      this.bruteRightArm.rotation.set(-0.14, -0.78 - pump, 0.16);
      this.bruteRightElbow.rotation.y = -0.58 - Math.max(0, stride) * 0.25;
    } else if (isStalking) {
      const stalkSwing = stride * 0.36;
      this.bruteLeftArm.rotation.set(0.24, -0.45 + stalkSwing, -0.12);
      this.bruteLeftElbow.rotation.y = -0.45;
      this.bruteRightArm.rotation.set(-0.24, -0.45 - stalkSwing, 0.12);
      this.bruteRightElbow.rotation.y = -0.45;
    } else {
      const roamSwing = stride * 0.35;
      this.bruteLeftArm.rotation.set(0.08, -0.18 + roamSwing, 0);
      this.bruteLeftElbow.rotation.y = -0.28;
      this.bruteRightArm.rotation.set(-0.08, -0.18 - roamSwing, 0);
      this.bruteRightElbow.rotation.y = -0.28;
    }

    // Dynamic armor heat & molten furnace pulse per Brute state (subdued bronze trims, fierce core)
    const furnacePulse = 0.85 + Math.sin(timeSec * (isChasing ? 13 : 5)) * 0.15;
    if (isStunned) {
      this.bruteHullBundle.uTint.value.setHex(0x211513);
      this.bruteTrimBundle.uTint.value.setHex(0x3a180d);
      this.bruteHelmTrimBundle.uTint.value.setHex(0x3a180d);
      this.bruteGauntletRimBundle.uTint.value.setHex(0x3a180d);
      const dimFlicker = 0.25 + 0.12 * Math.sin(timeSec * 24);
      this.tmpColorA.setHex(0x3a1407);
      this.tmpColorB.setHex(0x7c2d12);
      this.bruteFurnaceBundle.uTint.value
        .copy(this.tmpColorA)
        .lerp(this.tmpColorB, dimFlicker);
      this.bruteFurnaceBundle.uEmissiveStrength.value = 0.14;
      this.bruteLeftEyeMesh.visible = false;
      this.bruteRightEyeMesh.visible = false;
    } else if (isChasing) {
      this.bruteHullBundle.uTint.value.setHex(0x3b1a13);
      this.bruteTrimBundle.uTint.value.setHex(0x8c2e12);
      this.bruteHelmTrimBundle.uTint.value.setHex(0x9a3412);
      this.bruteGauntletRimBundle.uTint.value.setHex(0x9a3412);
      this.tmpColorA.setHex(0xf97316);
      this.tmpColorB.setHex(0xffedd5);
      this.bruteFurnaceBundle.uTint.value
        .copy(this.tmpColorA)
        .lerp(this.tmpColorB, 0.45 * furnacePulse);
      this.bruteFurnaceBundle.uEmissiveStrength.value = 1.25 * furnacePulse;
      this.bruteEyeBundle.uTint.value.setHex(0xffedd5);
      this.bruteEyeBundle.uEmissiveStrength.value = 1.65;
      this.bruteLeftEyeMesh.visible = true;
      this.bruteRightEyeMesh.visible = true;
    } else if (isStalking) {
      this.bruteHullBundle.uTint.value.setHex(0x2d1814);
      this.bruteTrimBundle.uTint.value.setHex(0x6b2511);
      this.bruteHelmTrimBundle.uTint.value.setHex(0x742812);
      this.bruteGauntletRimBundle.uTint.value.setHex(0x742812);
      this.tmpColorA.setHex(0xc2410c);
      this.tmpColorB.setHex(0xfdba74);
      this.bruteFurnaceBundle.uTint.value
        .copy(this.tmpColorA)
        .lerp(this.tmpColorB, 0.35 * furnacePulse);
      this.bruteFurnaceBundle.uEmissiveStrength.value = 0.85 * furnacePulse;
      this.bruteEyeBundle.uTint.value.setHex(0xfdba74);
      this.bruteEyeBundle.uEmissiveStrength.value = 1.15;
      this.bruteLeftEyeMesh.visible = true;
      this.bruteRightEyeMesh.visible = true;
    } else {
      this.bruteHullBundle.uTint.value.setHex(0x261714);
      this.bruteTrimBundle.uTint.value.setHex(0x521f10);
      this.bruteHelmTrimBundle.uTint.value.setHex(0x5a2312);
      this.bruteGauntletRimBundle.uTint.value.setHex(0x5a2312);
      this.tmpColorA.setHex(0x9a3412);
      this.tmpColorB.setHex(0xf97316);
      this.bruteFurnaceBundle.uTint.value
        .copy(this.tmpColorA)
        .lerp(this.tmpColorB, 0.45 * furnacePulse);
      this.bruteFurnaceBundle.uEmissiveStrength.value = 0.65 * furnacePulse;
      this.bruteEyeBundle.uTint.value.setHex(0xfb923c);
      this.bruteEyeBundle.uEmissiveStrength.value = 0.95;
      this.bruteLeftEyeMesh.visible = true;
      this.bruteRightEyeMesh.visible = true;
    }

    // Update exact world-space 3D gleam anchors
    this.bruteRoot.updateMatrixWorld(true);
    this.bruteGleam.valid = !isStunned;
    this.bruteGleam.isChasing = isChasing;
    this.bruteGleam.isStalking = isStalking;

    this.bruteBrowAnchor.getWorldPosition(this.tmpVec3);
    this.bruteGleam.browX = this.tmpVec3.x;
    this.bruteGleam.browY = -this.tmpVec3.y;
    this.bruteGleam.browZ = this.tmpVec3.z;

    this.bruteLeftEyeAnchor.getWorldPosition(this.tmpVec3);
    this.bruteGleam.leftEyeX = this.tmpVec3.x;
    this.bruteGleam.leftEyeY = -this.tmpVec3.y;
    this.bruteGleam.leftEyeZ = this.tmpVec3.z;

    this.bruteRightEyeAnchor.getWorldPosition(this.tmpVec3);
    this.bruteGleam.rightEyeX = this.tmpVec3.x;
    this.bruteGleam.rightEyeY = -this.tmpVec3.y;
    this.bruteGleam.rightEyeZ = this.tmpVec3.z;

    this.bruteChestCoreAnchor.getWorldPosition(this.tmpVec3);
    this.bruteGleam.chestX = this.tmpVec3.x;
    this.bruteGleam.chestY = -this.tmpVec3.y;
    this.bruteGleam.chestZ = this.tmpVec3.z;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.worldScene.remove(this.playerRoot);
    this.worldScene.remove(this.bruteRoot);

    for (const g of this.sharedGeoms) g.dispose();
    this.sharedGeoms = [];
    for (const t of this.sharedTextures) t.dispose();
    this.sharedTextures = [];
    for (const m of this.sharedMaterials) m.dispose();
    this.sharedMaterials = [];
    this.wireMaterials = [];
  }
}

export function isPlayerOnDeck(map: ShipMap, deck: ShipDeck, y: number): boolean {
  const b = map.deckBounds[deck];
  const ty = Math.floor(y / map.tileSize);
  return ty >= b.y1 && ty <= b.y2;
}
