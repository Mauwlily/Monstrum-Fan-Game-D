import { isTileWalkable } from './mapGen';
import {
  BruteState,
  BruteTuningNumbers,
  DifficultyConfig,
  DifficultyLevel,
  Door,
  EscapeProgress,
  PlayerState,
  RoomLightSwitch,
  RoomName,
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
  room: RoomName;
  lastVisitedAt: number;
  lastClearedAt: number;
  suspicion: number;
  connectedRooms: RoomName[];
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
  reason:
    | 'OPEN_DOOR'
    | 'CUT_LOCK'
    | 'LOOTED_CONTAINER'
    | 'LIGHT_LEFT_ON'
    | 'CONNECTED_SWEEP';
  sweepHidingOnArrival: boolean;
  killSwitchId?: string;
}

export interface ClueDetectionEvent {
  x: number;
  y: number;
  room: RoomName;
  reason: 'OPEN_DOOR' | 'CUT_LOCK' | 'LOOTED_CONTAINER' | 'LIGHT_LEFT_ON';
}

export interface StalkQueueEntry {
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
  public roomMemory: Map<RoomName, RoomMemory> = new Map();
  public doorSides: Map<string, { sideA: RoomName; sideB: RoomName }> = new Map();

  public activeGoal: UtilityGoal = 'UNLEASHED_ROAM';
  public stalkTarget: StalkTarget | null = null;
  public stalkRoomQueue: StalkQueueEntry[] = [];

  // Sight-observed escape progress (Brute only biases patrol routes after visually seeing repairs/activation)
  public observedHeliRepairs = 0;
  public observedHeliActive = false;
  public observedLifeboatRepairs = 0;
  public observedLifeboatActive = false;

  private map: ShipMap;
  private recentlyCheckedSpots: Map<string, number> = new Map();
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

    // Build per-room walkable tile buckets and adjacency graph
    const tilesByRoom = new Map<RoomName, Array<{ tx: number; ty: number }>>();
    const adjacency = new Map<RoomName, Set<RoomName>>();

    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        if (!isTileWalkable(this.map.tiles[y][x])) continue;
        const r = this.map.roomGrid[y][x];
        if (!tilesByRoom.has(r)) tilesByRoom.set(r, []);
        tilesByRoom.get(r)!.push({ tx: x, ty: y });

        if (!adjacency.has(r)) adjacency.set(r, new Set());
        const neighbors = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= this.map.width || ny < 0 || ny >= this.map.height) continue;
          if (!isTileWalkable(this.map.tiles[ny][nx])) continue;
          const nr = this.map.roomGrid[ny][nx];
          if (nr !== r) {
            adjacency.get(r)!.add(nr);
          }
        }
      }
    }

    // Link stairwells across MAIN <-> LOWER decks in room adjacency graph
    for (const st of this.map.stairwells) {
      if (!adjacency.has(st.room)) adjacency.set(st.room, new Set());
      if (!adjacency.has(st.targetRoom)) adjacency.set(st.targetRoom, new Set());
      if (st.room !== st.targetRoom) {
        adjacency.get(st.room)!.add(st.targetRoom);
        adjacency.get(st.targetRoom)!.add(st.room);
      }
    }

    for (const [room, tiles] of tilesByRoom.entries()) {
      let sx = 0;
      let sy = 0;
      for (const t of tiles) {
        sx += (t.tx + 0.5) * this.map.tileSize;
        sy += (t.ty + 0.5) * this.map.tileSize;
      }
      this.roomMemory.set(room, {
        room,
        lastVisitedAt: -30,
        lastClearedAt: -30,
        suspicion: 0,
        connectedRooms: Array.from(adjacency.get(room) ?? []),
        walkableTiles: tiles,
        centerWorld: {
          x: sx / Math.max(1, tiles.length),
          y: sy / Math.max(1, tiles.length),
        },
      });
    }
  }

  private resolveDoorSides(door: Door): { sideA: RoomName; sideB: RoomName } {
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
    for (const [dx, dy] of dirs) {
      const nx = door.tx + dx;
      const ny = door.ty + dy;
      if (nx >= 0 && nx < this.map.width && ny >= 0 && ny < this.map.height) {
        rooms.push(this.map.roomGrid[ny][nx]);
      }
    }
    return {
      sideA: rooms[0] ?? 'Corridor',
      sideB: rooms[1] ?? 'Corridor',
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

  public markRoomVisited(room: RoomName, nowSec: number): void {
    const mem = this.roomMemory.get(room);
    if (!mem) return;
    mem.lastVisitedAt = nowSec;
  }

  public markRoomCleared(room: RoomName, nowSec: number): void {
    const mem = this.roomMemory.get(room);
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

  public getRoomUncheckedSpots(
    room: RoomName,
    refX: number,
    refY: number,
    nowSec: number,
    intelligence: DifficultyLevel,
    tuning?: BruteTuningNumbers
  ): string[] {
    const deckSplitY = 29 * this.map.tileSize;
    const onLower = refY > deckSplitY;

    let candidates = this.map.hidingSpots.filter((s) => {
      if ((this.recentlyCheckedSpots.get(s.id) ?? -1) > nowSec) return false;
      if (room !== 'Corridor' && room !== 'Catwalk') {
        return s.room === room;
      }
      const spotLower = s.y > deckSplitY;
      return spotLower === onLower && Math.hypot(s.x - refX, s.y - refY) <= 230;
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
    // HIGH intelligence sweeps 100% of unchecked hiding spots in the suspect room!
    return candidates.map((s) => s.id);
  }

  /**
   * Checks doors and containers inside the Brute's real raycasted FoV.
   * Returns newly discovered ClueDetectionEvents (if any).
   */
  public perceiveClues(
    dt: number,
    nowSec: number,
    brute: BruteState,
    doorsByTile: Map<number, Door>,
    difficulty: DifficultyConfig,
    tuning?: BruteTuningNumbers,
    escape?: EscapeProgress
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
          const farRoom = this.pickFarRoomFromDoor(door, brute);
          const reason = lockTampered ? 'CUT_LOCK' : 'OPEN_DOOR';
          this.triggerClueReaction(
            farRoom,
            doorX,
            doorY,
            reason,
            nowSec,
            difficulty.intelligence,
            undefined,
            tuning
          );
          events.push({ x: doorX, y: doorY, room: farRoom, reason });
        }
      } else {
        // Sync normal expected state (e.g. player closed a door behind them, or door already observed)
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
          cont.room,
          cont.x,
          cont.y,
          'LOOTED_CONTAINER',
          nowSec,
          difficulty.intelligence,
          undefined,
          tuning
        );
        events.push({ x: cont.x, y: cont.y, room: cont.room, reason: 'LOOTED_CONTAINER' });
      }
    }

    // 3. Check Room Light Switches left ON unexpectedly!
    const bTx = Math.max(0, Math.min(this.map.width - 1, Math.floor(brute.x / this.map.tileSize)));
    const bTy = Math.max(0, Math.min(this.map.height - 1, Math.floor(brute.y / this.map.tileSize)));
    const bruteRoom = this.map.roomGrid[bTy][bTx];
    const lightSightRange = 485 * senses.sightMult;

    for (const sw of this.map.lightSwitches) {
      const memOn = this.rememberedLights.get(sw.id) ?? false;
      if (!sw.isOn) {
        this.rememberedLights.set(sw.id, false);
        continue;
      }
      if (memOn) continue;
      if (nowSec < (this.lightCooldowns.get(sw.id) ?? 0)) continue;

      const roomMem = this.roomMemory.get(sw.room);
      const seesLight =
        bruteRoom === sw.room ||
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
        this.lightCooldowns.set(sw.id, nowSec + 18);
        this.triggerClueReaction(
          sw.room,
          sw.x,
          sw.y,
          'LIGHT_LEFT_ON',
          nowSec,
          difficulty.intelligence,
          sw,
          tuning
        );
        events.push({ x: sw.x, y: sw.y, room: sw.room, reason: 'LIGHT_LEFT_ON' });
      }
    }

    // 4. Sight-based Escape Craft inspection: only learn repairs/activation when in real LoS!
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
          const heliMem = this.roomMemory.get('Helideck');
          if (heliMem) heliMem.suspicion = Math.min(1, heliMem.suspicion + 0.55);
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
          const lifeMem = this.roomMemory.get('Lifeboat Davit');
          if (lifeMem) lifeMem.suspicion = Math.min(1, lifeMem.suspicion + 0.55);
        }
        this.observedLifeboatRepairs = nextLifeRepairs;
        this.observedLifeboatActive = nextLifeActive;
      }
    }

    return events;
  }

  private pickFarRoomFromDoor(door: Door, brute: BruteState): RoomName {
    const sides = this.doorSides.get(door.id);
    if (!sides) return this.map.roomGrid[door.ty][door.tx];

    const bruteTx = Math.max(0, Math.min(this.map.width - 1, Math.floor(brute.x / this.map.tileSize)));
    const bruteTy = Math.max(0, Math.min(this.map.height - 1, Math.floor(brute.y / this.map.tileSize)));
    const bruteRoom = this.map.roomGrid[bruteTy][bruteTx];

    if (sides.sideA === bruteRoom && sides.sideB !== bruteRoom) return sides.sideB;
    if (sides.sideB === bruteRoom && sides.sideA !== bruteRoom) return sides.sideA;

    // Prefer named compartment over generic Corridor
    if (sides.sideA !== 'Corridor' && sides.sideB === 'Corridor') return sides.sideA;
    if (sides.sideB !== 'Corridor' && sides.sideA === 'Corridor') return sides.sideB;
    return sides.sideA;
  }

  private triggerClueReaction(
    primaryRoom: RoomName,
    clueX: number,
    clueY: number,
    reason: 'OPEN_DOOR' | 'CUT_LOCK' | 'LOOTED_CONTAINER' | 'LIGHT_LEFT_ON',
    nowSec: number,
    intelligence: DifficultyLevel,
    lightSwitch?: RoomLightSwitch,
    tuning?: BruteTuningNumbers
  ): void {
    const primaryMem = this.roomMemory.get(primaryRoom);
    if (primaryMem) {
      primaryMem.suspicion = Math.min(1, primaryMem.suspicion + 0.85);
      for (const adj of primaryMem.connectedRooms) {
        const adjMem = this.roomMemory.get(adj);
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

    // Build connected-room sweep trail: primary room first, then adjacent connected named rooms
    const nextRooms: RoomName[] = [];
    if (primaryRoom !== 'Corridor' && primaryRoom !== 'Catwalk') {
      nextRooms.push(primaryRoom);
    }

    const connected = (primaryMem?.connectedRooms ?? []).filter(
      (r) => r !== 'Corridor' && r !== 'Catwalk' && r !== primaryRoom
    );
    connected.sort((a, b) => {
      const ma = this.roomMemory.get(a);
      const mb = this.roomMemory.get(b);
      return (ma?.lastClearedAt ?? 0) - (mb?.lastClearedAt ?? 0);
    });
    for (const r of connected) {
      if (nextRooms.length >= maxRooms) break;
      if (!nextRooms.includes(r)) nextRooms.push(r);
    }

    if (nextRooms.length < maxRooms) {
      const originX = primaryMem?.centerWorld.x ?? clueX;
      const originY = primaryMem?.centerWorld.y ?? clueY;
      const nearby = this.findNearestNamedRooms(originX, originY, maxRooms + 1);
      for (const r of nearby) {
        if (nextRooms.length >= maxRooms) break;
        if (!nextRooms.includes(r)) nextRooms.push(r);
      }
    }

    // If a room light was left ON, march directly to the breaker switch to kill it first!
    if (reason === 'LIGHT_LEFT_ON' && lightSwitch) {
      this.stalkTarget = {
        x: lightSwitch.x,
        y: lightSwitch.y,
        room: lightSwitch.room,
        reason: 'LIGHT_LEFT_ON',
        sweepHidingOnArrival: true,
        killSwitchId: lightSwitch.id,
      };
      this.stalkRoomQueue = nextRooms
        .filter((r) => r !== lightSwitch.room)
        .map((room) => ({ room, sweepHidingOnArrival: true }));
      return;
    }

    const stairScanRange = tuning?.stairPursuitRange ?? (intelligence === 'LOW' ? 56 : 110);
    const crossDeckEntries =
      stairScanRange >= 75 ? this.findCrossDeckStairEntries(clueX, clueY, 240) : [];

    // Set immediate Stalker target & queue connected rooms
    if (primaryRoom === 'Corridor' || primaryRoom === 'Catwalk') {
      this.stalkTarget = {
        x: clueX,
        y: clueY,
        room: primaryRoom,
        reason,
        sweepHidingOnArrival: false,
      };
      this.stalkRoomQueue = [
        ...crossDeckEntries,
        ...nextRooms.map((room) => ({ room, sweepHidingOnArrival: true })),
      ].slice(0, maxRooms);
    } else {
      const targetSpot = this.pickRoomSweepPoint(primaryRoom, nowSec);
      this.stalkTarget = {
        x: targetSpot.x,
        y: targetSpot.y,
        room: primaryRoom,
        reason,
        sweepHidingOnArrival: true,
      };
      this.stalkRoomQueue = [
        ...nextRooms
          .filter((r) => r !== primaryRoom)
          .map((room) => ({ room, sweepHidingOnArrival: true })),
        ...crossDeckEntries,
      ].slice(0, maxRooms);
    }
  }

  /**
   * Queues an aggressive multi-room follow-up sweep after breaking line of sight and finishing
   * momentum overshoot, driven strictly by observed arrival topology (zero player cheats).
   */
  public initiateChaseLossSweep(
    originX: number,
    originY: number,
    originRoom: RoomName,
    _nowSec: number,
    intelligence: DifficultyLevel,
    tuning?: BruteTuningNumbers
  ): void {
    const rawDepth =
      tuning?.clueRoomDepth ??
      (intelligence === 'HIGH' || intelligence === 'EXTREME' ? 4 : intelligence === 'MEDIUM' ? 3 : 1);
    const maxFollowups = Math.max(1, Math.round(rawDepth >= 4 ? 3 : rawDepth >= 2 ? 2 : 1));
    const primaryMem = this.roomMemory.get(originRoom);
    const queue: StalkQueueEntry[] = [];
    const seenRooms = new Set<RoomName>([originRoom]);

    // Check if sight broke near a companionway — queue the opposite-deck landing & adjacent room!
    const stairScanRange = tuning?.stairPursuitRange ?? (intelligence === 'LOW' ? 56 : 110);
    if (stairScanRange >= 75) {
      const crossEntries = this.findCrossDeckStairEntries(originX, originY, 260);
      for (const ce of crossEntries) {
        if (queue.length >= maxFollowups) break;
        queue.push(ce);
        if (ce.room !== 'Corridor' && ce.room !== 'Catwalk') {
          seenRooms.add(ce.room);
        }
      }
    }

    const connected = (primaryMem?.connectedRooms ?? []).filter(
      (r) => r !== 'Corridor' && r !== 'Catwalk' && !seenRooms.has(r)
    );
    for (const r of connected) {
      if (queue.length >= maxFollowups) break;
      seenRooms.add(r);
      queue.push({ room: r, sweepHidingOnArrival: true });
    }

    if (queue.length < maxFollowups) {
      const nearby = this.findNearestNamedRooms(originX, originY, maxFollowups + 2);
      for (const r of nearby) {
        if (queue.length >= maxFollowups) break;
        if (!seenRooms.has(r)) {
          seenRooms.add(r);
          queue.push({ room: r, sweepHidingOnArrival: true });
        }
      }
    }

    for (const entry of queue) {
      const mem = this.roomMemory.get(entry.room);
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
    const deckSplitY = 29 * this.map.tileSize;
    const originDeck = wy > deckSplitY ? 'LOWER' : 'MAIN';
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

  private findNearestNamedRooms(wx: number, wy: number, count: number): RoomName[] {
    const deckSplitY = 29 * this.map.tileSize;
    const originLower = wy > deckSplitY;
    const nearStair = this.map.stairwells.some(
      (s) => (s.deck === 'LOWER') === originLower && Math.hypot(s.x - wx, s.y - wy) <= 240
    );
    const deckPenalty = nearStair ? 260 : 750;

    return Array.from(this.roomMemory.values())
      .filter((m) => m.room !== 'Corridor' && m.room !== 'Catwalk')
      .sort((a, b) => {
        const da =
          Math.hypot(a.centerWorld.x - wx, a.centerWorld.y - wy) +
          ((a.centerWorld.y > deckSplitY) !== originLower ? deckPenalty : 0);
        const db =
          Math.hypot(b.centerWorld.x - wx, b.centerWorld.y - wy) +
          ((b.centerWorld.y > deckSplitY) !== originLower ? deckPenalty : 0);
        return da - db;
      })
      .slice(0, count)
      .map((m) => m.room);
  }

  public pickRoomSweepPoint(room: RoomName, _nowSec: number): { x: number; y: number } {
    const mem = this.roomMemory.get(room);
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
        : this.pickRoomSweepPoint(nextEntry.room, nowSec);
    this.stalkTarget = {
      x: pt.x,
      y: pt.y,
      room: nextEntry.room,
      reason: 'CONNECTED_SWEEP',
      sweepHidingOnArrival: nextEntry.sweepHidingOnArrival ?? true,
    };
    return true;
  }

  /**
   * Recency-weighted UN-LEASHED random patrol picker with sight-based escape-route patrol bias.
   * Zero reference to player position or unseen repairs — only biases toward Helideck & Lifeboat Davit
   * based on progress the Brute has actually spotted in person.
   */
  public pickRecencyWeightedRoamTarget(nowSec: number): {
    tx: number;
    ty: number;
    room: RoomName;
  } {
    const rooms = Array.from(this.roomMemory.values()).filter((m) => m.walkableTiles.length > 0);
    if (rooms.length === 0) {
      return { tx: 10, ty: 16, room: 'Corridor' };
    }

    const heliRepairs = this.observedHeliRepairs;
    const heliActive = this.observedHeliActive ? 1.1 : 0;
    const lifeRepairs = this.observedLifeboatRepairs;
    const lifeActive = this.observedLifeboatActive ? 1.1 : 0;

    let totalWeight = 0;
    const weights = rooms.map((m) => {
      const age = Math.max(0, nowSec - m.lastClearedAt);
      // Named compartments & container bays get richer exploration weight than generic corridors,
      // and recently cleared rooms drop to 0.15x so he naturally covers the whole vessel.
      const recencyFactor = Math.min(2.6, Math.max(0.15, age / 38));
      const roomBias = m.room === 'Corridor' || m.room === 'Catwalk' ? 0.55 : 1.15;
      const suspicionBoost = 1 + m.suspicion * 1.4;

      // Subtle baseline escape-route interest that scales noticeably as each route is visually observed repaired/activated
      let escapeBias = 1.0;
      if (m.room === 'Helideck') {
        escapeBias = 1.25 + heliRepairs * 0.5 + heliActive;
      } else if (m.room === 'Lifeboat Davit') {
        escapeBias = 1.25 + lifeRepairs * 0.5 + lifeActive;
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
    return { tx: tile.tx, ty: tile.ty, room: chosen.room };
  }

  /**
   * Continuous Utility AI Scorer with hysteresis.
   */
  public evaluateUtilityGoal(
    dt: number,
    brute: BruteState,
    player: PlayerState,
    doorsByTile: Map<number, Door>,
    difficulty: DifficultyConfig,
    tuning?: BruteTuningNumbers
  ): UtilityGoal {
    if (brute.state === 'STUNNED') {
      this.activeGoal = 'UNLEASHED_ROAM';
      return 'UNLEASHED_ROAM';
    }

    if (brute.state === 'SMASH_DOOR') {
      this.activeGoal = 'SMASH_DOOR';
      return 'SMASH_DOOR';
    }

    const seesPlayer = canBruteSeePlayer(brute, player, this.map, doorsByTile, difficulty, tuning);
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
