import * as THREE from 'three/webgpu';
import { createShadedCharacterMaterial, ShadedCharacterMaterialBundle } from './threeTsl';
import { ItemId } from './types';

function makeBox(w: number, d: number, h: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, d, h);
  g.translate(0, 0, h * 0.5);
  return g;
}

function makeCyl(
  rt: number,
  rb: number,
  h: number,
  seg = 12,
  centerZ = false
): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.rotateX(Math.PI * 0.5);
  if (!centerZ) g.translate(0, 0, h * 0.5);
  return g;
}

export class Item3DLibrary {
  private sharedGeoms: THREE.BufferGeometry[] = [];
  private sharedMaterials: ShadedCharacterMaterialBundle[] = [];
  private disposed = false;

  // Shared materials by finish for zero bloat across dozens of deck items
  private matSteelDark: ShadedCharacterMaterialBundle;
  private matSteelLight: ShadedCharacterMaterialBundle;
  private matBrass: ShadedCharacterMaterialBundle;
  private matCopper: ShadedCharacterMaterialBundle;
  private matRedPaint: ShadedCharacterMaterialBundle;
  private matRedRubber: ShadedCharacterMaterialBundle;
  private matYellow: ShadedCharacterMaterialBundle;
  private matAmberGlow: ShadedCharacterMaterialBundle;
  private matOrange: ShadedCharacterMaterialBundle;
  private matNavy: ShadedCharacterMaterialBundle;
  private matSky: ShadedCharacterMaterialBundle;
  private matTeal: ShadedCharacterMaterialBundle;
  private matEmeraldGlow: ShadedCharacterMaterialBundle;
  private matPorcelain: ShadedCharacterMaterialBundle;
  private matRubberBlack: ShadedCharacterMaterialBundle;
  private matFlareGlow: ShadedCharacterMaterialBundle;

  constructor() {
    const reg = (opts: Parameters<typeof createShadedCharacterMaterial>[0]) => {
      const b = createShadedCharacterMaterial(opts);
      this.sharedMaterials.push(b);
      return b;
    };

    this.matSteelDark = reg({ color: 0x334155, roughness: 0.48, metalness: 0.72 });
    this.matSteelLight = reg({ color: 0xcbd5e1, roughness: 0.28, metalness: 0.85 });
    this.matBrass = reg({ color: 0xd97706, roughness: 0.26, metalness: 0.88 });
    this.matCopper = reg({ color: 0xc2410c, roughness: 0.3, metalness: 0.85 });
    this.matRedPaint = reg({ color: 0xb91c1c, roughness: 0.4, metalness: 0.25 });
    this.matRedRubber = reg({ color: 0xdc2626, roughness: 0.75, metalness: 0.06 });
    this.matYellow = reg({ color: 0xfacc15, roughness: 0.42, metalness: 0.15 });
    this.matAmberGlow = reg({
      color: 0xfbbf24,
      roughness: 0.22,
      metalness: 0.2,
      emissiveColor: 0xf59e0b,
      emissiveStrength: 0.55,
    });
    this.matOrange = reg({ color: 0xea580c, roughness: 0.65, metalness: 0.08 });
    this.matNavy = reg({ color: 0x1e3a5f, roughness: 0.74, metalness: 0.08 });
    this.matSky = reg({ color: 0x38bdf8, roughness: 0.35, metalness: 0.45 });
    this.matTeal = reg({ color: 0x0d9488, roughness: 0.34, metalness: 0.55 });
    this.matEmeraldGlow = reg({
      color: 0x4ade80,
      roughness: 0.2,
      metalness: 0.1,
      emissiveColor: 0x22c55e,
      emissiveStrength: 0.72,
    });
    this.matPorcelain = reg({ color: 0xe2e8f0, roughness: 0.25, metalness: 0.05 });
    this.matRubberBlack = reg({ color: 0x0f172a, roughness: 0.85, metalness: 0.1 });
    this.matFlareGlow = reg({
      color: 0xfb7185,
      roughness: 0.25,
      metalness: 0.1,
      emissiveColor: 0xf43f5e,
      emissiveStrength: 0.65,
    });
  }

  private g<T extends THREE.BufferGeometry>(geom: T): T {
    this.sharedGeoms.push(geom);
    return geom;
  }

  public createItemGroup(item: ItemId): THREE.Group {
    const root = new THREE.Group();
    root.name = `item_${item}`;

    switch (item) {
      case 'BACKPACK': {
        const body = new THREE.Mesh(this.g(makeBox(11.5, 13.5, 7.5)), this.matNavy.material);
        const topPocket = new THREE.Mesh(this.g(makeBox(9.2, 6.2, 2.2)), this.matOrange.material);
        topPocket.position.set(0, -1.8, 7.2);
        const flap = new THREE.Mesh(this.g(makeBox(10.6, 8.2, 1.4)), this.matNavy.material);
        flap.position.set(0, 1.6, 7.2);
        const strapL = new THREE.Mesh(this.g(makeBox(2.0, 11.0, 1.2)), this.matRubberBlack.material);
        strapL.position.set(-3.4, 0, 0.2);
        const strapR = new THREE.Mesh(this.g(makeBox(2.0, 11.0, 1.2)), this.matRubberBlack.material);
        strapR.position.set(3.4, 0, 0.2);
        const buckleL = new THREE.Mesh(this.g(makeBox(1.8, 1.8, 1.5)), this.matBrass.material);
        buckleL.position.set(-2.9, 3.0, 7.8);
        const buckleR = new THREE.Mesh(this.g(makeBox(1.8, 1.8, 1.5)), this.matBrass.material);
        buckleR.position.set(2.9, 3.0, 7.8);
        const handle = new THREE.Mesh(this.g(makeBox(4.8, 1.4, 1.6)), this.matOrange.material);
        handle.position.set(0, -6.4, 6.6);
        root.add(body, topPocket, flap, strapL, strapR, buckleL, buckleR, handle);
        break;
      }

      case 'MASTER_FUSE': {
        const capL = new THREE.Mesh(this.g(makeCyl(3.0, 3.0, 3.4, 12, true)), this.matBrass.material);
        capL.rotation.z = Math.PI * 0.5;
        capL.position.set(-4.8, 0, 3.4);
        const capR = new THREE.Mesh(this.g(makeCyl(3.0, 3.0, 3.4, 12, true)), this.matBrass.material);
        capR.rotation.z = Math.PI * 0.5;
        capR.position.set(4.8, 0, 3.4);
        const body = new THREE.Mesh(this.g(makeCyl(2.5, 2.5, 6.4, 12, true)), this.matPorcelain.material);
        body.rotation.z = Math.PI * 0.5;
        body.position.set(0, 0, 3.4);
        const core = new THREE.Mesh(this.g(makeBox(4.4, 2.4, 2.4)), this.matAmberGlow.material);
        core.position.set(0, 0, 4.4);
        const ring = new THREE.Mesh(this.g(makeCyl(3.15, 3.15, 1.2, 12, true)), this.matCopper.material);
        ring.rotation.z = Math.PI * 0.5;
        ring.position.set(0, 0, 3.4);
        root.add(capL, capR, body, core, ring);
        break;
      }

      case 'BOLT_CUTTERS': {
        const gripL = new THREE.Mesh(this.g(makeBox(8.8, 2.0, 2.0)), this.matRedRubber.material);
        gripL.position.set(-2.8, -2.0, 0.2);
        gripL.rotation.z = 0.2;
        const gripR = new THREE.Mesh(this.g(makeBox(8.8, 2.0, 2.0)), this.matRedRubber.material);
        gripR.position.set(-2.8, 2.0, 0.2);
        gripR.rotation.z = -0.2;
        const shankL = new THREE.Mesh(this.g(makeBox(4.6, 1.3, 1.6)), this.matSteelDark.material);
        shankL.position.set(2.0, -1.2, 0.4);
        shankL.rotation.z = 0.18;
        const shankR = new THREE.Mesh(this.g(makeBox(4.6, 1.3, 1.6)), this.matSteelDark.material);
        shankR.position.set(2.0, 1.2, 0.4);
        shankR.rotation.z = -0.18;
        const jaw = new THREE.Mesh(this.g(makeBox(4.2, 4.4, 2.0)), this.matSteelLight.material);
        jaw.position.set(5.4, 0, 0.3);
        const pivot = new THREE.Mesh(this.g(makeCyl(1.4, 1.4, 2.5, 10)), this.matBrass.material);
        pivot.position.set(4.1, 0, 0.2);
        root.add(gripL, gripR, shankL, shankR, jaw, pivot);
        break;
      }

      case 'FLARE': {
        const tube = new THREE.Mesh(this.g(makeCyl(2.0, 2.0, 11.0, 12, true)), this.matRedPaint.material);
        tube.rotation.z = Math.PI * 0.5;
        tube.position.set(0, 0, 2.2);
        const collar = new THREE.Mesh(this.g(makeCyl(2.25, 2.25, 1.8, 12, true)), this.matRubberBlack.material);
        collar.rotation.z = Math.PI * 0.5;
        collar.position.set(3.4, 0, 2.2);
        const tip = new THREE.Mesh(this.g(makeCyl(1.75, 2.1, 2.2, 12, true)), this.matFlareGlow.material);
        tip.rotation.z = Math.PI * 0.5;
        tip.position.set(5.6, 0, 2.2);
        const endCap = new THREE.Mesh(this.g(makeCyl(2.15, 2.15, 1.5, 12, true)), this.matBrass.material);
        endCap.rotation.z = Math.PI * 0.5;
        endCap.position.set(-5.2, 0, 2.2);
        root.add(tube, collar, tip, endCap);
        break;
      }

      case 'GLOWSTICK': {
        const rod = new THREE.Mesh(this.g(makeCyl(1.5, 1.5, 10.6, 12, true)), this.matEmeraldGlow.material);
        rod.rotation.z = Math.PI * 0.5;
        rod.position.set(0, 0, 1.8);
        const capA = new THREE.Mesh(this.g(makeCyl(1.8, 1.8, 2.0, 8, true)), this.matRubberBlack.material);
        capA.rotation.z = Math.PI * 0.5;
        capA.position.set(-4.8, 0, 1.8);
        const capB = new THREE.Mesh(this.g(makeCyl(1.7, 1.7, 1.5, 8, true)), this.matSteelDark.material);
        capB.rotation.z = Math.PI * 0.5;
        capB.position.set(5.0, 0, 1.8);
        root.add(rod, capA, capB);
        break;
      }

      case 'BATTERY_PACK': {
        const casing = new THREE.Mesh(this.g(makeBox(9.0, 6.2, 5.2)), this.matRubberBlack.material);
        const band = new THREE.Mesh(this.g(makeBox(9.2, 6.4, 2.6)), this.matYellow.material);
        band.position.set(0, 0, 1.2);
        const postL = new THREE.Mesh(this.g(makeCyl(1.1, 1.1, 1.8, 10)), this.matBrass.material);
        postL.position.set(-2.2, 0, 5.1);
        const postR = new THREE.Mesh(this.g(makeCyl(1.1, 1.1, 1.8, 10)), this.matCopper.material);
        postR.position.set(2.2, 0, 5.1);
        root.add(casing, band, postL, postR);
        break;
      }

      case 'FIRE_EXTINGUISHER': {
        const tank = new THREE.Mesh(this.g(makeCyl(2.8, 2.8, 10.5, 14, true)), this.matRedPaint.material);
        tank.rotation.z = Math.PI * 0.5;
        tank.position.set(-0.6, 0, 3.0);
        const valve = new THREE.Mesh(this.g(makeCyl(1.4, 1.8, 2.2, 10, true)), this.matBrass.material);
        valve.rotation.z = Math.PI * 0.5;
        valve.position.set(5.4, 0, 3.0);
        const horn = new THREE.Mesh(this.g(makeCyl(1.6, 0.7, 3.4, 10, true)), this.matRubberBlack.material);
        horn.rotation.z = Math.PI * 0.2;
        horn.position.set(4.5, 2.6, 3.8);
        const label = new THREE.Mesh(this.g(makeBox(4.8, 5.9, 2.4)), this.matPorcelain.material);
        label.position.set(-0.8, 0, 3.6);
        root.add(tank, valve, horn, label);
        break;
      }

      case 'AVIATION_FUEL': {
        const can = new THREE.Mesh(this.g(makeBox(9.6, 6.8, 9.2)), this.matRedPaint.material);
        const rib = new THREE.Mesh(this.g(makeBox(6.8, 7.2, 5.4)), this.matCopper.material);
        rib.position.set(-0.4, 0, 1.8);
        const handle = new THREE.Mesh(this.g(makeBox(5.6, 1.8, 1.8)), this.matSteelDark.material);
        handle.position.set(-1.2, 0, 9.2);
        const spout = new THREE.Mesh(this.g(makeCyl(1.1, 1.3, 3.2, 10)), this.matBrass.material);
        spout.rotation.y = 0.45;
        spout.position.set(3.6, 0, 8.8);
        root.add(can, rib, handle, spout);
        break;
      }

      case 'ROTOR_FUSE': {
        const block = new THREE.Mesh(this.g(makeBox(9.4, 6.8, 4.6)), this.matSteelDark.material);
        const top = new THREE.Mesh(this.g(makeBox(7.4, 5.0, 1.4)), this.matAmberGlow.material);
        top.position.set(0, 0, 4.6);
        const prongL = new THREE.Mesh(this.g(makeBox(2.2, 1.3, 2.2)), this.matBrass.material);
        prongL.position.set(-5.4, -1.8, 1.0);
        const prongR = new THREE.Mesh(this.g(makeBox(2.2, 1.3, 2.2)), this.matBrass.material);
        prongR.position.set(-5.4, 1.8, 1.0);
        const coil = new THREE.Mesh(this.g(makeCyl(1.7, 1.7, 2.0, 10)), this.matCopper.material);
        coil.position.set(2.2, 0, 4.8);
        root.add(block, top, prongL, prongR, coil);
        break;
      }

      case 'IGNITION_KEY': {
        const fob = new THREE.Mesh(this.g(makeBox(6.8, 3.4, 1.4)), this.matAmberGlow.material);
        fob.position.set(-2.5, 0, 0.8);
        const bow = new THREE.Mesh(this.g(makeCyl(2.2, 2.2, 1.2, 10)), this.matBrass.material);
        bow.position.set(1.8, 0, 1.0);
        const shaft = new THREE.Mesh(this.g(makeBox(5.4, 1.2, 1.0)), this.matBrass.material);
        shaft.position.set(4.8, 0, 1.1);
        const teeth = new THREE.Mesh(this.g(makeBox(2.6, 1.4, 1.0)), this.matSteelLight.material);
        teeth.position.set(5.8, 0.9, 1.1);
        root.add(fob, bow, shaft, teeth);
        break;
      }

      case 'HULL_PATCH': {
        const plate = new THREE.Mesh(this.g(makeBox(11.6, 8.8, 1.8)), this.matSky.material);
        const seam = new THREE.Mesh(this.g(makeBox(11.8, 2.0, 2.3)), this.matRubberBlack.material);
        const clampL = new THREE.Mesh(this.g(makeBox(2.0, 9.2, 2.6)), this.matSteelLight.material);
        clampL.position.set(-3.4, 0, 0);
        const clampR = new THREE.Mesh(this.g(makeBox(2.0, 9.2, 2.6)), this.matSteelLight.material);
        clampR.position.set(3.4, 0, 0);
        root.add(plate, seam, clampL, clampR);
        break;
      }

      case 'WINCH_CRANK': {
        const hub = new THREE.Mesh(this.g(makeCyl(2.4, 2.4, 3.6, 12)), this.matSteelDark.material);
        hub.position.set(-4.2, 0, 0);
        const arm = new THREE.Mesh(this.g(makeBox(9.2, 2.2, 1.8)), this.matSteelLight.material);
        arm.position.set(0.2, 0, 1.8);
        const handle = new THREE.Mesh(this.g(makeCyl(1.3, 1.3, 4.6, 10)), this.matSky.material);
        handle.position.set(4.4, 0, 3.0);
        root.add(hub, arm, handle);
        break;
      }

      case 'MARINE_BATTERY': {
        const box = new THREE.Mesh(this.g(makeBox(10.8, 7.6, 6.2)), this.matRubberBlack.material);
        const lid = new THREE.Mesh(this.g(makeBox(11.2, 8.0, 1.8)), this.matSky.material);
        lid.position.set(0, 0, 6.0);
        const postA = new THREE.Mesh(this.g(makeCyl(1.1, 1.1, 1.8, 10)), this.matSteelLight.material);
        postA.position.set(-3.0, -1.6, 7.6);
        const postB = new THREE.Mesh(this.g(makeCyl(1.1, 1.1, 1.8, 10)), this.matRedPaint.material);
        postB.position.set(3.0, -1.6, 7.6);
        const strap = new THREE.Mesh(this.g(makeBox(7.0, 1.4, 1.2)), this.matBrass.material);
        strap.position.set(0, 1.8, 7.6);
        root.add(box, lid, postA, postB, strap);
        break;
      }

      case 'SUB_BATTERY': {
        const cell = new THREE.Mesh(this.g(makeBox(10.6, 7.4, 6.2)), this.matTeal.material);
        const cap = new THREE.Mesh(this.g(makeBox(11.0, 7.8, 1.8)), this.matSteelDark.material);
        cap.position.set(0, 0, 6.0);
        const gauge = new THREE.Mesh(this.g(makeBox(3.4, 2.6, 0.9)), this.matEmeraldGlow.material);
        gauge.position.set(0, 0, 7.8);
        const postA = new THREE.Mesh(this.g(makeCyl(1.1, 1.1, 1.6, 10)), this.matBrass.material);
        postA.position.set(-3.5, 0, 7.6);
        const postB = new THREE.Mesh(this.g(makeCyl(1.1, 1.1, 1.6, 10)), this.matCopper.material);
        postB.position.set(3.5, 0, 7.6);
        root.add(cell, cap, gauge, postA, postB);
        break;
      }

      case 'BALLAST_PUMP': {
        const housing = new THREE.Mesh(this.g(makeCyl(4.4, 4.4, 4.4, 14)), this.matTeal.material);
        const flange = new THREE.Mesh(this.g(makeCyl(2.4, 2.4, 5.6, 12, true)), this.matBrass.material);
        flange.rotation.z = Math.PI * 0.5;
        flange.position.set(3.2, 0, 2.4);
        const intake = new THREE.Mesh(this.g(makeCyl(2.4, 2.4, 2.2, 12)), this.matSteelLight.material);
        intake.position.set(-1.0, 0, 4.2);
        const base = new THREE.Mesh(this.g(makeBox(9.2, 7.6, 1.4)), this.matSteelDark.material);
        root.add(base, housing, flange, intake);
        break;
      }

      case 'DIVE_KEY': {
        const card = new THREE.Mesh(this.g(makeBox(8.6, 5.4, 1.8)), this.matTeal.material);
        const spine = new THREE.Mesh(this.g(makeBox(8.8, 1.8, 2.4)), this.matSteelDark.material);
        spine.position.set(0, -1.6, 0);
        const pins = new THREE.Mesh(this.g(makeBox(2.8, 3.6, 2.1)), this.matBrass.material);
        pins.position.set(3.4, 0.5, 0);
        const dot = new THREE.Mesh(this.g(makeCyl(1.0, 1.0, 2.2, 10)), this.matEmeraldGlow.material);
        dot.position.set(-2.2, 0.6, 0.2);
        root.add(card, spine, pins, dot);
        break;
      }
    }

    return root;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.sharedGeoms) g.dispose();
    this.sharedGeoms = [];
    for (const m of this.sharedMaterials) m.material.dispose();
    this.sharedMaterials = [];
  }
}
