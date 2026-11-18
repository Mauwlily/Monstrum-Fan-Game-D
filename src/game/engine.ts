import { HorrorAudioEngine } from './audio';
import { BruteBrain } from './bruteAi';
import { applyDebugScenarioToEngine, DebugScenarioMetadata } from './debugScenarios';
import { getRoomLightFlicker } from './lighting';
import { generateCargoShip, isTileWalkable } from './mapGen';
import { findPath } from './pathfinding';
import {
  AcousticContext,
  BruteState,
  BruteTuningNumbers,
  Container,
  DebugOverlayConfig,
  DebugScenarioId,
  DifficultyConfig,
  Door,
  DroppedLight,
  EscapeProgress,
  FloorMaterial,
  getDeckIndex,
  getDeckLabel,
  getViewportResolutionScale,
  HidingSpot,
  HudSnapshot,
  ITEM_CATALOG,
  ItemId,
  PaperMapStand,
  Particle,
  PlayerState,
  RoomLightSwitch,
  RoomName,
  RunStats,
  ShipDeck,
  ShipMap,
  SoundRipple,
  Stairwell,
  SteamPipe,
  WorldPickup,
} from './types';
import {
  canBruteSeePlayer,
  canBruteSeePoint,
  getSensesProfile,
  hasLineOfSight,
  hasLineOfSightToEntity,
  normalizeAngle,
} from './visibility';

export interface GameEngineCallbacks {
  onHudUpdate: (hud: HudSnapshot) => void;
  onGameOver: (stats: RunStats) => void;
  onVictory: (stats: RunStats) => void;
}

export class MonstrumGameEngine {
  public map: ShipMap;
  public difficulty: DifficultyConfig;
  public bruteTuning?: BruteTuningNumbers;
  public customBruteTuning = false;
  public player: PlayerState;
  public brute: BruteState;
  public escape: EscapeProgress;
  public ripples: SoundRipple[] = [];
  public droppedLights: DroppedLight[] = [];
  public worldPickups: WorldPickup[] = [];
  public particles: Particle[] = [];
  public doorsByTile: Map<number, Door> = new Map();
  public stairByTile: Map<number, Stairwell> = new Map();

  public cameraX = 0;
  public cameraY = 0;
  public zoom = 1.25;
  public targetZoom = 1.25;
  public lookAheadX = 0;
  public lookAheadY = 0;
  public screenShake = 0;
  public spotFlashAlpha = 0;
  public elapsedSeconds = 0;
  public journalOpen = false;

  public brain: BruteBrain;
  private audio: HorrorAudioEngine;
  private callbacks: GameEngineCallbacks;
  private nextId = 1;
  private toastMessage: string | null = null;
  private toastTimer = 0;
  private containersSearched = 0;
  private hudSyncTimer = 0;
  private ended = false;
  private brutePassThroughDoors: Set<string> = new Set();
  private lastObservedPlayerPos: { x: number; y: number } | null = null;
  private peekNoBatteryToasted = false;
  private climbMidRungPlayed = false;
  private checkHidingStallTimer = 0;
  private lastCheckHidingSpotId: string | null = null;
  private lastCheckHidingDist = Infinity;
  private repairTickTimer = 0;
  private heliPulseTimer = 0;
  private lifeboatPulseTimer = 0;
  private subPulseTimer = 0;
  private activeRepairLabel: string | null = null;
  private activeRepairProgress = 0;
  public maxEmittedAcousticRadius = 0;
  private bruteStuckTimer = 0;

  public debugConfig: DebugOverlayConfig = {
    enabled: false,
    freezeAi: false,
    showPlayerLos: false,
    showBruteFov: false,
    showWallSegments: false,
    showBlackProbes: true,
    forceVentPeek: false,
    forceDoorPeek: false,
    forceStairPeek: false,
  };
  public debugScenario: DebugScenarioId | null = null;
  public debugProbePoints: Array<{ x: number; y: number; label: string }> = [];

  // Input state
  public keys: Set<string> = new Set();
  public mouseScreenX = 0;
  public mouseScreenY = 0;
  public mouseMoved = false;
  public holdingInteract = false;

  constructor(
    difficulty: DifficultyConfig,
    audio: HorrorAudioEngine,
    callbacks: GameEngineCallbacks,
    seed?: number,
    bruteTuning?: BruteTuningNumbers,
    customBruteTuning = false
  ) {
    this.difficulty = { ...difficulty };
    this.bruteTuning = bruteTuning ? { ...bruteTuning } : undefined;
    this.customBruteTuning = customBruteTuning;
    this.audio = audio;
    this.callbacks = callbacks;
    this.map = generateCargoShip(seed);
    this.rebuildDoorIndex();
    this.brain = new BruteBrain(this.map);

    this.player = {
      x: this.map.playerSpawn.x,
      y: this.map.playerSpawn.y,
      angle: 0,
      radius: 13,
      stamina: 100,
      maxStamina: 100,
      exhausted: false,
      battery: 100,
      maxBattery: 100,
      flashlightOn: true,
      crouching: false,
      sprinting: false,
      isMoving: false,
      hidingSpotId: null,
      peekingDoorId: null,
      peekingSpotId: null,
      peekingStairId: null,
      preHidePos: null,
      climbingStairId: null,
      climbProgress: 0,
      steamStaggerTimer: 0,
      steamFogAlpha: 0,
      openPaperMapDeck: null,
      openPaperMapStandPos: null,
      inventory: ['GLOWSTICK'], // Start with 1 glowstick; 4 slots by default (+2 via Backpack)
      maxInventorySlots: 4,
      hasBackpack: false,
      selectedSlot: 0,
      stepTimer: 0,
      walkPhase: 0,
      noiseLevel: 0,
    };

    this.brute = {
      x: this.map.bruteSpawn.x,
      y: this.map.bruteSpawn.y,
      angle: Math.PI,
      targetAngle: Math.PI,
      radius: 17,
      state: 'ROAM',
      path: [],
      pathRecalcTimer: 0,
      roamTarget: null,
      investigateTarget: null,
      lastKnownPlayerPos: null,
      lastSeenPlayerVelocity: null,
      chaseOvershootPos: null,
      chaseAggroTimer: 0,
      watchedPlayerHideSpotId: null,
      searchSpotsQueue: [],
      currentInspectSpotId: null,
      inspectTimer: 0,
      smashDoorId: null,
      smashTimer: 0,
      stunTimer: 0,
      alertTimer: 0,
      stepTimer: 0,
      roarCooldown: 0,
      sightingsCount: 0,
      cluesSpottedTotal: 0,
      checkedSpotsTotal: 0,
      doorsSmashedTotal: 0,
      pauseAtWaypointTimer: 0,
      scanSweepDir: 1,
      stairClimbTimer: 0,
      stairDestId: null,
      pursuitStairId: null,
      walkPhase: 0,
    };

    this.escape = {
      lifeboatParts: [],
      heliParts: [],
      submarineParts: [],
      lifeboatPartProgress: 0,
      heliPartProgress: 0,
      submarinePartProgress: 0,
      lifeboatActivatingHold: 0,
      heliActivatingHold: 0,
      submarineActivatingHold: 0,
      lifeboatState: 'IDLE',
      heliState: 'IDLE',
      submarineState: 'IDLE',
      lifeboatActivationProgress: 0,
      heliActivationProgress: 0,
      submarineActivationProgress: 0,
    };

    this.cameraX = this.player.x;
    this.cameraY = this.player.y;
    this.maxEmittedAcousticRadius = 0;
    this.bruteStuckTimer = 0;
    this.pickRandomRoamTarget();
    this.emitHud();
  }

  private rebuildDoorIndex(): void {
    this.doorsByTile.clear();
    for (const d of this.map.doors) {
      this.doorsByTile.set(d.ty * this.map.width + d.tx, d);
    }
    this.stairByTile.clear();
    for (const s of this.map.stairwells) {
      this.stairByTile.set(s.ty * this.map.width + s.tx, s);
    }
  }

  public showToast(msg: string, duration = 2.8): void {
    this.toastMessage = msg;
    this.toastTimer = duration;
  }

  public getEffectiveZoom(canvasWidth: number, canvasHeight: number): number {
    return this.zoom * getViewportResolutionScale(canvasWidth, canvasHeight);
  }

  public adjustZoom(deltaY: number): void {
    const step = deltaY > 0 ? -0.1 : 0.1;
    this.targetZoom = Math.max(0.9, Math.min(1.8, Math.round((this.targetZoom + step) * 100) / 100));
  }

  public applyDebugScenario(scenarioId: DebugScenarioId): DebugScenarioMetadata {
    this.ended = false;
    this.toastMessage = null;
    this.toastTimer = 0;
    this.spotFlashAlpha = 0;
    this.screenShake = 0;
    this.checkHidingStallTimer = 0;
    this.lastCheckHidingSpotId = null;
    this.lastCheckHidingDist = Infinity;
    this.bruteStuckTimer = 0;
    this.maxEmittedAcousticRadius = 0;
    const meta = applyDebugScenarioToEngine(this, scenarioId);
    return meta;
  }

  public isEnded(): boolean {
    return this.ended;
  }

  public getBruteIncomingStairDestId(): string | null {
    const b = this.brute;
    if (b.stairClimbTimer > 0 && b.stairDestId) {
      return b.stairDestId;
    }
    if (b.state === 'STUNNED' || b.path.length === 0) return null;

    const bTx = Math.floor(b.x / this.map.tileSize);
    const bTy = Math.floor(b.y / this.map.tileSize);
    const bDeck = this.map.deckGrid[bTy]?.[bTx];
    if (!bDeck) return null;

    const checkLimit = Math.min(2, b.path.length);
    for (let i = 0; i < checkLimit; i++) {
      const wp = b.path[i];
      const wpDeck = this.map.deckGrid[wp.ty]?.[wp.tx];
      if (wpDeck && wpDeck !== bDeck) {
        const dest = this.stairByTile.get(wp.ty * this.map.width + wp.tx);
        if (dest) {
          const from = this.map.stairwells.find((s) => s.id === dest.targetStairId);
          if (from && Math.hypot(from.x - b.x, from.y - b.y) < 92) {
            return dest.id;
          }
        }
      }
    }
    return null;
  }

  public update(dt: number, canvasWidth: number, canvasHeight: number): void {
    if (this.ended) return;
    const clampedDt = Math.min(dt, 0.05);
    this.elapsedSeconds += clampedDt;

    if (this.toastTimer > 0) {
      this.toastTimer -= clampedDt;
      if (this.toastTimer <= 0) this.toastMessage = null;
    }

    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - clampedDt * 24);
    }
    if (this.spotFlashAlpha > 0) {
      this.spotFlashAlpha = Math.max(0, this.spotFlashAlpha - clampedDt * 2.2);
    }

    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, clampedDt * 12);

    this.updateDoors(clampedDt);
    this.updateSteamPipes(clampedDt);
    this.updateDroppedLights(clampedDt);
    this.updatePlayer(clampedDt, canvasWidth, canvasHeight);
    this.updateEscapeActivations(clampedDt);
    if (!this.debugConfig.freezeAi) {
      this.updateBrute(clampedDt);
    }
    this.updateRipplesAndParticles(clampedDt);

    // Expressive camera look-ahead toward mouse aim & peek vectors
    const effZoom = this.getEffectiveZoom(canvasWidth, canvasHeight);
    let desiredLookX = 0;
    let desiredLookY = 0;
    if (this.player.peekingDoorId) {
      const door = this.map.doors.find((d) => d.id === this.player.peekingDoorId);
      if (door) {
        const dcx = (door.tx + 0.5) * this.map.tileSize;
        const dcy = (door.ty + 0.5) * this.map.tileSize;
        const dx = dcx - this.player.x;
        const dy = dcy - this.player.y;
        const len = Math.max(1, Math.hypot(dx, dy));
        const peekBias = 132 / Math.sqrt(this.zoom);
        desiredLookX = (dx / len) * peekBias;
        desiredLookY = (dy / len) * peekBias;
      }
    } else if (this.player.peekingStairId) {
      const st = this.map.stairwells.find((s) => s.id === this.player.peekingStairId);
      if (st) {
        const dx = st.x - this.player.x;
        const dy = st.y - this.player.y;
        const len = Math.max(1, Math.hypot(dx, dy));
        const peekBias = 56 / Math.sqrt(this.zoom);
        desiredLookX = (dx / len) * peekBias;
        desiredLookY = (dy / len) * peekBias;
      }
    } else if (this.player.peekingSpotId) {
      const peekBias = 112 / Math.sqrt(this.zoom);
      desiredLookX = Math.cos(this.player.angle) * peekBias;
      desiredLookY = Math.sin(this.player.angle) * peekBias;
    } else if (this.player.hidingSpotId !== null) {
      desiredLookX = 0;
      desiredLookY = 0;
    } else if (this.mouseMoved && canvasWidth > 0 && canvasHeight > 0 && effZoom > 0) {
      const nx = Math.max(-1, Math.min(1, (this.mouseScreenX - canvasWidth / 2) / (canvasWidth * 0.42)));
      const ny = Math.max(-1, Math.min(1, (this.mouseScreenY - canvasHeight / 2) / (canvasHeight * 0.42)));
      const maxLook = 135 / Math.sqrt(this.zoom);
      desiredLookX = nx * maxLook;
      desiredLookY = ny * maxLook;
    }

    this.lookAheadX += (desiredLookX - this.lookAheadX) * Math.min(1, clampedDt * 6.5);
    this.lookAheadY += (desiredLookY - this.lookAheadY) * Math.min(1, clampedDt * 6.5);

    const camSpeed = 9;
    const targetCamX = this.player.x + this.lookAheadX;
    const targetCamY = this.player.y + this.lookAheadY;
    this.cameraX += (targetCamX - this.cameraX) * Math.min(1, clampedDt * camSpeed);
    this.cameraY += (targetCamY - this.cameraY) * Math.min(1, clampedDt * camSpeed);

    this.audio.updateAmbient(clampedDt, this.buildAcousticContext());

    this.hudSyncTimer += clampedDt;
    if (this.hudSyncTimer >= 0.08) {
      this.hudSyncTimer = 0;
      this.emitHud();
    }
  }

  private updateDoors(dt: number): void {
    for (const d of this.map.doors) {
      if (d.isBroken) {
        d.openProgress = 1;
        continue;
      }
      const target = d.isOpen ? 1 : 0;
      if (d.openProgress < target) {
        d.openProgress = Math.min(target, d.openProgress + d.swingSpeed * dt);
      } else if (d.openProgress > target) {
        d.openProgress = Math.max(target, d.openProgress - d.swingSpeed * dt);
      }
    }

    // Smooth non-stick directional push-through if player overlaps a closing/closed door
    if (this.player.hidingSpotId === null && this.player.climbingStairId === null) {
      this.resolveEntityDoorPush(this.player, dt, false);
    }
  }

  public getSteamPipeClippedRangeTiles(pipe: SteamPipe): number {
    let reach = 0;
    for (let step = 0; step < pipe.rangeTiles; step++) {
      const tx = pipe.nozzleTx + pipe.dirX * step;
      const ty = pipe.nozzleTy + pipe.dirY * step;
      if (tx < 0 || tx >= this.map.width || ty < 0 || ty >= this.map.height) break;
      if (!isTileWalkable(this.map.tiles[ty][tx])) break;
      const door = this.doorsByTile.get(ty * this.map.width + tx);
      if (door && !door.isOpen && !door.isBroken) break;
      reach = step + 1;
    }
    return reach;
  }

  private updateSteamPipes(dt: number): void {
    const p = this.player;
    const ts = this.map.tileSize;

    for (const pipe of this.map.steamPipes) {
      if (pipe.activeTimer > 0) {
        pipe.activeTimer -= dt;
        const clippedTiles = this.getSteamPipeClippedRangeTiles(pipe);
        const jetLenPx = clippedTiles * ts;

        if (clippedTiles > 0 && Math.random() < 0.72) {
          const along = Math.random() * jetLenPx;
          const nozzleWorldX = pipe.x - pipe.dirX * (ts * 0.42);
          const nozzleWorldY = pipe.y - pipe.dirY * (ts * 0.42);
          this.particles.push({
            x: nozzleWorldX + pipe.dirX * along + (Math.random() - 0.5) * 10,
            y: nozzleWorldY + pipe.dirY * along + (Math.random() - 0.5) * 10,
            vx: pipe.dirX * (170 + Math.random() * 110) + (Math.random() - 0.5) * 26,
            vy: pipe.dirY * (170 + Math.random() * 110) + (Math.random() - 0.5) * 26,
            life: 0.42,
            maxLife: 0.42,
            size: 5 + Math.random() * 7,
            color: 'rgba(226, 232, 240, 0.42)',
          });
        }

        // Hit detection against exposed player inside clipped directional steam plume
        if (
          clippedTiles > 0 &&
          p.hidingSpotId === null &&
          p.climbingStairId === null
        ) {
          const originX = pipe.x - pipe.dirX * (ts * 0.46);
          const originY = pipe.y - pipe.dirY * (ts * 0.46);
          const relX = p.x - originX;
          const relY = p.y - originY;
          const proj = relX * pipe.dirX + relY * pipe.dirY;
          const perp = Math.abs(relX * -pipe.dirY + relY * pipe.dirX);
          if (proj >= -4 && proj <= jetLenPx + ts * 0.36 && perp <= ts * 0.46) {
            if (!pipe.hitPlayerThisBurst) {
              pipe.hitPlayerThisBurst = true;
              p.steamStaggerTimer = 2.6;
              p.steamFogAlpha = Math.min(1, p.steamFogAlpha + 0.92);
              p.sprinting = false;
              this.screenShake = Math.max(this.screenShake, 7.5);
              this.audio.playSteamPipeBurst(pipe.x - p.x, 0, true);
              this.emitNoise(p.x, p.y, 780, 'rgba(248, 250, 252, 0.78)', true, 0.92);
              this.showToast('Scalding steam blast — vision obscured & staggered!', 2.6);
              this.emitHud();
            } else {
              p.steamFogAlpha = Math.min(1, Math.max(p.steamFogAlpha, 0.85));
            }
          }
        }
      } else if (pipe.warningTimer > 0) {
        pipe.warningTimer -= dt;
        if (Math.random() < 0.38) {
          const nozzleX = pipe.x - pipe.dirX * (ts * 0.44);
          const nozzleY = pipe.y - pipe.dirY * (ts * 0.44);
          this.particles.push({
            x: nozzleX + (Math.random() - 0.5) * 6,
            y: nozzleY + (Math.random() - 0.5) * 6,
            vx: pipe.dirX * 55 + (Math.random() - 0.5) * 18,
            vy: pipe.dirY * 55 + (Math.random() - 0.5) * 18,
            life: 0.35,
            maxLife: 0.35,
            size: 3 + Math.random() * 3,
            color: 'rgba(251, 191, 36, 0.42)',
          });
        }
        if (pipe.warningTimer <= 0) {
          pipe.activeTimer = 2.0;
          pipe.cycleTimer = pipe.nextInterval;
          pipe.hitPlayerThisBurst = false;
          const occ = this.computeAcousticOcclusion(pipe.x, pipe.y, p.x, p.y);
          const dist = this.getEffectiveNoiseDistance(pipe.x, pipe.y, p.x, p.y);
          if (dist < 620) {
            this.audio.playSteamPipeBurst(pipe.x - p.x, occ, false);
          }
          this.emitNoise(pipe.x, pipe.y, 440, 'rgba(203, 213, 225, 0.45)', false);
        }
      } else {
        pipe.cycleTimer -= dt;
        if (pipe.cycleTimer <= 0) {
          pipe.warningTimer = 1.35;
          const occ = this.computeAcousticOcclusion(pipe.x, pipe.y, p.x, p.y);
          const dist = this.getEffectiveNoiseDistance(pipe.x, pipe.y, p.x, p.y);
          if (dist < 560) {
            this.audio.playSteamPipeWarning(pipe.x - p.x, occ);
          }
          this.emitNoise(pipe.x, pipe.y, 260, 'rgba(251, 191, 36, 0.34)', false);
        }
      }
    }
  }

  private updateDroppedLights(dt: number): void {
    for (let i = this.droppedLights.length - 1; i >= 0; i--) {
      const l = this.droppedLights[i];
      l.life -= dt;
      if (l.type === 'FLARE') {
        l.lureTimer -= dt;
        if (l.lureTimer <= 0) {
          l.lureTimer = 1.1;
          this.emitNoise(l.x, l.y, 640, 'rgba(251, 113, 133, 0.5)', true, 0.75);
        }
        if (Math.random() < 0.5) {
          this.particles.push({
            x: l.x + (Math.random() - 0.5) * 6,
            y: l.y + (Math.random() - 0.5) * 6,
            vx: (Math.random() - 0.5) * 35,
            vy: (Math.random() - 0.5) * 35,
            life: 0.35,
            maxLife: 0.35,
            size: 3,
            color: '#fb7185',
          });
        }
      }
      if (l.life <= 0) {
        this.droppedLights.splice(i, 1);
      }
    }
  }

  private updatePlayer(dt: number, canvasWidth: number, canvasHeight: number): void {
    const p = this.player;

    if (p.steamStaggerTimer > 0) {
      p.steamStaggerTimer = Math.max(0, p.steamStaggerTimer - dt);
    }
    if (p.steamFogAlpha > 0) {
      p.steamFogAlpha = Math.max(0, p.steamFogAlpha - dt * 0.24);
    }

    // Auto-close stationary Paper Map if player moves away from stand or climbs/hides
    if (p.openPaperMapDeck !== null) {
      const stand = p.openPaperMapStandPos;
      if (
        !stand ||
        p.hidingSpotId !== null ||
        p.climbingStairId !== null ||
        Math.hypot(p.x - stand.x, p.y - stand.y) > 95
      ) {
        this.closePaperMap(false);
      }
    }

    // Flash checked highlight fade
    for (const spot of this.map.hidingSpots) {
      if (spot.checkedFlash > 0) spot.checkedFlash = Math.max(0, spot.checkedFlash - dt * 1.5);
    }

    // Flashlight battery drain
    if (p.flashlightOn) {
      p.battery = Math.max(0, p.battery - dt * 1.35);
      if (p.battery <= 0) {
        p.flashlightOn = false;
        this.audio.playFlashlightClick();
        this.showToast('Flashlight battery depleted.');
      }
    }

    // Aim toward mouse cursor (unprojected with resolution-invariant effective zoom)
    const effZoom = this.getEffectiveZoom(canvasWidth, canvasHeight);
    if (this.mouseMoved && effZoom > 0) {
      const worldMouseX = this.cameraX + (this.mouseScreenX - canvasWidth / 2) / effZoom;
      const worldMouseY = this.cameraY + (this.mouseScreenY - canvasHeight / 2) / effZoom;
      p.angle = Math.atan2(worldMouseY - p.y, worldMouseX - p.x);
    }

    // If actively climbing a companionway stair (~0.9s), anchor on hatch & stay vulnerable until completion
    if (p.climbingStairId !== null) {
      const st = this.map.stairwells.find((s) => s.id === p.climbingStairId);
      const dest = st ? this.map.stairwells.find((s) => s.id === st.targetStairId) : undefined;
      if (!st || !dest) {
        p.climbingStairId = null;
        p.climbProgress = 0;
        this.climbMidRungPlayed = false;
      } else {
        p.sprinting = false;
        p.isMoving = false;
        p.peekingDoorId = null;
        p.peekingSpotId = null;
        p.peekingStairId = null;
        p.noiseLevel = 0.48;
        p.x += (st.x - p.x) * Math.min(1, dt * 16);
        p.y += (st.y - p.y) * Math.min(1, dt * 16);
        p.climbProgress = Math.min(1, p.climbProgress + dt / 0.9);

        if (p.climbProgress >= 0.48 && !this.climbMidRungPlayed) {
          this.climbMidRungPlayed = true;
          this.audio.playStairTraversal(0);
          this.emitNoise(st.x, st.y, 240, 'rgba(148, 163, 184, 0.3)', true, 0.65);
        }

        if (canBruteSeePlayer(this.brute, p, this.map, this.doorsByTile, this.difficulty, this.bruteTuning)) {
          this.brute.pursuitStairId = dest.id;
          this.brute.lastKnownPlayerPos = { x: st.x, y: st.y };
          this.brute.chaseAggroTimer = Math.max(this.brute.chaseAggroTimer, 5.8);
        }

        if (p.climbProgress >= 1) {
          const hearingMult = getSensesProfile(this.difficulty, this.bruteTuning).hearingMult;
          const bruteSawOrHeardNearHatch =
            (this.brute.state === 'CHASE' || this.brute.state === 'SMASH_DOOR') &&
            (this.brute.pursuitStairId === dest.id ||
              (this.brute.lastKnownPlayerPos !== null &&
                Math.hypot(this.brute.lastKnownPlayerPos.x - st.x, this.brute.lastKnownPlayerPos.y - st.y) <= 130) ||
              this.getEffectiveNoiseDistance(st.x, st.y, this.brute.x, this.brute.y) <= 270 * hearingMult);

          p.x = dest.x;
          p.y = dest.y;
          p.climbingStairId = null;
          p.climbProgress = 0;
          this.climbMidRungPlayed = false;
          this.cameraX = p.x;
          this.cameraY = p.y;
          this.lookAheadX = 0;
          this.lookAheadY = 0;
          this.screenShake = Math.max(this.screenShake, 2.2);

          if (bruteSawOrHeardNearHatch) {
            this.brute.pursuitStairId = dest.id;
            this.brute.lastKnownPlayerPos = { x: dest.x, y: dest.y };
            this.brute.lastSeenPlayerVelocity = null;
            this.brute.chaseAggroTimer = 5.8;
            this.brute.pathRecalcTimer = 0;
          }

          this.audio.playStairTraversal(0);
          this.emitNoise(dest.x, dest.y, 210, 'rgba(148, 163, 184, 0.35)', true, 0.55);
          this.showToast(`${getDeckLabel(dest.deck)} — ${dest.room}`);
          this.emitHud();
        }

        p.stamina = Math.min(p.maxStamina, p.stamina + dt * 5);
        this.escape.lifeboatActivatingHold = 0;
        this.escape.heliActivatingHold = 0;
        this.escape.submarineActivatingHold = 0;
        this.activeRepairLabel = null;
        this.activeRepairProgress = 0;
        return;
      }
    }

    // If hiding, flashlight is off by default; holding Q turns it on to peek vents, releasing Q turns it off
    if (p.hidingSpotId !== null) {
      p.sprinting = false;
      p.isMoving = false;
      p.noiseLevel = 0;
      p.peekingDoorId = null;
      p.peekingStairId = null;

      const wantsVentPeek = this.keys.has('KeyQ') || this.debugConfig.forceVentPeek;
      if (wantsVentPeek) {
        if (p.battery > 0) {
          if (p.peekingSpotId === null || !p.flashlightOn) {
            p.flashlightOn = true;
            this.audio.playFlashlightClick();
          }
          p.peekingSpotId = p.hidingSpotId;
          this.peekNoBatteryToasted = false;

          // If Brute is looking toward the hiding spot, he spots the flashlight gleaming out of the slats!
          const senses = getSensesProfile(this.difficulty, this.bruteTuning);
          if (
            !this.debugConfig.freezeAi &&
            this.brute.state !== 'STUNNED' &&
            this.brute.watchedPlayerHideSpotId !== p.hidingSpotId &&
            canBruteSeePoint(
              this.brute,
              p.x,
              p.y,
              440 * senses.sightMult,
              this.map,
              this.doorsByTile,
              senses.halfFovDeg
            )
          ) {
            this.brute.watchedPlayerHideSpotId = p.hidingSpotId;
            const spot = this.map.hidingSpots.find((s) => s.id === p.hidingSpotId);
            if (spot) spot.checkedFlash = 0.7;
          }
        } else {
          p.peekingSpotId = null;
          if (p.flashlightOn) {
            p.flashlightOn = false;
            this.audio.playFlashlightClick();
          }
          if (!this.peekNoBatteryToasted) {
            this.peekNoBatteryToasted = true;
            this.showToast('Flashlight battery empty — cannot peek vents.');
          }
        }
      } else {
        this.peekNoBatteryToasted = false;
        if (p.peekingSpotId !== null) {
          p.peekingSpotId = null;
        }
        if (p.flashlightOn) {
          p.flashlightOn = false;
          this.audio.playFlashlightClick();
        }
      }

      p.stamina = Math.min(p.maxStamina, p.stamina + dt * 22);
      if (p.stamina >= 25) p.exhausted = false;
      this.escape.lifeboatActivatingHold = 0;
      this.escape.heliActivatingHold = 0;
      this.escape.submarineActivatingHold = 0;
      this.activeRepairLabel = null;
      this.activeRepairProgress = 0;
      return;
    }

    p.peekingSpotId = null;

    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;

    const moving = mx !== 0 || my !== 0;
    p.isMoving = moving;
    if (moving) {
      const len = Math.hypot(mx, my);
      mx /= len;
      my /= len;
      if (!this.mouseMoved) {
        p.angle = Math.atan2(my, mx);
      }
    }

    // Check closed-door keyhole OR stairwell landing portal peek when holding Q (or debug force flags)
    const wantsHoldQ = this.keys.has('KeyQ');
    if (wantsHoldQ || this.debugConfig.forceDoorPeek || this.debugConfig.forceStairPeek) {
      let bestDoorId: string | null = null;
      let bestDoorDist = 56;
      if (wantsHoldQ || this.debugConfig.forceDoorPeek) {
        for (const d of this.map.doors) {
          if (d.isOpen || d.isBroken) continue;
          const cx = (d.tx + 0.5) * this.map.tileSize;
          const cy = (d.ty + 0.5) * this.map.tileSize;
          const dist = Math.hypot(cx - p.x, cy - p.y);
          if (dist < bestDoorDist) {
            bestDoorDist = dist;
            bestDoorId = d.id;
          }
        }
      }

      let bestStairId: string | null = null;
      let bestStairDist = this.debugConfig.forceStairPeek ? 110 : 60;
      if (wantsHoldQ || this.debugConfig.forceStairPeek) {
        for (const st of this.map.stairwells) {
          const dist = Math.hypot(st.x - p.x, st.y - p.y);
          if (
            dist < bestStairDist &&
            hasLineOfSightToEntity(this.map, this.doorsByTile, p.x, p.y, st.x, st.y)
          ) {
            bestStairDist = dist;
            bestStairId = st.id;
          }
        }
      }

      if (bestStairId && (!bestDoorId || bestStairDist <= bestDoorDist || this.debugConfig.forceStairPeek)) {
        p.peekingStairId = bestStairId;
        p.peekingDoorId = null;
      } else {
        p.peekingDoorId = bestDoorId;
        p.peekingStairId = null;
      }
    } else {
      p.peekingDoorId = null;
      p.peekingStairId = null;
    }

    const isStaggered = p.steamStaggerTimer > 0;
    const sprintKey = !isStaggered && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
    if (sprintKey && moving && !p.exhausted && p.stamina > 0) {
      // Starting a sprint cleanly exits toggleable sneak stance
      p.crouching = false;
    }
    const wantsSprint = sprintKey && !p.crouching && moving;

    if (wantsSprint && !p.exhausted && p.stamina > 0) {
      p.sprinting = true;
      p.stamina = Math.max(0, p.stamina - dt * 24);
      if (p.stamina <= 0) {
        p.exhausted = true;
        p.sprinting = false;
      }
    } else {
      p.sprinting = false;
      const regen = moving ? 11 : 21;
      p.stamina = Math.min(p.maxStamina, p.stamina + dt * regen);
      if (p.stamina >= 25) p.exhausted = false;
    }

    const baseSpeed = p.sprinting ? 212 : p.crouching ? 86 : 142;
    const speed = isStaggered ? baseSpeed * 0.62 : baseSpeed;

    if (moving) {
      const prevX = p.x;
      const prevY = p.y;
      this.moveEntityWithCollision(p, mx * speed * dt, my * speed * dt, false);
      const moved = Math.hypot(p.x - prevX, p.y - prevY);
      p.walkPhase += moved * (p.crouching ? 0.14 : p.sprinting ? 0.19 : 0.165);
      p.noiseLevel = p.sprinting ? 1.0 : p.crouching ? 0.12 : 0.42;

      p.stepTimer -= dt;
      if (p.stepTimer <= 0) {
        p.stepTimer = p.sprinting ? 0.25 : p.crouching ? 0.52 : 0.37;
        this.audio.playPlayerStep(p.sprinting, p.crouching, this.getFloorMaterialAt(p.x, p.y));
        if (p.sprinting) {
          this.emitNoise(p.x, p.y, 350, 'rgba(226, 232, 240, 0.3)', true, 0.85);
        } else if (!p.crouching) {
          this.emitNoise(p.x, p.y, 130, 'rgba(148, 163, 184, 0.16)', true, 0.25);
        }
      }
    } else {
      p.noiseLevel = 0;
    }

    // Hold E to perform slow partial part repairs OR pull the escape activation lever
    this.updateEscapeInteractHold(dt);
  }

  public getHeldPartForRoute(route: 'LIFEBOAT' | 'HELI' | 'SUBMARINE'): ItemId | null {
    const targetCategory =
      route === 'LIFEBOAT'
        ? 'LIFEBOAT_PART'
        : route === 'HELI'
          ? 'HELI_PART'
          : 'SUBMARINE_PART';
    const installed =
      route === 'LIFEBOAT'
        ? this.escape.lifeboatParts
        : route === 'HELI'
          ? this.escape.heliParts
          : this.escape.submarineParts;
    for (const itemId of this.player.inventory) {
      const meta = ITEM_CATALOG[itemId];
      if (meta.category === targetCategory && !installed.includes(itemId)) {
        return itemId;
      }
    }
    return null;
  }

  private updateEscapeInteractHold(dt: number): void {
    const p = this.player;
    const distLife = Math.hypot(p.x - this.map.lifeboatPos.x, p.y - this.map.lifeboatPos.y);
    const distHeli = Math.hypot(p.x - this.map.heliPos.x, p.y - this.map.heliPos.y);
    const distSubDock = Math.hypot(p.x - this.map.submarinePos.x, p.y - this.map.submarinePos.y);
    const distSubLever = Math.hypot(p.x - this.map.submarinePos.leverX, p.y - this.map.submarinePos.leverY);

    let label: string | null = null;
    let progress = 0;

    // 1. Lifeboat Davit partial repair or crank/crane release lever
    const heldLifePart = this.getHeldPartForRoute('LIFEBOAT');
    if (this.holdingInteract && distLife < 72 && this.escape.lifeboatState === 'IDLE') {
      if (this.escape.lifeboatParts.length < 3 && heldLifePart) {
        this.escape.lifeboatPartProgress = Math.min(1, this.escape.lifeboatPartProgress + dt / 5.0);
        label = `Installing ${ITEM_CATALOG[heldLifePart].name}...`;
        progress = this.escape.lifeboatPartProgress;

        this.repairTickTimer -= dt;
        if (this.repairTickTimer <= 0) {
          this.repairTickTimer = 0.78;
          this.audio.playRepairTick('LIFEBOAT', heldLifePart);
          this.emitNoise(
            this.map.lifeboatPos.x,
            this.map.lifeboatPos.y,
            880,
            'rgba(56, 189, 248, 0.52)',
            true,
            0.88
          );
          for (let i = 0; i < 4; i++) {
            this.particles.push({
              x: this.map.lifeboatPos.x + (Math.random() - 0.5) * 20,
              y: this.map.lifeboatPos.y + (Math.random() - 0.5) * 20,
              vx: (Math.random() - 0.5) * 65,
              vy: (Math.random() - 0.5) * 65,
              life: 0.35,
              maxLife: 0.35,
              size: 2.5,
              color: heldLifePart === 'MARINE_BATTERY' ? '#38bdf8' : '#fed7aa',
            });
          }
        }

        if (this.escape.lifeboatPartProgress >= 1) {
          this.escape.lifeboatPartProgress = 0;
          const idx = p.inventory.indexOf(heldLifePart);
          if (idx !== -1) p.inventory.splice(idx, 1);
          if (p.selectedSlot >= p.inventory.length) {
            p.selectedSlot = Math.max(0, p.inventory.length - 1);
          }
          this.escape.lifeboatParts.push(heldLifePart);
          this.audio.playRepairComplete();
          this.emitNoise(
            this.map.lifeboatPos.x,
            this.map.lifeboatPos.y,
            960,
            'rgba(56, 189, 248, 0.65)',
            true,
            0.94
          );
          this.showToast(
            `${ITEM_CATALOG[heldLifePart].name} installed on Lifeboat (${this.escape.lifeboatParts.length}/3)!`
          );
          this.emitHud();
        }
      } else if (this.escape.lifeboatParts.length === 3) {
        this.escape.lifeboatActivatingHold = Math.min(1, this.escape.lifeboatActivatingHold + dt / 1.4);
        label = 'Engaging Hydraulic Davit Crane...';
        progress = this.escape.lifeboatActivatingHold;
        if (this.escape.lifeboatActivatingHold >= 1) {
          this.escape.lifeboatActivatingHold = 0;
          this.escape.lifeboatState = 'ACTIVATING';
          this.escape.lifeboatActivationProgress = 0;
          this.lifeboatPulseTimer = 0.25;
          this.audio.playEscapeActivationStart('LIFEBOAT');
          this.emitNoise(
            this.map.lifeboatPos.x,
            this.map.lifeboatPos.y,
            960,
            'rgba(56, 189, 248, 0.72)',
            true,
            0.98
          );
          this.showToast('Hydraulic crane engaged — survive until lifeboat swings clear!');
          this.emitHud();
        }
      }
    } else {
      this.escape.lifeboatPartProgress = Math.max(0, this.escape.lifeboatPartProgress - dt * 0.14);
      this.escape.lifeboatActivatingHold = Math.max(0, this.escape.lifeboatActivatingHold - dt * 1.4);
    }

    // 2. Helicopter partial repair or turbine starter hold
    const heldHeliPart = this.getHeldPartForRoute('HELI');
    if (this.holdingInteract && distHeli < 78 && this.escape.heliState === 'IDLE') {
      if (this.escape.heliParts.length < 3 && heldHeliPart) {
        this.escape.heliPartProgress = Math.min(1, this.escape.heliPartProgress + dt / 5.0);
        label = `Installing ${ITEM_CATALOG[heldHeliPart].name}...`;
        progress = this.escape.heliPartProgress;

        this.repairTickTimer -= dt;
        if (this.repairTickTimer <= 0) {
          this.repairTickTimer = 0.78;
          this.audio.playRepairTick('HELI', heldHeliPart);
          this.emitNoise(
            this.map.heliPos.x,
            this.map.heliPos.y,
            900,
            'rgba(251, 191, 36, 0.52)',
            true,
            0.88
          );
          for (let i = 0; i < 4; i++) {
            this.particles.push({
              x: this.map.heliPos.x + (Math.random() - 0.5) * 24,
              y: this.map.heliPos.y + (Math.random() - 0.5) * 24,
              vx: (Math.random() - 0.5) * 70,
              vy: (Math.random() - 0.5) * 70,
              life: 0.35,
              maxLife: 0.35,
              size: 2.5,
              color: heldHeliPart === 'ROTOR_FUSE' ? '#34d399' : '#fbbf24',
            });
          }
        }

        if (this.escape.heliPartProgress >= 1) {
          this.escape.heliPartProgress = 0;
          const idx = p.inventory.indexOf(heldHeliPart);
          if (idx !== -1) p.inventory.splice(idx, 1);
          if (p.selectedSlot >= p.inventory.length) {
            p.selectedSlot = Math.max(0, p.inventory.length - 1);
          }
          this.escape.heliParts.push(heldHeliPart);
          this.audio.playRepairComplete();
          this.emitNoise(
            this.map.heliPos.x,
            this.map.heliPos.y,
            980,
            'rgba(251, 191, 36, 0.65)',
            true,
            0.94
          );
          this.showToast(
            `${ITEM_CATALOG[heldHeliPart].name} installed on Helicopter (${this.escape.heliParts.length}/3)!`
          );
          this.emitHud();
        }
      } else if (this.escape.heliParts.length === 3) {
        this.escape.heliActivatingHold = Math.min(1, this.escape.heliActivatingHold + dt / 1.4);
        label = 'Starting Helicopter Turbine...';
        progress = this.escape.heliActivatingHold;
        if (this.escape.heliActivatingHold >= 1) {
          this.escape.heliActivatingHold = 0;
          this.escape.heliState = 'ACTIVATING';
          this.escape.heliActivationProgress = 0;
          this.heliPulseTimer = 0.25;
          this.audio.playEscapeActivationStart('HELI');
          this.emitNoise(
            this.map.heliPos.x,
            this.map.heliPos.y,
            960,
            'rgba(251, 191, 36, 0.72)',
            true,
            0.98
          );
          this.showToast('Turbine spinning up — survive until rotors reach flight RPM!');
          this.emitHud();
        }
      }
    } else {
      this.escape.heliPartProgress = Math.max(0, this.escape.heliPartProgress - dt * 0.14);
      this.escape.heliActivatingHold = Math.max(0, this.escape.heliActivatingHold - dt * 1.4);
    }

    // 3. Submarine Moonpool partial repair (at dock) OR Floodgate Launch Lever (at lever console)
    const heldSubPart = this.getHeldPartForRoute('SUBMARINE');
    let subPartHolding = false;
    let subLeverHolding = false;
    if (this.holdingInteract && this.escape.submarineState === 'IDLE') {
      if (this.escape.submarineParts.length < 3 && heldSubPart && distSubDock < 92) {
        subPartHolding = true;
        this.escape.submarinePartProgress = Math.min(1, this.escape.submarinePartProgress + dt / 5.0);
        label = `Installing ${ITEM_CATALOG[heldSubPart].name}...`;
        progress = this.escape.submarinePartProgress;

        this.repairTickTimer -= dt;
        if (this.repairTickTimer <= 0) {
          this.repairTickTimer = 0.78;
          this.audio.playRepairTick('SUBMARINE', heldSubPart);
          this.emitNoise(
            this.map.submarinePos.x,
            this.map.submarinePos.y,
            880,
            'rgba(45, 212, 191, 0.52)',
            true,
            0.88
          );
          for (let i = 0; i < 4; i++) {
            this.particles.push({
              x: this.map.submarinePos.x + (Math.random() - 0.5) * 24,
              y: this.map.submarinePos.y + (Math.random() - 0.5) * 24,
              vx: (Math.random() - 0.5) * 65,
              vy: (Math.random() - 0.5) * 65,
              life: 0.35,
              maxLife: 0.35,
              size: 2.5,
              color: heldSubPart === 'SUB_BATTERY' ? '#2dd4bf' : '#fde68a',
            });
          }
        }

        if (this.escape.submarinePartProgress >= 1) {
          this.escape.submarinePartProgress = 0;
          const idx = p.inventory.indexOf(heldSubPart);
          if (idx !== -1) p.inventory.splice(idx, 1);
          if (p.selectedSlot >= p.inventory.length) {
            p.selectedSlot = Math.max(0, p.inventory.length - 1);
          }
          this.escape.submarineParts.push(heldSubPart);
          this.audio.playRepairComplete();
          this.emitNoise(
            this.map.submarinePos.x,
            this.map.submarinePos.y,
            960,
            'rgba(45, 212, 191, 0.65)',
            true,
            0.94
          );
          this.showToast(
            `${ITEM_CATALOG[heldSubPart].name} installed on Submarine (${this.escape.submarineParts.length}/3)!`
          );
          this.emitHud();
        }
      } else if (this.escape.submarineParts.length === 3 && distSubLever < 78) {
        subLeverHolding = true;
        this.escape.submarineActivatingHold = Math.min(1, this.escape.submarineActivatingHold + dt / 1.4);
        label = 'Pulling Floodgate Launch Lever...';
        progress = this.escape.submarineActivatingHold;
        if (this.escape.submarineActivatingHold >= 1) {
          this.escape.submarineActivatingHold = 0;
          this.escape.submarineState = 'ACTIVATING';
          this.escape.submarineActivationProgress = 0;
          this.subPulseTimer = 0.25;
          this.audio.playEscapeActivationStart('SUBMARINE');
          this.emitNoise(
            this.map.submarinePos.leverX,
            this.map.submarinePos.leverY,
            960,
            'rgba(45, 212, 191, 0.72)',
            true,
            0.98
          );
          this.showToast('Moonpool floodgates opening — survive the deluge until launch pressure!');
          this.emitHud();
        }
      }
    }
    if (!subPartHolding) {
      this.escape.submarinePartProgress = Math.max(0, this.escape.submarinePartProgress - dt * 0.14);
    }
    if (!subLeverHolding) {
      this.escape.submarineActivatingHold = Math.max(0, this.escape.submarineActivatingHold - dt * 1.4);
    }

    this.activeRepairLabel = label;
    this.activeRepairProgress = progress;
  }

  private updateEscapeActivations(dt: number): void {
    const p = this.player;

    if (this.escape.lifeboatState === 'ACTIVATING') {
      this.escape.lifeboatActivationProgress = Math.min(
        1,
        this.escape.lifeboatActivationProgress + dt / 9.0
      );
      this.lifeboatPulseTimer -= dt;
      if (this.lifeboatPulseTimer <= 0) {
        this.lifeboatPulseTimer = 1.2;
        const occ = this.computeAcousticOcclusion(
          this.map.lifeboatPos.x,
          this.map.lifeboatPos.y,
          p.x,
          p.y
        );
        this.audio.playEscapeActivationPulse(
          'LIFEBOAT',
          this.escape.lifeboatActivationProgress,
          this.map.lifeboatPos.x - p.x,
          occ
        );
        this.emitNoise(
          this.map.lifeboatPos.x,
          this.map.lifeboatPos.y,
          900,
          'rgba(56, 189, 248, 0.58)',
          true,
          0.95
        );
      }
      if (this.escape.lifeboatActivationProgress >= 1) {
        this.escape.lifeboatState = 'READY';
        this.audio.playEscapeReadyChime('LIFEBOAT');
        this.showToast('LIFEBOAT SWUNG CLEAR — Press E at the bow davit to escape!');
        this.emitHud();
      }
    }

    if (this.escape.heliState === 'ACTIVATING') {
      this.escape.heliActivationProgress = Math.min(1, this.escape.heliActivationProgress + dt / 9.0);
      this.heliPulseTimer -= dt;
      if (this.heliPulseTimer <= 0) {
        this.heliPulseTimer = 1.05;
        const occ = this.computeAcousticOcclusion(this.map.heliPos.x, this.map.heliPos.y, p.x, p.y);
        this.audio.playEscapeActivationPulse(
          'HELI',
          this.escape.heliActivationProgress,
          this.map.heliPos.x - p.x,
          occ
        );
        this.emitNoise(
          this.map.heliPos.x,
          this.map.heliPos.y,
          960,
          'rgba(251, 191, 36, 0.62)',
          true,
          0.96
        );
      }
      if (this.escape.heliActivationProgress >= 1) {
        this.escape.heliState = 'READY';
        this.audio.playEscapeReadyChime('HELI');
        this.showToast('HELICOPTER AT FLIGHT RPM — Press E on the helideck to escape!');
        this.emitHud();
      }
    }

    if (this.escape.submarineState === 'ACTIVATING') {
      this.escape.submarineActivationProgress = Math.min(
        1,
        this.escape.submarineActivationProgress + dt / 9.5
      );
      this.subPulseTimer -= dt;
      if (this.subPulseTimer <= 0) {
        this.subPulseTimer = 1.1;
        const occ = this.computeAcousticOcclusion(
          this.map.submarinePos.x,
          this.map.submarinePos.y,
          p.x,
          p.y
        );
        this.audio.playEscapeActivationPulse(
          'SUBMARINE',
          this.escape.submarineActivationProgress,
          this.map.submarinePos.x - p.x,
          occ
        );
        this.emitNoise(
          this.map.submarinePos.x,
          this.map.submarinePos.y,
          960,
          'rgba(45, 212, 191, 0.62)',
          true,
          0.96
        );
      }
      if (this.escape.submarineActivationProgress >= 1) {
        this.escape.submarineState = 'READY';
        this.audio.playEscapeReadyChime('SUBMARINE');
        this.showToast('SUBMARINE FLOODED & LAUNCH READY — Press E at Submarine Bay to dive!');
        this.emitHud();
      }
    }
  }

  private getSpeedProfile(): {
    roam: number;
    investigate: number;
    stalk: number;
    chase: number;
    smashChase: number;
    smashPatrol: number;
  } {
    if (this.bruteTuning) {
      return {
        roam: this.bruteTuning.roamSpeed,
        investigate: this.bruteTuning.investigateSpeed,
        stalk: this.bruteTuning.stalkSpeed,
        chase: this.bruteTuning.chaseSpeed,
        smashChase: this.bruteTuning.smashChaseDelay,
        smashPatrol: this.bruteTuning.smashPatrolDelay,
      };
    }
    switch (this.difficulty.speed) {
      case 'LOW':
        return {
          roam: 102,
          investigate: 132,
          stalk: 140,
          chase: 196,
          smashChase: 0.62,
          smashPatrol: 0.85,
        };
      case 'HIGH':
        return {
          roam: 136,
          investigate: 174,
          stalk: 186,
          chase: 264,
          smashChase: 0.3,
          smashPatrol: 0.54,
        };
      case 'EXTREME':
        return {
          roam: 164,
          investigate: 210,
          stalk: 224,
          chase: 316,
          smashChase: 0.22,
          smashPatrol: 0.4,
        };
      default:
        return {
          roam: 118,
          investigate: 152,
          stalk: 164,
          chase: 238,
          smashChase: 0.42,
          smashPatrol: 0.7,
        };
    }
  }

  private updateBruteDoorClosing(): void {
    const b = this.brute;
    const p = this.player;
    const ts = this.map.tileSize;
    const nextWp = b.path[0];

    for (const doorId of Array.from(this.brutePassThroughDoors)) {
      const door = this.map.doors.find((d) => d.id === doorId);
      if (!door || door.isBroken || door.isLocked || !door.isOpen) {
        this.brutePassThroughDoors.delete(doorId);
        continue;
      }
      if (nextWp && nextWp.tx === door.tx && nextWp.ty === door.ty) {
        continue;
      }
      const dcx = (door.tx + 0.5) * ts;
      const dcy = (door.ty + 0.5) * ts;
      const dist = Math.hypot(dcx - b.x, dcy - b.y);
      if (dist >= 48) {
        door.isOpen = false;
        door.swingSpeed = door.isWatertight ? (b.state === 'CHASE' ? 2.8 : 1.7) : b.state === 'CHASE' ? 6.2 : 4.5;
        this.brain.noteBruteDoorAction(door, this.elapsedSeconds);
        const effDist = this.getEffectiveNoiseDistance(dcx, dcy, p.x, p.y);
        const occ = this.computeAcousticOcclusion(dcx, dcy, p.x, p.y);
        this.audio.playDoorToggle(false, false, effDist, occ, dcx - p.x, Boolean(door.isWatertight));
        this.brutePassThroughDoors.delete(doorId);
      }
    }
  }

  private computeChaseOvershoot(
    startX: number,
    startY: number,
    vel: { vx: number; vy: number } | null,
    maxDist: number
  ): { x: number; y: number } | null {
    if (!vel) return null;
    const spd = Math.hypot(vel.vx, vel.vy);
    if (spd < 24) return null;
    const ux = vel.vx / spd;
    const uy = vel.vy / spd;
    const ts = this.map.tileSize;
    let bestX = startX;
    let bestY = startY;
    for (let d = 24; d <= maxDist; d += 22) {
      const px = startX + ux * d;
      const py = startY + uy * d;
      const tx = Math.floor(px / ts);
      const ty = Math.floor(py / ts);
      if (tx < 0 || tx >= this.map.width || ty < 0 || ty >= this.map.height) break;
      if (!isTileWalkable(this.map.tiles[ty][tx])) break;
      const door = this.doorsByTile.get(ty * this.map.width + tx);
      if (door && !door.isOpen && !door.isBroken && door.isLocked) break;
      bestX = (tx + 0.5) * ts;
      bestY = (ty + 0.5) * ts;
    }
    if (Math.hypot(bestX - startX, bestY - startY) < 46) return null;
    return { x: bestX, y: bestY };
  }

  private updateBrute(dt: number): void {
    const b = this.brute;
    const p = this.player;
    const speeds = this.getSpeedProfile();

    if (b.roarCooldown > 0) b.roarCooldown -= dt;
    this.brain.decaySuspicion(dt);

    const bTx = Math.max(0, Math.min(this.map.width - 1, Math.floor(b.x / this.map.tileSize)));
    const bTy = Math.max(0, Math.min(this.map.height - 1, Math.floor(b.y / this.map.tileSize)));
    const bruteCurrRoomId = this.map.roomIdGrid[bTy][bTx];
    this.brain.markRoomVisited(bruteCurrRoomId, this.elapsedSeconds);

    // 1. Stunned state (Fire Extinguisher CO2 blast)
    if (b.state === 'STUNNED') {
      b.stunTimer -= dt;
      if (b.stunTimer <= 0) {
        b.state = 'SEARCH_ROOM';
        b.alertTimer = 7.5;
        this.queueSearchRoomHidingSpots(bruteCurrRoomId, b.x, b.y);
      }
      return;
    }

    // 1b. Physical stairwell traversal between decks (prevents instant cross-deck teleportation)
    if (b.stairClimbTimer > 0 && b.stairDestId) {
      b.stairClimbTimer -= dt;
      if (b.stairClimbTimer <= 0) {
        const dest = this.map.stairwells.find((s) => s.id === b.stairDestId);
        b.stairDestId = null;
        if (dest) {
          b.x = dest.x;
          b.y = dest.y;
          b.path = [];
          b.pathRecalcTimer = 0;
          const eff = this.getEffectiveBruteAudioDelta();
          const occ = this.computeAcousticOcclusion(dest.x, dest.y, p.x, p.y);
          this.audio.playStairTraversal(eff.dist, occ);
          this.maybeEmitVerticalEchoRipple(dest.x, dest.y, 'rgba(249, 115, 22, 0.45)', 140);
        }
      }
      return;
    }

    // Close unlocked doors behind the Brute once he clears the doorway
    this.updateBruteDoorClosing();

    // 2. Check wide non-gamey FoV vision for Player!
    const seesPlayer = canBruteSeePlayer(b, p, this.map, this.doorsByTile, this.difficulty, this.bruteTuning);
    if (seesPlayer) {
      const wasChasing = b.state === 'CHASE' || b.state === 'SMASH_DOOR';
      if (this.lastObservedPlayerPos && dt > 0.001) {
        const instVx = (p.x - this.lastObservedPlayerPos.x) / dt;
        const instVy = (p.y - this.lastObservedPlayerPos.y) / dt;
        if (b.lastSeenPlayerVelocity) {
          b.lastSeenPlayerVelocity = {
            vx: b.lastSeenPlayerVelocity.vx * 0.55 + instVx * 0.45,
            vy: b.lastSeenPlayerVelocity.vy * 0.55 + instVy * 0.45,
          };
        } else {
          b.lastSeenPlayerVelocity = { vx: instVx, vy: instVy };
        }
      }
      this.lastObservedPlayerPos = { x: p.x, y: p.y };
      b.lastKnownPlayerPos = { x: p.x, y: p.y };
      b.chaseOvershootPos = null;
      b.chaseAggroTimer = 5.5;
      b.watchedPlayerHideSpotId = null;
      if (p.climbingStairId === null) {
        b.pursuitStairId = null;
      }
      this.brain.stalkTarget = null;
      this.brain.stalkRoomQueue = [];

      if (!wasChasing) {
        b.sightingsCount += 1;
        this.spotFlashAlpha = 0.72;
        this.screenShake = Math.max(this.screenShake, 10);
        if (b.roarCooldown <= 0) {
          const eff = this.getEffectiveBruteAudioDelta();
          const occ = this.computeAcousticOcclusion(b.x, b.y, p.x, p.y);
          this.audio.playBruteRoar(eff.dx, eff.dy, occ);
          b.roarCooldown = 4.0;
        }
      }

      if (b.state !== 'SMASH_DOOR') {
        b.state = 'CHASE';
      }
      b.alertTimer = 6.0;
    } else {
      this.lastObservedPlayerPos = null;
      if (b.watchedPlayerHideSpotId !== null && b.state !== 'SMASH_DOOR') {
        // Brute watched player dive into a hiding spot — charge straight to rip it open!
        const spot = this.map.hidingSpots.find((s) => s.id === b.watchedPlayerHideSpotId);
        if (spot) {
          b.state = 'CHECK_HIDING';
          b.currentInspectSpotId = spot.id;
          b.searchSpotsQueue = [spot.id];
          b.lastKnownPlayerPos = null;
          b.chaseOvershootPos = null;
          b.pursuitStairId = null;
        } else {
          b.watchedPlayerHideSpotId = null;
        }
      }
    }

    // 3. Kill check if within grab distance
    if (p.hidingSpotId === null) {
      const distToPlayer = Math.hypot(b.x - p.x, b.y - p.y);
      if (
        distToPlayer < b.radius + p.radius + 5 &&
        hasLineOfSight(this.map, this.doorsByTile, b.x, b.y, p.x, p.y)
      ) {
        this.triggerGameOver(
          p.climbingStairId !== null
            ? 'Dragged off the companionway stairs by the Brute.'
            : 'Caught by the Brute in open corridors.'
        );
        return;
      }
    }

    // 4. Smashing closed door
    if (b.state === 'SMASH_DOOR') {
      b.smashTimer -= dt;
      if (b.smashTimer <= 0) {
        const door = this.map.doors.find((d) => d.id === b.smashDoorId);
        if (door && !door.isBroken) {
          door.isBroken = true;
          door.isOpen = true;
          door.openProgress = 1;
          door.isLocked = false;
          this.brain.noteBruteDoorAction(door, this.elapsedSeconds);
          b.doorsSmashedTotal += 1;
          const doorX = (door.tx + 0.5) * this.map.tileSize;
          const doorY = (door.ty + 0.5) * this.map.tileSize;
          const dx = doorX - p.x;
          const dy = doorY - p.y;
          const occ = this.computeAcousticOcclusion(doorX, doorY, p.x, p.y);
          this.audio.playDoorSmash(dx, dy, occ);
          this.screenShake = Math.max(this.screenShake, Math.max(0, 9 - Math.hypot(dx, dy) / 90));
          this.emitNoise(
            (door.tx + 0.5) * this.map.tileSize,
            (door.ty + 0.5) * this.map.tileSize,
            680,
            'rgba(249, 115, 22, 0.55)',
            false
          );
          this.maybeEmitVerticalEchoRipple(
            (door.tx + 0.5) * this.map.tileSize,
            (door.ty + 0.5) * this.map.tileSize,
            'rgba(249, 115, 22, 0.42)',
            190
          );
          for (let i = 0; i < 14; i++) {
            this.particles.push({
              x: (door.tx + 0.5) * this.map.tileSize,
              y: (door.ty + 0.5) * this.map.tileSize,
              vx: (Math.random() - 0.5) * 180,
              vy: (Math.random() - 0.5) * 180,
              life: 0.55,
              maxLife: 0.55,
              size: 3.5,
              color: i % 2 === 0 ? '#f97316' : '#94a3b8',
            });
          }
        }
        b.smashDoorId = null;
        b.state = b.lastKnownPlayerPos
          ? 'CHASE'
          : this.brain.stalkTarget
            ? 'STALK'
            : 'INVESTIGATE';
        b.pathRecalcTimer = 0;
      }
      return;
    }

    // 5. Perceive environmental discrepancies & escape repairs inside FoV!
    const clueEvents = this.brain.perceiveClues(
      dt,
      this.elapsedSeconds,
      b,
      this.doorsByTile,
      this.difficulty,
      this.bruteTuning,
      this.escape
    );
    if (clueEvents.length > 0) {
      b.cluesSpottedTotal += clueEvents.length;
      const eff = this.getEffectiveBruteAudioDelta();
      const occ = this.computeAcousticOcclusion(b.x, b.y, p.x, p.y);
      this.audio.playBruteSuspicionGrowl(eff.dx, eff.dy, occ);
      this.ripples.push({
        id: this.nextId++,
        x: clueEvents[0].x,
        y: clueEvents[0].y,
        radius: 6,
        maxRadius: 110,
        alpha: 0.65,
        color: 'rgba(245, 158, 11, 0.65)',
      });
    }

    // 6. Utility AI Goal Evaluation
    const goal = this.brain.evaluateUtilityGoal(
      dt,
      b,
      p,
      this.doorsByTile,
      this.difficulty,
      this.bruteTuning
    );

    // Goal: PURSUIT (Active chase to last known spot + stair follow-through + momentum overshoot!)
    if (goal === 'PURSUIT') {
      b.state = 'CHASE';
      if (b.lastKnownPlayerPos) {
        const target = b.lastKnownPlayerPos;
        this.followTarget(b, target.x, target.y, speeds.chase, dt, true);

        if (!seesPlayer) {
          const distToLast = Math.hypot(target.x - b.x, target.y - b.y);
          if (distToLast < 32) {
            const overshootDist =
              this.bruteTuning?.overshootDist ??
              (this.difficulty.intelligence === 'HIGH' || this.difficulty.intelligence === 'EXTREME'
                ? 250
                : this.difficulty.intelligence === 'MEDIUM'
                  ? 190
                  : 120);

            const bDeck = this.map.deckGrid[bTy]?.[bTx] ?? 'DECK_2';
            const arrivedLanding = b.pursuitStairId
              ? this.map.stairwells.find((s) => s.id === b.pursuitStairId && s.deck === bDeck)
              : undefined;

            if (b.pursuitStairId && !arrivedLanding) {
              const destStair = this.map.stairwells.find((s) => s.id === b.pursuitStairId);
              if (destStair && destStair.deck !== bDeck) {
                b.lastKnownPlayerPos = { x: destStair.x, y: destStair.y };
                b.chaseAggroTimer = 5.6;
                b.pathRecalcTimer = 0;
                return;
              }
            }

            if (!arrivedLanding) {
              const nearbyStair = this.findPursuitStairNear(target.x, target.y, b.lastSeenPlayerVelocity);
              if (nearbyStair) {
                const destStair = this.map.stairwells.find((s) => s.id === nearbyStair.targetStairId);
                if (destStair) {
                  b.pursuitStairId = destStair.id;
                  b.lastKnownPlayerPos = { x: destStair.x, y: destStair.y };
                  b.lastSeenPlayerVelocity = null;
                  b.chaseAggroTimer = 5.6;
                  b.pathRecalcTimer = 0;
                  return;
                }
              }
            }

            // Arrived at opposite-deck stair landing: surge outward down the landing corridor!
            b.pursuitStairId = null;
            b.lastKnownPlayerPos = null;

            const overshoot = arrivedLanding
              ? this.computeLandingOvershoot(arrivedLanding.x, arrivedLanding.y, overshootDist)
              : this.computeChaseOvershoot(
                  b.x,
                  b.y,
                  b.lastSeenPlayerVelocity,
                  overshootDist
                );
            if (overshoot) {
              b.chaseOvershootPos = overshoot;
              b.chaseAggroTimer = 2.8;
              return;
            }
            this.finishPursuitIntoSweep(bruteCurrRoomId);
          }
        }
        return;
      }

      if (b.chaseOvershootPos) {
        b.chaseAggroTimer -= dt;
        const target = b.chaseOvershootPos;
        this.followTarget(b, target.x, target.y, speeds.chase, dt, true);
        const distToOver = Math.hypot(target.x - b.x, target.y - b.y);
        if (distToOver < 34 || b.chaseAggroTimer <= 0) {
          this.finishPursuitIntoSweep(bruteCurrRoomId);
        }
        return;
      }

      b.pursuitStairId = null;
      b.state = 'ROAM';
      return;
    }

    // Goal: CHECK_HIDING (Thorough room-scoped locker / desk / crate inspection)
    if (goal === 'CHECK_HIDING') {
      if (!b.currentInspectSpotId && b.searchSpotsQueue.length > 0) {
        b.currentInspectSpotId = b.searchSpotsQueue.shift()!;
        b.inspectTimer = 0;
      }
      b.state = 'CHECK_HIDING';
      const spot = this.map.hidingSpots.find((s) => s.id === b.currentInspectSpotId);
      if (!spot) {
        b.watchedPlayerHideSpotId = null;
        this.checkHidingStallTimer = 0;
        this.advanceHidingSearch(bruteCurrRoomId);
        return;
      }

      const isWatchedSpot = b.watchedPlayerHideSpotId === spot.id;
      const approachSpeed = isWatchedSpot ? speeds.chase : speeds.investigate;
      const dist = Math.hypot(spot.x - b.x, spot.y - b.y);

      if (this.lastCheckHidingSpotId !== spot.id) {
        this.lastCheckHidingSpotId = spot.id;
        this.lastCheckHidingDist = dist;
        this.checkHidingStallTimer = 0;
      } else if (dist >= this.lastCheckHidingDist - 0.5 && dist <= 64) {
        this.checkHidingStallTimer += dt;
      } else {
        this.lastCheckHidingDist = dist;
        this.checkHidingStallTimer = 0;
      }

      const canReachInspect =
        dist <= 38 ||
        (dist <= 48 && hasLineOfSightToEntity(this.map, this.doorsByTile, b.x, b.y, spot.x, spot.y)) ||
        (dist <= 64 && this.checkHidingStallTimer >= 0.35);

      if (!canReachInspect) {
        this.followTarget(b, spot.x, spot.y, approachSpeed, dt, isWatchedSpot);
      } else {
        b.targetAngle = Math.atan2(spot.y - b.y, spot.x - b.x);
        this.turnBruteTowardTarget(dt, 10);
        if (b.inspectTimer <= 0) {
          b.inspectTimer = isWatchedSpot ? 0.38 : 0.56;
        }
        b.inspectTimer -= dt;
        if (b.inspectTimer <= 0) {
          spot.checkedFlash = 1.0;
          b.checkedSpotsTotal += 1;
          this.checkHidingStallTimer = 0;
          this.lastCheckHidingSpotId = null;
          this.brain.markSpotChecked(spot.id, this.elapsedSeconds);
          this.audio.playLockerSound();
          if (p.hidingSpotId === spot.id) {
            this.triggerGameOver(
              `Dragged out of a ${spot.type.toLowerCase().replace('_', ' ')} in ${spot.room}.`
            );
            return;
          }
          b.watchedPlayerHideSpotId = null;
          this.advanceHidingSearch(bruteCurrRoomId);
        }
      }
      return;
    }

    // Goal: STALK_CLUE (Stalker Mode sweeping connected rooms after finding clue or lost chase!)
    if (goal === 'STALK_CLUE') {
      if (!this.brain.stalkTarget && !this.brain.advanceStalkQueue(this.elapsedSeconds)) {
        b.state = 'ROAM';
        return;
      }
      b.state = 'STALK';
      const st = this.brain.stalkTarget!;
      const dist = Math.hypot(st.x - b.x, st.y - b.y);
      if (dist > 32) {
        this.followTarget(b, st.x, st.y, speeds.stalk, dt, false);
      } else {
        if (st.killSwitchId) {
          const sw = this.map.lightSwitches.find((s) => s.id === st.killSwitchId);
          if (sw && sw.isOn) {
            sw.isOn = false;
            this.brain.rememberedLights.set(sw.id, false);
            this.audio.playBreakerSwitch(false);
            this.emitNoise(sw.x, sw.y, 165, 'rgba(245, 158, 11, 0.35)', false);
          }
        }
        const arrivalRoomId = st.roomId;
        this.brain.markRoomCleared(arrivalRoomId, this.elapsedSeconds);
        const shouldSweep = st.sweepHidingOnArrival;
        this.brain.stalkTarget = null;

        if (shouldSweep) {
          this.queueSearchRoomHidingSpots(arrivalRoomId, b.x, b.y);
          if (b.searchSpotsQueue.length > 0) {
            b.currentInspectSpotId = b.searchSpotsQueue.shift()!;
            b.inspectTimer = 0;
            b.state = 'CHECK_HIDING';
            return;
          }
        }
        this.brain.advanceStalkQueue(this.elapsedSeconds);
      }
      return;
    }

    // Goal: INVESTIGATE_NOISE (Audio lures, sprinting, door slams, flares)
    if (goal === 'INVESTIGATE_NOISE' && b.investigateTarget) {
      b.state = 'INVESTIGATE';
      const target = b.investigateTarget;
      const dist = Math.hypot(target.x - b.x, target.y - b.y);
      if (dist > 34) {
        this.followTarget(b, target.x, target.y, speeds.investigate, dt, false);
      } else {
        b.investigateTarget = null;
        this.queueSearchRoomHidingSpots(bruteCurrRoomId, b.x, b.y);
        if (b.searchSpotsQueue.length > 0) {
          b.currentInspectSpotId = b.searchSpotsQueue.shift()!;
          b.inspectTimer = 0;
          b.state = 'CHECK_HIDING';
        } else {
          b.state = 'SEARCH_ROOM';
          b.alertTimer = 4.5;
        }
      }
      return;
    }

    // Post-search brief corner scan before dropping back to ROAM
    if (b.state === 'SEARCH_ROOM') {
      b.alertTimer -= dt;
      b.targetAngle += dt * 1.9 * b.scanSweepDir;
      this.turnBruteTowardTarget(dt, 5);
      if (b.alertTimer <= 0) {
        this.brain.markRoomCleared(bruteCurrRoomId, this.elapsedSeconds);
        b.state = 'ROAM';
        this.pickRandomRoamTarget();
      }
      return;
    }

    // Goal: UNLEASHED_ROAM — Truly zero player leash, recency-weighted across the whole vessel!
    b.state = 'ROAM';
    if (!b.roamTarget) {
      this.pickRandomRoamTarget();
    }
    if (b.pauseAtWaypointTimer > 0) {
      b.pauseAtWaypointTimer -= dt;
      b.targetAngle += dt * 1.45 * b.scanSweepDir;
      this.turnBruteTowardTarget(dt, 4.5);
      if (b.pauseAtWaypointTimer <= 0) {
        this.pickRandomRoamTarget();
      }
      return;
    }

    if (b.roamTarget) {
      const wx = (b.roamTarget.tx + 0.5) * this.map.tileSize;
      const wy = (b.roamTarget.ty + 0.5) * this.map.tileSize;
      const dist = Math.hypot(wx - b.x, wy - b.y);
      if (dist < 28) {
        const targetRoomId = b.roamTarget.roomId ?? bruteCurrRoomId;
        this.brain.markRoomCleared(targetRoomId, this.elapsedSeconds);
        b.pauseAtWaypointTimer = 1.0 + Math.random() * 1.25;
        b.scanSweepDir = Math.random() > 0.5 ? 1 : -1;
        // Occasionally during random roaming, Brute checks a nearby unchecked hiding spot!
        if (Math.random() < 0.32) {
          this.queueSearchRoomHidingSpots(targetRoomId, b.x, b.y, 1);
          if (b.searchSpotsQueue.length > 0) {
            b.currentInspectSpotId = b.searchSpotsQueue.shift()!;
            b.state = 'CHECK_HIDING';
            b.inspectTimer = 0;
            b.pauseAtWaypointTimer = 0;
          }
        }
      } else {
        this.followTarget(b, wx, wy, speeds.roam, dt, false);
      }
    }
  }

  private finishPursuitIntoSweep(currRoomId: number): void {
    const b = this.brute;
    b.lastKnownPlayerPos = null;
    b.chaseOvershootPos = null;
    b.lastSeenPlayerVelocity = null;
    this.queueSearchRoomHidingSpots(currRoomId, b.x, b.y);
    this.brain.initiateChaseLossSweep(
      b.x,
      b.y,
      currRoomId,
      this.elapsedSeconds,
      this.difficulty.intelligence,
      this.bruteTuning
    );
    if (b.searchSpotsQueue.length > 0) {
      b.currentInspectSpotId = b.searchSpotsQueue.shift()!;
      b.inspectTimer = 0;
      b.state = 'CHECK_HIDING';
    } else if (this.brain.advanceStalkQueue(this.elapsedSeconds)) {
      b.state = 'STALK';
    } else {
      b.state = 'SEARCH_ROOM';
      b.alertTimer = 5.5;
    }
  }

  private queueSearchRoomHidingSpots(
    roomId: number,
    cx: number,
    cy: number,
    capOverride?: number
  ): void {
    const tx = Math.max(0, Math.min(this.map.width - 1, Math.floor(cx / this.map.tileSize)));
    const ty = Math.max(0, Math.min(this.map.height - 1, Math.floor(cy / this.map.tileSize)));
    const roomName = this.brain.roomMemory.get(roomId)?.room ?? this.map.roomGrid[ty][tx];
    let spots = this.brain.getRoomUncheckedSpots(
      roomId,
      roomName,
      cx,
      cy,
      this.elapsedSeconds,
      this.difficulty.intelligence,
      this.bruteTuning
    );
    if (capOverride !== undefined) {
      spots = spots.slice(0, capOverride);
    }
    this.brute.searchSpotsQueue = spots;
  }

  private advanceHidingSearch(currRoomId: number): void {
    const b = this.brute;
    if (b.searchSpotsQueue.length > 0) {
      b.currentInspectSpotId = b.searchSpotsQueue.shift()!;
      b.inspectTimer = 0;
      b.state = 'CHECK_HIDING';
    } else {
      b.currentInspectSpotId = null;
      this.brain.markRoomCleared(currRoomId, this.elapsedSeconds);
      if (this.brain.advanceStalkQueue(this.elapsedSeconds)) {
        b.state = 'STALK';
      } else {
        b.state = 'SEARCH_ROOM';
        b.alertTimer = 2.6;
      }
    }
  }

  private pickRandomRoamTarget(): void {
    this.brute.roamTarget = this.brain.pickRecencyWeightedRoamTarget(this.elapsedSeconds);
    this.brute.path = [];
    this.brute.pathRecalcTimer = 0;
  }

  private followTarget(
    b: BruteState,
    txWorld: number,
    tyWorld: number,
    speed: number,
    dt: number,
    aggressiveChase: boolean
  ): void {
    const ts = this.map.tileSize;
    const bTx = Math.max(0, Math.min(this.map.width - 1, Math.floor(b.x / ts)));
    const bTy = Math.max(0, Math.min(this.map.height - 1, Math.floor(b.y / ts)));
    const goalTx = Math.max(0, Math.min(this.map.width - 1, Math.floor(txWorld / ts)));
    const goalTy = Math.max(0, Math.min(this.map.height - 1, Math.floor(tyWorld / ts)));

    b.pathRecalcTimer -= dt;
    if (b.pathRecalcTimer <= 0 || b.path.length === 0) {
      b.pathRecalcTimer = aggressiveChase ? 0.25 : 0.65;
      b.path = findPath(this.map, bTx, bTy, goalTx, goalTy, this.map.doors, aggressiveChase);

      // Drop stale unreachable non-pursuit target rather than hugging a wall
      if (b.path.length === 0 && (bTx !== goalTx || bTy !== goalTy)) {
        if (!aggressiveChase) {
          if (b.state === 'ROAM') {
            this.pickRandomRoamTarget();
          } else if (b.state === 'INVESTIGATE') {
            b.investigateTarget = null;
          } else if (b.state === 'STALK') {
            this.brain.stalkTarget = null;
            this.brain.advanceStalkQueue(this.elapsedSeconds);
          }
        }
      }
    }

    let nextX = txWorld;
    let nextY = tyWorld;
    const startStairTraversal = (dest: Stairwell) => {
      const fromStair = this.map.stairwells.find((s) => s.targetStairId === dest.id);
      if (fromStair) {
        b.x = fromStair.x;
        b.y = fromStair.y;
      }
      b.stairDestId = dest.id;
      b.stairClimbTimer = this.bruteTuning
        ? aggressiveChase
          ? this.bruteTuning.stairClimbChase
          : this.bruteTuning.stairClimbPatrol
        : this.difficulty.speed === 'EXTREME'
          ? aggressiveChase
            ? 0.32
            : 0.48
          : this.difficulty.speed === 'HIGH'
            ? aggressiveChase
              ? 0.42
              : 0.62
            : this.difficulty.speed === 'LOW'
              ? aggressiveChase
                ? 0.68
                : 0.88
              : aggressiveChase
                ? 0.54
                : 0.74;
      b.path.shift();
      this.bruteStuckTimer = 0;
      const eff = this.getEffectiveBruteAudioDelta();
      const occ = this.computeAcousticOcclusion(b.x, b.y, this.player.x, this.player.y);
      this.audio.playStairTraversal(eff.dist, occ);
      this.maybeEmitVerticalEchoRipple(b.x, b.y, 'rgba(249, 115, 22, 0.35)', 120);
    };

    if (b.path.length > 0) {
      const wp = b.path[0];
      const wpDeck = this.map.deckGrid[wp.ty]?.[wp.tx];
      const bDeck = this.map.deckGrid[bTy]?.[bTx];
      if (wpDeck && bDeck && wpDeck !== bDeck) {
        const dest = this.stairByTile.get(wp.ty * this.map.width + wp.tx);
        if (dest) {
          startStairTraversal(dest);
          return;
        }
      }
      nextX = (wp.tx + 0.5) * ts;
      nextY = (wp.ty + 0.5) * ts;
      if (Math.hypot(nextX - b.x, nextY - b.y) < 16) {
        b.path.shift();
        if (b.path.length > 0) {
          const nextWp = b.path[0];
          const nextDeck = this.map.deckGrid[nextWp.ty]?.[nextWp.tx];
          if (nextDeck && bDeck && nextDeck !== bDeck) {
            const dest = this.stairByTile.get(nextWp.ty * this.map.width + nextWp.tx);
            if (dest) {
              startStairTraversal(dest);
              return;
            }
          }
          nextX = (nextWp.tx + 0.5) * ts;
          nextY = (nextWp.ty + 0.5) * ts;
        }
      }
    }

    // Check if current or next waypoint tile has an unlocked intact door
    const currDoor = this.doorsByTile.get(bTy * this.map.width + bTx);
    if (currDoor && currDoor.isOpen && !currDoor.isBroken && !currDoor.isLocked) {
      this.brutePassThroughDoors.add(currDoor.id);
    }

    const wpTx = Math.floor(nextX / ts);
    const wpTy = Math.floor(nextY / ts);
    const door = this.doorsByTile.get(wpTy * this.map.width + wpTx);
    if (door && !door.isBroken) {
      const dcx = (door.tx + 0.5) * ts;
      const dcy = (door.ty + 0.5) * ts;
      const distToDoor = Math.hypot(dcx - b.x, dcy - b.y);
      if (!door.isOpen && distToDoor < 38) {
        if (aggressiveChase || door.isLocked) {
          const speeds = this.getSpeedProfile();
          b.state = 'SMASH_DOOR';
          b.smashDoorId = door.id;
          b.smashTimer = aggressiveChase ? speeds.smashChase : speeds.smashPatrol;
          this.bruteStuckTimer = 0;
          return;
        } else {
          // Brute pushes unlocked door open during patrol/stalk & marks it to close behind him!
          door.isOpen = true;
          door.swingSpeed = door.isWatertight ? 2.1 : 5.5;
          this.brain.noteBruteDoorAction(door, this.elapsedSeconds);
          this.brutePassThroughDoors.add(door.id);
          const effDist = this.getEffectiveNoiseDistance(dcx, dcy, this.player.x, this.player.y);
          const occ = this.computeAcousticOcclusion(dcx, dcy, this.player.x, this.player.y);
          this.audio.playDoorToggle(true, false, effDist, occ, dcx - this.player.x, Boolean(door.isWatertight));
        }
      } else if (door.isOpen && !door.isLocked && distToDoor < 30) {
        this.brutePassThroughDoors.add(door.id);
      }
    }

    // Gentle doorway & narrow-passage centerline alignment so Brute slides cleanly through thresholds
    if (b.path.length > 0) {
      const wp = b.path[0];
      const isNarrowX =
        !isTileWalkable(this.map.tiles[wp.ty]?.[wp.tx - 1] ?? 'VOID') ||
        !isTileWalkable(this.map.tiles[wp.ty]?.[wp.tx + 1] ?? 'VOID');
      const isNarrowY =
        !isTileWalkable(this.map.tiles[wp.ty - 1]?.[wp.tx] ?? 'VOID') ||
        !isTileWalkable(this.map.tiles[wp.ty + 1]?.[wp.tx] ?? 'VOID');
      if (isNarrowX) {
        nextX = (wp.tx + 0.5) * ts;
      }
      if (isNarrowY) {
        nextY = (wp.ty + 0.5) * ts;
      }
    }

    const dx = nextX - b.x;
    const dy = nextY - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      const startX = b.x;
      const startY = b.y;
      const vx = (dx / dist) * speed * dt;
      const vy = (dy / dist) * speed * dt;
      b.targetAngle = Math.atan2(dy, dx);
      this.turnBruteTowardTarget(dt, aggressiveChase ? 11 : 6);
      this.moveEntityWithCollision(b, vx, vy, true);
      const actualMoved = Math.hypot(b.x - startX, b.y - startY);
      b.walkPhase += actualMoved * 0.13;

      // Stuck-detection failsafe: if Brute makes negligible progress against geometry, slide toward tile center or reroute
      if (actualMoved < speed * dt * 0.14) {
        this.bruteStuckTimer += dt;
        if (this.bruteStuckTimer >= 0.42) {
          b.pathRecalcTimer = 0;
          const tileCx = (bTx + 0.5) * ts;
          const tileCy = (bTy + 0.5) * ts;
          const pullX = tileCx - b.x;
          const pullY = tileCy - b.y;
          const pullLen = Math.hypot(pullX, pullY);
          if (pullLen > 1) {
            const nudge = Math.min(pullLen, speed * dt * 0.9);
            this.moveEntityWithCollision(b, (pullX / pullLen) * nudge, (pullY / pullLen) * nudge, true);
          }
        }
        if (this.bruteStuckTimer >= 1.15) {
          this.bruteStuckTimer = 0;
          b.path = [];
          b.pathRecalcTimer = 0;
          if (!aggressiveChase) {
            if (b.state === 'ROAM') {
              this.pickRandomRoamTarget();
            } else if (b.state === 'INVESTIGATE') {
              b.investigateTarget = null;
            } else if (b.state === 'STALK') {
              this.brain.stalkTarget = null;
              this.brain.advanceStalkQueue(this.elapsedSeconds);
            }
          }
        }
      } else {
        this.bruteStuckTimer = Math.max(0, this.bruteStuckTimer - dt * 2);
      }

      b.stepTimer -= dt;
      if (b.stepTimer <= 0) {
        b.stepTimer = aggressiveChase ? 0.27 : 0.48;
        const eff = this.getEffectiveBruteAudioDelta();
        const occ = this.computeAcousticOcclusion(b.x, b.y, this.player.x, this.player.y);
        const mat = this.getFloorMaterialAt(b.x, b.y);
        this.audio.playBruteStep(eff.dx, eff.dy, aggressiveChase, eff.muffled, occ, mat);
        if (eff.muffled && (aggressiveChase || eff.dist < 320)) {
          this.maybeEmitVerticalEchoRipple(
            b.x,
            b.y,
            aggressiveChase ? 'rgba(249, 115, 22, 0.34)' : 'rgba(148, 163, 184, 0.24)',
            aggressiveChase ? 125 : 85
          );
        }
        if (aggressiveChase && !eff.muffled) {
          if (eff.dist < 480) {
            this.screenShake = Math.max(this.screenShake, (1 - eff.dist / 480) * 4.2);
          }
        } else if (!eff.muffled && eff.dist < 220) {
          this.screenShake = Math.max(this.screenShake, (1 - eff.dist / 220) * 1.4);
        }
      }
    }
  }

  private turnBruteTowardTarget(dt: number, turnRate: number): void {
    const diff = normalizeAngle(this.brute.targetAngle - this.brute.angle);
    this.brute.angle = normalizeAngle(this.brute.angle + diff * Math.min(1, dt * turnRate));
  }

  private resolveSingleDoorPush(
    ent: { x: number; y: number; radius: number; angle?: number },
    door: Door,
    dt: number,
    isBrute: boolean,
    immediateNudge = false
  ): void {
    if (door.isBroken || door.isOpen) return;
    if (isBrute && !door.isLocked) return;

    const ts = this.map.tileSize;
    const cx = (door.tx + 0.5) * ts;
    const cy = (door.ty + 0.5) * ts;
    const minClear = ent.radius + 5.5;

    const inAlongSpan =
      door.orientation === 'H'
        ? Math.abs(ent.x - cx) < ts * 0.58
        : Math.abs(ent.y - cy) < ts * 0.58;
    if (!inAlongSpan) return;

    const delta = door.orientation === 'H' ? ent.y - cy : ent.x - cx;
    const absDelta = Math.abs(delta);
    if (absDelta >= minClear) return;

    let pushSign = 1;
    if (absDelta > 1.5) {
      pushSign = delta >= 0 ? 1 : -1;
    } else if (!isBrute) {
      const moveAxis =
        door.orientation === 'H'
          ? (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) -
            (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0)
          : (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
            (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      if (moveAxis !== 0) {
        pushSign = moveAxis > 0 ? 1 : -1;
      } else {
        const ang = ent.angle ?? 0;
        const proj = door.orientation === 'H' ? Math.sin(ang) : Math.cos(ang);
        pushSign = proj >= 0 ? 1 : -1;
      }
    }

    const needed = minClear - absDelta + 0.75;
    const step = immediateNudge ? Math.min(needed, 5.5) : Math.min(needed, Math.max(2.5, dt * 360));

    const tryPush = (sign: number): boolean => {
      const candX = door.orientation === 'V' ? ent.x + sign * step : ent.x;
      const candY = door.orientation === 'H' ? ent.y + sign * step : ent.y;
      if (!this.collidesAtWallsOnly(candX, candY, ent.radius)) {
        ent.x = candX;
        ent.y = candY;
        return true;
      }
      return false;
    };

    if (!tryPush(pushSign)) {
      tryPush(-pushSign);
    }
  }

  private resolveEntityDoorPush(
    ent: { x: number; y: number; radius: number; angle?: number },
    dt: number,
    isBrute: boolean
  ): void {
    const ts = this.map.tileSize;
    const minTx = Math.floor((ent.x - ent.radius - 6) / ts);
    const maxTx = Math.floor((ent.x + ent.radius + 6) / ts);
    const minTy = Math.floor((ent.y - ent.radius - 6) / ts);
    const maxTy = Math.floor((ent.y + ent.radius + 6) / ts);

    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const door = this.doorsByTile.get(ty * this.map.width + tx);
        if (door && !door.isOpen && !door.isBroken) {
          this.resolveSingleDoorPush(ent, door, dt, isBrute, false);
        }
      }
    }
  }

  private collidesAtWallsOnly(wx: number, wy: number, radius: number): boolean {
    const ts = this.map.tileSize;
    const minTx = Math.floor((wx - radius) / ts);
    const maxTx = Math.floor((wx + radius) / ts);
    const minTy = Math.floor((wy - radius) / ts);
    const maxTy = Math.floor((wy + radius) / ts);

    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (tx < 0 || tx >= this.map.width || ty < 0 || ty >= this.map.height) return true;
        if (!isTileWalkable(this.map.tiles[ty][tx])) return true;
      }
    }
    return false;
  }

  private moveEntityWithCollision(
    ent: { x: number; y: number; radius: number },
    dx: number,
    dy: number,
    isBrute: boolean
  ): void {
    const nx = ent.x + dx;
    if (!this.collidesAt(nx, ent.y, ent.radius, isBrute, ent.x, ent.y)) {
      ent.x = nx;
    } else if (isBrute && Math.abs(dx) > 0.05) {
      // Corner-sliding nudge along Y so Brute never snags on door jambs or corridor corners
      const nudge = Math.min(Math.abs(dx) + 1.5, 4);
      for (const sign of [-1, 1]) {
        if (!this.collidesAt(nx, ent.y + sign * nudge, ent.radius, isBrute, ent.x, ent.y)) {
          ent.x = nx;
          ent.y += sign * nudge;
          break;
        }
      }
    }

    const ny = ent.y + dy;
    if (!this.collidesAt(ent.x, ny, ent.radius, isBrute, ent.x, ent.y)) {
      ent.y = ny;
    } else if (isBrute && Math.abs(dy) > 0.05) {
      const nudge = Math.min(Math.abs(dy) + 1.5, 4);
      for (const sign of [-1, 1]) {
        if (!this.collidesAt(ent.x + sign * nudge, ny, ent.radius, isBrute, ent.x, ent.y)) {
          ent.x += sign * nudge;
          ent.y = ny;
          break;
        }
      }
    }
  }

  private collidesAt(
    wx: number,
    wy: number,
    radius: number,
    isBrute: boolean,
    fromX?: number,
    fromY?: number
  ): boolean {
    const ts = this.map.tileSize;
    const minTx = Math.floor((wx - radius) / ts);
    const maxTx = Math.floor((wx + radius) / ts);
    const minTy = Math.floor((wy - radius) / ts);
    const maxTy = Math.floor((wy + radius) / ts);

    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (tx < 0 || tx >= this.map.width || ty < 0 || ty >= this.map.height) return true;
        if (!isTileWalkable(this.map.tiles[ty][tx])) return true;

        const door = this.doorsByTile.get(ty * this.map.width + tx);
        if (door && !door.isOpen && !door.isBroken) {
          // Brute passes door tile up to door center so he can trigger smash/open
          if (!isBrute || door.isLocked) {
            const cx = (tx + 0.5) * ts;
            const cy = (ty + 0.5) * ts;
            if (door.orientation === 'H' && Math.abs(wy - cy) < radius + 5) {
              // If already overlapping the closing door leaf, never block movement that pushes farther clear
              if (fromY !== undefined && Math.abs(fromY - cy) < radius + 5) {
                if (Math.abs(wy - cy) > Math.abs(fromY - cy)) continue;
              }
              return true;
            }
            if (door.orientation === 'V' && Math.abs(wx - cx) < radius + 5) {
              if (fromX !== undefined && Math.abs(fromX - cx) < radius + 5) {
                if (Math.abs(wx - cx) > Math.abs(fromX - cx)) continue;
              }
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  public emitNoise(
    x: number,
    y: number,
    maxRadius: number,
    color: string,
    alertsBrute: boolean,
    urgency = 0.6
  ): void {
    this.maxEmittedAcousticRadius = Math.max(this.maxEmittedAcousticRadius, maxRadius);
    this.ripples.push({
      id: this.nextId++,
      x,
      y,
      radius: 8,
      maxRadius: Math.min(280, maxRadius * 0.55),
      alpha: 0.75,
      color,
    });

    if (!alertsBrute) return;

    const b = this.brute;
    if (
      b.state === 'CHASE' ||
      b.state === 'STUNNED' ||
      b.state === 'SMASH_DOOR' ||
      (b.state === 'CHECK_HIDING' && b.watchedPlayerHideSpotId !== null)
    ) {
      return;
    }

    const hearingMultiplier = getSensesProfile(this.difficulty, this.bruteTuning).hearingMult;
    const dist = this.getEffectiveNoiseDistance(x, y, b.x, b.y);
    if (dist <= maxRadius * hearingMultiplier) {
      if (!b.investigateTarget || urgency >= b.investigateTarget.urgency) {
        b.investigateTarget = { x, y, urgency };
        b.state = 'INVESTIGATE';
        b.pathRecalcTimer = 0;
      }
    }
  }

  private findPursuitStairNear(
    wx: number,
    wy: number,
    vel: { vx: number; vy: number } | null
  ): Stairwell | null {
    const ts = this.map.tileSize;
    const tx = Math.max(0, Math.min(this.map.width - 1, Math.floor(wx / ts)));
    const ty = Math.max(0, Math.min(this.map.height - 1, Math.floor(wy / ts)));
    const deck = this.map.deckGrid[ty][tx];

    const pursuitCap =
      this.bruteTuning?.stairPursuitRange ??
      (this.difficulty.intelligence === 'LOW' ? 56 : 110);
    let best: Stairwell | null = null;
    let bestDist = pursuitCap;
    for (const s of this.map.stairwells) {
      if (s.deck !== deck) continue;
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (d > bestDist) continue;
      if (!hasLineOfSight(this.map, this.doorsByTile, wx, wy, s.x, s.y)) continue;

      if (vel && d > 48) {
        const spd = Math.hypot(vel.vx, vel.vy);
        if (spd > 20) {
          const dot = ((s.x - wx) / Math.max(1, d)) * (vel.vx / spd) +
            ((s.y - wy) / Math.max(1, d)) * (vel.vy / spd);
          if (dot < -0.25) continue;
        }
      }
      bestDist = d;
      best = s;
    }
    return best;
  }

  private computeLandingOvershoot(
    startX: number,
    startY: number,
    maxDist: number
  ): { x: number; y: number } | null {
    const dirs = [
      { vx: 1, vy: 0 },
      { vx: -1, vy: 0 },
      { vx: 0, vy: 1 },
      { vx: 0, vy: -1 },
    ];
    let bestTarget: { x: number; y: number } | null = null;
    let bestClearance = 0;
    for (const dir of dirs) {
      const candidate = this.computeChaseOvershoot(startX, startY, { vx: dir.vx * 140, vy: dir.vy * 140 }, maxDist);
      if (!candidate) continue;
      const d = Math.hypot(candidate.x - startX, candidate.y - startY);
      if (d > bestClearance) {
        bestClearance = d;
        bestTarget = candidate;
      }
    }
    return bestTarget;
  }

  private deckCenterY(deck: ShipDeck): number {
    return this.map.deckBounds[deck].centerY * this.map.tileSize;
  }

  private maybeEmitVerticalEchoRipple(
    wx: number,
    wy: number,
    color: string,
    maxRadius: number
  ): void {
    const ts = this.map.tileSize;
    const pDeck = this.getCurrentDeck();
    const tx = Math.max(0, Math.min(this.map.width - 1, Math.floor(wx / ts)));
    const ty = Math.max(0, Math.min(this.map.height - 1, Math.floor(wy / ts)));
    const srcDeck = this.map.deckGrid[ty][tx];
    if (srcDeck === pDeck) return;

    const localY = wy - this.deckCenterY(srcDeck);
    const projectedY = localY + this.deckCenterY(pDeck);
    if (this.getEffectiveNoiseDistance(wx, wy, this.player.x, this.player.y) > 460) return;

    this.ripples.push({
      id: this.nextId++,
      x: wx,
      y: projectedY,
      radius: 10,
      maxRadius,
      alpha: 0.45,
      color,
    });
  }

  private getEffectiveNoiseDistance(x1: number, y1: number, x2: number, y2: number): number {
    const ts = this.map.tileSize;
    const tx1 = Math.max(0, Math.min(this.map.width - 1, Math.floor(x1 / ts)));
    const ty1 = Math.max(0, Math.min(this.map.height - 1, Math.floor(y1 / ts)));
    const tx2 = Math.max(0, Math.min(this.map.width - 1, Math.floor(x2 / ts)));
    const ty2 = Math.max(0, Math.min(this.map.height - 1, Math.floor(y2 / ts)));
    const d1 = this.map.deckGrid[ty1][tx1];
    const d2 = this.map.deckGrid[ty2][tx2];
    if (d1 === d2) return Math.hypot(x2 - x1, y2 - y1);

    const deckDiff = Math.abs(getDeckIndex(d1) - getDeckIndex(d2));

    // 1. Acoustic paths via stairwell shafts (1-hop direct or 2-hop via Deck 2)
    let best = Infinity;
    for (const s1 of this.map.stairwells) {
      if (s1.deck !== d1) continue;
      const t1 = this.map.stairwells.find((o) => o.id === s1.targetStairId);
      if (!t1) continue;
      if (t1.deck === d2) {
        const distViaStairs =
          Math.hypot(s1.x - x1, s1.y - y1) + Math.hypot(x2 - t1.x, y2 - t1.y) + 145;
        if (distViaStairs < best) best = distViaStairs;
      } else if (deckDiff === 2) {
        for (const s2 of this.map.stairwells) {
          if (s2.deck !== t1.deck) continue;
          const t2 = this.map.stairwells.find((o) => o.id === s2.targetStairId);
          if (!t2 || t2.deck !== d2) continue;
          const dist2Hop =
            Math.hypot(s1.x - x1, s1.y - y1) +
            Math.hypot(s2.x - t1.x, s2.y - t1.y) +
            Math.hypot(x2 - t2.x, y2 - t2.y) +
            260;
          if (dist2Hop < best) best = dist2Hop;
        }
      }
    }

    // 2. Vertical sound bleed directly through ship grates, cargo hatches & companionway openings
    const localY1 = y1 - this.deckCenterY(d1);
    const localY2 = y2 - this.deckCenterY(d2);
    const horizDist = Math.hypot(x2 - x1, localY2 - localY1);

    const mat1 = this.map.floorMaterial[ty1][tx1];
    const mat2 = this.map.floorMaterial[ty2][tx2];
    const nearShaft = this.map.stairwells.some(
      (s) =>
        (s.deck === d1 && Math.hypot(s.x - x1, s.y - y1) <= ts * 2.6) ||
        (s.deck === d2 && Math.hypot(s.x - x2, s.y - y2) <= ts * 2.6)
    );
    const openConductive =
      nearShaft ||
      mat1 === 'GRATING' ||
      mat2 === 'GRATING' ||
      mat1 === 'CARGO' ||
      mat2 === 'CARGO';
    const platePenalty = (openConductive ? 140 : 225) + (deckDiff - 1) * 190;

    return Math.min(best, horizDist + platePenalty);
  }

  public getEffectiveBruteAudioDelta(): {
    dx: number;
    dy: number;
    dist: number;
    muffled: boolean;
  } {
    const p = this.player;
    const b = this.brute;
    const pDeck = this.getCurrentDeck();
    const bTx = Math.max(0, Math.min(this.map.width - 1, Math.floor(b.x / this.map.tileSize)));
    const bTy = Math.max(0, Math.min(this.map.height - 1, Math.floor(b.y / this.map.tileSize)));
    const bDeck = this.map.deckGrid[bTy][bTx];

    if (pDeck === bDeck) {
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      return { dx, dy, dist: Math.hypot(dx, dy), muffled: false };
    }

    const dist = this.getEffectiveNoiseDistance(p.x, p.y, b.x, b.y);
    const localPy = p.y - this.deckCenterY(pDeck);
    const localBy = b.y - this.deckCenterY(bDeck);
    return {
      dx: b.x - p.x,
      dy: localBy - localPy,
      dist,
      muffled: true,
    };
  }

  public getEffectiveBruteDistance(): number {
    return this.getEffectiveBruteAudioDelta().dist;
  }

  public getFloorMaterialAt(wx: number, wy: number): FloorMaterial {
    const ts = this.map.tileSize;
    const tx = Math.max(0, Math.min(this.map.width - 1, Math.floor(wx / ts)));
    const ty = Math.max(0, Math.min(this.map.height - 1, Math.floor(wy / ts)));
    const t = this.map.tiles[ty][tx];
    if (t === 'EXTERIOR_DECK' || t === 'ESCAPE_HELI' || t === 'ESCAPE_LIFEBOAT') {
      return 'WEATHER';
    }
    if (t === 'ESCAPE_SUBMARINE') {
      return 'GRATING';
    }
    return this.map.floorMaterial[ty][tx] ?? 'STEEL';
  }

  public computeAcousticOcclusion(x1: number, y1: number, x2: number, y2: number): number {
    const ts = this.map.tileSize;
    const tx1 = Math.max(0, Math.min(this.map.width - 1, Math.floor(x1 / ts)));
    const ty1 = Math.max(0, Math.min(this.map.height - 1, Math.floor(y1 / ts)));
    const tx2 = Math.max(0, Math.min(this.map.width - 1, Math.floor(x2 / ts)));
    const ty2 = Math.max(0, Math.min(this.map.height - 1, Math.floor(y2 / ts)));
    const d1 = this.map.deckGrid[ty1][tx1];
    const d2 = this.map.deckGrid[ty2][tx2];

    let occlusion = 0;
    let sy1 = y1;
    let sy2 = y2;
    if (d1 !== d2) {
      const deckDiff = Math.abs(getDeckIndex(d1) - getDeckIndex(d2));
      occlusion += 0.42 * deckDiff;
      sy1 = y1 - this.deckCenterY(d1);
      sy2 = y2 - this.deckCenterY(d2);
    }

    const dx = x2 - x1;
    const dy = sy2 - sy1;
    const len = Math.hypot(dx, dy);
    if (len < ts * 0.5) return Math.min(0.94, occlusion);

    const stepSize = ts * 0.45;
    const steps = Math.min(54, Math.ceil(len / stepSize));
    const deckYOffset = this.deckCenterY(d2);
    let lastKey = -1;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const sx = x1 + dx * t;
      const sy = d1 === d2 ? y1 + dy * t : deckYOffset + (sy1 + dy * t);
      const cx = Math.max(0, Math.min(this.map.width - 1, Math.floor(sx / ts)));
      const cy = Math.max(0, Math.min(this.map.height - 1, Math.floor(sy / ts)));
      const key = cy * this.map.width + cx;
      if (key === lastKey) continue;
      lastKey = key;

      const tile = this.map.tiles[cy][cx];
      if (tile === 'WALL' || tile === 'VOID') {
        occlusion += 0.24;
      } else {
        const door = this.doorsByTile.get(key);
        if (door && !door.isOpen && !door.isBroken) {
          occlusion += 0.18;
        }
      }
      if (occlusion >= 0.94) return 0.94;
    }

    return Math.min(0.94, occlusion);
  }

  private buildAcousticContext(): AcousticContext {
    const p = this.player;
    const b = this.brute;
    const eff = this.getEffectiveBruteAudioDelta();
    const bruteOcclusion = this.computeAcousticOcclusion(b.x, b.y, p.x, p.y);

    // Nearest active ON overhead light + flicker sputter intensity
    let nearestLightDist = Infinity;
    let nearestLightOcclusion = 0;
    let nearestLightSputter = 0;
    for (const sw of this.map.lightSwitches) {
      if (!sw.isOn) continue;
      const d = this.getEffectiveNoiseDistance(sw.x, sw.y, p.x, p.y);
      if (d < nearestLightDist) {
        nearestLightDist = d;
        nearestLightOcclusion = this.computeAcousticOcclusion(sw.x, sw.y, p.x, p.y);
        const bruteToSw = Math.hypot(b.x - sw.x, b.y - sw.y);
        nearestLightSputter = getRoomLightFlicker(sw.id, this.elapsedSeconds, bruteToSw).sputterAmount;
      }
    }

    // Nearest active steam pipe burst / warning intensity
    let nearestVentIntensity = 0;
    for (const pipe of this.map.steamPipes) {
      if (pipe.activeTimer <= 0 && pipe.warningTimer <= 0) continue;
      const d = this.getEffectiveNoiseDistance(pipe.x, pipe.y, p.x, p.y);
      if (d < 460) {
        const occ = this.computeAcousticOcclusion(pipe.x, pipe.y, p.x, p.y);
        const mult = pipe.activeTimer > 0 ? 1.0 : 0.45;
        const inten = Math.pow(1 - d / 460, 1.35) * (1 - occ * 0.65) * mult;
        if (inten > nearestVentIntensity) nearestVentIntensity = inten;
      }
    }

    // Nearest active burning flare sizzle intensity
    let nearestFlareIntensity = 0;
    for (const l of this.droppedLights) {
      if (l.type !== 'FLARE') continue;
      const d = this.getEffectiveNoiseDistance(l.x, l.y, p.x, p.y);
      if (d < 360) {
        const occ = this.computeAcousticOcclusion(l.x, l.y, p.x, p.y);
        const inten = Math.pow(1 - d / 360, 1.35) * (1 - occ * 0.65);
        if (inten > nearestFlareIntensity) nearestFlareIntensity = inten;
      }
    }

    return {
      bruteDistance: eff.dist,
      bruteDx: eff.dx,
      bruteDy: eff.dy,
      bruteOcclusion,
      bruteState: b.state,
      bruteMuffled: eff.muffled,
      playerExhausted: p.exhausted,
      playerStaminaRatio: p.stamina / Math.max(1, p.maxStamina),
      playerSprinting: p.sprinting,
      playerHiding: p.hidingSpotId !== null,
      nearestLightDist,
      nearestLightOcclusion,
      nearestLightSputter,
      nearestVentIntensity,
      nearestFlareIntensity,
    };
  }

  private updateRipplesAndParticles(dt: number): void {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.radius += (r.maxRadius - r.radius) * Math.min(1, dt * 6) + dt * 90;
      r.alpha -= dt * 1.45;
      if (r.alpha <= 0) this.ripples.splice(i, 1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.94;
      pt.vy *= 0.94;
      pt.life -= dt;
      if (pt.life <= 0) this.particles.splice(i, 1);
    }
  }

  // --- Player Actions ---
  public toggleCrouch(): void {
    if (this.ended || this.player.hidingSpotId !== null || this.player.climbingStairId !== null) return;
    this.player.crouching = !this.player.crouching;
    this.emitHud();
  }

  public toggleFlashlight(): void {
    if (this.ended) return;
    if (this.player.hidingSpotId !== null) {
      if (this.player.peekingSpotId === null) {
        this.showToast('Hold Q to peek with flashlight.');
      }
      return;
    }
    if (this.player.battery <= 0 && !this.player.flashlightOn) {
      this.showToast('Flashlight battery empty.');
      return;
    }
    this.player.flashlightOn = !this.player.flashlightOn;
    this.audio.playFlashlightClick();
    this.emitHud();
  }

  public toggleJournal(): void {
    if (this.ended) return;
    this.journalOpen = !this.journalOpen;
    this.audio.playJournalToggle(this.journalOpen);
    this.emitHud();
  }

  public selectSlot(idx: number): void {
    if (idx < 0 || idx >= this.player.maxInventorySlots) return;
    this.player.selectedSlot = idx;
    this.emitHud();
  }

  public dropSelectedItem(): void {
    if (this.ended || this.player.hidingSpotId !== null || this.player.climbingStairId !== null) return;
    const p = this.player;
    const slot = p.selectedSlot;
    const itemId = p.inventory[slot];
    if (!itemId) return;

    p.inventory.splice(slot, 1);
    this.worldPickups.push({
      id: this.nextId++,
      x: p.x + Math.cos(p.angle) * 14,
      y: p.y + Math.sin(p.angle) * 14,
      deck: this.getCurrentDeck(),
      item: itemId,
    });
    if (p.selectedSlot >= p.inventory.length) {
      p.selectedSlot = Math.max(0, p.inventory.length - 1);
    }
    this.audio.playItemDrop();
    this.showToast(`Dropped ${ITEM_CATALOG[itemId].name}.`);
    this.emitHud();
  }

  public closePaperMap(playSound = true): void {
    if (this.player.openPaperMapDeck === null) return;
    this.player.openPaperMapDeck = null;
    this.player.openPaperMapStandPos = null;
    if (playSound) this.audio.playPaperMapToggle(false);
    this.emitHud();
  }

  public useSelectedItem(): void {
    if (this.ended || this.player.hidingSpotId !== null || this.player.climbingStairId !== null) return;
    const slot = this.player.selectedSlot;
    const itemId = this.player.inventory[slot];
    if (!itemId) return;

    const p = this.player;
    const meta = ITEM_CATALOG[itemId];
    if (
      meta.category === 'LIFEBOAT_PART' ||
      meta.category === 'HELI_PART' ||
      meta.category === 'SUBMARINE_PART'
    ) {
      const destLabel =
        meta.category === 'HELI_PART'
          ? 'Deck 3 Stern Helideck'
          : meta.category === 'LIFEBOAT_PART'
            ? 'Deck 2 Bow Lifeboat Davit'
            : 'Deck 1 Submarine Bay';
      this.showToast(`Take ${meta.name} to the ${destLabel} and Hold E.`);
      return;
    }

    if (itemId === 'BATTERY_PACK') {
      p.battery = Math.min(p.maxBattery, p.battery + 55);
      p.inventory.splice(slot, 1);
      this.audio.playItemPickup();
      this.showToast('Battery recharged (+55%).');
    } else if (itemId === 'GLOWSTICK') {
      this.droppedLights.push({
        id: this.nextId++,
        x: p.x,
        y: p.y,
        type: 'GLOWSTICK',
        life: 65,
        maxLife: 65,
        lureTimer: 0,
      });
      p.inventory.splice(slot, 1);
      this.audio.playFlashlightClick();
      this.showToast('Cracked & dropped chemical glowstick.');
    } else if (itemId === 'FLARE') {
      const throwDist = 110;
      let fx = p.x + Math.cos(p.angle) * throwDist;
      let fy = p.y + Math.sin(p.angle) * throwDist;
      const ftx = Math.floor(fx / this.map.tileSize);
      const fty = Math.floor(fy / this.map.tileSize);
      if (
        ftx < 0 ||
        ftx >= this.map.width ||
        fty < 0 ||
        fty >= this.map.height ||
        !isTileWalkable(this.map.tiles[fty][ftx])
      ) {
        fx = p.x;
        fy = p.y;
      }
      this.droppedLights.push({
        id: this.nextId++,
        x: fx,
        y: fy,
        type: 'FLARE',
        life: 16,
        maxLife: 16,
        lureTimer: 0.2,
      });
      this.audio.playFlareIgnite(fx - p.x);
      this.emitNoise(fx, fy, 680, 'rgba(251, 113, 133, 0.7)', true, 0.9);
      p.inventory.splice(slot, 1);
      this.showToast('Flare ignited — Brute lured toward light!');
    } else if (itemId === 'FIRE_EXTINGUISHER') {
      this.audio.playExtinguisherBlast();
      p.inventory.splice(slot, 1);
      for (let i = 0; i < 24; i++) {
        const spread = p.angle + (Math.random() - 0.5) * 0.7;
        const spd = 120 + Math.random() * 190;
        this.particles.push({
          x: p.x,
          y: p.y,
          vx: Math.cos(spread) * spd,
          vy: Math.sin(spread) * spd,
          life: 0.55,
          maxLife: 0.55,
          size: 7 + Math.random() * 6,
          color: 'rgba(226, 232, 240, 0.75)',
        });
      }
      const dx = this.brute.x - p.x;
      const dy = this.brute.y - p.y;
      const dist = Math.hypot(dx, dy);
      const angleDiff = Math.abs(normalizeAngle(Math.atan2(dy, dx) - p.angle));
      if (
        dist <= 215 &&
        angleDiff <= 0.65 &&
        hasLineOfSight(this.map, this.doorsByTile, p.x, p.y, this.brute.x, this.brute.y)
      ) {
        this.brute.state = 'STUNNED';
        this.brute.stunTimer = 4.2;
        this.brute.watchedPlayerHideSpotId = null;
        this.showToast('Direct CO2 hit! The Brute is blinded & stunned.');
      } else {
        this.showToast('CO2 discharged.');
      }
    } else if (itemId === 'BOLT_CUTTERS') {
      this.tryInteract(true);
    }

    if (p.selectedSlot >= p.inventory.length) {
      p.selectedSlot = Math.max(0, p.inventory.length - 1);
    }
    this.emitHud();
  }

  public tryInteract(cuttersOnly = false): void {
    if (this.ended || this.player.climbingStairId !== null) return;
    const p = this.player;

    if (p.openPaperMapDeck !== null && !cuttersOnly) {
      this.closePaperMap(true);
      return;
    }

    // 1. Exit hiding spot if currently hiding (return cleanly to saved entry position, keep flashlight OFF)
    if (p.hidingSpotId !== null && !cuttersOnly) {
      if (p.preHidePos && !this.collidesAt(p.preHidePos.x, p.preHidePos.y, p.radius, false)) {
        p.x = p.preHidePos.x;
        p.y = p.preHidePos.y;
      }
      p.hidingSpotId = null;
      p.peekingSpotId = null;
      p.preHidePos = null;
      p.flashlightOn = false;
      this.peekNoBatteryToasted = false;
      this.audio.playLockerSound();
      this.emitNoise(p.x, p.y, 175, 'rgba(148, 163, 184, 0.25)', true, 0.35);
      this.emitHud();
      return;
    }

    const nearest = this.findNearestInteractable();
    if (!nearest) return;

    if (nearest.kind === 'PAPER_MAP' && !cuttersOnly) {
      p.openPaperMapDeck = nearest.stand.deck;
      p.openPaperMapStandPos = {
        x: nearest.stand.x,
        y: nearest.stand.y,
        deck: nearest.stand.deck,
      };
      this.audio.playPaperMapToggle(true);
      this.emitHud();
      return;
    }

    if (nearest.kind === 'ESCAPE_LIFEBOAT' && !cuttersOnly) {
      if (this.escape.lifeboatState === 'READY') {
        this.triggerVictory('LIFEBOAT');
      }
      return;
    }

    if (nearest.kind === 'ESCAPE_HELI' && !cuttersOnly) {
      if (this.escape.heliState === 'READY') {
        this.triggerVictory('HELICOPTER');
      }
      return;
    }

    if (nearest.kind === 'ESCAPE_SUBMARINE' && !cuttersOnly) {
      if (this.escape.submarineState === 'READY') {
        this.triggerVictory('SUBMARINE');
      }
      return;
    }

    if (nearest.kind === 'PICKUP' && !cuttersOnly) {
      const pickup = nearest.pickup;
      const meta = ITEM_CATALOG[pickup.item];
      if (pickup.item === 'BACKPACK') {
        p.hasBackpack = true;
        p.maxInventorySlots = 6;
        const idx = this.worldPickups.findIndex((w) => w.id === pickup.id);
        if (idx !== -1) this.worldPickups.splice(idx, 1);
        this.audio.playBackpackEquip();
        this.showToast('Equipped Crew Backpack (+2 inventory slots, 6 total)!');
      } else if (p.inventory.length < p.maxInventorySlots) {
        p.inventory.push(pickup.item);
        const idx = this.worldPickups.findIndex((w) => w.id === pickup.id);
        if (idx !== -1) this.worldPickups.splice(idx, 1);
        this.audio.playItemPickup();
        this.showToast(`Picked up ${meta.name}.`);
      } else {
        this.showToast(`Pack full (${p.inventory.length}/${p.maxInventorySlots}) — drop [G] or use an item first.`);
      }
      this.emitHud();
      return;
    }

    if (nearest.kind === 'STAIRWELL' && !cuttersOnly) {
      const dest = this.map.stairwells.find((s) => s.id === nearest.stairwell.targetStairId);
      if (dest) {
        p.climbingStairId = nearest.stairwell.id;
        p.climbProgress = 0;
        this.climbMidRungPlayed = false;
        p.peekingDoorId = null;
        p.peekingSpotId = null;
        p.sprinting = false;
        p.isMoving = false;
        this.audio.playStairTraversal(0);
        this.emitNoise(
          nearest.stairwell.x,
          nearest.stairwell.y,
          240,
          'rgba(148, 163, 184, 0.32)',
          true,
          0.65
        );
      }
    } else if (nearest.kind === 'LIGHT_SWITCH' && !cuttersOnly) {
      const sw = nearest.lightSwitch;
      sw.isOn = !sw.isOn;
      this.audio.playBreakerSwitch(sw.isOn);
      this.emitNoise(sw.x, sw.y, 180, 'rgba(253, 224, 71, 0.38)', true, 0.28);
      this.showToast(`${sw.room} overhead lights ${sw.isOn ? 'ON' : 'OFF'}.`);
    } else if (nearest.kind === 'DOOR') {
      const d = nearest.door;
      if (d.isBroken) return;
      if (d.isLocked) {
        const cutterIdx = p.inventory.indexOf('BOLT_CUTTERS');
        if (cutterIdx !== -1) {
          d.isLocked = false;
          d.lockCut = true;
          d.isOpen = true;
          d.swingSpeed = d.isWatertight ? 1.9 : 6.5;
          this.audio.playBoltCuttersSnap();
          this.audio.playDoorToggle(true, false, 0, 0, 0, Boolean(d.isWatertight));
          this.emitNoise(
            (d.tx + 0.5) * this.map.tileSize,
            (d.ty + 0.5) * this.map.tileSize,
            d.isWatertight ? 480 : 290,
            'rgba(226, 232, 240, 0.4)',
            true,
            0.5
          );
          this.showToast('Padlock cut open.');
        } else {
          this.showToast('Padlocked bulkhead — requires Bolt Cutters.');
        }
      } else if (!cuttersOnly) {
        // Walking or sprinting slams doors loudly; sneaking (C) or standing still opens/closes slower
        // Watertight Deck 1 doors are always heavier, slower to swing, and significantly louder
        const slam = p.isMoving && !p.crouching;
        const silent = !slam;
        const wt = Boolean(d.isWatertight);
        d.isOpen = !d.isOpen;
        d.swingSpeed = wt ? (silent ? 0.92 : 1.75) : silent ? 1.55 : 8.5;
        if (!d.isOpen) {
          this.resolveSingleDoorPush(p, d, 0.016, false, true);
        }
        this.audio.playDoorToggle(d.isOpen, silent, 0, 0, 0, wt);
        const dx = (d.tx + 0.5) * this.map.tileSize;
        const dy = (d.ty + 0.5) * this.map.tileSize;
        if (wt) {
          this.emitNoise(
            dx,
            dy,
            silent ? 230 : 540,
            silent ? 'rgba(56, 189, 248, 0.34)' : 'rgba(251, 146, 60, 0.55)',
            true,
            silent ? 0.42 : 0.9
          );
        } else if (silent) {
          this.emitNoise(dx, dy, 52, 'rgba(148, 163, 184, 0.16)', false);
        } else {
          this.emitNoise(dx, dy, 340, 'rgba(148, 163, 184, 0.45)', true, 0.6);
        }
      }
    } else if (nearest.kind === 'CONTAINER' && !cuttersOnly) {
      const c = nearest.container;
      if (c.searched) return;
      c.searched = true;
      this.containersSearched += 1;
      if (c.item) {
        const meta = ITEM_CATALOG[c.item];
        if (c.item === 'BACKPACK') {
          p.hasBackpack = true;
          p.maxInventorySlots = 6;
          this.audio.playBackpackEquip();
          this.showToast('Found Crew Backpack (+2 inventory slots — 6 total)!');
        } else if (p.inventory.length < p.maxInventorySlots) {
          p.inventory.push(c.item);
          this.audio.playContainerSearch(true);
          this.showToast(
            meta.category === 'LIFEBOAT_PART' ||
              meta.category === 'HELI_PART' ||
              meta.category === 'SUBMARINE_PART'
              ? `Picked up ${meta.name} (check [J] Journal).`
              : `Picked up ${meta.name}.`
          );
        } else {
          // Undo searched so player can swap/drop later if inventory full
          c.searched = false;
          this.containersSearched -= 1;
          this.showToast(
            `Pack full (${p.inventory.length}/${p.maxInventorySlots}) — drop [G] or use an item first.`
          );
        }
      } else {
        this.audio.playContainerSearch(false);
        this.showToast('Empty.');
      }
    } else if (nearest.kind === 'HIDING' && !cuttersOnly) {
      const spot = nearest.spot;
      // Check if Brute currently sees player or is actively chasing nearby with clear LoS
      const bruteSawHide =
        canBruteSeePlayer(this.brute, p, this.map, this.doorsByTile, this.difficulty, this.bruteTuning) ||
        ((this.brute.state === 'CHASE' || this.brute.state === 'SMASH_DOOR') &&
          Math.hypot(this.brute.x - p.x, this.brute.y - p.y) <= 320 &&
          hasLineOfSight(this.map, this.doorsByTile, this.brute.x, this.brute.y, p.x, p.y));
      p.preHidePos = { x: p.x, y: p.y };
      p.x = spot.x;
      p.y = spot.y;
      p.hidingSpotId = spot.id;
      p.peekingSpotId = null;
      if (p.flashlightOn) {
        p.flashlightOn = false;
        this.audio.playFlashlightClick();
      }
      p.sprinting = false;
      p.isMoving = false;
      this.lookAheadX = 0;
      this.lookAheadY = 0;
      this.audio.playLockerSound();
      if (bruteSawHide) {
        this.brute.watchedPlayerHideSpotId = spot.id;
        this.brute.lastKnownPlayerPos = null;
        this.brute.chaseOvershootPos = null;
        this.brute.pursuitStairId = null;
        spot.checkedFlash = 0.65;
      } else {
        this.emitNoise(spot.x, spot.y, 195, 'rgba(148, 163, 184, 0.28)', true, 0.4);
      }
    }

    this.emitHud();
  }

  public findNearestInteractable():
    | { kind: 'DOOR'; door: Door; dist: number; prompt: string; sub: string }
    | { kind: 'STAIRWELL'; stairwell: Stairwell; dist: number; prompt: string; sub: string }
    | { kind: 'LIGHT_SWITCH'; lightSwitch: RoomLightSwitch; dist: number; prompt: string; sub: string }
    | { kind: 'CONTAINER'; container: Container; dist: number; prompt: string; sub: string }
    | { kind: 'PICKUP'; pickup: WorldPickup; dist: number; prompt: string; sub: string }
    | { kind: 'HIDING'; spot: HidingSpot; dist: number; prompt: string; sub: string }
    | { kind: 'PAPER_MAP'; stand: PaperMapStand; dist: number; prompt: string; sub: string }
    | { kind: 'ESCAPE_LIFEBOAT'; dist: number; prompt: string; sub: string }
    | { kind: 'ESCAPE_HELI'; dist: number; prompt: string; sub: string }
    | { kind: 'ESCAPE_SUBMARINE'; subTarget: 'DOCK' | 'LEVER'; dist: number; prompt: string; sub: string }
    | null {
    const p = this.player;
    if (p.hidingSpotId !== null || p.climbingStairId !== null) {
      return null;
    }

    let best: ReturnType<MonstrumGameEngine['findNearestInteractable']> = null;
    let bestDist = 78;

    // Escape zones
    const dLife = Math.hypot(p.x - this.map.lifeboatPos.x, p.y - this.map.lifeboatPos.y);
    if (dLife < 72) {
      const heldLife = this.getHeldPartForRoute('LIFEBOAT');
      let prompt = `Bow Lifeboat Davit (${this.escape.lifeboatParts.length}/3)`;
      let sub = 'Press J to view required Lifeboat parts in your Field Journal.';
      if (this.escape.lifeboatState === 'READY') {
        prompt = 'Press E to Board Lifeboat & Escape!';
        sub = 'Davit crane has lowered the boat clear of the hull — go!';
      } else if (this.escape.lifeboatState === 'ACTIVATING') {
        const pct = Math.round(this.escape.lifeboatActivationProgress * 100);
        prompt = `Lowering Lifeboat Over Railing (${pct}%)`;
        sub = 'Hydraulic winch is screaming — survive until 100%, then Press E!';
      } else if (this.escape.lifeboatParts.length === 3) {
        prompt = 'Hold E to Engage Hydraulic Davit Crane';
        sub = 'All 3 parts installed — swinging boat over the rail draws the Brute!';
      } else if (heldLife) {
        prompt = `Hold E to Install ${ITEM_CATALOG[heldLife].name} (${this.escape.lifeboatParts.length}/3)`;
        sub = 'Slow mechanical repair (~5s) — loud clanks will draw the Brute.';
      }
      best = {
        kind: 'ESCAPE_LIFEBOAT',
        dist: dLife,
        prompt,
        sub,
      };
      bestDist = dLife;
    }

    const dHeli = Math.hypot(p.x - this.map.heliPos.x, p.y - this.map.heliPos.y);
    if (dHeli < 78 && dHeli < bestDist) {
      const heldHeli = this.getHeldPartForRoute('HELI');
      let prompt = `Stern Helideck (${this.escape.heliParts.length}/3)`;
      let sub = 'Press J to view required Helicopter parts in your Field Journal.';
      if (this.escape.heliState === 'READY') {
        prompt = 'Press E to Board Helicopter & Escape!';
        sub = 'Rotors at full flight RPM — press E now to lift off!';
      } else if (this.escape.heliState === 'ACTIVATING') {
        const pct = Math.round(this.escape.heliActivationProgress * 100);
        prompt = `Helicopter Turbine Spinning Up (${pct}%)`;
        sub = 'Deafening engine spool — survive until 100%, then Press E!';
      } else if (this.escape.heliParts.length === 3) {
        prompt = 'Hold E to Start Helicopter Turbine';
        sub = 'All 3 parts installed — loud spin-up alerts the Brute!';
      } else if (heldHeli) {
        prompt = `Hold E to Install ${ITEM_CATALOG[heldHeli].name} (${this.escape.heliParts.length}/3)`;
        sub = 'Slow mechanical repair (~5s) — noise attracts the Brute.';
      }
      best = {
        kind: 'ESCAPE_HELI',
        dist: dHeli,
        prompt,
        sub,
      };
      bestDist = dHeli;
    }

    const dSubDock = Math.hypot(p.x - this.map.submarinePos.x, p.y - this.map.submarinePos.y);
    const dSubLever = Math.hypot(p.x - this.map.submarinePos.leverX, p.y - this.map.submarinePos.leverY);
    if ((dSubDock < 92 || dSubLever < 78) && Math.min(dSubDock, dSubLever) < bestDist) {
      const heldSub = this.getHeldPartForRoute('SUBMARINE');
      const nearLever = dSubLever < 78 && (this.escape.submarineParts.length === 3 || dSubLever <= dSubDock);
      let prompt = `Deck 1 Submarine Dock (${this.escape.submarineParts.length}/3)`;
      let sub = 'Press J to view required Submarine parts in your Field Journal.';
      if (this.escape.submarineState === 'READY') {
        prompt = 'Press E to Board Submarine & Dive!';
        sub = 'Moonpool floodgates open & hull pressurized — dive now!';
      } else if (this.escape.submarineState === 'ACTIVATING') {
        const pct = Math.round(this.escape.submarineActivationProgress * 100);
        prompt = `Flooding Moonpool Chamber (${pct}%)`;
        sub = 'Floodgate klaxon blaring — survive until 100%, then Press E at the sub!';
      } else if (this.escape.submarineParts.length === 3) {
        if (dSubLever < 78) {
          prompt = 'Hold E to Pull Floodgate Launch Lever';
          sub = 'All 3 parts installed — opening the sea lock blares klaxons & alerts the Brute!';
        } else {
          prompt = 'All Parts Installed — Pull Floodgate Lever Inside Bay';
          sub = 'Head to the Floodgate Console at the northwest corner of Submarine Bay.';
        }
      } else if (heldSub && dSubDock < 92) {
        prompt = `Hold E to Install ${ITEM_CATALOG[heldSub].name} (${this.escape.submarineParts.length}/3)`;
        sub = 'Heavy retrofit (~5s) — loud clanging draws the Brute.';
      } else if (nearLever) {
        prompt = `Floodgate Launch Console (${this.escape.submarineParts.length}/3 Parts)`;
        sub = 'Install all 3 Submarine parts at the drydock hull before pulling the floodgate lever.';
      }
      const chosenDist = nearLever ? dSubLever : dSubDock;
      best = {
        kind: 'ESCAPE_SUBMARINE',
        subTarget: nearLever ? 'LEVER' : 'DOCK',
        dist: chosenDist,
        prompt,
        sub,
      };
      bestDist = chosenDist;
    }

    const pDeck = this.getCurrentDeck();
    for (const stand of this.map.paperMaps) {
      if (stand.deck !== pDeck) continue;
      const dist = Math.hypot(stand.x - p.x, stand.y - p.y);
      if (
        dist < 54 &&
        dist < bestDist &&
        hasLineOfSightToEntity(this.map, this.doorsByTile, p.x, p.y, stand.x, stand.y)
      ) {
        bestDist = dist;
        best = {
          kind: 'PAPER_MAP',
          stand,
          dist,
          prompt: `Press E to Inspect Deck Paper Map (${getDeckLabel(stand.deck)})`,
          sub: 'Fixed wall chart — world stays live while reading! Cannot be carried.',
        };
      }
    }

    for (const wp of this.worldPickups) {
      if (wp.deck !== pDeck) continue;
      const dist = Math.hypot(wp.x - p.x, wp.y - p.y);
      if (
        dist < 46 &&
        dist < bestDist &&
        hasLineOfSightToEntity(this.map, this.doorsByTile, p.x, p.y, wp.x, wp.y)
      ) {
        bestDist = dist;
        const meta = ITEM_CATALOG[wp.item];
        best = {
          kind: 'PICKUP',
          pickup: wp,
          dist,
          prompt: `Press E to Pick up ${meta.name}`,
          sub: meta.description,
        };
      }
    }

    for (const c of this.map.containers) {
      if (c.searched) continue;
      const dist = Math.hypot(c.x - p.x, c.y - p.y);
      if (
        dist < 48 &&
        dist < bestDist &&
        hasLineOfSightToEntity(this.map, this.doorsByTile, p.x, p.y, c.x, c.y)
      ) {
        bestDist = dist;
        best = {
          kind: 'CONTAINER',
          container: c,
          dist,
          prompt: `Press E to Search ${c.type.replace('_', ' ')}`,
          sub: c.room,
        };
      }
    }

    for (const s of this.map.hidingSpots) {
      const dist = Math.hypot(s.x - p.x, s.y - p.y);
      if (
        dist < 48 &&
        dist < bestDist &&
        hasLineOfSightToEntity(this.map, this.doorsByTile, p.x, p.y, s.x, s.y)
      ) {
        bestDist = dist;
        best = {
          kind: 'HIDING',
          spot: s,
          dist,
          prompt: `Press E to Hide (${s.type.replace('_', ' ')})`,
          sub: 'Break line of sight first — Brute sweeps lockers',
        };
      }
    }

    for (const sw of this.map.lightSwitches) {
      const dist = Math.hypot(sw.x - p.x, sw.y - p.y);
      if (
        dist < 46 &&
        dist < bestDist &&
        hasLineOfSightToEntity(this.map, this.doorsByTile, p.x, p.y, sw.x, sw.y)
      ) {
        bestDist = dist;
        best = {
          kind: 'LIGHT_SWITCH',
          lightSwitch: sw,
          dist,
          prompt: sw.isOn
            ? `Press E to Turn OFF ${sw.room} Lights`
            : `Press E to Turn ON ${sw.room} Lights`,
          sub: sw.isOn
            ? 'Lit compartments extend Brute sight & trigger Stalker Mode'
            : 'Illuminates room without draining flashlight battery',
        };
      }
    }

    for (const st of this.map.stairwells) {
      const dist = Math.hypot(st.x - p.x, st.y - p.y);
      if (
        dist < 48 &&
        dist < bestDist &&
        hasLineOfSightToEntity(this.map, this.doorsByTile, p.x, p.y, st.x, st.y)
      ) {
        bestDist = dist;
        best = {
          kind: 'STAIRWELL',
          stairwell: st,
          dist,
          prompt:
            st.direction === 'DOWN'
              ? `Press E to Take Stairs Down (${getDeckLabel(st.targetDeck)})`
              : `Press E to Take Stairs Up (${getDeckLabel(st.targetDeck)})`,
          sub: `Hold Q to Peek Landing · ${st.label} → ${st.targetRoom}`,
        };
      }
    }

    for (const d of this.map.doors) {
      if (d.isBroken) continue;
      const cx = (d.tx + 0.5) * this.map.tileSize;
      const cy = (d.ty + 0.5) * this.map.tileSize;
      const dist = Math.hypot(cx - p.x, cy - p.y);
      // Slightly larger door interaction reach (70px vs 54px) and chase slam bias
      const effectiveScore = d.isOpen && p.isMoving && !p.crouching ? Math.max(0, dist - 10) : dist;
      if (
        dist < 70 &&
        effectiveScore < bestDist &&
        hasLineOfSightToEntity(this.map, this.doorsByTile, p.x, p.y, cx, cy)
      ) {
        bestDist = effectiveScore;
        const slam = p.isMoving && !p.crouching;
        const wt = Boolean(d.isWatertight);
        best = {
          kind: 'DOOR',
          door: d,
          dist,
          prompt: d.isLocked
            ? p.inventory.includes('BOLT_CUTTERS')
              ? 'Press E to Cut Padlock'
              : 'Locked Bulkhead'
            : wt
              ? d.isOpen
                ? 'Press E to Seal Watertight Door (Slow & Loud)'
                : 'Press E to Crank Watertight Door (Slow & Loud)'
              : d.isOpen
                ? slam
                  ? 'Press E to Slam Door Shut (Loud)'
                  : 'Press E to Close Door Slowly (Silent)'
                : slam
                  ? 'Press E to Slam Door Open (Loud)'
                  : 'Press E to Open Door Slowly (Silent)',
          sub: d.isLocked
            ? 'Requires Bolt Cutters'
            : wt
              ? 'Heavy Deck 1 bulkhead · Slow swing & loud hydraulic clank'
              : d.isOpen
                ? 'Sneak (C) or stand still to close silently · Walking/Sprinting slams'
                : 'Hold Q to Peek · Sneak (C) or stand still for silent swing',
        };
      }
    }

    return best;
  }

  public getCurrentRoom(): RoomName {
    const tx = Math.max(0, Math.min(this.map.width - 1, Math.floor(this.player.x / this.map.tileSize)));
    const ty = Math.max(0, Math.min(this.map.height - 1, Math.floor(this.player.y / this.map.tileSize)));
    return this.map.roomGrid[ty][tx];
  }

  public getCurrentDeck(): ShipDeck {
    const tx = Math.max(0, Math.min(this.map.width - 1, Math.floor(this.player.x / this.map.tileSize)));
    const ty = Math.max(0, Math.min(this.map.height - 1, Math.floor(this.player.y / this.map.tileSize)));
    return this.map.deckGrid[ty][tx];
  }

  private triggerGameOver(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.closePaperMap(false);
    this.audio.playDeathImpact();
    this.emitHud();
    this.callbacks.onGameOver({
      elapsedSeconds: this.elapsedSeconds,
      partsInstalled:
        this.escape.lifeboatParts.length +
        this.escape.heliParts.length +
        this.escape.submarineParts.length,
      containersSearched: this.containersSearched,
      bruteSightings: this.brute.sightingsCount,
      cluesSpotted: this.brute.cluesSpottedTotal,
      hidingSpotsCheckedByBrute: this.brute.checkedSpotsTotal,
      doorsSmashed: this.brute.doorsSmashedTotal,
      escapeMethod: null,
      deathReason: reason,
      seed: this.map.seed,
      difficulty: { ...this.difficulty },
      customBruteTuning: this.customBruteTuning,
    });
  }

  private triggerVictory(method: 'LIFEBOAT' | 'HELICOPTER' | 'SUBMARINE'): void {
    if (this.ended) return;
    this.ended = true;
    this.closePaperMap(false);
    this.audio.playVictoryHorn();
    this.emitHud();
    this.callbacks.onVictory({
      elapsedSeconds: this.elapsedSeconds,
      partsInstalled:
        this.escape.lifeboatParts.length +
        this.escape.heliParts.length +
        this.escape.submarineParts.length,
      containersSearched: this.containersSearched,
      bruteSightings: this.brute.sightingsCount,
      cluesSpotted: this.brute.cluesSpottedTotal,
      hidingSpotsCheckedByBrute: this.brute.checkedSpotsTotal,
      doorsSmashed: this.brute.doorsSmashedTotal,
      escapeMethod: method,
      deathReason: null,
      seed: this.map.seed,
      difficulty: { ...this.difficulty },
      customBruteTuning: this.customBruteTuning,
    });
  }

  public emitHud(): void {
    const nearest = this.findNearestInteractable();
    let promptText = nearest ? nearest.prompt : null;
    let promptSubtext = nearest ? nearest.sub : null;

    if (this.player.climbingStairId !== null) {
      const st = this.map.stairwells.find((s) => s.id === this.player.climbingStairId);
      if (st) {
        promptText =
          st.direction === 'DOWN'
            ? `Descending to ${st.targetRoom}...`
            : `Climbing Up to ${st.targetRoom}...`;
        promptSubtext = 'Exposed on companionway treads until climb completes.';
      }
    } else if (this.player.peekingStairId !== null) {
      const st = this.map.stairwells.find((s) => s.id === this.player.peekingStairId);
      const dest = st ? this.map.stairwells.find((s) => s.id === st.targetStairId) : undefined;
      if (st && dest) {
        promptText = `Peeking ${getDeckLabel(dest.deck)} Landing — ${dest.room}`;
        promptSubtext = 'Release Q to step back · Press E to climb companionway.';
      }
    } else if (this.player.hidingSpotId !== null) {
      if (this.player.battery <= 0) {
        promptText = 'Hiding — Press E to Exit · Battery Empty';
        promptSubtext = 'Cannot peek vents without flashlight battery. Wait for the Brute to pass.';
      } else if (this.player.peekingSpotId) {
        promptText = 'Peeking Vents (Light ON) — Release Q to Duck Back';
        promptSubtext = 'Draining flashlight battery while looking through the vents.';
      } else {
        promptText = 'Hiding — Press E to Exit · Hold Q to Peek';
        promptSubtext = 'Holding Q turns on your flashlight and drains battery to see out.';
      }
    }

    const actionProgress = this.activeRepairProgress;
    const actionLabel = this.activeRepairLabel;

    const climbingStair = this.player.climbingStairId
      ? this.map.stairwells.find((s) => s.id === this.player.climbingStairId)
      : undefined;
    const climbProgress = climbingStair ? this.player.climbProgress : 0;
    const climbLabel = climbingStair
      ? climbingStair.direction === 'DOWN'
        ? `Descending to ${climbingStair.targetRoom}...`
        : `Climbing Up to ${climbingStair.targetRoom}...`
      : null;

    this.callbacks.onHudUpdate({
      stamina: this.player.stamina,
      battery: this.player.battery,
      flashlightOn: this.player.flashlightOn,
      crouching: this.player.crouching,
      hiding: this.player.hidingSpotId !== null,
      currentDeck: this.getCurrentDeck(),
      currentRoom: this.getCurrentRoom(),
      shipArchetype: this.map.archetype,
      inventory: [...this.player.inventory],
      maxInventorySlots: this.player.maxInventorySlots,
      hasBackpack: this.player.hasBackpack,
      selectedSlot: this.player.selectedSlot,
      journalOpen: this.journalOpen,
      paperMapDeck: this.player.openPaperMapDeck,
      paperMapStandPos: this.player.openPaperMapStandPos
        ? { ...this.player.openPaperMapStandPos }
        : null,
      steamFogAlpha: this.player.steamFogAlpha,
      steamStaggered: this.player.steamStaggerTimer > 0,
      lifeboatParts: [...this.escape.lifeboatParts],
      heliParts: [...this.escape.heliParts],
      submarineParts: [...this.escape.submarineParts],
      lifeboatState: this.escape.lifeboatState,
      heliState: this.escape.heliState,
      submarineState: this.escape.submarineState,
      lifeboatActivationProgress: this.escape.lifeboatActivationProgress,
      heliActivationProgress: this.escape.heliActivationProgress,
      submarineActivationProgress: this.escape.submarineActivationProgress,
      promptText,
      promptSubtext,
      bruteState: this.brute.state,
      bruteDistance: this.getEffectiveBruteDistance(),
      elapsedSeconds: this.elapsedSeconds,
      toastMessage: this.toastMessage,
      actionProgress,
      actionLabel,
      climbProgress,
      climbLabel,
      zoom: this.zoom,
    });
  }
}
