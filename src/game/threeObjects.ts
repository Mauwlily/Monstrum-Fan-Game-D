import * as THREE from 'three/webgpu';
import { MonstrumGameEngine } from './engine';
import { isTileWalkable } from './mapGen';
import { Item3DLibrary } from './threeItems';
import { createShadedCharacterMaterial, ShadedCharacterMaterialBundle } from './threeTsl';
import {
  Container,
  ContainerType,
  CursorContainerTarget,
  FuseSocket,
  HidingSpot,
  ItemId,
  PaperMapStand,
  RoomLightSwitch,
  ShipDeck,
  ShipMap,
  ShipProp,
  SteamPipe,
} from './types';

function makeBox(w: number, d: number, h: number, centerZ = false): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, d, h);
  if (!centerZ) g.translate(0, 0, h * 0.5);
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

function resolveTileWallFacing(map: ShipMap, tx: number, ty: number): {
  angle: number;
  wallOffsetX: number;
  wallOffsetY: number;
} {
  const dirs = [
    { dx: 0, dy: -1, ang: Math.PI * 0.5 }, // Wall is North -> face South (+Y world)
    { dx: 0, dy: 1, ang: -Math.PI * 0.5 }, // Wall is South -> face North (-Y world)
    { dx: -1, dy: 0, ang: 0 }, // Wall is West -> face East (+X world)
    { dx: 1, dy: 0, ang: Math.PI }, // Wall is East -> face West (-X world)
  ];
  for (const d of dirs) {
    if (map.tiles[ty + d.dy]?.[tx + d.dx] === 'WALL') {
      const fwdWalkable = isTileWalkable(map.tiles[ty - d.dy]?.[tx - d.dx] ?? 'VOID');
      if (fwdWalkable) {
        return {
          angle: d.ang,
          wallOffsetX: d.dx * (map.tileSize * 0.34),
          wallOffsetY: d.dy * (map.tileSize * 0.34),
        };
      }
    }
  }
  return { angle: Math.PI * 0.5, wallOffsetX: 0, wallOffsetY: 0 };
}

interface ContainerRig {
  container: Container;
  deck: ShipDeck;
  root: THREE.Group;
  movingPart: THREE.Group;
  doorLeft?: THREE.Group;
  doorRight?: THREE.Group;
  itemMount: THREE.Group;
  mountedItemId: ItemId | null;
  itemGroup: THREE.Group | null;
  containerHitMesh: THREE.Mesh;
  itemHitMesh: THREE.Mesh;
  hoverRing: THREE.Mesh;
  itemHoverRing: THREE.Mesh;
}

interface HidingSpotRig {
  spot: HidingSpot;
  deck: ShipDeck;
  root: THREE.Group;
  doorPivot?: THREE.Group;
  statusLightMesh?: THREE.Mesh;
  occupiedColorMat?: ShadedCharacterMaterialBundle;
}

interface PaperMapRig {
  stand: PaperMapStand;
  deck: ShipDeck;
  root: THREE.Group;
  pinMesh: THREE.Mesh;
}

interface FuseSocketRig {
  socket: FuseSocket;
  deck: ShipDeck;
  root: THREE.Group;
  cartridgeMesh: THREE.Mesh;
  ledMesh: THREE.Mesh;
  ledMat: ShadedCharacterMaterialBundle;
}

interface LightSwitchRig {
  sw: RoomLightSwitch;
  deck: ShipDeck;
  root: THREE.Group;
  paddleGroup: THREE.Group;
  lockCover: THREE.Mesh;
  ledMesh: THREE.Mesh;
  ledMat: ShadedCharacterMaterialBundle;
}

interface SteamPipeRig {
  pipe: SteamPipe;
  deck: ShipDeck;
  root: THREE.Group;
  gaugeDial: THREE.Mesh;
  gaugeMat: ShadedCharacterMaterialBundle;
  plumeGroup: THREE.Group;
  plumeOuter: THREE.Mesh;
  plumeCore: THREE.Mesh;
}

interface DynamicItemVisual {
  group: THREE.Group;
  halo?: THREE.Mesh;
  haloMat?: THREE.MeshBasicMaterial;
  ember?: THREE.Mesh;
}

interface StaticPropVisual {
  deck: ShipDeck;
  cx: number;
  cy: number;
  halfSpan: number;
  root: THREE.Group;
}

export class ShipObjects3D {
  private map: ShipMap;
  private worldScene: THREE.Scene;
  private itemLib: Item3DLibrary;
  private disposed = false;

  private sharedGeoms: THREE.BufferGeometry[] = [];
  private sharedMaterials: ShadedCharacterMaterialBundle[] = [];
  private basicMaterials: THREE.Material[] = [];

  private containerRigs: ContainerRig[] = [];
  private hidingRigs: HidingSpotRig[] = [];
  private paperMapRigs: PaperMapRig[] = [];
  private fuseRigs: FuseSocketRig[] = [];
  private switchRigs: LightSwitchRig[] = [];
  private steamRigs: SteamPipeRig[] = [];
  private staticPropVisuals: StaticPropVisual[] = [];

  private pickupVisuals = new Map<number, DynamicItemVisual>();
  private droppedLightVisuals = new Map<number, DynamicItemVisual>();

  // Raycast hit proxy material (transparent opacity=0 so Raycaster hits while keeping visual scene clean)
  private hitProxyMat: THREE.MeshBasicMaterial;
  private hoverRingMat: THREE.MeshBasicMaterial;
  private itemHoverRingMat: THREE.MeshBasicMaterial;
  private steamOuterMat: THREE.MeshBasicMaterial;
  private steamCoreMat: THREE.MeshBasicMaterial;

  // Shared PBR-style TSL materials
  private matSteelDark: ShadedCharacterMaterialBundle;
  private matSteelMid: ShadedCharacterMaterialBundle;
  private matSteelLight: ShadedCharacterMaterialBundle;
  private matOliveSteel: ShadedCharacterMaterialBundle;
  private matRedPaint: ShadedCharacterMaterialBundle;
  private matRedDark: ShadedCharacterMaterialBundle;
  private matWood: ShadedCharacterMaterialBundle;
  private matWoodDark: ShadedCharacterMaterialBundle;
  private matBrass: ShadedCharacterMaterialBundle;
  private matCopper: ShadedCharacterMaterialBundle;
  private matAmber: ShadedCharacterMaterialBundle;
  private matCyan: ShadedCharacterMaterialBundle;
  private matTeal: ShadedCharacterMaterialBundle;
  private matNavy: ShadedCharacterMaterialBundle;
  private matParchment: ShadedCharacterMaterialBundle;
  private matCavityDark: ShadedCharacterMaterialBundle;
  private matMattress: ShadedCharacterMaterialBundle;
  private matWhiteCloth: ShadedCharacterMaterialBundle;
  private matGlassPane: ShadedCharacterMaterialBundle;

  private raycastHitMeshes: THREE.Object3D[] = [];
  private raycastDeckKey = '';
  private pickupHaloGeom: THREE.RingGeometry;

  constructor(map: ShipMap, worldScene: THREE.Scene) {
    this.map = map;
    this.worldScene = worldScene;
    this.itemLib = new Item3DLibrary();

    const regMat = (opts: Parameters<typeof createShadedCharacterMaterial>[0]) => {
      const b = createShadedCharacterMaterial(opts);
      this.sharedMaterials.push(b);
      return b;
    };

    this.matSteelDark = regMat({ color: 0x1e293b, roughness: 0.62, metalness: 0.58 });
    this.matSteelMid = regMat({ color: 0x334155, roughness: 0.52, metalness: 0.64 });
    this.matSteelLight = regMat({ color: 0x94a3b8, roughness: 0.34, metalness: 0.78 });
    this.matOliveSteel = regMat({ color: 0x4b5548, roughness: 0.56, metalness: 0.45 });
    this.matRedPaint = regMat({ color: 0x991b1b, roughness: 0.44, metalness: 0.3 });
    this.matRedDark = regMat({ color: 0x7f1d1d, roughness: 0.55, metalness: 0.25 });
    this.matWood = regMat({ color: 0x6b4c32, roughness: 0.76, metalness: 0.05 });
    this.matWoodDark = regMat({ color: 0x453120, roughness: 0.8, metalness: 0.04 });
    this.matBrass = regMat({ color: 0xd97706, roughness: 0.28, metalness: 0.86 });
    this.matCopper = regMat({ color: 0xb45309, roughness: 0.34, metalness: 0.82 });
    this.matAmber = regMat({
      color: 0xf59e0b,
      roughness: 0.3,
      metalness: 0.35,
      emissiveColor: 0xf59e0b,
      emissiveStrength: 0.28,
    });
    this.matCyan = regMat({
      color: 0x38bdf8,
      roughness: 0.3,
      metalness: 0.35,
      emissiveColor: 0x0284c7,
      emissiveStrength: 0.35,
    });
    this.matTeal = regMat({ color: 0x0f766e, roughness: 0.42, metalness: 0.48 });
    this.matNavy = regMat({ color: 0x1e3a5f, roughness: 0.72, metalness: 0.08 });
    this.matParchment = regMat({ color: 0xe7dcc2, roughness: 0.85, metalness: 0.02 });
    this.matCavityDark = regMat({ color: 0x090d14, roughness: 0.92, metalness: 0.1 });
    this.matMattress = regMat({ color: 0x264166, roughness: 0.85, metalness: 0.02 });
    this.matWhiteCloth = regMat({ color: 0xcbd5e1, roughness: 0.85, metalness: 0.02 });
    this.matGlassPane = regMat({
      color: 0x93c5fd,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });

    this.hitProxyMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
    });
    this.pickupHaloGeom = this.g(new THREE.RingGeometry(8.5, 11.2, 20));
    this.hoverRingMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.itemHoverRingMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.steamOuterMat = new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.steamCoreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.basicMaterials.push(
      this.hitProxyMat,
      this.hoverRingMat,
      this.itemHoverRingMat,
      this.steamOuterMat,
      this.steamCoreMat
    );

    this.buildContainers();
    this.buildHidingSpots();
    this.buildPaperMaps();
    this.buildFuseSockets();
    this.buildLightSwitches();
    this.buildSteamPipes();
    this.buildStaticBlockingProps();
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

  private buildContainers(): void {
    const hoverRingGeom = this.g(new THREE.RingGeometry(13.5, 16.5, 24));
    const itemRingGeom = this.g(new THREE.RingGeometry(6.8, 9.2, 20));
    const itemHitGeom = this.g(makeBox(16, 16, 16, true));

    for (const c of this.map.containers) {
      const deck = this.map.deckGrid[c.ty]?.[c.tx] ?? 'DECK_2';
      const root = new THREE.Group();
      root.position.set(c.x, -c.y, 0);
      root.rotation.z = -c.angle;

      const movingPart = new THREE.Group();
      const itemMount = new THREE.Group();
      let doorLeft: THREE.Group | undefined;
      let doorRight: THREE.Group | undefined;
      let hitW = 28;
      let hitD = 26;
      let hitH = 22;

      if (c.type === 'DRAWER') {
        // Heavy industrial 3-drawer steel unit (replaces Supply Crate)
        const housing = new THREE.Mesh(this.g(makeBox(22, 24, 19)), this.matOliveSteel.material);
        housing.position.set(-2, 0, 0);
        const topRim = new THREE.Mesh(this.g(makeBox(23, 25, 2.2)), this.matSteelDark.material);
        topRim.position.set(-2, 0, 18.6);
        const wellBack = new THREE.Mesh(this.g(makeBox(17, 19, 6.2)), this.matCavityDark.material);
        wellBack.position.set(-1.5, 0, 12.2);
        const sideRailL = new THREE.Mesh(this.g(makeBox(22, 2.2, 19)), this.matSteelDark.material);
        sideRailL.position.set(-2, -11.4, 0);
        const sideRailR = new THREE.Mesh(this.g(makeBox(22, 2.2, 19)), this.matSteelDark.material);
        sideRailR.position.set(-2, 11.4, 0);
        root.add(housing, topRim, wellBack, sideRailL, sideRailR);

        // Sliding top drawer tray
        const trayFloor = new THREE.Mesh(this.g(makeBox(19, 19, 1.4)), this.matSteelMid.material);
        trayFloor.position.set(0, 0, 12.6);
        const trayWallL = new THREE.Mesh(this.g(makeBox(18, 1.5, 4.4)), this.matSteelMid.material);
        trayWallL.position.set(0, -8.8, 12.8);
        const trayWallR = new THREE.Mesh(this.g(makeBox(18, 1.5, 4.4)), this.matSteelMid.material);
        trayWallR.position.set(0, 8.8, 12.8);
        const trayFront = new THREE.Mesh(this.g(makeBox(2.2, 20.5, 5.8)), this.matSteelLight.material);
        trayFront.position.set(9.4, 0, 12.2);
        const handle = new THREE.Mesh(this.g(makeBox(1.8, 8.5, 1.8)), this.matBrass.material);
        handle.position.set(11.1, 0, 14.2);
        // Lower closed drawer fronts for visual richness
        const lowFront1 = new THREE.Mesh(this.g(makeBox(1.6, 20.2, 4.8)), this.matSteelDark.material);
        lowFront1.position.set(9.2, 0, 6.4);
        const lowFront2 = new THREE.Mesh(this.g(makeBox(1.6, 20.2, 4.8)), this.matSteelDark.material);
        lowFront2.position.set(9.2, 0, 1.0);
        root.add(lowFront1, lowFront2);

        movingPart.add(trayFloor, trayWallL, trayWallR, trayFront, handle);
        itemMount.position.set(1.5, 0, 14.1);
        movingPart.add(itemMount);
        root.add(movingPart);
        hitW = 28;
        hitD = 26;
        hitH = 21;
      } else if (c.type === 'TOOLBOX') {
        // Cantilevered crimson steel toolbox with hinged lid
        const base = new THREE.Mesh(this.g(makeBox(17, 23, 9.5)), this.matRedPaint.material);
        const rim = new THREE.Mesh(this.g(makeBox(18, 24, 1.4)), this.matSteelDark.material);
        rim.position.set(0, 0, 9.2);
        const innerWell = new THREE.Mesh(this.g(makeBox(14.5, 20.5, 2.2)), this.matCavityDark.material);
        innerWell.position.set(0, 0, 8.0);
        const latch = new THREE.Mesh(this.g(makeBox(1.8, 5.0, 2.4)), this.matSteelLight.material);
        latch.position.set(9.0, 0, 7.6);
        root.add(base, rim, innerWell, latch);

        // Hinged lid pivots around rear (-X = -8.5, z = 10.2)
        movingPart.position.set(-8.5, 0, 10.2);
        const lidShell = new THREE.Mesh(this.g(makeBox(17.5, 23.5, 4.2)), this.matRedPaint.material);
        lidShell.position.set(8.5, 0, 0);
        const handleBar = new THREE.Mesh(this.g(makeBox(2.2, 10.5, 2.4)), this.matSteelLight.material);
        handleBar.position.set(8.5, 0, 4.2);
        const clasp = new THREE.Mesh(this.g(makeBox(1.8, 4.2, 1.8)), this.matBrass.material);
        clasp.position.set(17.2, 0, 0.2);
        movingPart.add(lidShell, handleBar, clasp);

        itemMount.position.set(0.8, 0, 10.2);
        root.add(movingPart, itemMount);
        hitW = 23;
        hitD = 26;
        hitH = 16;
      } else if (c.type === 'CABINET') {
        // Tall industrial steel storage cabinet with twin hinged doors
        const back = new THREE.Mesh(this.g(makeBox(14, 24, 25)), this.matSteelMid.material);
        back.position.set(-4, 0, 0);
        const sideL = new THREE.Mesh(this.g(makeBox(20, 2.2, 25)), this.matSteelMid.material);
        sideL.position.set(-1, -11, 0);
        const sideR = new THREE.Mesh(this.g(makeBox(20, 2.2, 25)), this.matSteelMid.material);
        sideR.position.set(-1, 11, 0);
        const top = new THREE.Mesh(this.g(makeBox(21, 24.4, 2.2)), this.matSteelDark.material);
        top.position.set(-1, 0, 23.4);
        const shelf = new THREE.Mesh(this.g(makeBox(17.5, 20.5, 1.6)), this.matSteelLight.material);
        shelf.position.set(-0.5, 0, 13.5);
        const interiorDark = new THREE.Mesh(this.g(makeBox(10, 19.5, 21)), this.matCavityDark.material);
        interiorDark.position.set(-2.5, 0, 1.5);
        root.add(back, sideL, sideR, top, shelf, interiorDark);

        doorLeft = new THREE.Group();
        doorLeft.position.set(8.8, -10.4, 1.5);
        const leafL = new THREE.Mesh(this.g(makeBox(1.8, 10.2, 21.5)), this.matSteelMid.material);
        leafL.position.set(0, 5.1, 0);
        const handleL = new THREE.Mesh(this.g(makeBox(1.5, 1.4, 4.5)), this.matBrass.material);
        handleL.position.set(1.2, 8.8, 9.5);
        doorLeft.add(leafL, handleL);

        doorRight = new THREE.Group();
        doorRight.position.set(8.8, 10.4, 1.5);
        const leafR = new THREE.Mesh(this.g(makeBox(1.8, 10.2, 21.5)), this.matSteelMid.material);
        leafR.position.set(0, -5.1, 0);
        const handleR = new THREE.Mesh(this.g(makeBox(1.5, 1.4, 4.5)), this.matBrass.material);
        handleR.position.set(1.2, -8.8, 9.5);
        doorRight.add(leafR, handleR);

        itemMount.position.set(1.2, 0, 15.2);
        root.add(doorLeft, doorRight, itemMount);
        hitW = 24;
        hitD = 26;
        hitH = 26;
      } else {
        // DESK: Captain/bridge officer steel & mahogany desk with sliding front drawer
        const legL = new THREE.Mesh(this.g(makeBox(17, 6.2, 18.5)), this.matSteelDark.material);
        legL.position.set(0, -10.5, 0);
        const legR = new THREE.Mesh(this.g(makeBox(17, 6.2, 18.5)), this.matSteelDark.material);
        legR.position.set(0, 10.5, 0);
        const backPanel = new THREE.Mesh(this.g(makeBox(2.2, 26, 18)), this.matSteelDark.material);
        backPanel.position.set(-7.4, 0, 0);
        const desktop = new THREE.Mesh(this.g(makeBox(19, 28, 2.2)), this.matWood.material);
        desktop.position.set(0, 0, 18.5);
        const blotter = new THREE.Mesh(this.g(makeBox(11, 16, 0.7)), this.matNavy.material);
        blotter.position.set(0.5, -1.5, 20.6);
        const lampBase = new THREE.Mesh(this.g(makeCyl(2.4, 2.8, 2.5, 10)), this.matBrass.material);
        lampBase.position.set(-4.5, 8.8, 20.6);
        root.add(legL, legR, backPanel, desktop, blotter, lampBase);

        const dFloor = new THREE.Mesh(this.g(makeBox(14, 13.5, 1.2)), this.matWoodDark.material);
        dFloor.position.set(0, 0, 12.2);
        const dFront = new THREE.Mesh(this.g(makeBox(2.0, 14.5, 5.2)), this.matWood.material);
        dFront.position.set(7.5, 0, 11.8);
        const dPull = new THREE.Mesh(this.g(makeBox(1.5, 4.6, 1.4)), this.matBrass.material);
        dPull.position.set(9.0, 0, 14.0);
        movingPart.add(dFloor, dFront, dPull);

        itemMount.position.set(1.0, 0, 13.4);
        movingPart.add(itemMount);
        root.add(movingPart);
        hitW = 24;
        hitD = 30;
        hitH = 22;
      }

      // Mount initial 3D item if present
      let itemGroup: THREE.Group | null = null;
      if (c.item) {
        itemGroup = this.itemLib.createItemGroup(c.item);
        itemMount.add(itemGroup);
      }

      const containerHitMesh = new THREE.Mesh(
        this.g(makeBox(hitW, hitD, hitH)),
        this.hitProxyMat
      );
      containerHitMesh.position.set(1.5, 0, 0);
      containerHitMesh.userData = { pickKind: 'CONTAINER', containerId: c.id };
      root.add(containerHitMesh);

      const itemHitMesh = new THREE.Mesh(itemHitGeom, this.hitProxyMat);
      itemHitMesh.position.set(0, 0, 3);
      itemHitMesh.userData = { pickKind: 'CONTAINER_ITEM', containerId: c.id };
      itemHitMesh.visible = false;
      itemMount.add(itemHitMesh);

      const hoverRing = new THREE.Mesh(hoverRingGeom, this.hoverRingMat);
      hoverRing.position.set(2, 0, 1.4);
      hoverRing.visible = false;
      root.add(hoverRing);

      const itemHoverRing = new THREE.Mesh(itemRingGeom, this.itemHoverRingMat);
      itemHoverRing.position.set(0, 0, 1.8);
      itemHoverRing.visible = false;
      itemMount.add(itemHoverRing);

      root.visible = false;
      this.setRenderOrderRecursive(root, 6);
      hoverRing.renderOrder = 15;
      itemHoverRing.renderOrder = 15;
      containerHitMesh.renderOrder = 16;
      itemHitMesh.renderOrder = 16;
      this.worldScene.add(root);

      this.containerRigs.push({
        container: c,
        deck,
        root,
        movingPart,
        doorLeft,
        doorRight,
        itemMount,
        mountedItemId: c.item,
        itemGroup,
        containerHitMesh,
        itemHitMesh,
        hoverRing,
        itemHoverRing,
      });
    }
  }

  private buildHidingSpots(): void {
    for (const s of this.map.hidingSpots) {
      const root = new THREE.Group();
      root.position.set(s.x, -s.y, 0);
      root.rotation.z = -s.angle;

      const occMat = createShadedCharacterMaterial({
        color: 0x334155,
        roughness: 0.48,
        metalness: 0.55,
      });
      this.sharedMaterials.push(occMat);

      let doorPivot: THREE.Group | undefined;
      let statusLightMesh: THREE.Mesh | undefined;

      if (s.type === 'LOCKER') {
        const body = new THREE.Mesh(this.g(makeBox(20, 24, 41)), this.matNavy.material);
        body.position.set(-2, 0, 0);
        const topCap = new THREE.Mesh(this.g(makeBox(21.5, 25.5, 2.2)), this.matSteelDark.material);
        topCap.position.set(-2, 0, 40.5);
        const inner = new THREE.Mesh(this.g(makeBox(14, 19, 37)), this.matCavityDark.material);
        inner.position.set(-2.5, 0, 1.5);
        root.add(body, topCap, inner);

        doorPivot = new THREE.Group();
        doorPivot.position.set(7.6, -10.5, 1.8);
        const doorLeaf = new THREE.Mesh(this.g(makeBox(2.2, 21.0, 38)), occMat.material);
        doorLeaf.position.set(0, 10.5, 0);
        const vent1 = new THREE.Mesh(this.g(makeBox(2.6, 13.0, 1.6)), this.matSteelDark.material);
        vent1.position.set(0.3, 10.5, 30);
        const vent2 = new THREE.Mesh(this.g(makeBox(2.6, 13.0, 1.6)), this.matSteelDark.material);
        vent2.position.set(0.3, 10.5, 26);
        const latch = new THREE.Mesh(this.g(makeBox(1.8, 2.2, 4.5)), this.matBrass.material);
        latch.position.set(1.2, 18.5, 17);
        doorPivot.add(doorLeaf, vent1, vent2, latch);
        root.add(doorPivot);
      } else if (s.type === 'UNDER_DESK') {
        const legL = new THREE.Mesh(this.g(makeBox(19, 5.2, 23)), occMat.material);
        legL.position.set(0, -12, 0);
        const legR = new THREE.Mesh(this.g(makeBox(19, 5.2, 23)), occMat.material);
        legR.position.set(0, 12, 0);
        const back = new THREE.Mesh(this.g(makeBox(2.4, 28, 22)), this.matSteelDark.material);
        back.position.set(-8.5, 0, 0);
        const top = new THREE.Mesh(this.g(makeBox(21, 30, 2.8)), this.matWood.material);
        top.position.set(0, 0, 23);
        const blotter = new THREE.Mesh(this.g(makeBox(12, 18, 0.8)), this.matNavy.material);
        blotter.position.set(0.5, 0, 25.8);
        const statusTrim = new THREE.Mesh(this.g(makeBox(2, 18, 1.8)), occMat.material);
        statusTrim.position.set(9.8, 0, 22.8);
        statusLightMesh = statusTrim;
        root.add(legL, legR, back, top, blotter, statusTrim);
      } else {
        // CARGO_CRATE hiding spot
        const shell = new THREE.Mesh(this.g(makeBox(25, 25, 29)), this.matWood.material);
        const trimT = new THREE.Mesh(this.g(makeBox(26.5, 26.5, 2.5)), this.matWoodDark.material);
        trimT.position.set(0, 0, 27.5);
        const trimB = new THREE.Mesh(this.g(makeBox(26.5, 26.5, 2.5)), this.matWoodDark.material);
        const hatch = new THREE.Mesh(this.g(makeBox(2.2, 16, 22)), occMat.material);
        hatch.position.set(12.2, 0, 3);
        statusLightMesh = hatch;
        root.add(shell, trimT, trimB, hatch);
      }

      root.visible = false;
      this.setRenderOrderRecursive(root, 6);
      this.worldScene.add(root);
      this.hidingRigs.push({
        spot: s,
        deck: s.deck,
        root,
        doorPivot,
        statusLightMesh,
        occupiedColorMat: occMat,
      });
    }
  }

  private buildPaperMaps(): void {
    for (const stand of this.map.paperMaps) {
      const facing = resolveTileWallFacing(this.map, stand.tx, stand.ty);
      const root = new THREE.Group();
      root.position.set(stand.x + facing.wallOffsetX * 0.45, -(stand.y + facing.wallOffsetY * 0.45), 0);
      root.rotation.z = -facing.angle;

      const base = new THREE.Mesh(this.g(makeBox(16, 22, 2.5)), this.matSteelDark.material);
      const post = new THREE.Mesh(this.g(makeBox(5.5, 7.5, 22)), this.matSteelMid.material);
      post.position.set(-1.5, 0, 2);

      const topGroup = new THREE.Group();
      topGroup.position.set(0.5, 0, 24);
      topGroup.rotation.y = 0.28; // tilted toward reader
      const tray = new THREE.Mesh(this.g(makeBox(18, 24, 1.8)), this.matSteelMid.material);
      const sheet = new THREE.Mesh(this.g(makeBox(15, 20.5, 0.7)), this.matParchment.material);
      sheet.position.set(0, 0, 1.8);
      const bar = new THREE.Mesh(this.g(makeBox(2.0, 17, 0.8)), this.matNavy.material);
      bar.position.set(-2, 0, 2.4);
      const pinMesh = new THREE.Mesh(
        this.g(makeCyl(1.7, 1.7, 2.4, 10)),
        this.matRedPaint.material
      );
      pinMesh.position.set(1.5, -2.5, 2.4);
      topGroup.add(tray, sheet, bar, pinMesh);

      root.add(base, post, topGroup);
      root.visible = false;
      this.setRenderOrderRecursive(root, 6);
      this.worldScene.add(root);
      this.paperMapRigs.push({ stand, deck: stand.deck, root, pinMesh });
    }
  }

  private buildFuseSockets(): void {
    for (const fs of this.map.fuseSockets) {
      const facing = resolveTileWallFacing(this.map, fs.tx, fs.ty);
      const root = new THREE.Group();
      root.position.set(fs.x + facing.wallOffsetX * 0.85, -(fs.y + facing.wallOffsetY * 0.85), 0);
      root.rotation.z = -facing.angle;

      const pedestal = new THREE.Mesh(this.g(makeBox(8, 12, 16)), this.matSteelDark.material);
      const cabinet = new THREE.Mesh(this.g(makeBox(10.5, 20, 22)), this.matSteelMid.material);
      cabinet.position.set(0, 0, 15);
      const busL = new THREE.Mesh(this.g(makeBox(2.2, 2.4, 14)), this.matCopper.material);
      busL.position.set(4.5, -4.5, 19);
      const busR = new THREE.Mesh(this.g(makeBox(2.2, 2.4, 14)), this.matCopper.material);
      busR.position.set(4.5, 4.5, 19);
      const glass = new THREE.Mesh(this.g(makeBox(1.2, 16, 17)), this.matGlassPane.material);
      glass.position.set(5.6, 0, 17.5);

      const cartridgeMat = createShadedCharacterMaterial({
        color: 0xfbbf24,
        roughness: 0.25,
        metalness: 0.55,
        emissiveColor: 0x34d399,
        emissiveStrength: 0.75,
      });
      this.sharedMaterials.push(cartridgeMat);
      const cartridgeMesh = new THREE.Mesh(
        this.g(makeCyl(2.4, 2.4, 11, 10)),
        cartridgeMat.material
      );
      cartridgeMesh.position.set(4.2, 0, 20.5);
      cartridgeMesh.visible = fs.hasFuse;

      const ledMat = createShadedCharacterMaterial({
        color: 0xef4444,
        roughness: 0.2,
        metalness: 0.1,
        emissiveColor: 0xef4444,
        emissiveStrength: 0.85,
      });
      this.sharedMaterials.push(ledMat);
      const ledMesh = new THREE.Mesh(this.g(makeBox(2.4, 3.6, 2.4)), ledMat.material);
      ledMesh.position.set(4.8, 0, 35.5);

      root.add(pedestal, cabinet, busL, busR, glass, cartridgeMesh, ledMesh);
      root.visible = false;
      this.setRenderOrderRecursive(root, 6);
      glass.renderOrder = 14;
      this.worldScene.add(root);
      this.fuseRigs.push({
        socket: fs,
        deck: fs.deck,
        root,
        cartridgeMesh,
        ledMesh,
        ledMat,
      });
    }
  }

  private buildLightSwitches(): void {
    for (const sw of this.map.lightSwitches) {
      const deck = this.map.deckGrid[sw.ty]?.[sw.tx] ?? 'DECK_2';
      const facing = resolveTileWallFacing(this.map, sw.tx, sw.ty);
      const root = new THREE.Group();
      root.position.set(sw.x + facing.wallOffsetX * 0.88, -(sw.y + facing.wallOffsetY * 0.88), 0);
      root.rotation.z = -facing.angle;

      const conduit = new THREE.Mesh(this.g(makeCyl(1.4, 1.4, 22, 8)), this.matSteelDark.material);
      conduit.position.set(-1.0, 0, 22);
      const box = new THREE.Mesh(this.g(makeBox(6.5, 11, 14)), this.matSteelMid.material);
      box.position.set(0, 0, 19);

      const paddleGroup = new THREE.Group();
      paddleGroup.position.set(3.4, 0, 26);
      const lever = new THREE.Mesh(this.g(makeBox(5.2, 2.6, 2.2)), this.matBrass.material);
      lever.position.set(2.2, 0, 0);
      paddleGroup.add(lever);

      const lockCover = new THREE.Mesh(this.g(makeBox(3.8, 9.6, 10.2)), this.matAmber.material);
      lockCover.position.set(3.8, 0, 20.5);
      lockCover.visible = false;

      const ledMat = createShadedCharacterMaterial({
        color: 0x334155,
        roughness: 0.25,
        metalness: 0.1,
        emissiveColor: 0x000000,
        emissiveStrength: 0,
      });
      this.sharedMaterials.push(ledMat);
      const ledMesh = new THREE.Mesh(this.g(makeBox(2.2, 3.0, 2.0)), ledMat.material);
      ledMesh.position.set(2.8, 0, 32.8);

      root.add(conduit, box, paddleGroup, lockCover, ledMesh);
      root.visible = false;
      this.setRenderOrderRecursive(root, 6);
      this.worldScene.add(root);
      this.switchRigs.push({
        sw,
        deck,
        root,
        paddleGroup,
        lockCover,
        ledMesh,
        ledMat,
      });
    }
  }

  private buildSteamPipes(): void {
    const ts = this.map.tileSize;
    for (const pipe of this.map.steamPipes) {
      const wallCx = (pipe.wallTx + 0.5) * ts;
      const wallCy = (pipe.wallTy + 0.5) * ts;
      const edgeX = wallCx + pipe.dirX * (ts * 0.48);
      const edgeY = wallCy + pipe.dirY * (ts * 0.48);
      const angle = Math.atan2(pipe.dirY, pipe.dirX);

      const root = new THREE.Group();
      root.position.set(edgeX, -edgeY, 0);
      root.rotation.z = -angle;

      const flange = new THREE.Mesh(this.g(makeCyl(6.2, 6.2, 4.0, 12, true)), this.matSteelDark.material);
      flange.rotation.z = Math.PI * 0.5;
      flange.position.set(1.2, 0, 22);
      const barrel = new THREE.Mesh(this.g(makeCyl(3.8, 4.4, 9.5, 12, true)), this.matCopper.material);
      barrel.rotation.z = Math.PI * 0.5;
      barrel.position.set(5.5, 0, 22);
      const collar = new THREE.Mesh(this.g(makeCyl(4.6, 4.6, 2.2, 12, true)), this.matBrass.material);
      collar.rotation.z = Math.PI * 0.5;
      collar.position.set(9.8, 0, 22);

      const gaugeMat = createShadedCharacterMaterial({
        color: 0x64748b,
        roughness: 0.3,
        metalness: 0.4,
        emissiveColor: 0xf59e0b,
        emissiveStrength: 0,
      });
      this.sharedMaterials.push(gaugeMat);
      const gaugeDial = new THREE.Mesh(this.g(makeCyl(3.4, 3.4, 2.2, 12)), gaugeMat.material);
      gaugeDial.position.set(4.5, 0, 27);

      const plumeGroup = new THREE.Group();
      plumeGroup.position.set(10.5, 0, 22);
      // Cone geometry points along +Y by default -> rotate Z -90 deg so base sits at nozzle (+X) & cone flares along +X
      const outerConeGeom = this.g(new THREE.ConeGeometry(13.5, 1, 14, 1, true));
      outerConeGeom.translate(0, -0.5, 0);
      outerConeGeom.rotateZ(Math.PI * 0.5);
      const plumeOuter = new THREE.Mesh(outerConeGeom, this.steamOuterMat);

      const coreConeGeom = this.g(new THREE.ConeGeometry(7.2, 1, 12, 1, true));
      coreConeGeom.translate(0, -0.5, 0);
      coreConeGeom.rotateZ(Math.PI * 0.5);
      const plumeCore = new THREE.Mesh(coreConeGeom, this.steamCoreMat);
      plumeGroup.add(plumeOuter, plumeCore);
      plumeGroup.visible = false;

      root.add(flange, barrel, collar, gaugeDial, plumeGroup);
      root.visible = false;
      this.setRenderOrderRecursive(root, 6);
      plumeOuter.renderOrder = 15;
      plumeCore.renderOrder = 15;
      this.worldScene.add(root);
      this.steamRigs.push({
        pipe,
        deck: pipe.deck,
        root,
        gaugeDial,
        gaugeMat,
        plumeGroup,
        plumeOuter,
        plumeCore,
      });
    }
  }

  private buildStaticBlockingProps(): void {
    const ts = this.map.tileSize;
    for (const prop of this.map.props) {
      if (!prop.blocking) continue;
      if (prop.kind === 'SUBMARINE_HULL' || prop.kind === 'FLOODGATE_LEVER') continue;

      const pw = prop.tw * ts;
      const ph = prop.th * ts;
      const cx = prop.tx * ts + pw * 0.5;
      const cy = prop.ty * ts + ph * 0.5;
      const root = new THREE.Group();
      root.position.set(cx, -cy, 0);

      this.populateStaticPropMesh(root, prop, pw, ph);
      root.visible = false;
      this.setRenderOrderRecursive(root, 6);
      this.worldScene.add(root);
      this.staticPropVisuals.push({
        deck: prop.deck,
        cx,
        cy,
        halfSpan: Math.max(pw, ph) * 0.65 + 24,
        root,
      });
    }
  }

  private populateStaticPropMesh(
    root: THREE.Group,
    prop: ShipProp,
    pw: number,
    ph: number
  ): void {
    const w = Math.max(14, pw - 8);
    const d = Math.max(14, ph - 8);
    const k = prop.kind;

    if (k === 'SHIPPING_CONTAINER') {
      let bodyMat = this.matSteelMid.material;
      if (prop.color) {
        const customMat = createShadedCharacterMaterial({
          color: new THREE.Color(prop.color).getHex(),
          roughness: 0.62,
          metalness: 0.38,
        });
        this.sharedMaterials.push(customMat);
        bodyMat = customMat.material;
      }
      const hull = new THREE.Mesh(this.g(makeBox(w, d, 34)), bodyMat);
      root.add(hull);
      const step = 12;
      for (let x = -w * 0.42; x <= w * 0.42; x += step) {
        const rib = new THREE.Mesh(this.g(makeBox(3.5, d + 1.8, 32)), this.matSteelDark.material);
        rib.position.set(x, 0, 1.0);
        root.add(rib);
      }
      for (const sx of [-w * 0.48, w * 0.48]) {
        for (const sy of [-d * 0.48, d * 0.48]) {
          const post = new THREE.Mesh(this.g(makeBox(4.5, 4.5, 35.5)), this.matSteelLight.material);
          post.position.set(sx, sy, 0);
          root.add(post);
        }
      }
    } else if (k === 'TURBINE') {
      const skid = new THREE.Mesh(this.g(makeBox(w, d, 6)), this.matSteelDark.material);
      const drum = new THREE.Mesh(
        this.g(makeCyl(Math.min(w, d) * 0.34, Math.min(w, d) * 0.34, w * 0.72, 14, true)),
        this.matSteelMid.material
      );
      drum.rotation.z = Math.PI * 0.5;
      drum.position.set(0, 0, 16);
      const capL = new THREE.Mesh(this.g(makeBox(8, d * 0.85, 24)), this.matCopper.material);
      capL.position.set(-w * 0.36, 0, 4);
      const capR = new THREE.Mesh(this.g(makeBox(8, d * 0.85, 24)), this.matCopper.material);
      capR.position.set(w * 0.36, 0, 4);
      root.add(skid, drum, capL, capR);
    } else if (k === 'BOILER') {
      const cradle = new THREE.Mesh(this.g(makeBox(w * 0.85, d * 0.85, 7)), this.matSteelDark.material);
      const shell = new THREE.Mesh(
        this.g(makeCyl(Math.min(w, d) * 0.42, Math.min(w, d) * 0.42, 28, 16)),
        this.matWoodDark.material
      );
      shell.position.set(0, 0, 6);
      const firebox = new THREE.Mesh(this.g(makeBox(10, d * 0.45, 9)), this.matAmber.material);
      firebox.position.set(0, -d * 0.34, 10);
      const stack = new THREE.Mesh(this.g(makeCyl(6, 6, 12, 12)), this.matBrass.material);
      stack.position.set(0, 0, 32);
      root.add(cradle, shell, firebox, stack);
    } else if (k === 'HELM_CONSOLE') {
      const consoleBox = new THREE.Mesh(this.g(makeBox(w * 0.75, d * 0.88, 22)), this.matSteelDark.material);
      const visor = new THREE.Mesh(this.g(makeBox(w * 0.65, d * 0.72, 6)), this.matCyan.material);
      visor.position.set(-2, 0, 21.5);
      const wheel = new THREE.Mesh(this.g(makeCyl(7.5, 7.5, 2.2, 14, true)), this.matBrass.material);
      wheel.rotation.z = Math.PI * 0.5;
      wheel.position.set(w * 0.35, 0, 20);
      root.add(consoleBox, visor, wheel);
    } else if (k === 'CRANE_PEDESTAL') {
      const ped = new THREE.Mesh(this.g(makeCyl(15, 18, 24, 16)), this.matAmber.material);
      const turret = new THREE.Mesh(this.g(makeBox(24, 20, 12)), this.matSteelMid.material);
      turret.position.set(0, 0, 24);
      const boom = new THREE.Mesh(this.g(makeBox(46, 7.5, 7.5)), this.matSteelLight.material);
      boom.position.set(18, 0, 34);
      boom.rotation.y = -0.32;
      root.add(ped, turret, boom);
    } else if (k === 'BUNK') {
      const frame = new THREE.Mesh(this.g(makeBox(w, d, 26)), this.matSteelDark.material);
      const matt1 = new THREE.Mesh(this.g(makeBox(w - 4, d - 4, 4)), this.matMattress.material);
      matt1.position.set(0, 0, 7);
      const matt2 = new THREE.Mesh(this.g(makeBox(w - 4, d - 4, 4)), this.matMattress.material);
      matt2.position.set(0, 0, 21);
      const pillow = new THREE.Mesh(this.g(makeBox(8, d - 8, 2.5)), this.matWhiteCloth.material);
      pillow.position.set(-w * 0.3, 0, 25);
      root.add(frame, matt1, matt2, pillow);
    } else if (k === 'MED_BED') {
      const frame = new THREE.Mesh(this.g(makeBox(w, d, 12)), this.matSteelMid.material);
      const pad = new THREE.Mesh(this.g(makeBox(w - 3, d - 3, 4.5)), this.matSteelLight.material);
      pad.position.set(0, 0, 12);
      const crossH = new THREE.Mesh(this.g(makeBox(9, 3, 1.0)), this.matRedPaint.material);
      crossH.position.set(0, 0, 16.5);
      const crossV = new THREE.Mesh(this.g(makeBox(3, 9, 1.0)), this.matRedPaint.material);
      crossV.position.set(0, 0, 16.5);
      root.add(frame, pad, crossH, crossV);
    } else if (k === 'CHART_TABLE') {
      const base = new THREE.Mesh(this.g(makeBox(w - 4, d - 4, 18)), this.matWoodDark.material);
      const top = new THREE.Mesh(this.g(makeBox(w, d, 3)), this.matWood.material);
      top.position.set(0, 0, 18);
      const map = new THREE.Mesh(this.g(makeBox(w - 8, d - 8, 1)), this.matParchment.material);
      map.position.set(0, 0, 21);
      root.add(base, top, map);
    } else if (k === 'CAPSTAN') {
      const drum = new THREE.Mesh(this.g(makeCyl(11, 14, 18, 14)), this.matSteelMid.material);
      const cap = new THREE.Mesh(this.g(makeCyl(13, 11, 4, 14)), this.matSteelLight.material);
      cap.position.set(0, 0, 18);
      root.add(drum, cap);
    } else if (k === 'COMPRESSED_AIR_TANK') {
      const rack = new THREE.Mesh(this.g(makeBox(w * 0.8, d * 0.8, 4)), this.matSteelDark.material);
      const cyl = new THREE.Mesh(this.g(makeCyl(11, 11, 26, 14)), this.matTeal.material);
      cyl.position.set(0, 0, 4);
      const valve = new THREE.Mesh(this.g(makeCyl(3.2, 3.2, 5, 10)), this.matBrass.material);
      valve.position.set(0, 0, 30);
      root.add(rack, cyl, valve);
    } else if (k === 'PUMP_UNIT' || k === 'GENERATOR_SKID' || k === 'SWITCHGEAR') {
      const housing = new THREE.Mesh(
        this.g(makeBox(w, d, k === 'SWITCHGEAR' ? 28 : 22)),
        k === 'GENERATOR_SKID' ? this.matRedDark.material : this.matSteelDark.material
      );
      const cap = new THREE.Mesh(
        this.g(makeBox(w * 0.72, d * 0.72, 6)),
        k === 'PUMP_UNIT' ? this.matTeal.material : this.matSteelMid.material
      );
      cap.position.set(0, 0, k === 'SWITCHGEAR' ? 28 : 22);
      const beacon = new THREE.Mesh(
        this.g(makeBox(6, 6, 3)),
        k === 'PUMP_UNIT' ? this.matCyan.material : this.matAmber.material
      );
      beacon.position.set(0, 0, k === 'SWITCHGEAR' ? 34 : 28);
      root.add(housing, cap, beacon);
    } else if (k === 'VALVE_MANIFOLD') {
      const block = new THREE.Mesh(this.g(makeBox(w, d, 14)), this.matSteelMid.material);
      const pipe = new THREE.Mesh(
        this.g(makeCyl(4.5, 4.5, w * 0.9, 10, true)),
        this.matCopper.material
      );
      pipe.rotation.z = Math.PI * 0.5;
      pipe.position.set(0, 0, 16);
      const wheel = new THREE.Mesh(this.g(makeCyl(7.5, 7.5, 2.5, 12)), this.matRedPaint.material);
      wheel.position.set(0, 0, 21);
      root.add(block, pipe, wheel);
    } else {
      // Mess tables, counters, wardrobes, fridges, booths, racks, workbenches, dive racks
      const isWood = k === 'MESS_TABLE' || k === 'CABIN_WARDROBE';
      const isBright = k === 'GALLEY_FRIDGE' || k === 'MED_CART';
      const isRed = k === 'DINING_BOOTH' || k === 'WORKBENCH';
      const h =
        k === 'CABIN_WARDROBE' || k === 'GALLEY_FRIDGE'
          ? 34
          : k === 'CARGO_RACK'
            ? 30
            : k === 'MED_CART'
              ? 18
              : 20;
      const body = new THREE.Mesh(
        this.g(makeBox(w, d, h)),
        isWood
          ? this.matWood.material
          : isBright
            ? this.matSteelLight.material
            : isRed
              ? this.matRedDark.material
              : this.matSteelMid.material
      );
      const trim = new THREE.Mesh(
        this.g(makeBox(w + 1.5, d + 1.5, 2.5)),
        this.matSteelDark.material
      );
      trim.position.set(0, 0, h - 1.5);
      root.add(body, trim);
    }
  }

  public getRaycastTargets(activeDeck: ShipDeck): THREE.Object3D[] {
    if (this.raycastDeckKey !== activeDeck) {
      this.raycastDeckKey = activeDeck;
    }
    this.raycastHitMeshes.length = 0;
    for (let i = 0; i < this.containerRigs.length; i++) {
      const rig = this.containerRigs[i];
      if (rig.deck !== activeDeck || !rig.root.visible) continue;
      if (rig.itemHitMesh.visible) {
        this.raycastHitMeshes.push(rig.itemHitMesh);
      }
      this.raycastHitMeshes.push(rig.containerHitMesh);
    }
    return this.raycastHitMeshes;
  }

  public getContainerWorldHitCenter(
    containerId: string,
    targetPart: 'CONTAINER' | 'CONTAINER_ITEM',
    outVec: THREE.Vector3
  ): boolean {
    const rig = this.containerRigs.find((r) => r.container.id === containerId);
    if (!rig || !rig.root.visible) return false;
    rig.root.updateMatrixWorld(true);
    if (targetPart === 'CONTAINER_ITEM' && rig.itemHitMesh.visible) {
      rig.itemHitMesh.getWorldPosition(outVec);
      return true;
    }
    if (rig.itemHitMesh.visible) {
      // Aim at rear/side rim of container housing clear of the 16x16 revealed item hitbox
      outVec.set(-6, -9.5, 11);
      rig.root.localToWorld(outVec);
      return true;
    }
    rig.containerHitMesh.getWorldPosition(outVec);
    return true;
  }

  public updateForFrame(
    engine: MonstrumGameEngine,
    renderDeck: ShipDeck,
    camX: number,
    camY: number,
    halfW: number,
    halfH: number,
    timeSec: number,
    hoveredTarget: CursorContainerTarget | null
  ): void {
    if (this.disposed) return;

    const padX = halfW + 120;
    const padY = halfH + 120;

    // 1. Containers (Drawers, Toolboxes, Cabinets, Desks)
    for (let i = 0; i < this.containerRigs.length; i++) {
      const rig = this.containerRigs[i];
      const c = rig.container;
      if (rig.deck !== renderDeck || Math.abs(c.x - camX) > padX || Math.abs(c.y - camY) > padY) {
        rig.root.visible = false;
        continue;
      }
      rig.root.visible = true;

      const prog = c.openProgress;
      if (c.type === 'DRAWER' || c.type === 'DESK') {
        rig.movingPart.position.x = prog * 11.5;
      } else if (c.type === 'TOOLBOX') {
        rig.movingPart.rotation.y = -prog * 1.72;
      } else if (c.type === 'CABINET') {
        if (rig.doorLeft) rig.doorLeft.rotation.z = -prog * 1.55;
        if (rig.doorRight) rig.doorRight.rotation.z = prog * 1.55;
      }

      // Sync item mount visibility / removal
      if (c.item !== rig.mountedItemId) {
        if (rig.itemGroup) {
          rig.itemMount.remove(rig.itemGroup);
          rig.itemGroup = null;
        }
        rig.mountedItemId = c.item;
        if (c.item) {
          rig.itemGroup = this.itemLib.createItemGroup(c.item);
          this.setRenderOrderRecursive(rig.itemGroup, 7);
          rig.itemMount.add(rig.itemGroup);
        }
      }

      const showItem = c.item !== null && prog > 0.14;
      rig.itemMount.visible = showItem;
      rig.itemHitMesh.visible = c.item !== null && prog > 0.22;

      const isHovered = hoveredTarget !== null && hoveredTarget.containerId === c.id && hoveredTarget.hasLos;
      const isItemHover = isHovered && hoveredTarget.kind === 'CONTAINER_ITEM' && showItem;
      const isBoxHover = isHovered && hoveredTarget.kind === 'CONTAINER';

      rig.hoverRing.visible = isBoxHover;
      rig.itemHoverRing.visible = isItemHover;
      if (isBoxHover) {
        this.hoverRingMat.color.setHex(hoveredTarget.inReach ? 0xfbbf24 : 0x64748b);
        this.hoverRingMat.opacity = hoveredTarget.inReach ? 0.78 : 0.42;
      }
      if (isItemHover) {
        this.itemHoverRingMat.color.setHex(hoveredTarget.inReach ? 0x34d399 : 0x64748b);
        this.itemHoverRingMat.opacity = hoveredTarget.inReach ? 0.92 : 0.45;
      }
    }

    // 2. Hiding Spots
    for (let i = 0; i < this.hidingRigs.length; i++) {
      const hr = this.hidingRigs[i];
      const s = hr.spot;
      if (hr.deck !== renderDeck || Math.abs(s.x - camX) > padX || Math.abs(s.y - camY) > padY) {
        hr.root.visible = false;
        continue;
      }
      hr.root.visible = true;
      const isOccupied = engine.player.hidingSpotId === s.id;
      const isFlashing = s.checkedFlash > 0;

      if (hr.doorPivot) {
        hr.doorPivot.rotation.z = isFlashing ? -1.45 : isOccupied ? -0.18 : 0;
      }
      if (hr.occupiedColorMat) {
        if (isFlashing) {
          hr.occupiedColorMat.uTint.value.setHex(0x9a3412);
          hr.occupiedColorMat.uEmissive.value.setHex(0xf97316);
          hr.occupiedColorMat.uEmissiveStrength.value = 0.65;
        } else if (isOccupied) {
          hr.occupiedColorMat.uTint.value.setHex(0x1e3a5f);
          hr.occupiedColorMat.uEmissive.value.setHex(0x38bdf8);
          hr.occupiedColorMat.uEmissiveStrength.value = 0.35;
        } else {
          hr.occupiedColorMat.uTint.value.setHex(
            s.type === 'CARGO_CRATE' ? 0x5c422c : s.type === 'UNDER_DESK' ? 0x334155 : 0x2b394e
          );
          hr.occupiedColorMat.uEmissiveStrength.value = 0;
        }
      }
    }

    // 3. Paper Map Stands
    for (let i = 0; i < this.paperMapRigs.length; i++) {
      const pm = this.paperMapRigs[i];
      if (pm.deck !== renderDeck || Math.abs(pm.stand.x - camX) > padX || Math.abs(pm.stand.y - camY) > padY) {
        pm.root.visible = false;
        continue;
      }
      pm.root.visible = true;
      pm.pinMesh.position.z = 2.4 + Math.sin(timeSec * 4.5) * 0.45;
    }

    // 4. Fuse Control Panels
    for (let i = 0; i < this.fuseRigs.length; i++) {
      const fr = this.fuseRigs[i];
      if (fr.deck !== renderDeck || Math.abs(fr.socket.x - camX) > padX || Math.abs(fr.socket.y - camY) > padY) {
        fr.root.visible = false;
        continue;
      }
      fr.root.visible = true;
      const hasFuse = fr.socket.hasFuse;
      fr.cartridgeMesh.visible = hasFuse;
      if (hasFuse) {
        fr.ledMat.uTint.value.setHex(0x34d399);
        fr.ledMat.uEmissive.value.setHex(0x34d399);
        fr.ledMat.uEmissiveStrength.value = 0.7 + 0.25 * Math.sin(timeSec * 8);
      } else {
        const blink = Math.sin(timeSec * 4.5) > 0;
        fr.ledMat.uTint.value.setHex(blink ? 0xef4444 : 0x7f1d1d);
        fr.ledMat.uEmissive.value.setHex(0xef4444);
        fr.ledMat.uEmissiveStrength.value = blink ? 0.9 : 0.15;
      }
    }

    // 5. Light Switches
    for (let i = 0; i < this.switchRigs.length; i++) {
      const sr = this.switchRigs[i];
      if (sr.deck !== renderDeck || Math.abs(sr.sw.x - camX) > padX || Math.abs(sr.sw.y - camY) > padY) {
        sr.root.visible = false;
        continue;
      }
      sr.root.visible = true;
      const powered = engine.poweredDecks[sr.deck];
      const isOn = powered || sr.sw.isOn;
      sr.paddleGroup.rotation.y = isOn ? -0.48 : 0.48;
      sr.lockCover.visible = powered;
      if (powered) {
        sr.ledMat.uTint.value.setHex(0xfbbf24);
        sr.ledMat.uEmissive.value.setHex(0xf59e0b);
        sr.ledMat.uEmissiveStrength.value = 0.6;
      } else if (isOn) {
        sr.ledMat.uTint.value.setHex(0x34d399);
        sr.ledMat.uEmissive.value.setHex(0x10b981);
        sr.ledMat.uEmissiveStrength.value = 0.5;
      } else {
        sr.ledMat.uTint.value.setHex(0x334155);
        sr.ledMat.uEmissiveStrength.value = 0;
      }
    }

    // 6. Steam Pipes & 3D Volumetric Jets
    const ts = engine.map.tileSize;
    for (let i = 0; i < this.steamRigs.length; i++) {
      const spRig = this.steamRigs[i];
      const pipe = spRig.pipe;
      if (spRig.deck !== renderDeck || Math.abs(pipe.x - camX) > padX + 90 || Math.abs(pipe.y - camY) > padY + 90) {
        spRig.root.visible = false;
        continue;
      }
      spRig.root.visible = true;
      const isWarn = pipe.warningTimer > 0;
      const isActive = pipe.activeTimer > 0;
      if (isActive) {
        spRig.gaugeMat.uTint.value.setHex(0xef4444);
        spRig.gaugeMat.uEmissive.value.setHex(0xf97316);
        spRig.gaugeMat.uEmissiveStrength.value = 0.85;
      } else if (isWarn) {
        const pulse = 0.5 + 0.5 * Math.sin(timeSec * 24);
        spRig.gaugeMat.uTint.value.setHex(0xfbbf24);
        spRig.gaugeMat.uEmissive.value.setHex(0xf59e0b);
        spRig.gaugeMat.uEmissiveStrength.value = 0.35 + 0.55 * pulse;
        spRig.gaugeDial.position.z = 27 + Math.sin(timeSec * 42) * 0.45;
      } else {
        spRig.gaugeMat.uTint.value.setHex(0x64748b);
        spRig.gaugeMat.uEmissiveStrength.value = 0;
        spRig.gaugeDial.position.z = 27;
      }

      if (isActive) {
        const clippedTiles = engine.getSteamPipeClippedRangeTiles(pipe);
        if (clippedTiles > 0) {
          const jetLen = Math.max(12, clippedTiles * ts - 10);
          const wobble = 1 + Math.sin(timeSec * 36 + pipe.wallTx) * 0.1;
          spRig.plumeGroup.visible = true;
          spRig.plumeOuter.scale.set(jetLen, wobble, wobble);
          spRig.plumeCore.scale.set(jetLen * 0.92, wobble * 0.95, wobble * 0.95);
        } else {
          spRig.plumeGroup.visible = false;
        }
      } else {
        spRig.plumeGroup.visible = false;
      }
    }

    // 7. Static 3D Blocking Ship Furniture
    for (let i = 0; i < this.staticPropVisuals.length; i++) {
      const pv = this.staticPropVisuals[i];
      if (
        pv.deck !== renderDeck ||
        Math.abs(pv.cx - camX) > padX + pv.halfSpan ||
        Math.abs(pv.cy - camY) > padY + pv.halfSpan
      ) {
        pv.root.visible = false;
      } else {
        pv.root.visible = true;
      }
    }

    // 8. Loose World Pickups
    const activePickupIds = new Set<number>();
    for (const wp of engine.worldPickups) {
      if (wp.deck !== renderDeck) continue;
      if (Math.abs(wp.x - camX) > padX || Math.abs(wp.y - camY) > padY) continue;
      activePickupIds.add(wp.id);

      let vis = this.pickupVisuals.get(wp.id);
      if (!vis) {
        const group = new THREE.Group();
        const itemMesh = this.itemLib.createItemGroup(wp.item);
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
        const haloMat = new THREE.MeshBasicMaterial({
          color: haloColor,
          transparent: true,
          opacity: wp.item === 'MASTER_FUSE' ? 0.85 : 0.65,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const halo = new THREE.Mesh(this.pickupHaloGeom, haloMat);
        halo.position.z = 0.8;
        group.add(halo, itemMesh);
        this.setRenderOrderRecursive(group, 7);
        halo.renderOrder = 15;
        this.worldScene.add(group);
        vis = { group, halo, haloMat };
        this.pickupVisuals.set(wp.id, vis);
      }
      const pulse = 1 + Math.sin(timeSec * 5 + wp.id) * 0.14;
      vis.group.visible = true;
      vis.group.position.set(wp.x, -wp.y, 0);
      const itemChild = vis.group.children[1];
      if (itemChild) {
        itemChild.position.z = 4.2 + Math.sin(timeSec * 3.4 + wp.id) * 1.8;
        itemChild.rotation.z = timeSec * 1.15 + wp.id;
      }
      if (vis.halo) {
        vis.halo.scale.set(pulse, pulse, 1);
      }
    }
    for (const [id, vis] of this.pickupVisuals) {
      if (!activePickupIds.has(id)) {
        this.worldScene.remove(vis.group);
        vis.haloMat?.dispose();
        this.pickupVisuals.delete(id);
      }
    }

    // 9. Dropped Lights (Flares & Glowsticks)
    const activeDroppedIds = new Set<number>();
    for (const dl of engine.droppedLights) {
      const lTx = Math.floor(dl.x / ts);
      const lTy = Math.floor(dl.y / ts);
      const dlDeck = engine.map.deckGrid[lTy]?.[lTx] ?? 'DECK_2';
      if (dlDeck !== renderDeck) continue;
      if (Math.abs(dl.x - camX) > padX || Math.abs(dl.y - camY) > padY) continue;
      activeDroppedIds.add(dl.id);

      let vis = this.droppedLightVisuals.get(dl.id);
      if (!vis) {
        const group = new THREE.Group();
        const mesh = this.itemLib.createItemGroup(dl.type === 'FLARE' ? 'FLARE' : 'GLOWSTICK');
        mesh.rotation.z = ((dl.id * 1.37) % (Math.PI * 2));
        group.add(mesh);

        let ember: THREE.Mesh | undefined;
        let haloMat: THREE.MeshBasicMaterial | undefined;
        if (dl.type === 'FLARE') {
          haloMat = new THREE.MeshBasicMaterial({
            color: 0xfb7185,
            transparent: true,
            opacity: 0.72,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          ember = new THREE.Mesh(this.g(new THREE.CircleGeometry(7.5, 16)), haloMat);
          ember.position.set(Math.cos(mesh.rotation.z) * 6, Math.sin(mesh.rotation.z) * 6, 2.2);
          group.add(ember);
        }
        this.setRenderOrderRecursive(group, 7);
        if (ember) ember.renderOrder = 15;
        this.worldScene.add(group);
        vis = { group, ember, haloMat };
        this.droppedLightVisuals.set(dl.id, vis);
      }
      vis.group.visible = true;
      vis.group.position.set(dl.x, -dl.y, 0);
      if (vis.ember) {
        const s = 0.75 + 0.35 * Math.sin(timeSec * 28 + dl.id);
        vis.ember.scale.set(s, s, 1);
      }
    }
    for (const [id, vis] of this.droppedLightVisuals) {
      if (!activeDroppedIds.has(id)) {
        this.worldScene.remove(vis.group);
        vis.haloMat?.dispose();
        this.droppedLightVisuals.delete(id);
      }
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const rig of this.containerRigs) this.worldScene.remove(rig.root);
    this.containerRigs = [];
    for (const hr of this.hidingRigs) this.worldScene.remove(hr.root);
    this.hidingRigs = [];
    for (const pm of this.paperMapRigs) this.worldScene.remove(pm.root);
    this.paperMapRigs = [];
    for (const fr of this.fuseRigs) this.worldScene.remove(fr.root);
    this.fuseRigs = [];
    for (const sr of this.switchRigs) this.worldScene.remove(sr.root);
    this.switchRigs = [];
    for (const spRig of this.steamRigs) this.worldScene.remove(spRig.root);
    this.steamRigs = [];
    for (const pv of this.staticPropVisuals) this.worldScene.remove(pv.root);
    this.staticPropVisuals = [];
    for (const vis of this.pickupVisuals.values()) {
      this.worldScene.remove(vis.group);
      vis.haloMat?.dispose();
    }
    this.pickupVisuals.clear();
    for (const vis of this.droppedLightVisuals.values()) {
      this.worldScene.remove(vis.group);
      vis.haloMat?.dispose();
    }
    this.droppedLightVisuals.clear();

    for (const g of this.sharedGeoms) g.dispose();
    this.sharedGeoms = [];
    for (const m of this.sharedMaterials) m.material.dispose();
    this.sharedMaterials = [];
    for (const m of this.basicMaterials) m.dispose();
    this.basicMaterials = [];
    this.itemLib.dispose();
  }
}
