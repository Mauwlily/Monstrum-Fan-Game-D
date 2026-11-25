import { isTileWalkable } from './mapGen';
import {
  BruteState,
  BruteTuningNumbers,
  DifficultyConfig,
  DifficultyLevel,
  Door,
  EscapeProgress,
  getDeckIndex,
  PlayerState,
  RoomLightSwitch,
  RoomName,
  ShipDeck,
  ShipMap,
} from './types';
import { canBruteSeePlayer, canBruteSeePoint, getSensesProfile } from './visibility';

export interface RememberedDoor {
  isOpen: boolean;
  isBroken: boolean;
  isLocked: boolean;
  lockCut: boolean;
  cooldownUntil: number;
}

export interface RoomMemory {
  roomId: number;
  room: RoomName;
  deck: ShipDeck;
  lastVisitedAt: number;
  lastClearedAt: number;
  suspicion: number;
  connectedRoomIds: number[];
  walkableTiles: Array<{ tx: number; ty: number }>;
  centerWorld: { x: number; y: number };
}

export type UtilityGoal =
  | 'PURSUIT'
  | 'SMASH_DOOR'
  | 'CHECK_HIDING'
  | 'STALK_CLUE'
  | 'INVESTIGATE_NOISE'
  | 'UNLEASHED_ROAM';

export interface StalkTarget {
  x: number;
  y: number;
  room: RoomName;
  roomId: number;
  reason:
    | 'OPEN_DOOR'
    | 'CUT_LOCK'
    | 'LOOTED_CONTAINER'
    | 'LIGHT_LEFT_ON'
    | 'DOOR_PEEK_BEAM'
    | 'CONNECTED_SWEEP';
  sweepHidingOnArrival: boolean;
  killSwitchId?: string;
}

export interface ClueDetectionEvent {
  x: number;
  y: number;
  room: RoomName;
  roomId: number;
  reason: 'OPEN_DOOR' | 'CUT_LOCK' | 'LOOTED_CONTAINER' | 'LIGHT_LEFT_ON' | 'DOOR_PEEK_BEAM';
}

export interface StalkQueueEntry {
  roomId: number;
  room: RoomName;
  x?: number;
  y?: number;
  sweepHidingOnArrival?: boolean;
}

export class BruteBrain {
  public rememberedDoors: Map<string, RememberedDoor> = new Map();
  public rememberedContainers: Map<string, boolean> = new Map();
  public rememberedLights: Map<string, boolean> = new Map();
  public lightCooldowns: Map<string, number> = new Map();
  public roomMemory: Map<number, RoomMemory> = new Map();
  public doorSides: Map<
    string,
    { sideA: RoomName; sideB: RoomName; sideAId: number; sideBId: number }
  > = new Map();

  public activeGoal: UtilityGoal = 'UNLEASHED_ROAM';
  public stalkTarget: StalkTarget | null = null;
  public stalkRoomQueue: StalkQueueEntry[] = [];

  // Master Fuse per-deck intelligence awareness & Low-Int periodic forgetfulness
  public knownFuseDecks: Set<ShipDeck> = new Set();
  public lowForgetTimers: Partial<Record<ShipDeck, number>> = {};
  public fuseDeckScanCooldowns: Partial<Record<ShipDeck, number>> = {};

  // Sight-observed escape progress (Brute only biases patrol routes after visually seeing repairs/activation)
  public observedHeliRepairs = 0;
  public observedHeliActive = false;
  public observedLifeboatRepairs = 0;
  public observedLifeboatActive = false;
  public observedSubRepairs = 0;
  public observedSubActive = false;

  private map: ShipMap;
  private recentlyCheckedSpots: Map<string, number> = new Map();
  private doorPeekCooldowns: Map<string, number> = new Map();
  private clueScanTimer = 0;
  private evalTimer = 0;

  constructor(map: ShipMap) {
    this.map = map;
    this.initMemory();
  }

  private initMemory(): void {
    for (const d of this.map.doors) {
      this.rememberedDoors.set(d.id, {
        isOpen: d.isOpen,
        isBroken: d.isBroken,
        isLocked: d.isLocked,
        lockCut: Boolean(d.lockCut),
        cooldownUntil: 0,
      });
      this.doorSides.set(d.id, this.resolveDoorSides(d));
    }

    for (const c of this.map.containers) {
      this.rememberedContainers.set(c.id, c.searched);
    }

    for (const ls of this.map.lightSwitches) {
      this.rememberedLights.set(ls.id, ls.isOn);
      this.lightCooldowns.set(ls.id, 0);
    }

    // Build per-compartment (roomId) walkable tile buckets and adjacency graph
    const tilesByRoomId = new Map<number, Array<{ tx: number; ty: number }>>();
    const roomMetaById = new Map<number, { room: RoomName; deck: ShipDeck }>();
    const adjacency = new Map<number, Set<number>>();

    const subPool = this.map.props.find((p) => p.kind === 'SUBMARINE_HULL');
    const isBrainTileWalkable = (tx: number, ty: number): boolean => {
      if (!isTileWalkable(this.map.tiles[ty][tx])) return false;
      if (
        subPool &&
        tx >= subPool.tx &&
        tx < subPool.tx + subPool.tw &&
        ty >= subPool.ty &&
        ty < subPool.ty + subPool.th
      ) {
        return false;
      }
      return true;
    };

    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        if (!isBrainTileWalkable(x, y)) continue;
        const rId = this.map.roomIdGrid[y][x];
        const rName = this.map.roomGrid[y][x];
        const deck = this.map.deckGrid[y][x];
        if (!tilesByRoomId.has(rId)) {
          tilesByRoomId.set(rId, []);
          roomMetaById.set(rId, { room: rName, deck });
        }
        tilesByRoomId.get(rId)!.push({ tx: x, ty: y });

        if (!adjacency.has(rId)) adjacency.set(rId, new Set());
        const neighbors = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= this.map.width || ny < 0 || ny >= this.map.height) continue;
          if (!isBrainTileWalkable(nx, ny)) continue;
          const nrId = this.map.roomIdGrid[ny][nx];
          if (nrId !== rId) {
            adjacency.get(rId)!.add(nrId);
          }
        }
      }
    }

    // Link stairwells across DECK_3 <-> DECK_2 <-> DECK_1 in compartment adjacency graph
    for (const st of this.map.stairwells) {
      const aId = st.roomId;
      const bId = st.targetRoomId;
      if (!adjacency.has(aId)) adjacency.set(aId, new Set());
      if (!adjacency.has(bId)) adjacency.set(bId, new Set());
      if (aId !== bId) {
        adjacency.get(aId)!.add(bId);
        adjacency.get(bId)!.add(aId);
      }
    }

    for (const [roomId, tiles] of tilesByRoomId.entries()) {
      let sx = 0;
      let sy = 0;
      for (const t of tiles) {
        sx += (t.tx + 0.5) * this.map.tileSize;
        sy += (t.ty + 0.5) * this.map.tileSize;
      }
      const meta = roomMetaById.get(roomId) ?? { room: 'Corridor' as RoomName, deck: 'DECK_2' as ShipDeck };
      this.roomMemory.set(roomId, {
        roomId,
        room: meta.room,
        deck: meta.deck,
        lastVisitedAt: -30,
        lastClearedAt: -30,
        suspicion: 0,
        connectedRoomIds: Array.from(adjacency.get(roomId) ?? []),
        walkableTiles: tiles,
        centerWorld: {
          x: sx / Math.max(1, tiles.length),
          y: sy / Math.max(1, tiles.length),
        },
      });
    }
  }

  private resolveDoorSides(
    door: Door
  ): { sideA: RoomName; sideB: RoomName; sideAId: number; sideBId: number } {
    const dirs =
      door.orientation === 'H'
        ? [
            [0, -1],
            [0, 1],
          ]
        : [
            [-1, 0],
            [1, 0],
          ];
    const rooms: RoomName[] = [];
    const roomIds: number[] = [];
    for (const [dx, dy] of dirs) {
      const nx = door.tx + dx;
      const ny = door.ty + dy;
      if (nx >= 0 && nx < this.map.width && ny >= 0 && ny < this.map.height) {
        rooms.push(this.map.roomGrid[ny][nx]);
        roomIds.push(this.map.roomIdGrid[ny][nx]);
      }
    }
    return {
      sideA: rooms[0] ?? 'Corridor',
      sideB: rooms[1] ?? 'Corridor',
      sideAId: roomIds[0] ?? 0,
      sideBId: roomIds[1] ?? 0,
    };
  }

  public noteBruteDoorAction(door: Door, nowSec: number): void {
    this.rememberedDoors.set(door.id, {
      isOpen: door.isOpen,
      isBroken: door.isBroken,
      isLocked: door.isLocked,
      lockCut: Boolean(door.lockCut),
      cooldownUntil: nowSec + 10,
    });
  }

  public markRoomVisited(roomId: number, nowSec: number): void {
    const mem = this.roomMemory.get(roomId);
    if (!mem) return;
    mem.lastVisitedAt = nowSec;
  }

  public markRoomCleared(roomId: number, nowSec: number): void {
    const mem = this.roomMemory.get(roomId);
    if (!mem) return;
    mem.lastClearedAt = nowSec;
    mem.suspicion = Math.max(0, mem.suspicion * 0.25);
  }

  public decaySuspicion(dt: number): void {
    for (const mem of this.roomMemory.values()) {
      if (mem.suspicion > 0) {
        mem.suspicion = Math.max(0, mem.suspicion - dt * 0.025);
      }
    }
  }

  public markSpotChecked(spotId: string, nowSec: number): void {
    this.recentlyCheckedSpots.set(spotId, nowSec + 26);
  }

  public getSwitchDeck(sw: RoomLightSwitch): ShipDeck {
    return this.map.deckGrid[sw.ty]?.[sw.tx] ?? 'DECK_2';
  }

  public markFuseDeckKnown(deck: ShipDeck, intelligence: DifficultyLevel): void {
    this.knownFuseDecks.add(deck);
    if (intelligence === 'LOW') {
      this.lowForgetTimers[deck] = 48 + Math.random() * 24;
    } else {
      delete this.lowForgetTimers[deck];
    }
  }

  public updateFuseMemory(
    dt: number,
    poweredDecks: Record<ShipDeck, boolean>,
    intelligence: DifficultyLevel
  ): void {
    if (intelligence !== 'LOW') return;
    for (const deck of ['DECK_3', 'DECK_2', 'DECK_1'] as const) {
      if (!poweredDecks[deck] || !this.knownFuseDecks.has(deck)) continue;
      const rem = this.lowForgetTimers[deck];
      if (rem === undefined) {
        this.lowForgetTimers[deck] = 48 + Math.random() * 24;
        continue;
      }
      const next = rem - dt;
      if (next <= 0) {
        this.knownFuseDecks.delete(deck);
        delete this.lowForgetTimers[deck];
        delete this.fuseDeckScanCooldowns[deck];
        for (const sw of this.map.lightSwitches) {
          if (this.getSwitchDeck(sw) === deck) {
            this.lightCooldowns.delete(sw.id);
            this.rememberedLights.set(sw.id, false);
          }
        }
      } else {
        this.lowForgetTimers[deck] = next;
      }
    }
  }

  private getDeckAtWorld(wx: number, wy: number): ShipDeck {
    const tx = Math.max(0, Math.min(this.map.width - 1, Math.floor(wx / this.map.tileSize)));
    const ty = Math.max(0, Math.min(this.map.height - 1, Math.floor(wy / this.map.tileSize)));
    return this.map.deckGrid[ty][tx];
  }

  public getRoomUncheckedSpots(
    roomId: number,
    room: RoomName,
    refX: number,
    refY: number,
    nowSec: number,
    intelligence: DifficultyLevel,
    tuning?: BruteTuningNumbers
  ): string[] {
    const refDeck = this.getDeckAtWorld(refX, refY);

    let candidates = this.map.hidingSpots.filter((s) => {
      if ((this.recentlyCheckedSpots.get(s.id) ?? -1) > nowSec) return false;
      if (room !== 'Corridor' && room !== 'Catwalk') {
        return s.roomId === roomId;
      }
      return s.deck === refDeck && Math.hypot(s.x - refX, s.y - refY) <= 230;
    });

    if (candidates.length === 0 && (room === 'Corridor' || room === 'Catwalk')) {
      return [];
    }

    candidates = candidates.sort(
      (a, b) => Math.hypot(a.x - refX, a.y - refY) - Math.hypot(b.x - refX, b.y - refY)
    );

    if (tuning) {
      const cap = Math.max(1, Math.ceil(candidates.length * Math.max(0.1, Math.min(1, tuning.sweepCoverage))));
      return candidates.slice(0, cap).map((s) => s.id);
    }

    if (intelligence === 'LOW') {
      return candidates.slice(0, 2).map((s) => s.id);
    }
    if (intelligence === 'MEDIUM') {
      const cap = Math.max(3, Math.ceil(candidates.length * 0.75));
      return candidates.slice(0, cap).map((s) => s.id);
    }
    return candidates.map((s) => s.id);
  }

  /**
   * Checks doors, containers, lights, and escape bays inside the Brute's real raycasted FoV.
   */
  public perceiveClues(
    dt: number,
    nowSec: number,
    brute: BruteState,
    doorsByTile: Map<number, Door>,
    difficulty: DifficultyConfig,
    tuning?: BruteTuningNumbers,
    escape?: EscapeProgress,
    poweredDecks?: Record<ShipDeck, boolean>
  ): ClueDetectionEvent[] {
    this.clueScanTimer -= dt;
    if (this.clueScanTimer > 0) return [];
    const highIntel = difficulty.intelligence === 'HIGH' || difficulty.intelligence === 'EXTREME';
    this.clueScanTimer =
      tuning?.clueScanInterval ??
      (highIntel ? 0.06 : difficulty.intelligence === 'MEDIUM' ? 0.12 : 0.22);

    if (brute.state === 'STUNNED' || brute.state === 'SMASH_DOOR') return [];

    const events: ClueDetectionEvent[] = [];
    const senses = getSensesProfile(difficulty, tuning);
    const doorSightRange = 415 * senses.sightMult;
    const containerSightRange = 345 * senses.sightMult;
    const silentSyncOnly = brute.state === 'CHASE';

    // 1. Check Doors against remembered state
    for (const door of this.map.doors) {
      const mem = this.rememberedDoors.get(door.id);
      if (!mem) continue;
      if (nowSec < mem.cooldownUntil) continue;

      const doorX = (door.tx + 0.5) * this.map.tileSize;
      const doorY = (door.ty + 0.5) * this.map.tileSize;
      if (
        !canBruteSeePoint(
          brute,
          doorX,
          doorY,
          doorSightRange,
          this.map,
          doorsByTile,
          senses.halfFovDeg
        )
      ) {
        continue;
      }

      const openedUnexpectedly = door.isOpen && !mem.isOpen;
      const lockTampered = (Boolean(door.lockCut) && !mem.lockCut) || (!door.isLocked && mem.isLocked);

      if (openedUnexpectedly || lockTampered) {
        mem.isOpen = door.isOpen;
        mem.isBroken = door.isBroken;
        mem.isLocked = door.isLocked;
        mem.lockCut = Boolean(door.lockCut);
        mem.cooldownUntil = nowSec + 18;

        if (!silentSyncOnly) {
          const far = this.pickFarRoomFromDoor(door, brute);
          const reason = lockTampered ? 'CUT_LOCK' : 'OPEN_DOOR';
          this.triggerClueReaction(
            far.roomId,
            far.room,
            doorX,
            doorY,
            reason,
            nowSec,
            difficulty.intelligence,
            undefined,
            tuning
          );
          events.push({ x: doorX, y: doorY, room: far.room, roomId: far.roomId, reason });
        }
      } else {
        mem.isOpen = door.isOpen;
        mem.isBroken = door.isBroken;
        mem.isLocked = door.isLocked;
        mem.lockCut = Boolean(door.lockCut);
      }
    }

    // 2. Check Containers against remembered state
    for (const cont of this.map.containers) {
      const memSearched = this.rememberedContainers.get(cont.id);
      if (memSearched === undefined || memSearched === cont.searched) continue;

      if (
        !canBruteSeePoint(
          brute,
          cont.x,
          cont.y,
          containerSightRange,
          this.map,
          doorsByTile,
          senses.halfFovDeg
        )
      ) {
        continue;
      }

      this.rememberedContainers.set(cont.id, cont.searched);
      if (cont.searched && !silentSyncOnly) {
        this.triggerClueReaction(
          cont.roomId,
          cont.room,
          cont.x,
          cont.y,
          'LOOTED_CONTAINER',
          nowSec,
          difficulty.intelligence,
          undefined,
          tuning
        );
        events.push({
          x: cont.x,
          y: cont.y,
          room: cont.room,
          roomId: cont.roomId,
          reason: 'LOOTED_CONTAINER',
        });
      }
    }

    // 3. Check Room Light Switches & Master-Fuse Deck Lighting
    const bTx = Math.max(0, Math.min(this.map.width - 1, Math.floor(brute.x / this.map.tileSize)));
    const bTy = Math.max(0, Math.min(this.map.height - 1, Math.floor(brute.y / this.map.tileSize)));
    const bruteRoom = this.map.roomGrid[bTy][bTx];
    const bruteRoomId = this.map.roomIdGrid[bTy][bTx];
    const bruteDeck = this.map.deckGrid[bTy]?.[bTx] ?? 'DECK_2';
    const lightSightRange = 485 * senses.sightMult;

    // Extreme Intelligence deduces immediately from deck/hallway illumination that switches are futile
    if (
      poweredDecks?.[bruteDeck] &&
      difficulty.intelligence === 'EXTREME' &&
      !this.knownFuseDecks.has(bruteDeck)
    ) {
      this.knownFuseDecks.add(bruteDeck);
      for (const sw of this.map.lightSwitches) {
        if (this.getSwitchDeck(sw) === bruteDeck) {
          this.rememberedLights.set(sw.id, true);
        }
      }
    }

    // If on a fuse-powered deck and Brute hasn't learned/forgot it's fuse-powered yet, head to nearest switch
    if (
      !silentSyncOnly &&
      poweredDecks?.[bruteDeck] &&
      !this.knownFuseDecks.has(bruteDeck) &&
      difficulty.intelligence !== 'EXTREME' &&
      !brute.fiddleSwitchId &&
      nowSec >= (this.fuseDeckScanCooldowns[bruteDeck] ?? 0)
    ) {
      const deckSwitches = this.map.lightSwitches
        .filter((sw) => this.getSwitchDeck(sw) === bruteDeck && nowSec >= (this.lightCooldowns.get(sw.id) ?? 0))
        .sort((a, b) => Math.hypot(a.x - brute.x, a.y - brute.y) - Math.hypot(b.x - brute.x, b.y - brute.y));
      const nearestSw = deckSwitches[0];
      if (nearestSw) {
        this.fuseDeckScanCooldowns[bruteDeck] = nowSec + 18;
        this.lightCooldowns.set(nearestSw.id, nowSec + 18);
        this.triggerClueReaction(
          nearestSw.roomId,
          nearestSw.room,
          nearestSw.x,
          nearestSw.y,
          'LIGHT_LEFT_ON',
          nowSec,
          difficulty.intelligence,
          nearestSw,
          tuning
        );
        events.push({
          x: nearestSw.x,
          y: nearestSw.y,
          room: nearestSw.room,
          roomId: nearestSw.roomId,
          reason: 'LIGHT_LEFT_ON',
        });
      }
    }

    for (const sw of this.map.lightSwitches) {
      const swDeck = this.getSwitchDeck(sw);
      if (this.knownFuseDecks.has(swDeck)) continue;
      if (poweredDecks?.[swDeck] && difficulty.intelligence === 'EXTREME') continue;

      const memOn = this.rememberedLights.get(sw.id) ?? false;
      if (!sw.isOn) {
        this.rememberedLights.set(sw.id, false);
        continue;
      }
      if (memOn) continue;
      if (nowSec < (this.lightCooldowns.get(sw.id) ?? 0)) continue;

      const roomMem = this.roomMemory.get(sw.roomId);
      const seesLight =
        bruteRoomId === sw.roomId ||
        canBruteSeePoint(
          brute,
          sw.x,
          sw.y,
          lightSightRange,
          this.map,
          doorsByTile,
          senses.halfFovDeg
        ) ||
        (roomMem !== undefined &&
          canBruteSeePoint(
            brute,
            roomMem.centerWorld.x,
            roomMem.centerWorld.y,
            lightSightRange,
            this.map,
            doorsByTile,
            senses.halfFovDeg
          ));

      if (seesLight && !silentSyncOnly) {
        // When deck is fuse-powered, steer Brute to the nearest switch on that deck first
        let targetSw = sw;
        if (poweredDecks?.[swDeck]) {
          const nearest = this.map.lightSwitches
            .filter((cand) => this.getSwitchDeck(cand) === swDeck)
            .sort((a, b) => Math.hypot(a.x - brute.x, a.y - brute.y) - Math.hypot(b.x - brute.x, b.y - brute.y))[0];
          if (nearest) targetSw = nearest;
        }
        this.lightCooldowns.set(targetSw.id, nowSec + 18);
        this.triggerClueReaction(
          targetSw.roomId,
          targetSw.room,
          targetSw.x,
          targetSw.y,
          'LIGHT_LEFT_ON',
          nowSec,
          difficulty.intelligence,
          targetSw,
          tuning
        );
        events.push({
          x: targetSw.x,
          y: targetSw.y,
          room: targetSw.room,
          roomId: targetSw.roomId,
          reason: 'LIGHT_LEFT_ON',
        });
      }
    }

    // 4. Sight-based Escape Craft inspection across all 3 decks (Heli Deck 3, Lifeboat Deck 2, Submarine Deck 1)
    if (escape) {
      const escapeSightRange = 500 * senses.sightMult;
      const seesHeli =
        bruteRoom === 'Helideck' ||
        canBruteSeePoint(
          brute,
          this.map.heliPos.x,
          this.map.heliPos.y,
          escapeSightRange,
          this.map,
          doorsByTile,
          senses.halfFovDeg
        );
      if (seesHeli) {
        const nextHeliRepairs = escape.heliParts.length;
        const nextHeliActive = escape.heliState === 'ACTIVATING' || escape.heliState === 'READY';
        if (nextHeliRepairs > this.observedHeliRepairs || (nextHeliActive && !this.observedHeliActive)) {
          for (const mem of this.roomMemory.values()) {
            if (mem.room === 'Helideck') mem.suspicion = Math.min(1, mem.suspicion + 0.55);
          }
        }
        this.observedHeliRepairs = nextHeliRepairs;
        this.observedHeliActive = nextHeliActive;
      }

      const seesLifeboat =
        bruteRoom === 'Lifeboat Davit' ||
        canBruteSeePoint(
          brute,
          this.map.lifeboatPos.x,
          this.map.lifeboatPos.y,
          escapeSightRange,
          this.map,
          doorsByTile,
          senses.halfFovDeg
        );
      if (seesLifeboat) {
        const nextLifeRepairs = escape.lifeboatParts.length;
        const nextLifeActive =
          escape.lifeboatState === 'ACTIVATING' || escape.lifeboatState === 'READY';
        if (
          nextLifeRepairs > this.observedLifeboatRepairs ||
          (nextLifeActive && !this.observedLifeboatActive)
        ) {
          for (const mem of this.roomMemory.values()) {
            if (mem.room === 'Lifeboat Davit') mem.suspicion = Math.min(1, mem.suspicion + 0.55);
          }
        }
        this.observedLifeboatRepairs = nextLifeRepairs;
        this.observedLifeboatActive = nextLifeActive;
      }

      const seesSub =
        bruteRoom === 'Submarine Bay' ||
        canBruteSeePoint(
          brute,
          this.map.submarinePos.x,
          this.map.submarinePos.y,
          escapeSightRange,
          this.map,
          doorsByTile,
          senses.halfFovDeg
        );
      if (seesSub) {
        const nextSubRepairs = escape.submarineParts.length;
        const nextSubActive =
          escape.submarineState === 'ACTIVATING' || escape.submarineState === 'READY';
        if (nextSubRepairs > this.observedSubRepairs || (nextSubActive && !this.observedSubActive)) {
          for (const mem of this.roomMemory.values()) {
            if (mem.room === 'Submarine Bay') mem.suspicion = Math.min(1, mem.suspicion + 0.55);
          }
        }
        this.observedSubRepairs = nextSubRepairs;
        this.observedSubActive = nextSubActive;
      }
    }

    return events;
  }

  public reportDoorPeekBeam(
    door: Door,
    playerX: number,
    playerY: number,
    brute: BruteState,
    nowSec: number,
    difficulty: DifficultyConfig,
    tuning?: BruteTuningNumbers
  ): ClueDetectionEvent | null {
    if (nowSec < (this.doorPeekCooldowns.get(door.id) ?? 0)) {
      return null;
    }
    this.doorPeekCooldowns.set(door.id, nowSec + 10);

    const ts = this.map.tileSize;
    const doorX = (door.tx + 0.5) * ts;
    const doorY = (door.ty + 0.5) * ts;

    // Target the compartment on the player's side of the door (where the beam originated)
    const pTx = Math.max(0, Math.min(this.map.width - 1, Math.floor(playerX / ts)));
    const pTy = Math.max(0, Math.min(this.map.height - 1, Math.floor(playerY / ts)));
    const playerRoomId = this.map.roomIdGrid[pTy]?.[pTx] ?? 0;
    const playerRoom = this.map.roomGrid[pTy]?.[pTx] ?? 'Corridor';
    const sides = this.doorSides.get(door.id);

    let targetRoomId = playerRoomId;
    let targetRoom: RoomName = playerRoom;
    if (sides && sides.sideAId !== playerRoomId && sides.sideBId !== playerRoomId) {
      const far = this.pickFarRoomFromDoor(door, brute);
      targetRoomId = far.roomId;
      targetRoom = far.room;
    }

    this.triggerClueReaction(
      targetRoomId,
      targetRoom,
      doorX,
      doorY,
      'DOOR_PEEK_BEAM',
      nowSec,
      difficulty.intelligence,
      undefined,
      tuning
    );
    return {
      x: doorX,
      y: doorY,
      room: targetRoom,
      roomId: targetRoomId,
      reason: 'DOOR_PEEK_BEAM',
    };
  }

  private pickFarRoomFromDoor(
    door: Door,
    brute: BruteState
  ): { room: RoomName; roomId: number } {
    const sides = this.doorSides.get(door.id);
    if (!sides) {
      return {
        room: this.map.roomGrid[door.ty][door.tx],
        roomId: this.map.roomIdGrid[door.ty][door.tx],
      };
    }

    const bruteTx = Math.max(0, Math.min(this.map.width - 1, Math.floor(brute.x / this.map.tileSize)));
    const bruteTy = Math.max(0, Math.min(this.map.height - 1, Math.floor(brute.y / this.map.tileSize)));
    const bruteRoomId = this.map.roomIdGrid[bruteTy][bruteTx];

    if (sides.sideAId === bruteRoomId && sides.sideBId !== bruteRoomId) {
      return { room: sides.sideB, roomId: sides.sideBId };
    }
    if (sides.sideBId === bruteRoomId && sides.sideAId !== bruteRoomId) {
      return { room: sides.sideA, roomId: sides.sideAId };
    }

    if (sides.sideA !== 'Corridor' && sides.sideB === 'Corridor') {
      return { room: sides.sideA, roomId: sides.sideAId };
    }
    if (sides.sideB !== 'Corridor' && sides.sideA === 'Corridor') {
      return { room: sides.sideB, roomId: sides.sideBId };
    }
    return { room: sides.sideA, roomId: sides.sideAId };
  }

  private triggerClueReaction(
    primaryRoomId: number,
    primaryRoom: RoomName,
    clueX: number,
    clueY: number,
    reason: 'OPEN_DOOR' | 'CUT_LOCK' | 'LOOTED_CONTAINER' | 'LIGHT_LEFT_ON' | 'DOOR_PEEK_BEAM',
    nowSec: number,
    intelligence: DifficultyLevel,
    lightSwitch?: RoomLightSwitch,
    tuning?: BruteTuningNumbers
  ): void {
    this.evalTimer = 0;
    const primaryMem = this.roomMemory.get(primaryRoomId);
    if (primaryMem) {
      primaryMem.suspicion = Math.min(1, primaryMem.suspicion + 0.85);
      for (const adjId of primaryMem.connectedRoomIds) {
        const adjMem = this.roomMemory.get(adjId);
        if (adjMem) adjMem.suspicion = Math.min(1, adjMem.suspicion + 0.42);
      }
    }

    const maxRooms = Math.max(
      1,
      Math.round(
        tuning?.clueRoomDepth ??
          (intelligence === 'HIGH' || intelligence === 'EXTREME' ? 4 : intelligence === 'MEDIUM' ? 3 : 1)
      )
    );

    const nextRooms: Array<{ roomId: number; room: RoomName }> = [];
    if (primaryRoom !== 'Corridor' && primaryRoom !== 'Catwalk') {
      nextRooms.push({ roomId: primaryRoomId, room: primaryRoom });
    }

    const connectedIds = (primaryMem?.connectedRoomIds ?? []).filter((id) => {
      const m = this.roomMemory.get(id);
      return m && m.room !== 'Corridor' && m.room !== 'Catwalk' && id !== primaryRoomId;
    });
    connectedIds.sort((a, b) => {
      const ma = this.roomMemory.get(a);
      const mb = this.roomMemory.get(b);
      return (ma?.lastClearedAt ?? 0) - (mb?.lastClearedAt ?? 0);
    });
    for (const id of connectedIds) {
      if (nextRooms.length >= maxRooms) break;
      const m = this.roomMemory.get(id);
      if (m && !nextRooms.some((nr) => nr.roomId === id)) {
        nextRooms.push({ roomId: id, room: m.room });
      }
    }

    if (nextRooms.length < maxRooms) {
      const originX = primaryMem?.centerWorld.x ?? clueX;
      const originY = primaryMem?.centerWorld.y ?? clueY;
      const nearby = this.findNearestNamedRooms(originX, originY, maxRooms + 1);
      for (const nr of nearby) {
        if (nextRooms.length >= maxRooms) break;
        if (!nextRooms.some((x) => x.roomId === nr.roomId)) {
          nextRooms.push(nr);
        }
      }
    }

    if (reason === 'LIGHT_LEFT_ON' && lightSwitch) {
      this.stalkTarget = {
        x: lightSwitch.x,
        y: lightSwitch.y,
        room: lightSwitch.room,
        roomId: lightSwitch.roomId,
        reason: 'LIGHT_LEFT_ON',
        sweepHidingOnArrival: true,
        killSwitchId: lightSwitch.id,
      };
      this.stalkRoomQueue = nextRooms
        .filter((r) => r.roomId !== lightSwitch.roomId)
        .map((r) => ({ roomId: r.roomId, room: r.room, sweepHidingOnArrival: true }));
      return;
    }

    const stairScanRange = tuning?.stairPursuitRange ?? (intelligence === 'LOW' ? 56 : 110);
    const crossDeckEntries =
      stairScanRange >= 75 ? this.findCrossDeckStairEntries(clueX, clueY, 240) : [];

    if (primaryRoom === 'Corridor' || primaryRoom === 'Catwalk') {
      this.stalkTarget = {
        x: clueX,
        y: clueY,
        room: primaryRoom,
        roomId: primaryRoomId,
        reason,
        sweepHidingOnArrival: false,
      };
      this.stalkRoomQueue = [
        ...crossDeckEntries,
        ...nextRooms.map((r) => ({ roomId: r.roomId, room: r.room, sweepHidingOnArrival: true })),
      ].slice(0, maxRooms);
    } else {
      const targetSpot = this.pickRoomSweepPoint(primaryRoomId, nowSec);
      this.stalkTarget = {
        x: targetSpot.x,
        y: targetSpot.y,
        room: primaryRoom,
        roomId: primaryRoomId,
        reason,
        sweepHidingOnArrival: true,
      };
      this.stalkRoomQueue = [
        ...nextRooms
          .filter((r) => r.roomId !== primaryRoomId)
          .map((r) => ({ roomId: r.roomId, room: r.room, sweepHidingOnArrival: true })),
        ...crossDeckEntries,
      ].slice(0, maxRooms);
    }
  }

  public initiateChaseLossSweep(
    originX: number,
    originY: number,
    originRoomId: number,
    _nowSec: number,
    intelligence: DifficultyLevel,
    tuning?: BruteTuningNumbers
  ): void {
    const rawDepth =
      tuning?.clueRoomDepth ??
      (intelligence === 'HIGH' || intelligence === 'EXTREME' ? 4 : intelligence === 'MEDIUM' ? 3 : 1);
    const maxFollowups = Math.max(1, Math.round(rawDepth >= 4 ? 3 : rawDepth >= 2 ? 2 : 1));
    const primaryMem = this.roomMemory.get(originRoomId);
    const queue: StalkQueueEntry[] = [];
    const seenRoomIds = new Set<number>([originRoomId]);

    const stairScanRange = tuning?.stairPursuitRange ?? (intelligence === 'LOW' ? 56 : 110);
    if (stairScanRange >= 75) {
      const crossEntries = this.findCrossDeckStairEntries(originX, originY, 260);
      for (const ce of crossEntries) {
        if (queue.length >= maxFollowups) break;
        queue.push(ce);
        if (ce.room !== 'Corridor' && ce.room !== 'Catwalk') {
          seenRoomIds.add(ce.roomId);
        }
      }
    }

    const connectedIds = (primaryMem?.connectedRoomIds ?? []).filter((id) => {
      const m = this.roomMemory.get(id);
      return m && m.room !== 'Corridor' && m.room !== 'Catwalk' && !seenRoomIds.has(id);
    });
    for (const id of connectedIds) {
      if (queue.length >= maxFollowups) break;
      const m = this.roomMemory.get(id)!;
      seenRoomIds.add(id);
      queue.push({ roomId: id, room: m.room, sweepHidingOnArrival: true });
    }

    if (queue.length < maxFollowups) {
      const nearby = this.findNearestNamedRooms(originX, originY, maxFollowups + 2);
      for (const nr of nearby) {
        if (queue.length >= maxFollowups) break;
        if (!seenRoomIds.has(nr.roomId)) {
          seenRoomIds.add(nr.roomId);
          queue.push({ roomId: nr.roomId, room: nr.room, sweepHidingOnArrival: true });
        }
      }
    }

    for (const entry of queue) {
      const mem = this.roomMemory.get(entry.roomId);
      if (mem) mem.suspicion = Math.min(1, mem.suspicion + 0.7);
    }
    this.stalkRoomQueue = queue;
    this.stalkTarget = null;
  }

  private findCrossDeckStairEntries(
    wx: number,
    wy: number,
    maxRange: number
  ): StalkQueueEntry[] {
    const originDeck = this.getDeckAtWorld(wx, wy);
    const entries: Array<{ dist: number; entry: StalkQueueEntry }> = [];

    for (const st of this.map.stairwells) {
      if (st.deck !== originDeck) continue;
      const d = Math.hypot(st.x - wx, st.y - wy);
      if (d > maxRange) continue;
      const dest = this.map.stairwells.find((s) => s.id === st.targetStairId);
      if (!dest) continue;
      entries.push({
        dist: d,
        entry: {
          roomId: dest.roomId,
          room: dest.room,
          x: dest.x,
          y: dest.y,
          sweepHidingOnArrival: true,
        },
      });
    }

    entries.sort((a, b) => a.dist - b.dist);
    return entries.map((e) => e.entry);
  }

  private findNearestNamedRooms(
    wx: number,
    wy: number,
    count: number
  ): Array<{ roomId: number; room: RoomName }> {
    const originDeck = this.getDeckAtWorld(wx, wy);
    const originDeckIdx = getDeckIndex(originDeck);
    const nearStair = this.map.stairwells.some(
      (s) => s.deck === originDeck && Math.hypot(s.x - wx, s.y - wy) <= 240
    );
    const deckPenalty = nearStair ? 260 : 750;

    return Array.from(this.roomMemory.values())
      .filter((m) => m.room !== 'Corridor' && m.room !== 'Catwalk')
      .sort((a, b) => {
        const da =
          Math.hypot(a.centerWorld.x - wx, a.centerWorld.y - wy) +
          Math.abs(getDeckIndex(a.deck) - originDeckIdx) * deckPenalty;
        const db =
          Math.hypot(b.centerWorld.x - wx, b.centerWorld.y - wy) +
          Math.abs(getDeckIndex(b.deck) - originDeckIdx) * deckPenalty;
        return da - db;
      })
      .slice(0, count)
      .map((m) => ({ roomId: m.roomId, room: m.room }));
  }

  public pickRoomSweepPoint(roomId: number, _nowSec: number): { x: number; y: number } {
    const mem = this.roomMemory.get(roomId);
    if (!mem || mem.walkableTiles.length === 0) {
      return { x: this.map.playerSpawn.x, y: this.map.playerSpawn.y };
    }
    const tile = mem.walkableTiles[Math.floor(Math.random() * mem.walkableTiles.length)];
    return {
      x: (tile.tx + 0.5) * this.map.tileSize,
      y: (tile.ty + 0.5) * this.map.tileSize,
    };
  }

  public advanceStalkQueue(nowSec: number): boolean {
    if (this.stalkRoomQueue.length === 0) {
      this.stalkTarget = null;
      return false;
    }
    const nextEntry = this.stalkRoomQueue.shift()!;
    const pt =
      nextEntry.x !== undefined && nextEntry.y !== undefined
        ? { x: nextEntry.x, y: nextEntry.y }
        : this.pickRoomSweepPoint(nextEntry.roomId, nowSec);
    this.stalkTarget = {
      x: pt.x,
      y: pt.y,
      room: nextEntry.room,
      roomId: nextEntry.roomId,
      reason: 'CONNECTED_SWEEP',
      sweepHidingOnArrival: nextEntry.sweepHidingOnArrival ?? true,
    };
    return true;
  }

  /**
   * Recency-weighted random patrol picker with sight-based escape-route patrol bias across all 3 decks.
   */
  public pickRecencyWeightedRoamTarget(nowSec: number): {
    tx: number;
    ty: number;
    room: RoomName;
    roomId: number;
  } {
    const rooms = Array.from(this.roomMemory.values()).filter((m) => m.walkableTiles.length > 0);
    if (rooms.length === 0) {
      return { tx: 10, ty: 16, room: 'Corridor', roomId: 0 };
    }

    const heliRepairs = this.observedHeliRepairs;
    const heliActive = this.observedHeliActive ? 1.1 : 0;
    const lifeRepairs = this.observedLifeboatRepairs;
    const lifeActive = this.observedLifeboatActive ? 1.1 : 0;
    const subRepairs = this.observedSubRepairs;
    const subActive = this.observedSubActive ? 1.15 : 0;

    let totalWeight = 0;
    const weights = rooms.map((m) => {
      const age = Math.max(0, nowSec - m.lastClearedAt);
      const recencyFactor = Math.min(2.6, Math.max(0.15, age / 42));
      const roomBias = m.room === 'Corridor' || m.room === 'Catwalk' ? 0.52 : 1.18;
      const suspicionBoost = 1 + m.suspicion * 1.4;

      let escapeBias = 1.0;
      if (m.room === 'Helideck') {
        escapeBias = 1.25 + heliRepairs * 0.5 + heliActive;
      } else if (m.room === 'Lifeboat Davit') {
        escapeBias = 1.25 + lifeRepairs * 0.5 + lifeActive;
      } else if (m.room === 'Submarine Bay') {
        escapeBias = 1.25 + subRepairs * 0.5 + subActive;
      }

      const w = recencyFactor * roomBias * suspicionBoost * escapeBias;
      totalWeight += w;
      return w;
    });

    let roll = Math.random() * totalWeight;
    let chosen = rooms[0];
    for (let i = 0; i < rooms.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        chosen = rooms[i];
        break;
      }
    }

    const tile = chosen.walkableTiles[Math.floor(Math.random() * chosen.walkableTiles.length)];
    return { tx: tile.tx, ty: tile.ty, room: chosen.room, roomId: chosen.roomId };
  }

  public evaluateUtilityGoal(
    dt: number,
    brute: BruteState,
    player: PlayerState,
    doorsByTile: Map<number, Door>,
    difficulty: DifficultyConfig,
    tuning?: BruteTuningNumbers,
    poweredDecks?: Record<ShipDeck, boolean>
  ): UtilityGoal {
    if (brute.state === 'STUNNED') {
      this.activeGoal = 'UNLEASHED_ROAM';
      return 'UNLEASHED_ROAM';
    }

    if (brute.state === 'SMASH_DOOR') {
      this.activeGoal = 'SMASH_DOOR';
      return 'SMASH_DOOR';
    }

    const seesPlayer = canBruteSeePlayer(brute, player, this.map, doorsByTile, difficulty, tuning, poweredDecks);
    if (seesPlayer) {
      this.activeGoal = 'PURSUIT';
      return 'PURSUIT';
    }

    if (brute.watchedPlayerHideSpotId !== null) {
      this.activeGoal = 'CHECK_HIDING';
      return 'CHECK_HIDING';
    }

    if (
      brute.state === 'CHASE' ||
      brute.lastKnownPlayerPos !== null ||
      brute.chaseOvershootPos !== null ||
      brute.pursuitStairId !== null
    ) {
      this.activeGoal = 'PURSUIT';
      return 'PURSUIT';
    }

    this.evalTimer -= dt;
    if (this.evalTimer > 0) {
      return this.activeGoal;
    }
    this.evalTimer = 0.12;

    const hyst = 0.06;

    const scores: Record<UtilityGoal, number> = {
      PURSUIT: brute.lastKnownPlayerPos || brute.chaseOvershootPos ? 0.92 : 0,
      SMASH_DOOR: 0,
      CHECK_HIDING:
        brute.currentInspectSpotId || brute.searchSpotsQueue.length > 0
          ? 0.8 + (this.activeGoal === 'CHECK_HIDING' ? hyst : 0)
          : 0,
      STALK_CLUE:
        this.stalkTarget || this.stalkRoomQueue.length > 0
          ? 0.72 + (this.activeGoal === 'STALK_CLUE' ? hyst : 0)
          : 0,
      INVESTIGATE_NOISE: brute.investigateTarget
        ? 0.52 + brute.investigateTarget.urgency * 0.34 + (this.activeGoal === 'INVESTIGATE_NOISE' ? hyst : 0)
        : 0,
      UNLEASHED_ROAM: 0.25 + (this.activeGoal === 'UNLEASHED_ROAM' ? hyst : 0),
    };

    let bestGoal: UtilityGoal = 'UNLEASHED_ROAM';
    let bestScore = -1;
    for (const [goal, score] of Object.entries(scores) as Array<[UtilityGoal, number]>) {
      if (score > bestScore) {
        bestScore = score;
        bestGoal = goal;
      }
    }

    this.activeGoal = bestGoal;
    return bestGoal;
  }

  public getDebugRoomCount(): number {
    return this.roomMemory.size;
  }
}
