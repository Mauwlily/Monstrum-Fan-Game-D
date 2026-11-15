import type { MonstrumGameEngine } from './engine';
import { isTileWalkable } from './mapGen';
import { DebugScenarioId, Door, HidingSpot, RoomLightSwitch, RoomName } from './types';
import { hasLineOfSight } from './visibility';

export interface DebugScenarioMetadata {
  id: DebugScenarioId;
  label: string;
  description: string;
  probePoints: Array<{ x: number; y: number; label: string }>;
}

export const DEBUG_SCENARIOS: Array<{ id: DebugScenarioId; label: string; summary: string }> = [
  {
    id: 'WALL_OCCLUSION',
    label: 'Wall Occlusion',
    summary: 'Player aims flashlight across bulkhead wall & corner; Brute stands behind wall.',
  },
  {
    id: 'LIT_ROOM_DOOR_SPILL',
    label: 'Lit Room Spill',
    summary: 'Room light ON with door OPEN; warm spill cone pours into dark corridor.',
  },
  {
    id: 'LIT_ROOM_CLOSED_DOOR',
    label: 'Lit Room Closed',
    summary: 'Room light ON behind closed door & wall; interior must stay #000000.',
  },
  {
    id: 'HIDING_FLASHLIGHT_PEEK',
    label: 'Hide & Peek',
    summary: 'Player enters hiding spot (flashlight OFF); Q-peek toggles light ON/OFF.',
  },
  {
    id: 'BRUTE_HIDING_KILL',
    label: 'Brute Hide Kill',
    summary: 'Brute watches player hide, charges spot, and executes rip-open kill.',
  },
  {
    id: 'DOOR_KEYHOLE_AND_FLARE',
    label: 'Keyhole & Flare',
    summary: 'Closed-door keyhole peek into room with raycasted flare shadows & Brute.',
  },
  {
    id: 'BRUTE_BEAM_CORNER',
    label: 'Brute Beam',
    summary: 'Brute aims orange searchlight past an open corner; beam spills into view, blocked by walls.',
  },
  {
    id: 'STAIR_BRUTE_GLOW',
    label: 'Stair Glow',
    summary: 'Brute climbs toward enlarged companionway hatch; stairwell pulses bright orange.',
  },
  {
    id: 'FLICKER_AND_SURVIVOR',
    label: 'Survivor & Flicker',
    summary: 'Remade maritime crew survivor mid-stride inside a flickering lit compartment.',
  },
];

function tileCenter(tx: number, ty: number, ts: number): { x: number; y: number } {
  return { x: (tx + 0.5) * ts, y: (ty + 0.5) * ts };
}

function findWallSeparatedPair(engine: MonstrumGameEngine): {
  playerPos: { x: number; y: number };
  brutePos: { x: number; y: number };
  aimAngle: number;
  probes: Array<{ x: number; y: number; label: string }>;
} {
  const { map } = engine;
  const ts = map.tileSize;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let ty = 8; ty < map.height - 8; ty++) {
    for (let tx = 8; tx < map.width - 8; tx++) {
      if (!isTileWalkable(map.tiles[ty][tx])) continue;
      if (engine.doorsByTile.has(ty * map.width + tx)) continue;
      for (const [dx, dy] of dirs) {
        const wx = tx + dx;
        const wy = ty + dy;
        const fx = tx + dx * 2;
        const fy = ty + dy * 2;
        if (map.tiles[wy]?.[wx] !== 'WALL') continue;
        if (!isTileWalkable(map.tiles[fy]?.[fx] ?? 'VOID')) continue;

        // Require bulkhead to span at least 1 neighbor on each perpendicular side so sight cannot slip past a pillar
        const px = -dy;
        const py = dx;
        if (
          map.tiles[wy + py]?.[wx + px] !== 'WALL' ||
          map.tiles[wy - py]?.[wx - px] !== 'WALL'
        ) {
          continue;
        }

        // Player tile has 1 tile of clearance behind it so flashlight fans cleanly
        const bx = tx - dx;
        const by = ty - dy;
        if (!isTileWalkable(map.tiles[by]?.[bx] ?? 'VOID')) continue;

        const p = tileCenter(tx, ty, ts);
        const b = tileCenter(fx, fy, ts);
        if (hasLineOfSight(map, engine.doorsByTile, p.x, p.y, b.x, b.y)) continue;

        const aimAngle = Math.atan2(dy, dx);
        return {
          playerPos: p,
          brutePos: b,
          aimAngle,
          probes: [
            { x: b.x, y: b.y, label: 'Behind Bulkhead' },
            { x: (wx + 0.5) * ts, y: (wy + 0.5) * ts, label: 'Inside Wall Tile' },
          ],
        };
      }
    }
  }

  return {
    playerPos: { x: map.playerSpawn.x, y: map.playerSpawn.y },
    brutePos: { x: map.bruteSpawn.x, y: map.bruteSpawn.y },
    aimAngle: 0,
    probes: [],
  };
}

function isRoomSealedByDoors(engine: MonstrumGameEngine, room: RoomName): boolean {
  const { map } = engine;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      if (map.roomGrid[y][x] !== room || !isTileWalkable(map.tiles[y][x])) continue;
      if (engine.doorsByTile.has(y * map.width + x)) continue;
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (!isTileWalkable(map.tiles[ny][nx])) continue;
        if (map.roomGrid[ny][nx] !== room && !engine.doorsByTile.has(ny * map.width + nx)) {
          return false;
        }
      }
    }
  }
  return true;
}

function findSwitchDoorPair(engine: MonstrumGameEngine): {
  sw: RoomLightSwitch;
  door: Door;
  corridorStand: { x: number; y: number };
  corridorOffsetStand: { x: number; y: number };
  roomInterior: { x: number; y: number };
  roomWallAdjacent: { x: number; y: number };
  aimIntoDoor: number;
} | null {
  const { map } = engine;
  const ts = map.tileSize;

  // Prefer rooms that are completely enclosed by walls & doors so closed-door scenarios have zero open gaps
  const switches = [...map.lightSwitches].sort((a, b) => {
    const aSealed = isRoomSealedByDoors(engine, a.room) ? 0 : 1;
    const bSealed = isRoomSealedByDoors(engine, b.room) ? 0 : 1;
    return aSealed - bSealed;
  });

  for (const sw of switches) {
    for (const d of map.doors) {
      if (d.isBroken) continue;
      const sides =
        d.orientation === 'H'
          ? [
              { tx: d.tx, ty: d.ty - 1 },
              { tx: d.tx, ty: d.ty + 1 },
            ]
          : [
              { tx: d.tx - 1, ty: d.ty },
              { tx: d.tx + 1, ty: d.ty },
            ];

      const inRoom = sides.find(
        (s) => isTileWalkable(map.tiles[s.ty]?.[s.tx] ?? 'VOID') && map.roomGrid[s.ty][s.tx] === sw.room
      );
      const outRoom = sides.find(
        (s) => isTileWalkable(map.tiles[s.ty]?.[s.tx] ?? 'VOID') && map.roomGrid[s.ty][s.tx] !== sw.room
      );
      if (!inRoom || !outRoom) continue;

      const outDx = outRoom.tx - d.tx;
      const outDy = outRoom.ty - d.ty;
      const step2Tx = outRoom.tx + outDx;
      const step2Ty = outRoom.ty + outDy;
      const standTx = isTileWalkable(map.tiles[step2Ty]?.[step2Tx] ?? 'VOID') ? step2Tx : outRoom.tx;
      const standTy = isTileWalkable(map.tiles[step2Ty]?.[step2Tx] ?? 'VOID') ? step2Ty : outRoom.ty;

      // Try lateral offset in corridor so player stands slightly to the side of the doorway behind wall
      const perp = d.orientation === 'H' ? [1, 0] : [0, 1];
      let offsetTx = standTx;
      let offsetTy = standTy;
      for (const sign of [1, -1]) {
        const cx = standTx + perp[0] * sign;
        const cy = standTy + perp[1] * sign;
        if (isTileWalkable(map.tiles[cy]?.[cx] ?? 'VOID')) {
          offsetTx = cx;
          offsetTy = cy;
          break;
        }
      }

      const dcx = (d.tx + 0.5) * ts;
      const dcy = (d.ty + 0.5) * ts;
      const standPt = tileCenter(standTx, standTy, ts);
      const offPt = tileCenter(offsetTx, offsetTy, ts);

      // Find a nearby walkable tile inside sw.room occluded from offsetStand by a wall (guaranteed on-screen)
      let hiddenRoomPt = tileCenter(inRoom.tx, inRoom.ty, ts);
      let bestHiddenScore = Infinity;
      for (let ry = 0; ry < map.height; ry++) {
        for (let rx = 0; rx < map.width; rx++) {
          if (map.roomGrid[ry][rx] !== sw.room || !isTileWalkable(map.tiles[ry][rx])) continue;
          const distFromDoor = Math.hypot(rx - d.tx, ry - d.ty);
          if (distFromDoor < 1.8 || distFromDoor > 6.5) continue;
          const pt = tileCenter(rx, ry, ts);
          const occludedFromOffset = !hasLineOfSight(map, engine.doorsByTile, offPt.x, offPt.y, pt.x, pt.y);
          if (occludedFromOffset && distFromDoor < bestHiddenScore) {
            bestHiddenScore = distFromDoor;
            hiddenRoomPt = pt;
          }
        }
      }

      return {
        sw,
        door: d,
        corridorStand: standPt,
        corridorOffsetStand: offPt,
        roomInterior: tileCenter(inRoom.tx, inRoom.ty, ts),
        roomWallAdjacent: hiddenRoomPt,
        aimIntoDoor: Math.atan2(dcy - offPt.y, dcx - offPt.x),
      };
    }
  }
  return null;
}

function findSpotWithClearNeighbor(engine: MonstrumGameEngine): {
  spot: HidingSpot;
  entryPos: { x: number; y: number };
  bruteApproachPos: { x: number; y: number };
} | null {
  const { map } = engine;
  const ts = map.tileSize;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (const spot of map.hidingSpots) {
    for (const [dx, dy] of dirs) {
      const n1x = spot.tx + dx;
      const n1y = spot.ty + dy;
      const n2x = spot.tx + dx * 2;
      const n2y = spot.ty + dy * 2;
      const n3x = spot.tx + dx * 3;
      const n3y = spot.ty + dy * 3;
      if (
        isTileWalkable(map.tiles[n1y]?.[n1x] ?? 'VOID') &&
        isTileWalkable(map.tiles[n2y]?.[n2x] ?? 'VOID') &&
        isTileWalkable(map.tiles[n3y]?.[n3x] ?? 'VOID') &&
        !engine.doorsByTile.has(n1y * map.width + n1x) &&
        !engine.doorsByTile.has(n2y * map.width + n2x) &&
        !engine.doorsByTile.has(n3y * map.width + n3x)
      ) {
        // Stand close to the hiding spot edge so no nearby container/switch steals tryInteract()
        const entryPos = {
          x: spot.x + dx * (ts * 0.45),
          y: spot.y + dy * (ts * 0.45),
        };
        const spotDist = Math.hypot(spot.x - entryPos.x, spot.y - entryPos.y);
        const closerContainer = map.containers.some(
          (c) => !c.searched && Math.hypot(c.x - entryPos.x, c.y - entryPos.y) <= spotDist
        );
        if (closerContainer) continue;
        return {
          spot,
          entryPos,
          bruteApproachPos: tileCenter(n3x, n3y, ts),
        };
      }
    }
  }
  return null;
}

function findCornerBeamSetup(engine: MonstrumGameEngine): {
  playerPos: { x: number; y: number };
  playerAngle: number;
  brutePos: { x: number; y: number };
  bruteAngle: number;
  cornerSpillPos: { x: number; y: number };
  probes: Array<{ x: number; y: number; label: string }>;
} | null {
  const { map } = engine;
  const ts = map.tileSize;
  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let cy = 6; cy < map.height - 6; cy++) {
    for (let cx = 6; cx < map.width - 6; cx++) {
      if (!isTileWalkable(map.tiles[cy][cx])) continue;
      if (engine.doorsByTile.has(cy * map.width + cx)) continue;

      for (const [dx, dy] of dirs) {
        // Brute stands 2 tiles from corner along (dx, dy), aiming back toward corner (-dx, -dy)
        const b1x = cx + dx;
        const b1y = cy + dy;
        const b2x = cx + dx * 2;
        const b2y = cy + dy * 2;
        // Beam target tile beyond corner
        const s1x = cx - dx;
        const s1y = cy - dy;

        if (
          !isTileWalkable(map.tiles[b1y]?.[b1x] ?? 'VOID') ||
          !isTileWalkable(map.tiles[b2y]?.[b2x] ?? 'VOID') ||
          !isTileWalkable(map.tiles[s1y]?.[s1x] ?? 'VOID') ||
          engine.doorsByTile.has(b1y * map.width + b1x) ||
          engine.doorsByTile.has(b2y * map.width + b2x) ||
          engine.doorsByTile.has(s1y * map.width + s1x)
        ) {
          continue;
        }

        const perps: Array<[number, number]> = dx === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
        for (const [pxDir, pyDir] of perps) {
          const p1x = cx + pxDir;
          const p1y = cy + pyDir;
          const p2x = cx + pxDir * 2;
          const p2y = cy + pyDir * 2;
          const wallX = cx + dx + pxDir;
          const wallY = cy + dy + pyDir;
          const wall2X = cx + dx * 2 + pxDir;
          const wall2Y = cy + dy * 2 + pyDir;

          if (
            !isTileWalkable(map.tiles[p1y]?.[p1x] ?? 'VOID') ||
            !isTileWalkable(map.tiles[p2y]?.[p2x] ?? 'VOID') ||
            engine.doorsByTile.has(p1y * map.width + p1x) ||
            engine.doorsByTile.has(p2y * map.width + p2x)
          ) {
            continue;
          }

          if (
            map.tiles[wallY]?.[wallX] !== 'WALL' ||
            map.tiles[wall2Y]?.[wall2X] !== 'WALL'
          ) {
            continue;
          }

          const playerPos = tileCenter(p2x, p2y, ts);
          const brutePos = tileCenter(b2x, b2y, ts);
          const cornerCenter = tileCenter(cx, cy, ts);
          const spillCenter = tileCenter(s1x, s1y, ts);

          // Confirm Brute is hidden around the corner from Player, while the open intersection & spill are visible
          if (hasLineOfSight(map, engine.doorsByTile, playerPos.x, playerPos.y, brutePos.x, brutePos.y)) {
            continue;
          }
          if (
            !hasLineOfSight(map, engine.doorsByTile, playerPos.x, playerPos.y, spillCenter.x, spillCenter.y) ||
            !hasLineOfSight(map, engine.doorsByTile, brutePos.x, brutePos.y, spillCenter.x, spillCenter.y)
          ) {
            continue;
          }

          return {
            playerPos,
            playerAngle: Math.atan2(cornerCenter.y - playerPos.y, cornerCenter.x - playerPos.x),
            brutePos,
            bruteAngle: Math.atan2(cornerCenter.y - brutePos.y, cornerCenter.x - brutePos.x),
            cornerSpillPos: spillCenter,
            probes: [
              { x: brutePos.x, y: brutePos.y, label: 'Brute Behind Corner' },
              { x: (wallX + 0.5) * ts, y: (wallY + 0.5) * ts, label: 'Corner Wall Core' },
            ],
          };
        }
      }
    }
  }
  return null;
}

function findStairwellViewSetup(engine: MonstrumGameEngine): {
  stair: (typeof engine.map.stairwells)[number];
  partner: (typeof engine.map.stairwells)[number];
  playerPos: { x: number; y: number };
  playerAngle: number;
} | null {
  const { map } = engine;
  const ts = map.tileSize;
  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (const st of map.stairwells) {
    const partner = map.stairwells.find((s) => s.id === st.targetStairId);
    if (!partner) continue;

    for (const [dx, dy] of dirs) {
      const t2x = st.tx + dx * 2;
      const t2y = st.ty + dy * 2;
      const t1x = st.tx + dx;
      const t1y = st.ty + dy;
      if (
        isTileWalkable(map.tiles[t1y]?.[t1x] ?? 'VOID') &&
        isTileWalkable(map.tiles[t2y]?.[t2x] ?? 'VOID') &&
        !engine.doorsByTile.has(t1y * map.width + t1x) &&
        !engine.doorsByTile.has(t2y * map.width + t2x)
      ) {
        const playerPos = tileCenter(t2x, t2y, ts);
        if (hasLineOfSight(map, engine.doorsByTile, playerPos.x, playerPos.y, st.x, st.y)) {
          return {
            stair: st,
            partner,
            playerPos,
            playerAngle: Math.atan2(st.y - playerPos.y, st.x - playerPos.x),
          };
        }
      }
    }
  }
  return null;
}

export function applyDebugScenarioToEngine(
  engine: MonstrumGameEngine,
  scenarioId: DebugScenarioId
): DebugScenarioMetadata {
  const p = engine.player;
  const b = engine.brute;
  const ts = engine.map.tileSize;

  // Common clean baseline reset
  engine.droppedLights = [];
  engine.ripples = [];
  engine.particles = [];
  p.hidingSpotId = null;
  p.peekingDoorId = null;
  p.peekingSpotId = null;
  p.preHidePos = null;
  p.climbingStairId = null;
  p.climbProgress = 0;
  p.crouching = false;
  p.sprinting = false;
  p.isMoving = false;
  p.walkPhase = 0;
  p.battery = 100;
  p.stamina = 100;
  engine.zoom = 1.25;
  engine.targetZoom = 1.25;
  engine.debugConfig.enabled = true;
  engine.debugConfig.forceVentPeek = false;
  engine.debugConfig.forceDoorPeek = false;

  b.state = 'ROAM';
  b.path = [];
  b.lastKnownPlayerPos = null;
  b.chaseOvershootPos = null;
  b.watchedPlayerHideSpotId = null;
  b.currentInspectSpotId = null;
  b.searchSpotsQueue = [];
  b.investigateTarget = null;
  b.pursuitStairId = null;
  b.stairClimbTimer = 0;
  b.stairDestId = null;
  b.smashDoorId = null;
  b.inspectTimer = 0;
  b.walkPhase = 0;

  for (const sw of engine.map.lightSwitches) {
    sw.isOn = false;
  }

  let probePoints: Array<{ x: number; y: number; label: string }> = [];

  if (scenarioId === 'WALL_OCCLUSION') {
    const setup = findWallSeparatedPair(engine);
    p.x = setup.playerPos.x;
    p.y = setup.playerPos.y;
    p.angle = setup.aimAngle;
    p.flashlightOn = true;
    b.x = setup.brutePos.x;
    b.y = setup.brutePos.y;
    b.angle = setup.aimAngle + Math.PI;
    engine.debugConfig.freezeAi = true;
    probePoints = setup.probes;
  } else if (scenarioId === 'LIT_ROOM_DOOR_SPILL') {
    const setup = findSwitchDoorPair(engine);
    if (setup) {
      setup.sw.isOn = true;
      setup.door.isLocked = false;
      setup.door.isOpen = true;
      setup.door.openProgress = 1;
      p.x = setup.corridorOffsetStand.x;
      p.y = setup.corridorOffsetStand.y;
      p.angle = setup.aimIntoDoor;
      p.flashlightOn = false;
      b.x = engine.map.bruteSpawn.x;
      b.y = engine.map.bruteSpawn.y;
      probePoints = [
        { x: setup.roomWallAdjacent.x, y: setup.roomWallAdjacent.y, label: 'Occluded Lit Room Corner' },
      ];
    }
    engine.debugConfig.freezeAi = true;
  } else if (scenarioId === 'LIT_ROOM_CLOSED_DOOR') {
    const setup = findSwitchDoorPair(engine);
    if (setup) {
      setup.sw.isOn = true;
      // Close all doors bordering this room so zero light leaks out
      for (const d of engine.map.doors) {
        const adj = [
          engine.map.roomGrid[d.ty - 1]?.[d.tx],
          engine.map.roomGrid[d.ty + 1]?.[d.tx],
          engine.map.roomGrid[d.ty]?.[d.tx - 1],
          engine.map.roomGrid[d.ty]?.[d.tx + 1],
        ];
        if (adj.includes(setup.sw.room)) {
          d.isOpen = false;
          d.openProgress = 0;
        }
      }
      p.x = setup.corridorStand.x;
      p.y = setup.corridorStand.y;
      p.angle = Math.atan2(
        (setup.door.ty + 0.5) * ts - p.y,
        (setup.door.tx + 0.5) * ts - p.x
      );
      p.flashlightOn = false;
      b.x = engine.map.bruteSpawn.x;
      b.y = engine.map.bruteSpawn.y;
      probePoints = [
        { x: setup.roomInterior.x, y: setup.roomInterior.y, label: 'Inside Closed Lit Room' },
        { x: setup.roomWallAdjacent.x, y: setup.roomWallAdjacent.y, label: 'Deep Inside Lit Room' },
      ];
    }
    engine.debugConfig.freezeAi = true;
  } else if (scenarioId === 'HIDING_FLASHLIGHT_PEEK') {
    const setup = findSpotWithClearNeighbor(engine);
    if (setup) {
      p.x = setup.entryPos.x;
      p.y = setup.entryPos.y;
      p.flashlightOn = true; // Start ON so entering proves automatic shutoff
      p.angle = Math.atan2(
        setup.bruteApproachPos.y - setup.spot.y,
        setup.bruteApproachPos.x - setup.spot.x
      );
      b.x = setup.bruteApproachPos.x;
      b.y = setup.bruteApproachPos.y;
      b.angle = Math.atan2(setup.spot.y - b.y, setup.spot.x - b.x);
      // Enter hiding spot via real interaction
      engine.tryInteract();
      // Keep Brute frozen until user/script inspects or unfreezes
      b.watchedPlayerHideSpotId = null;
      probePoints = [
        { x: setup.bruteApproachPos.x, y: setup.bruteApproachPos.y, label: 'Outside Locker Unpeeked' },
      ];
    }
    engine.debugConfig.freezeAi = true;
  } else if (scenarioId === 'BRUTE_HIDING_KILL') {
    const setup = findSpotWithClearNeighbor(engine);
    if (setup) {
      p.x = setup.entryPos.x;
      p.y = setup.entryPos.y;
      p.flashlightOn = true;
      p.angle = Math.atan2(
        setup.bruteApproachPos.y - setup.spot.y,
        setup.bruteApproachPos.x - setup.spot.x
      );
      b.x = setup.bruteApproachPos.x;
      b.y = setup.bruteApproachPos.y;
      b.angle = Math.atan2(setup.spot.y - b.y, setup.spot.x - b.x);
      b.state = 'CHASE';
      // Enter hiding spot right in front of Brute
      engine.tryInteract();
    }
    engine.debugConfig.freezeAi = false;
  } else if (scenarioId === 'DOOR_KEYHOLE_AND_FLARE') {
    const setup = findSwitchDoorPair(engine);
    if (setup) {
      setup.door.isOpen = false;
      setup.door.openProgress = 0;
      setup.door.isLocked = false;
      // Stand right next to door so keyhole peek activates
      const dcx = (setup.door.tx + 0.5) * ts;
      const dcy = (setup.door.ty + 0.5) * ts;
      const outDirX = Math.sign(setup.corridorStand.x - dcx);
      const outDirY = Math.sign(setup.corridorStand.y - dcy);
      p.x = dcx + outDirX * 32;
      p.y = dcy + outDirY * 32;
      p.angle = Math.atan2(dcy - p.y, dcx - p.x);
      p.flashlightOn = false;
      p.peekingDoorId = setup.door.id;
      engine.debugConfig.forceDoorPeek = true;

      // Place Brute inside the room facing player's door
      b.x = setup.roomInterior.x;
      b.y = setup.roomInterior.y;
      b.angle = Math.atan2(dcy - b.y, dcx - b.x);

      // Drop a flare inside the room
      engine.droppedLights.push({
        id: 9999,
        x: setup.roomWallAdjacent.x,
        y: setup.roomWallAdjacent.y,
        type: 'FLARE',
        life: 16,
        maxLife: 16,
        lureTimer: 5,
      });

      probePoints = [];
    }
    engine.debugConfig.freezeAi = true;
  } else if (scenarioId === 'BRUTE_BEAM_CORNER') {
    const setup = findCornerBeamSetup(engine);
    if (setup) {
      p.x = setup.playerPos.x;
      p.y = setup.playerPos.y;
      p.angle = setup.playerAngle;
      p.flashlightOn = false; // Show Brute's own orange spotlight spilling around the corner
      b.x = setup.brutePos.x;
      b.y = setup.brutePos.y;
      b.angle = setup.bruteAngle;
      b.state = 'CHASE';
      probePoints = setup.probes;
    }
    engine.debugConfig.freezeAi = true;
  } else if (scenarioId === 'STAIR_BRUTE_GLOW') {
    const setup = findStairwellViewSetup(engine);
    if (setup) {
      p.x = setup.playerPos.x;
      p.y = setup.playerPos.y;
      p.angle = setup.playerAngle;
      p.flashlightOn = false; // Show stairwell orange glow illuminating dark compartment
      b.x = setup.partner.x;
      b.y = setup.partner.y;
      b.state = 'CHASE';
      b.stairDestId = setup.stair.id;
      b.stairClimbTimer = 0.65;
      probePoints = [];
    }
    engine.debugConfig.freezeAi = true;
  } else if (scenarioId === 'FLICKER_AND_SURVIVOR') {
    const { map } = engine;
    let chosenSw: RoomLightSwitch | null = null;
    let clearPt: { x: number; y: number } | null = null;
    let bestClearScore = -Infinity;

    for (const sw of map.lightSwitches) {
      for (let ry = 1; ry < map.height - 1; ry++) {
        for (let rx = 1; rx < map.width - 1; rx++) {
          if (map.roomGrid[ry][rx] !== sw.room || !isTileWalkable(map.tiles[ry][rx])) continue;
          const wx = (rx + 0.5) * ts;
          const wy = (ry + 0.5) * ts;
          const minObjDist = Math.min(
            ...map.containers.map((c) => Math.hypot(c.x - wx, c.y - wy)),
            ...map.hidingSpots.map((h) => Math.hypot(h.x - wx, h.y - wy)),
            ...map.lightSwitches.map((s) => Math.hypot(s.x - wx, s.y - wy)),
            ...map.doors.map((d) => Math.hypot((d.tx + 0.5) * ts - wx, (d.ty + 0.5) * ts - wy))
          );
          if (minObjDist > bestClearScore) {
            bestClearScore = minObjDist;
            clearPt = { x: wx, y: wy };
            chosenSw = sw;
          }
        }
      }
    }

    if (chosenSw && clearPt) {
      chosenSw.isOn = true;
      for (const d of map.doors) {
        if (!d.isBroken && Math.hypot((d.tx + 0.5) * ts - clearPt.x, (d.ty + 0.5) * ts - clearPt.y) < ts * 5) {
          d.isLocked = false;
          d.isOpen = true;
          d.openProgress = 1;
        }
      }

      p.x = clearPt.x;
      p.y = clearPt.y;
      p.angle = Math.atan2(chosenSw.y - clearPt.y, chosenSw.x - clearPt.x);
      p.flashlightOn = true;
      p.isMoving = true;
      p.walkPhase = 1.25; // Mid-stride boot & arm swing pose
      p.inventory = ['GLOWSTICK', 'FLARE', 'BOLT_CUTTERS'];
      engine.zoom = 1.55;
      engine.targetZoom = 1.55;

      // Find an adjacent wall-separated tile outside the room so probe verifies #000000 wall occlusion
      const dirs: Array<[number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      const ptx = Math.floor(p.x / ts);
      const pty = Math.floor(p.y / ts);
      let occludedProbe = { x: p.x + ts * 3, y: p.y, label: 'Behind Bulkhead Wall' };
      outer: for (let distSteps = 1; distSteps <= 4; distSteps++) {
        for (const [dx, dy] of dirs) {
          const wx = ptx + dx * distSteps;
          const wy = pty + dy * distSteps;
          const fx = ptx + dx * (distSteps + 1);
          const fy = pty + dy * (distSteps + 1);
          if (map.tiles[wy]?.[wx] === 'WALL') {
            const probeX = (fx + 0.5) * ts;
            const probeY = (fy + 0.5) * ts;
            if (!hasLineOfSight(map, engine.doorsByTile, p.x, p.y, probeX, probeY)) {
              occludedProbe = { x: probeX, y: probeY, label: 'Behind Bulkhead Wall' };
              break outer;
            }
          }
        }
      }

      b.x = map.bruteSpawn.x;
      b.y = map.bruteSpawn.y;
      probePoints = [occludedProbe];
    }
    engine.debugConfig.freezeAi = true;
  }

  // Snap camera immediately for zero-lag inspection & screenshots
  engine.cameraX = p.x;
  engine.cameraY = p.y;
  engine.lookAheadX = 0;
  engine.lookAheadY = 0;
  engine.debugScenario = scenarioId;
  engine.debugProbePoints = probePoints;
  engine.emitHud();

  const meta = DEBUG_SCENARIOS.find((s) => s.id === scenarioId)!;
  return {
    id: scenarioId,
    label: meta.label,
    description: meta.summary,
    probePoints,
  };
}
