export type QualityPreset = 'LOW' | 'BALANCED' | 'HIGH' | 'ULTRA' | 'CUSTOM';
export type AoQuality = 'OFF' | 'LOW' | 'HIGH';
export type ColorGradePreset = 'COLD_HORROR' | 'AMBER_RUST' | 'NOIR_CONTRAST' | 'NEUTRAL';
export type HdrMode = 'AUTO' | 'ON' | 'OFF';
export type ToneMappingMode = 'ACES_FILMIC' | 'NEUTRAL' | 'REINHARD_EXTENDED';

export const DEFAULT_CAMERA_PITCH_DEG = 15;
export const DEFAULT_CAMERA_YAW_DEG = 0;
export const DEFAULT_CAMERA_FOV_DEG = 75;

export interface GraphicsSettings {
  qualityPreset: QualityPreset;
  // Performance
  resolutionScale: number; // 0.5 .. 1.5
  aoQuality: AoQuality;
  bloomEnabled: boolean;
  bloomIntensity: number; // 0 .. 1.5
  particleDensity: number; // 0.25 .. 1.5
  fpsCap: 0 | 30 | 60 | 120;
  // Presentation & Camera
  cameraPitchDeg: number; // 0 .. 45 (default 15)
  cameraYawDeg: number; // -45 .. 45 (default 0)
  cameraFovDeg: number; // 40 .. 90 (default 75)
  vignetteIntensity: number; // 0 .. 1.5
  filmGrain: number; // 0 .. 1.0
  colorGrade: ColorGradePreset;
  // HDR1000 & Tone Mapping
  hdrMode: HdrMode;
  hdrPeakNits: number; // 400 .. 1600 (default 1000)
  hdrPaperWhiteNits: number; // 80 .. 400 (default 203)
  toneMapping: ToneMappingMode;
}

export interface HdrCapabilities {
  displayHdr: boolean;
  wideGamutP3: boolean;
  webgpuAvailable: boolean;
}

const STORAGE_KEY = 'monstrum_fan_graphics_v1';

export const QUALITY_PRESET_SETTINGS: Record<
  Exclude<QualityPreset, 'CUSTOM'>,
  Pick<
    GraphicsSettings,
    'resolutionScale' | 'aoQuality' | 'bloomEnabled' | 'bloomIntensity' | 'particleDensity'
  >
> = {
  LOW: {
    resolutionScale: 0.7,
    aoQuality: 'OFF',
    bloomEnabled: false,
    bloomIntensity: 0,
    particleDensity: 0.45,
  },
  BALANCED: {
    resolutionScale: 0.9,
    aoQuality: 'LOW',
    bloomEnabled: true,
    bloomIntensity: 0.55,
    particleDensity: 0.8,
  },
  HIGH: {
    resolutionScale: 1.0,
    aoQuality: 'HIGH',
    bloomEnabled: true,
    bloomIntensity: 0.72,
    particleDensity: 1.0,
  },
  ULTRA: {
    resolutionScale: 1.25,
    aoQuality: 'HIGH',
    bloomEnabled: true,
    bloomIntensity: 0.9,
    particleDensity: 1.35,
  },
};

export function getDefaultGraphicsSettings(): GraphicsSettings {
  return {
    qualityPreset: 'HIGH',
    resolutionScale: 1.0,
    aoQuality: 'HIGH',
    bloomEnabled: true,
    bloomIntensity: 0.72,
    particleDensity: 1.0,
    fpsCap: 0,
    cameraPitchDeg: DEFAULT_CAMERA_PITCH_DEG,
    cameraYawDeg: DEFAULT_CAMERA_YAW_DEG,
    cameraFovDeg: DEFAULT_CAMERA_FOV_DEG,
    vignetteIntensity: 1.0,
    filmGrain: 0.24,
    colorGrade: 'COLD_HORROR',
    hdrMode: 'AUTO',
    hdrPeakNits: 1000,
    hdrPaperWhiteNits: 203,
    toneMapping: 'ACES_FILMIC',
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function sanitizeGraphicsSettings(raw: Partial<GraphicsSettings> | null | undefined): GraphicsSettings {
  const def = getDefaultGraphicsSettings();
  if (!raw || typeof raw !== 'object') return def;

  const fpsRaw = raw.fpsCap;
  const fpsCap: 0 | 30 | 60 | 120 =
    fpsRaw === 30 || fpsRaw === 60 || fpsRaw === 120 ? fpsRaw : 0;

  const aoQuality: AoQuality =
    raw.aoQuality === 'OFF' || raw.aoQuality === 'LOW' || raw.aoQuality === 'HIGH'
      ? raw.aoQuality
      : def.aoQuality;

  const colorGrade: ColorGradePreset =
    raw.colorGrade === 'COLD_HORROR' ||
    raw.colorGrade === 'AMBER_RUST' ||
    raw.colorGrade === 'NOIR_CONTRAST' ||
    raw.colorGrade === 'NEUTRAL'
      ? raw.colorGrade
      : def.colorGrade;

  const hdrMode: HdrMode =
    raw.hdrMode === 'AUTO' || raw.hdrMode === 'ON' || raw.hdrMode === 'OFF'
      ? raw.hdrMode
      : def.hdrMode;

  const toneMapping: ToneMappingMode =
    raw.toneMapping === 'ACES_FILMIC' ||
    raw.toneMapping === 'NEUTRAL' ||
    raw.toneMapping === 'REINHARD_EXTENDED'
      ? raw.toneMapping
      : def.toneMapping;

  const presetRaw = raw.qualityPreset;
  const qualityPreset: QualityPreset =
    presetRaw === 'LOW' ||
    presetRaw === 'BALANCED' ||
    presetRaw === 'HIGH' ||
    presetRaw === 'ULTRA' ||
    presetRaw === 'CUSTOM'
      ? presetRaw
      : def.qualityPreset;

  return {
    qualityPreset,
    resolutionScale:
      typeof raw.resolutionScale === 'number' && Number.isFinite(raw.resolutionScale)
        ? clamp(raw.resolutionScale, 0.5, 1.5)
        : def.resolutionScale,
    aoQuality,
    bloomEnabled: typeof raw.bloomEnabled === 'boolean' ? raw.bloomEnabled : def.bloomEnabled,
    bloomIntensity:
      typeof raw.bloomIntensity === 'number' && Number.isFinite(raw.bloomIntensity)
        ? clamp(raw.bloomIntensity, 0, 1.5)
        : def.bloomIntensity,
    particleDensity:
      typeof raw.particleDensity === 'number' && Number.isFinite(raw.particleDensity)
        ? clamp(raw.particleDensity, 0.25, 1.5)
        : def.particleDensity,
    fpsCap,
    cameraPitchDeg:
      typeof raw.cameraPitchDeg === 'number' && Number.isFinite(raw.cameraPitchDeg)
        ? clamp(raw.cameraPitchDeg, 0, 45)
        : def.cameraPitchDeg,
    cameraYawDeg:
      typeof raw.cameraYawDeg === 'number' && Number.isFinite(raw.cameraYawDeg)
        ? clamp(raw.cameraYawDeg, -45, 45)
        : def.cameraYawDeg,
    cameraFovDeg:
      typeof raw.cameraFovDeg === 'number' && Number.isFinite(raw.cameraFovDeg)
        ? clamp(raw.cameraFovDeg, 40, 90)
        : def.cameraFovDeg,
    vignetteIntensity:
      typeof raw.vignetteIntensity === 'number' && Number.isFinite(raw.vignetteIntensity)
        ? clamp(raw.vignetteIntensity, 0, 1.5)
        : def.vignetteIntensity,
    filmGrain:
      typeof raw.filmGrain === 'number' && Number.isFinite(raw.filmGrain)
        ? clamp(raw.filmGrain, 0, 1.0)
        : def.filmGrain,
    colorGrade,
    hdrMode,
    hdrPeakNits:
      typeof raw.hdrPeakNits === 'number' && Number.isFinite(raw.hdrPeakNits)
        ? clamp(raw.hdrPeakNits, 400, 1600)
        : def.hdrPeakNits,
    hdrPaperWhiteNits:
      typeof raw.hdrPaperWhiteNits === 'number' && Number.isFinite(raw.hdrPaperWhiteNits)
        ? clamp(raw.hdrPaperWhiteNits, 80, 400)
        : def.hdrPaperWhiteNits,
    toneMapping,
  };
}

export function loadGraphicsSettings(): GraphicsSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultGraphicsSettings();
    return sanitizeGraphicsSettings(JSON.parse(raw) as Partial<GraphicsSettings>);
  } catch {
    return getDefaultGraphicsSettings();
  }
}

export function saveGraphicsSettings(settings: GraphicsSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function applyQualityPresetToSettings(
  current: GraphicsSettings,
  preset: Exclude<QualityPreset, 'CUSTOM'>
): GraphicsSettings {
  return {
    ...current,
    ...QUALITY_PRESET_SETTINGS[preset],
    qualityPreset: preset,
  };
}

export function detectQualityPreset(settings: GraphicsSettings): QualityPreset {
  for (const key of ['LOW', 'BALANCED', 'HIGH', 'ULTRA'] as const) {
    const p = QUALITY_PRESET_SETTINGS[key];
    if (
      Math.abs(settings.resolutionScale - p.resolutionScale) < 0.02 &&
      settings.aoQuality === p.aoQuality &&
      settings.bloomEnabled === p.bloomEnabled &&
      Math.abs(settings.bloomIntensity - p.bloomIntensity) < 0.03 &&
      Math.abs(settings.particleDensity - p.particleDensity) < 0.03
    ) {
      return key;
    }
  }
  return 'CUSTOM';
}

export function detectHdrCapabilities(): HdrCapabilities {
  if (typeof window === 'undefined') {
    return { displayHdr: false, wideGamutP3: false, webgpuAvailable: false };
  }
  const displayHdr = Boolean(window.matchMedia?.('(dynamic-range: high)').matches);
  const wideGamutP3 = Boolean(window.matchMedia?.('(color-gamut: p3)').matches);
  const webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
  return { displayHdr, wideGamutP3, webgpuAvailable };
}

export function isHdrOutputActive(
  settings: GraphicsSettings,
  caps: HdrCapabilities,
  isWebGPUBackend: boolean
): boolean {
  if (!isWebGPUBackend) return false;
  if (settings.hdrMode === 'OFF') return false;
  if (settings.hdrMode === 'ON') return true;
  return caps.displayHdr;
}
