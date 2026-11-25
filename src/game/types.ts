export const GAME_VERSION = '0.3.1';

export const WALL_HEIGHT_RATIO = 1.25;
export const DOOR_HEIGHT_PX = 46;

export const REFERENCE_VIEWPORT_WIDTH = 1440;
export const REFERENCE_VIEWPORT_HEIGHT = 900;

export function getViewportResolutionScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1;
  const areaRatio = (width * height) / (REFERENCE_VIEWPORT_WIDTH * REFERENCE_VIEWPORT_HEIGHT);
  return Math.max(0.45, Math.min(3.0, Math.sqrt(areaRatio)));
}

export type GameStatus = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'VICTORY_CUTSCENE' | 'VICTORY' | 'GAME_OVER';

export type DifficultyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export interface DifficultyConfig {
  intelligence: DifficultyLevel;
  senses: DifficultyLevel;
  speed: DifficultyLevel;
}

export interface BruteTuningNumbers {
  // Speed internals
  roamSpeed: number;
  investigateSpeed: number;
  stalkSpeed: number;
  chaseSpeed: number;
  smashChaseDelay: number;
  smashPatrolDelay: number;
  stairClimbChase: number;
  stairClimbPatrol: number;
  // Senses internals
  sightMult: number;
  halfFovDeg: number;
  peripheralBase: number;
  peripheralCrouch: number;
  hearingMult: number;
  // Intelligence internals
  sweepCoverage: number;
  overshootDist: number;
  clueRoomDepth: number;
  clueScanInterval: number;
  stairPursuitRange: number;
}

export function buildBruteTuningFromDifficulty(cfg: DifficultyConfig): BruteTuningNumbers {
  const speedPart =
    cfg.speed === 'LOW'
      ? {
          roamSpeed: 102,
          investigateSpeed: 132,
          stalkSpeed: 140,
          chaseSpeed: 196,
          smashChaseDelay: 0.62,
          smashPatrolDelay: 0.85,
          stairClimbChase: 0.68,
          stairClimbPatrol: 0.88,
        }
      : cfg.speed === 'EXTREME'
        ? {
            roamSpeed: 164,
            investigateSpeed: 210,
            stalkSpeed: 224,
            chaseSpeed: 316,
            smashChaseDelay: 0.22,
            smashPatrolDelay: 0.4,
            stairClimbChase: 0.32,
            stairClimbPatrol: 0.48,
          }
        : cfg.speed === 'HIGH'
          ? {
              roamSpeed: 136,
              investigateSpeed: 174,
              stalkSpeed: 186,
              chaseSpeed: 264,
              smashChaseDelay: 0.3,
              smashPatrolDelay: 0.54,
              stairClimbChase: 0.42,
              stairClimbPatrol: 0.62,
            }
          : {
              roamSpeed: 118,
              investigateSpeed: 152,
              stalkSpeed: 164,
              chaseSpeed: 238,
              smashChaseDelay: 0.42,
              smashPatrolDelay: 0.7,
              stairClimbChase: 0.54,
              stairClimbPatrol: 0.74,
            };

  // 0.2.0: Slight senses buff (~10-14%) across all difficulties to compensate for 4.5x larger 3-deck vessel
  const sensesPart =
    cfg.senses === 'LOW'
      ? {
          sightMult: 0.9,
          halfFovDeg: 70,
          peripheralBase: 86,
          peripheralCrouch: 56,
          hearingMult: 0.9,
        }
      : cfg.senses === 'EXTREME'
        ? {
            sightMult: 1.54,
            halfFovDeg: 105,
            peripheralBase: 156,
            peripheralCrouch: 105,
            hearingMult: 1.68,
          }
        : cfg.senses === 'HIGH'
          ? {
              sightMult: 1.3,
              halfFovDeg: 89,
              peripheralBase: 126,
              peripheralCrouch: 84,
              hearingMult: 1.38,
            }
          : {
              sightMult: 1.1,
              halfFovDeg: 80,
              peripheralBase: 108,
              peripheralCrouch: 70,
              hearingMult: 1.12,
            };

  const intelPart =
    cfg.intelligence === 'LOW'
      ? {
          sweepCoverage: 0.4,
          overshootDist: 120,
          clueRoomDepth: 1,
          clueScanInterval: 0.22,
          stairPursuitRange: 56,
        }
      : cfg.intelligence === 'HIGH' || cfg.intelligence === 'EXTREME'
        ? {
            sweepCoverage: 1.0,
            overshootDist: 250,
            clueRoomDepth: 4,
            clueScanInterval: 0.06,
            stairPursuitRange: 125,
          }
        : {
            sweepCoverage: 0.75,
            overshootDist: 190,
            clueRoomDepth: 3,
            clueScanInterval: 0.12,
            stairPursuitRange: 110,
          };

  return {
    ...speedPart,
    ...sensesPart,
    ...intelPart,
  };
}

export type DifficultyPreset = 'MERCY' | 'STANDARD' | 'NIGHTMARE' | 'EXTREME' | 'CUSTOM';

export const DIFFICULTY_PRESETS: Record<Exclude<DifficultyPreset, 'CUSTOM'>, DifficultyConfig> = {
  MERCY: { intelligence: 'LOW', senses: 'LOW', speed: 'LOW' },
  STANDARD: { intelligence: 'MEDIUM', senses: 'MEDIUM', speed: 'MEDIUM' },
  NIGHTMARE: { intelligence: 'HIGH', senses: 'HIGH', speed: 'HIGH' },
  EXTREME: { intelligence: 'EXTREME', senses: 'EXTREME', speed: 'EXTREME' },
};

export function detectDifficultyPreset(cfg: DifficultyConfig): DifficultyPreset {
  for (const key of ['MERCY', 'STANDARD', 'NIGHTMARE', 'EXTREME'] as const) {
    const p = DIFFICULTY_PRESETS[key];
    if (
      p.intelligence === cfg.intelligence &&
      p.senses === cfg.senses &&
      p.speed === cfg.speed
    ) {
      return key;
    }
  }
  return 'CUSTOM';
}

export type TileType =
  | 'VOID'
  | 'FLOOR'
  | 'WALL'
  | 'EXTERIOR_DECK'
  | 'STEAM_VENT'
  | 'ESCAPE_LIFEBOAT'
  | 'ESCAPE_HELI'
  | 'ESCAPE_SUBMARINE';

export type ShipDeck = 'DECK_3' | 'DECK_2' | 'DECK_1';

export const SHIP_DECK_ORDER: ShipDeck[] = ['DECK_3', 'DECK_2', 'DECK_1'];

export function getDeckIndex(deck: ShipDeck): number {
  return deck === 'DECK_3' ? 2 : deck === 'DECK_2' ? 1 : 0;
}

export function getDeckLabel(deck: ShipDeck): string {
  return deck === 'DECK_3' ? 'Deck 3' : deck === 'DECK_2' ? 'Deck 2' : 'Deck 1';
}

export type ShipArchetype = 'CONTAINER_FREIGHTER' | 'BULK_CARRIER' | 'ICEBREAKER';

export type FloorMaterial = 'STEEL' | 'WEATHER' | 'GRATING' | 'CARGO' | 'CABIN' | 'BRIDGE';

export type RoomCategory = 'UNIQUE' | 'GENERIC' | 'CIRCULATION';

export type RoomName =
  // Unique Rooms (max 1 per vessel)
  | 'Helideck'
  | 'Lifeboat Davit'
  | 'Submarine Bay'
  | 'Weather Deck'
  | 'Container Bay'
  | 'Forecastle'
  | 'Bridge'
  | 'Chart Room'
  | 'Radio Room'
  | "Captain's Quarters"
  | 'Officers Mess'
  | 'Infirmary'
  | 'Galley & Mess'
  | 'Engine Room'
  | 'Boiler Room'
  | 'Pump Room'
  // Generic Rooms (can spawn multiple independent compartments across decks)
  | 'Crew Quarters'
  | 'Storage Room'
  | 'Cargo Hold'
  | 'Workshop'
  | 'Electrical Room'
  | 'Maintenance Bay'
  | 'Fuse Control'
  // Circulation
  | 'Corridor'
  | 'Catwalk';

export const ROOM_CATEGORIES: Record<RoomName, RoomCategory> = {
  Helideck: 'UNIQUE',
  'Lifeboat Davit': 'UNIQUE',
  'Submarine Bay': 'UNIQUE',
  'Weather Deck': 'UNIQUE',
  'Container Bay': 'GENERIC',
  Forecastle: 'UNIQUE',
  Bridge: 'UNIQUE',
  'Chart Room': 'UNIQUE',
  'Radio Room': 'UNIQUE',
  "Captain's Quarters": 'UNIQUE',
  'Officers Mess': 'UNIQUE',
  Infirmary: 'UNIQUE',
  'Galley & Mess': 'UNIQUE',
  'Engine Room': 'UNIQUE',
  'Boiler Room': 'UNIQUE',
  'Pump Room': 'UNIQUE',
  'Crew Quarters': 'GENERIC',
  'Storage Room': 'GENERIC',
  'Cargo Hold': 'GENERIC',
  Workshop: 'GENERIC',
  'Electrical Room': 'GENERIC',
  'Maintenance Bay': 'GENERIC',
  'Fuse Control': 'GENERIC',
  Corridor: 'CIRCULATION',
  Catwalk: 'CIRCULATION',
};

export type ItemId =
  | 'WINCH_CRANK'
  | 'MARINE_BATTERY'
  | 'HULL_PATCH'
  | 'AVIATION_FUEL'
  | 'IGNITION_KEY'
  | 'ROTOR_FUSE'
  | 'SUB_BATTERY'
  | 'BALLAST_PUMP'
  | 'DIVE_KEY'
  | 'BATTERY_PACK'
  | 'GLOWSTICK'
  | 'FLARE'
  | 'FIRE_EXTINGUISHER'
  | 'BOLT_CUTTERS'
  | 'MASTER_FUSE'
  | 'BACKPACK';

export interface ItemMeta {
  id: ItemId;
  name: string;
  shortName: string;
  category: 'LIFEBOAT_PART' | 'HELI_PART' | 'SUBMARINE_PART' | 'TOOL' | 'UPGRADE';
  description: string;
  color: string;
}

export const ITEM_CATALOG: Record<ItemId, ItemMeta> = {
  WINCH_CRANK: {
    id: 'WINCH_CRANK',
    name: 'Winch Crank',
    shortName: 'Winch',
    category: 'LIFEBOAT_PART',
    description: 'Lifeboat part — lowers the Deck 2 davit.',
    color: '#38bdf8',
  },
  MARINE_BATTERY: {
    id: 'MARINE_BATTERY',
    name: 'Marine Battery',
    shortName: 'M-Battery',
    category: 'LIFEBOAT_PART',
    description: 'Lifeboat part — powers the emergency release.',
    color: '#38bdf8',
  },
  HULL_PATCH: {
    id: 'HULL_PATCH',
    name: 'Hull Patch Kit',
    shortName: 'Patch Kit',
    category: 'LIFEBOAT_PART',
    description: 'Lifeboat part — seals the cracked lifeboat hull.',
    color: '#38bdf8',
  },
  AVIATION_FUEL: {
    id: 'AVIATION_FUEL',
    name: 'Aviation Fuel',
    shortName: 'Av-Fuel',
    category: 'HELI_PART',
    description: 'Helicopter part — fuels the Deck 3 stern chopper.',
    color: '#fbbf24',
  },
  IGNITION_KEY: {
    id: 'IGNITION_KEY',
    name: 'Ignition Key',
    shortName: 'Heli Key',
    category: 'HELI_PART',
    description: 'Helicopter part — unlocks the cockpit starter.',
    color: '#fbbf24',
  },
  ROTOR_FUSE: {
    id: 'ROTOR_FUSE',
    name: 'Rotor Fuse',
    shortName: 'Fuse',
    category: 'HELI_PART',
    description: 'Helicopter part — restores main turbine power.',
    color: '#fbbf24',
  },
  SUB_BATTERY: {
    id: 'SUB_BATTERY',
    name: 'Submarine Battery',
    shortName: 'Sub Battery',
    category: 'SUBMARINE_PART',
    description: 'Submarine part — powers the Deck 1 submersible hull.',
    color: '#10b981',
  },
  BALLAST_PUMP: {
    id: 'BALLAST_PUMP',
    name: 'Ballast Pump',
    shortName: 'Ballast',
    category: 'SUBMARINE_PART',
    description: 'Submarine part — regulates moonpool dive trim.',
    color: '#10b981',
  },
  DIVE_KEY: {
    id: 'DIVE_KEY',
    name: 'Dive Ignition Key',
    shortName: 'Dive Key',
    category: 'SUBMARINE_PART',
    description: 'Submarine part — engages the sub conning drive.',
    color: '#10b981',
  },
  BATTERY_PACK: {
    id: 'BATTERY_PACK',
    name: 'Flashlight Battery',
    shortName: 'Battery',
    category: 'TOOL',
    description: 'Recharges flashlight power (+55%).',
    color: '#a3e635',
  },
  GLOWSTICK: {
    id: 'GLOWSTICK',
    name: 'Chemical Glowstick',
    shortName: 'Glowstick',
    category: 'TOOL',
    description: 'Drop silent cold light without draining battery.',
    color: '#34d399',
  },
  FLARE: {
    id: 'FLARE',
    name: 'Distress Flare',
    shortName: 'Flare',
    category: 'TOOL',
    description: 'Throw to light corridors and lure the Brute away.',
    color: '#fb7185',
  },
  FIRE_EXTINGUISHER: {
    id: 'FIRE_EXTINGUISHER',
    name: 'Fire Extinguisher',
    shortName: 'Extinguisher',
    category: 'TOOL',
    description: 'Blast CO2 to blind and stun the Brute briefly.',
    color: '#f87171',
  },
  BOLT_CUTTERS: {
    id: 'BOLT_CUTTERS',
    name: 'Bolt Cutters',
    shortName: 'Cutters',
    category: 'TOOL',
    description: 'Cuts padlocked doors and Helicopter deck chains.',
    color: '#cbd5e1',
  },
  MASTER_FUSE: {
    id: 'MASTER_FUSE',
    name: 'Master Fuse',
    shortName: 'M-Fuse',
    category: 'TOOL',
    description: 'Slot into a deck Fuse Control panel to permanently power all lights & hallways on that deck.',
    color: '#f59e0b',
  },
  BACKPACK: {
    id: 'BACKPACK',
    name: 'Crew Backpack',
    shortName: 'Backpack',
    category: 'UPGRADE',
    description: 'Permanently expands pack capacity from 4 to 6 slots.',
    color: '#f97316',
  },
};

export interface Door {
  id: string;
  tx: number;
  ty: number;
  orientation: 'H' | 'V';
  isOpen: boolean;
  openProgress: number; // 0 (closed) .. 1 (open)
  swingSpeed: number;   // fast (~8.5) when moving, slow (~1.55) when standing still
  isBroken: boolean;
  isLocked: boolean;
  isWatertight?: boolean;
  lockCut?: boolean;
}

export interface RoomLightSwitch {
  id: string;
  roomId: number;
  room: RoomName;
  tx: number;
  ty: number;
  x: number;
  y: number;
  isOn: boolean;
}

export interface FuseSocket {
  id: string;
  deck: ShipDeck;
  roomId: number;
  room: RoomName;
  tx: number;
  ty: number;
  x: number;
  y: number;
  hasFuse: boolean;
}

export interface CorridorLightFixture {
  id: string;
  deck: ShipDeck;
  tx: number;
  ty: number;
  x: number;
  y: number;
  range: number;
}

export interface Stairwell {
  id: string;
  deck: ShipDeck;
  tx: number;
  ty: number;
  x: number;
  y: number;
  targetStairId: string;
  targetDeck: ShipDeck;
  targetRoom: RoomName;
  targetRoomId: number;
  room: RoomName;
  roomId: number;
  label: string;
  direction: 'UP' | 'DOWN';
}

export type ShipPropKind =
  | 'SHIPPING_CONTAINER'
  | 'TURBINE'
  | 'BOILER'
  | 'BUNK'
  | 'GALLEY_COUNTER'
  | 'MESS_TABLE'
  | 'HELM_CONSOLE'
  | 'CHART_TABLE'
  | 'MED_BED'
  | 'WORKBENCH'
  | 'CAPSTAN'
  | 'CRANE_PEDESTAL'
  | 'PIPE_RUN'
  | 'SUBMARINE_HULL'
  | 'FLOODGATE_LEVER'
  | 'PUMP_UNIT'
  | 'SWITCHGEAR'
  // 0.2.1 Non-interactable deck-appropriate furniture (blocking centerpieces & walkable floor clutter)
  | 'CABIN_WARDROBE'
  | 'GALLEY_FRIDGE'
  | 'DINING_BOOTH'
  | 'MED_CART'
  | 'CARGO_RACK'
  | 'GENERATOR_SKID'
  | 'VALVE_MANIFOLD'
  | 'COMPRESSED_AIR_TANK'
  | 'DIVE_GEAR_RACK'
  | 'RUBBER_RUNNER'
  | 'FLOOR_GRATE'
  | 'CABLE_COIL'
  | 'CAUTION_MAT'
  | 'OIL_DRIP_TRAY'
  | 'RUG_MAT';

export interface ShipProp {
  id: string;
  kind: ShipPropKind;
  deck: ShipDeck;
  tx: number;
  ty: number;
  tw: number;
  th: number;
  color?: string;
  orientation?: 'H' | 'V';
  blocking?: boolean;
}

export type HidingSpotType = 'LOCKER' | 'UNDER_DESK' | 'CARGO_CRATE';

export interface HidingSpot {
  id: string;
  tx: number;
  ty: number;
  x: number;
  y: number;
  type: HidingSpotType;
  room: RoomName;
  roomId: number;
  deck: ShipDeck;
  angle: number;
  checkedFlash: number; // visual flash timer when Brute rips it open
}

export type ContainerType = 'CABINET' | 'TOOLBOX' | 'DRAWER' | 'DESK';

export interface Container {
  id: string;
  tx: number;
  ty: number;
  x: number;
  y: number;
  type: ContainerType;
  room: RoomName;
  roomId: number;
  angle: number;
  isOpen: boolean;
  openProgress: number;
  searched: boolean;
  item: ItemId | null;
}

export interface CursorContainerTarget {
  kind: 'CONTAINER' | 'CONTAINER_ITEM';
  containerId: string;
  dist: number;
  inReach: boolean;
  hasLos: boolean;
  item?: ItemId;
}

export interface SteamPipe {
  id: string;
  deck: ShipDeck;
  wallTx: number;
  wallTy: number;
  nozzleTx: number;
  nozzleTy: number;
  x: number;
  y: number;
  dirX: number; // unit tile direction along corridor (-1, 0, 1)
  dirY: number;
  rangeTiles: number; // 2..4 corridor tiles
  cycleTimer: number; // idle countdown until telegraph starts
  warningTimer: number; // >0 means metallic clank + amber gauge + pre-burst wisps
  activeTimer: number; // >0 means directional steam jet firing
  nextInterval: number;
  hitPlayerThisBurst?: boolean;
}

export interface PaperMapStand {
  id: string;
  deck: ShipDeck;
  tx: number;
  ty: number;
  x: number;
  y: number;
  room: RoomName;
  roomId: number;
}

export interface RoomBounds {
  id: number;
  name: RoomName;
  category: RoomCategory;
  deck: ShipDeck;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type BloodStreakKind = 'DRAG_SMEAR' | 'BOOTPRINTS' | 'SPLATTER';

export interface BloodStreak {
  id: string;
  kind: BloodStreakKind;
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  intensity: number;
  seed: number;
  room: RoomName;
  roomId?: number;
}

export interface Deck3HullWedge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'CHAMFER' | 'BOW' | 'STERN';
}

export interface Deck3RailingSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  nx: number;
  ny: number;
  hasStartPost: boolean;
  hasEndPost: boolean;
}

export interface ShipMap {
  width: number;
  height: number;
  tileSize: number;
  archetype: ShipArchetype;
  tiles: TileType[][];
  roomGrid: RoomName[][];
  roomIdGrid: number[][];
  deckGrid: ShipDeck[][];
  deckBounds: Record<ShipDeck, { y1: number; y2: number; centerY: number }>;
  floorMaterial: FloorMaterial[][];
  rooms: RoomBounds[];
  doors: Door[];
  stairwells: Stairwell[];
  props: ShipProp[];
  hidingSpots: HidingSpot[];
  containers: Container[];
  steamPipes: SteamPipe[];
  paperMaps: PaperMapStand[];
  lightSwitches: RoomLightSwitch[];
  fuseSockets: FuseSocket[];
  corridorLights: CorridorLightFixture[];
  lockedOnlyRoomIds: number[];
  bloodStreaks: BloodStreak[];
  deck3HullWedges: Deck3HullWedge[];
  deck3Railings: Deck3RailingSegment[];
  playerSpawn: { x: number; y: number };
  bruteSpawn: { x: number; y: number };
  lifeboatPos: { x: number; y: number; tx: number; ty: number };
  heliPos: { x: number; y: number; tx: number; ty: number };
  submarinePos: {
    x: number;
    y: number;
    tx: number;
    ty: number;
    leverX: number;
    leverY: number;
    leverTx: number;
    leverTy: number;
  };
  seed: number;
}

export interface PlayerState {
  x: number;
  y: number;
  angle: number;
  radius: number;
  stamina: number;
  maxStamina: number;
  exhausted: boolean;
  battery: number;
  maxBattery: number;
  flashlightOn: boolean;
  crouching: boolean;
  sprinting: boolean;
  isMoving: boolean;
  hidingSpotId: string | null;
  peekingDoorId: string | null;
  peekingSpotId: string | null;
  peekingStairId: string | null;
  preHidePos: { x: number; y: number } | null;
  climbingStairId: string | null;
  climbProgress: number; // 0..1 timed climb progress
  steamStaggerTimer: number; // >0 means movement stagger limp from Deck 1 steam burst
  steamFogAlpha: number; // 0..1 condensation screen fog
  openPaperMapDeck: ShipDeck | null;
  openPaperMapStandPos: { x: number; y: number; deck: ShipDeck } | null;
  inventory: ItemId[];
  maxInventorySlots: number;
  hasBackpack: boolean;
  selectedSlot: number;
  stepTimer: number;
  walkPhase: number;
  noiseLevel: number; // 0..1 instantaneous noise
}

export type BruteBehaviorState =
  | 'ROAM'
  | 'STALK'
  | 'INVESTIGATE'
  | 'CHASE'
  | 'SEARCH_ROOM'
  | 'CHECK_HIDING'
  | 'SMASH_DOOR'
  | 'STUNNED';

export interface BruteState {
  x: number;
  y: number;
  angle: number;
  targetAngle: number;
  radius: number;
  state: BruteBehaviorState;
  path: Array<{ tx: number; ty: number }>;
  pathRecalcTimer: number;
  roamTarget: { tx: number; ty: number; room: RoomName; roomId?: number } | null;
  investigateTarget: { x: number; y: number; urgency: number } | null;
  lastKnownPlayerPos: { x: number; y: number } | null;
  lastSeenPlayerVelocity: { vx: number; vy: number } | null;
  chaseOvershootPos: { x: number; y: number } | null;
  chaseAggroTimer: number;
  watchedPlayerHideSpotId: string | null;
  searchSpotsQueue: string[];
  currentInspectSpotId: string | null;
  inspectTimer: number;
  smashDoorId: string | null;
  smashTimer: number;
  stunTimer: number;
  alertTimer: number; // time remaining in SEARCH_ROOM / INVESTIGATE before returning to truly random ROAM
  stepTimer: number;
  roarCooldown: number;
  sightingsCount: number;
  cluesSpottedTotal: number;
  checkedSpotsTotal: number;
  doorsSmashedTotal: number;
  pauseAtWaypointTimer: number;
  scanSweepDir: number;
  stairClimbTimer: number;
  stairDestId: string | null;
  pursuitStairId: string | null;
  fiddleSwitchId: string | null;
  fiddleSwitchTimer: number;
  fiddleClickTimer: number;
  walkPhase: number;
}

export interface SoundRipple {
  id: number;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
  label?: string;
}

export interface DroppedLight {
  id: number;
  x: number;
  y: number;
  type: 'GLOWSTICK' | 'FLARE';
  life: number;
  maxLife: number;
  lureTimer: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface WorldPickup {
  id: number;
  x: number;
  y: number;
  deck: ShipDeck;
  item: ItemId;
}

export type EscapeActivationState = 'IDLE' | 'ACTIVATING' | 'READY';

export interface EscapeProgress {
  lifeboatParts: ItemId[];
  heliParts: ItemId[];
  submarineParts: ItemId[];
  heliChainsRemaining: number;
  heliChainCutProgress: number;
  lifeboatPartProgress: number;
  heliPartProgress: number;
  submarinePartProgress: number;
  lifeboatActivatingHold: number;
  heliActivatingHold: number;
  submarineActivatingHold: number;
  lifeboatState: EscapeActivationState;
  heliState: EscapeActivationState;
  submarineState: EscapeActivationState;
  lifeboatActivationProgress: number; // 0..1 timed hydraulic crane swing-out
  heliActivationProgress: number; // 0..1 timed turbine spin-up
  submarineActivationProgress: number; // 0..1 timed floodgate deluge & ballast pressurize
}

export interface RunStats {
  elapsedSeconds: number;
  partsInstalled: number;
  containersSearched: number;
  bruteSightings: number;
  cluesSpotted: number;
  hidingSpotsCheckedByBrute: number;
  doorsSmashed: number;
  escapeMethod: 'LIFEBOAT' | 'HELICOPTER' | 'SUBMARINE' | null;
  deathReason: string | null;
  seed: number;
  difficulty: DifficultyConfig;
  customBruteTuning?: boolean;
}

export interface HudSnapshot {
  stamina: number;
  battery: number;
  flashlightOn: boolean;
  crouching: boolean;
  hiding: boolean;
  currentDeck: ShipDeck;
  currentRoom: RoomName;
  shipArchetype: ShipArchetype;
  inventory: ItemId[];
  maxInventorySlots: number;
  hasBackpack: boolean;
  selectedSlot: number;
  journalOpen: boolean;
  paperMapDeck: ShipDeck | null;
  paperMapStandPos: { x: number; y: number; deck: ShipDeck } | null;
  steamFogAlpha: number;
  steamStaggered: boolean;
  lifeboatParts: ItemId[];
  heliParts: ItemId[];
  submarineParts: ItemId[];
  heliChainsRemaining: number;
  poweredDecks: Record<ShipDeck, boolean>;
  lifeboatState: EscapeActivationState;
  heliState: EscapeActivationState;
  submarineState: EscapeActivationState;
  lifeboatActivationProgress: number;
  heliActivationProgress: number;
  submarineActivationProgress: number;
  promptText: string | null;
  promptSubtext: string | null;
  bruteState: BruteBehaviorState;
  bruteDistance: number;
  elapsedSeconds: number;
  toastMessage: string | null;
  actionProgress: number;
  actionLabel: string | null;
  climbProgress: number;
  climbLabel: string | null;
  zoom: number;
}

export type DebugScenarioId =
  | 'WALL_OCCLUSION'
  | 'LIT_ROOM_DOOR_SPILL'
  | 'LIT_ROOM_CLOSED_DOOR'
  | 'HIDING_FLASHLIGHT_PEEK'
  | 'BRUTE_HIDING_KILL'
  | 'DOOR_KEYHOLE_AND_FLARE'
  | 'BRUTE_BEAM_CORNER'
  | 'STAIR_BRUTE_GLOW'
  | 'STAIR_PEEK'
  | 'FLICKER_AND_SURVIVOR'
  | 'ESCAPE_HELI_OVERHAUL'
  | 'ESCAPE_LIFEBOAT_CRANE';

export interface AcousticContext {
  bruteDistance: number;
  bruteDx: number;
  bruteDy: number;
  bruteOcclusion: number; // 0 (open LoS) .. 1 (thick walls / cross-deck)
  bruteState: BruteBehaviorState;
  bruteMuffled: boolean;
  playerExhausted: boolean;
  playerStaminaRatio: number;
  playerSprinting: boolean;
  playerHiding: boolean;
  nearestLightDist: number;
  nearestLightOcclusion: number;
  nearestLightSputter: number;
  nearestVentIntensity: number;
  nearestFlareIntensity: number;
}

export type DebugRenderMode = 'NORMAL' | 'FULLBRIGHT' | 'LOS_ONLY' | 'LOS_MASK' | 'LIGHT_MASK';

export interface DebugOverlayConfig {
  enabled: boolean;
  freezeAi: boolean;
  showPlayerLos: boolean;
  showBruteFov: boolean;
  showWallSegments: boolean;
  showBlackProbes: boolean;
  forceVentPeek: boolean;
  forceDoorPeek: boolean;
  forceStairPeek: boolean;
  renderMode: DebugRenderMode;
  cameraPitchDeg: number;
  cameraYawDeg: number;
  cameraFovDeg: number;
  wireframeStructure: boolean;
  hideWallCaps: boolean;
  showStructureGizmos: boolean;
  debugDeckOverride: 'AUTO' | ShipDeck;
  freeCamEnabled: boolean;
  freeCamX: number;
  freeCamY: number;
  freeCamZoom: number;
}


