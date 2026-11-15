export interface RoomFlickerSample {
  intensity: number;     // 0.34 .. 1.0 effective luminous multiplier
  sputterAmount: number; // 0 .. 1 ballast electrical sputter/instability
}

function hashSwitchId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 10000;
}

/**
 * Deterministic, non-strobing ballast flicker curve simulating unmaintained shipboard
 * fluorescent fixtures: steady ~0.92-0.98 baseline with gentle generator sway, periodic
 * voltage dips (~0.55-0.75), occasional rapid fluorescent sputters (~0.34-0.52),
 * and subtle electrical sag when the heavy Brute stalks nearby.
 */
export function getRoomLightFlicker(
  switchId: string,
  timeSec: number,
  bruteDistToRoom = Infinity
): RoomFlickerSample {
  const seed = hashSwitchId(switchId);
  const phase = seed * 0.0173;
  const t = Math.max(0, timeSec) + phase;

  // Slow ship generator voltage sway (0.91 .. 0.99)
  const slowSway = 0.95 + 0.032 * Math.sin(t * 1.15) + 0.018 * Math.sin(t * 2.71 + 1.3);

  // Periodic realistic ballast dip cycle (every ~5.5 to 8.5s staggered per room)
  const cyclePeriod = 6.2 + (seed % 29) * 0.09;
  const cyclePos = (t % cyclePeriod) / cyclePeriod; // 0 .. 1

  let dip = 0;
  let sputter = 0;

  // Brief instability window occupying ~14% of each cycle
  if (cyclePos > 0.78 && cyclePos < 0.92) {
    const u = (cyclePos - 0.78) / 0.14; // 0 .. 1
    const envelope = Math.sin(u * Math.PI); // smooth entry & recovery
    // Double-pulse ballast choke stutter
    const choke = 0.5 + 0.5 * Math.sin(u * Math.PI * 5.2 + seed * 0.1);
    const microBuzz = 0.5 + 0.5 * Math.sin(t * 38.0 + seed);
    dip = envelope * (0.18 + 0.24 * choke + 0.09 * microBuzz);
    sputter = Math.min(1, envelope * (0.45 + 0.55 * choke));
  } else if (cyclePos > 0.34 && cyclePos < 0.39) {
    // Minor quick mid-cycle voltage brownout sag
    const u = (cyclePos - 0.34) / 0.05;
    const envelope = Math.sin(u * Math.PI);
    dip = envelope * 0.15;
    sputter = envelope * 0.3;
  }

  // Heavy Brute electromagnetic/vibration sag when passing near the compartment
  let bruteSag = 0;
  if (Number.isFinite(bruteDistToRoom) && bruteDistToRoom < 270) {
    const prox = Math.max(0, 1 - bruteDistToRoom / 270);
    const tremor = 0.5 + 0.5 * Math.sin(t * 27.0);
    bruteSag = prox * (0.09 + 0.16 * tremor);
    sputter = Math.max(sputter, prox * 0.55 * tremor);
  }

  const intensity = Math.max(0.34, Math.min(1.0, slowSway - dip - bruteSag));
  return {
    intensity,
    sputterAmount: Math.max(0, Math.min(1, sputter)),
  };
}
