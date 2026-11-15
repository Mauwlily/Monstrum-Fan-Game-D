export type GameStatus = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'VICTORY' | 'GAME_OVER';

export type DifficultyLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface DifficultyConfig {
  intelligence: DifficultyLevel;
  senses: DifficultyLevel;
  speed: DifficultyLevel;
}

export type DifficultyPreset = 'MERCY' | 'STANDARD' | 'NIGHTMARE' | 'CUSTOM';

export const DIFFICULTY_PRESETS: Record<Exclude<DifficultyPreset, 'CUSTOM'>, DifficultyConfig> = {
  MERCY: { intelligence: 'LOW', senses: 'LOW', speed: 'LOW' },
  STANDARD: { intelligence: 'MEDIUM', senses: 'MEDIUM', speed: 'MEDIUM' },
  NIGHTMARE: { intelligence: 'HIGH', senses: 'HIGH', speed: 'HIGH' },
};

export function detectDifficultyPreset(cfg: DifficultyConfig): DifficultyPreset {
  for (const key of ['MERCY', 'STANDARD', 'NIGHTMARE'] as const) {
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
  | 'ESCAPE_HELI';

export type ShipDeck = 'MAIN' | 'LOWER';

export type ShipArchetype = 'CONTAINER_FREIGHTER' | 'BULK_CARRIER' | 'ICEBREAKER';

export type FloorMaterial = 'STEEL' | 'WEATHER' | 'GRATING' | 'CARGO' | 'CABIN' | 'BRIDGE';

export type RoomName =
  | 'Helideck'
  | 'Lifeboat Davit'
  | 'Weather Deck'
  | 'Container Bay'
  | 'Forecastle'
  | 'Bridge'
  | 'Chart Room'
  | 'Officers Mess'
  | 'Infirmary'
  | 'Engine Room'
  | 'Boiler Room'
  | 'Workshop'
  | 'Lower Cargo Hold'
  | 'Crew Quarters'
  | 'Galley & Mess'
  | 'Pump Room'
  | 'Corridor'
  | 'Catwalk';

export type ItemId =
  | 'WINCH_CRANK'
  | 'MARINE_BATTERY'
  | 'HULL_PATCH'
  | 'AVIATION_FUEL'
  | 'IGNITION_KEY'
  | 'ROTOR_FUSE'
  | 'BATTERY_PACK'
  | 'GLOWSTICK'
  | 'FLARE'
  | 'FIRE_EXTINGUISHER'
  | 'BOLT_CUTTERS';

export interface ItemMeta {
  id: ItemId;
  name: string;
  shortName: string;
  category: 'LIFEBOAT_PART' | 'HELI_PART' | 'TOOL';
  description: string;
  color: string;
}

export const ITEM_CATALOG: Record<ItemId, ItemMeta> = {
  WINCH_CRANK: {
    id: 'WINCH_CRANK',
    name: 'Winch Crank',
    shortName: 'Winch',
    category: 'LIFEBOAT_PART',
    description: 'Lifeboat part — lowers the port stern davit.',
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
    description: 'Helicopter part — fuels the stern chopper.',
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
    description: 'Cuts padlocked bulkhead doors.',
    color: '#cbd5e1',
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
  lockCut?: boolean;
}

export interface RoomLightSwitch {
  id: string;
  room: RoomName;
  tx: number;
  ty: number;
  x: number;
  y: number;
  isOn: boolean;
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
  room: RoomName;
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
  | 'PIPE_RUN';

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
  angle: number;
  checkedFlash: number; // visual flash timer when Brute rips it open
}

export type ContainerType = 'CABINET' | 'TOOLBOX' | 'SUPPLY_CRATE' | 'DESK';

export interface Container {
  id: string;
  tx: number;
  ty: number;
  x: number;
  y: number;
  type: ContainerType;
  room: RoomName;
  searched: boolean;
  item: ItemId | null;
}

export interface SteamVent {
  id: string;
  tx: number;
  ty: number;
  x: number;
  y: number;
  timer: number;
  activeTimer: number; // >0 means hissing loud steam cloud
}

export interface RoomBounds {
  name: RoomName;
  deck: ShipDeck;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ShipMap {
  width: number;
  height: number;
  tileSize: number;
  archetype: ShipArchetype;
  tiles: TileType[][];
  roomGrid: RoomName[][];
  deckGrid: ShipDeck[][];
  floorMaterial: FloorMaterial[][];
  rooms: RoomBounds[];
  doors: Door[];
  stairwells: Stairwell[];
  props: ShipProp[];
  hidingSpots: HidingSpot[];
  containers: Container[];
  steamVents: SteamVent[];
  lightSwitches: RoomLightSwitch[];
  playerSpawn: { x: number; y: number };
  bruteSpawn: { x: number; y: number };
  lifeboatPos: { x: number; y: number; tx: number; ty: number };
  heliPos: { x: number; y: number; tx: number; ty: number };
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
  preHidePos: { x: number; y: number } | null;
  climbingStairId: string | null;
  climbProgress: number; // 0..1 timed climb progress
  inventory: ItemId[];
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
  roamTarget: { tx: number; ty: number; room: RoomName } | null;
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

export interface EscapeProgress {
  lifeboatParts: ItemId[];
  heliParts: ItemId[];
  lifeboatLaunchProgress: number; // 0..1 (hold E at escape once all 3 installed)
  heliLaunchProgress: number; // 0..1
}

export interface RunStats {
  elapsedSeconds: number;
  partsInstalled: number;
  containersSearched: number;
  bruteSightings: number;
  cluesSpotted: number;
  hidingSpotsCheckedByBrute: number;
  doorsSmashed: number;
  escapeMethod: 'LIFEBOAT' | 'HELICOPTER' | null;
  deathReason: string | null;
  seed: number;
  difficulty: DifficultyConfig;
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
  selectedSlot: number;
  lifeboatParts: ItemId[];
  heliParts: ItemId[];
  promptText: string | null;
  promptSubtext: string | null;
  bruteState: BruteBehaviorState;
  bruteDistance: number;
  elapsedSeconds: number;
  toastMessage: string | null;
  launchProgress: number;
  launchLabel: string | null;
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
  | 'FLICKER_AND_SURVIVOR';

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

export interface DebugOverlayConfig {
  enabled: boolean;
  freezeAi: boolean;
  showPlayerLos: boolean;
  showBruteFov: boolean;
  showWallSegments: boolean;
  showBlackProbes: boolean;
  forceVentPeek: boolean;
  forceDoorPeek: boolean;
}

