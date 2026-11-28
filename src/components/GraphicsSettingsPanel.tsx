import React, { useEffect, useState } from 'react';
import { Monitor, RotateCcw, Sliders, Sparkles, Sun } from 'lucide-react';
import {
  AoQuality,
  applyQualityPresetToSettings,
  ColorGradePreset,
  detectHdrCapabilities,
  detectQualityPreset,
  getDefaultGraphicsSettings,
  GraphicsSettings,
  HdrMode,
  isHdrOutputActive,
  QualityPreset,
  ToneMappingMode,
} from '../game/graphicsSettings';

interface GraphicsSettingsPanelProps {
  settings: GraphicsSettings;
  onChange: (next: GraphicsSettings) => void;
  onReset: () => void;
  rendererBackend?: string;
}

const PRESETS: Array<{ id: Exclude<QualityPreset, 'CUSTOM'>; label: string }> = [
  { id: 'LOW', label: 'Low' },
  { id: 'BALANCED', label: 'Balanced' },
  { id: 'HIGH', label: 'High' },
  { id: 'ULTRA', label: 'Ultra' },
];

const AO_OPTIONS: Array<{ id: AoQuality; label: string }> = [
  { id: 'OFF', label: 'Off' },
  { id: 'LOW', label: 'Low' },
  { id: 'HIGH', label: 'High' },
];

const FPS_OPTIONS: Array<{ id: 0 | 30 | 60 | 120; label: string }> = [
  { id: 0, label: 'Uncapped' },
  { id: 120, label: '120' },
  { id: 60, label: '60' },
  { id: 30, label: '30' },
];

const GRADE_OPTIONS: Array<{ id: ColorGradePreset; label: string }> = [
  { id: 'COLD_HORROR', label: 'Cold Horror' },
  { id: 'AMBER_RUST', label: 'Amber Rust' },
  { id: 'NOIR_CONTRAST', label: 'Noir' },
  { id: 'NEUTRAL', label: 'Neutral' },
];

const HDR_MODE_OPTIONS: Array<{ id: HdrMode; label: string }> = [
  { id: 'AUTO', label: 'Auto' },
  { id: 'ON', label: 'Force On' },
  { id: 'OFF', label: 'Off' },
];

const TONE_MAP_OPTIONS: Array<{ id: ToneMappingMode; label: string }> = [
  { id: 'ACES_FILMIC', label: 'ACES Filmic' },
  { id: 'NEUTRAL', label: 'Neutral' },
  { id: 'REINHARD_EXTENDED', label: 'Reinhard Ext' },
];

export const GraphicsSettingsPanel: React.FC<GraphicsSettingsPanelProps> = ({
  settings,
  onChange,
  onReset,
  rendererBackend,
}) => {
  const caps = detectHdrCapabilities();
  const isWebGpu =
    rendererBackend === 'WebGPU' ||
    (!rendererBackend && caps.webgpuAvailable);
  const hdrActive = isHdrOutputActive(settings, caps, isWebGpu);
  const detectedPreset = detectQualityPreset(settings);

  const patchPerf = (partial: Partial<GraphicsSettings>) => {
    const merged: GraphicsSettings = { ...settings, ...partial };
    merged.qualityPreset = detectQualityPreset(merged);
    onChange(merged);
  };

  const patchVisual = (partial: Partial<GraphicsSettings>) => {
    onChange({ ...settings, ...partial });
  };

  const defaults = getDefaultGraphicsSettings();
  const [mouseDraft, setMouseDraft] = useState<string>(() =>
    String(settings.mouseSensitivity ?? defaults.mouseSensitivity)
  );

  useEffect(() => {
    const numDraft = Number(mouseDraft);
    if (!Number.isFinite(numDraft) || Math.abs(numDraft - settings.mouseSensitivity) > 1e-6) {
      setMouseDraft(String(settings.mouseSensitivity));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mouseSensitivity]);

  const handleMouseDraftChange = (val: string) => {
    setMouseDraft(val);
    const trimmed = val.trim();
    if (!trimmed) return;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed >= 0.01) {
      patchVisual({ mouseSensitivity: parsed });
    }
  };

  const handleMouseDraftBlur = () => {
    const parsed = Number(mouseDraft.trim());
    if (!Number.isFinite(parsed) || parsed < 0.01) {
      setMouseDraft(String(settings.mouseSensitivity));
    }
  };

  return (
    <div className="space-y-4">
      {/* Quality Preset Header Bar */}
      <div className="rounded-md border border-slate-800 bg-slate-950/75 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Graphics Quality Profile
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded border border-slate-700/80 bg-[#070a0f] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300 font-mono-num">
              {detectedPreset}
            </span>
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset Defaults</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5 rounded border border-slate-800 bg-[#05070b] p-1">
          {PRESETS.map((p) => {
            const active = detectedPreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                data-testid={`gfx-preset-${p.id.toLowerCase()}`}
                onClick={() => onChange(applyQualityPresetToSettings(settings, p.id))}
                className={`rounded px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-orange-600 text-white'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Performance Settings */}
      <div className="rounded-md border border-slate-800 bg-slate-950/75 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-200">
          <Monitor className="h-3.5 w-3.5 text-sky-400" />
          <span>Performance &amp; Rendering</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">Resolution Scale</span>
              <span className="font-mono-num font-semibold text-amber-300">
                {Math.round(settings.resolutionScale * 100)}%
              </span>
            </div>
            <input
              type="range"
              aria-label="Resolution Scale"
              min={0.5}
              max={1.5}
              step={0.05}
              value={settings.resolutionScale}
              onChange={(e) => patchPerf({ resolutionScale: Number(e.target.value) })}
              className="h-1.5 w-full accent-orange-500 cursor-pointer"
            />
          </label>

          <label className="block space-y-1 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">Particle Density</span>
              <span className="font-mono-num font-semibold text-amber-300">
                {Math.round(settings.particleDensity * 100)}%
              </span>
            </div>
            <input
              type="range"
              aria-label="Particle Density"
              min={0.25}
              max={1.5}
              step={0.05}
              value={settings.particleDensity}
              onChange={(e) => patchPerf({ particleDensity: Number(e.target.value) })}
              className="h-1.5 w-full accent-orange-500 cursor-pointer"
            />
          </label>

          <div className="space-y-1.5 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">Shadow &amp; Wall AO</span>
              <span className="font-mono-num text-[10px] text-slate-400">{settings.aoQuality}</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {AO_OPTIONS.map((ao) => (
                <button
                  key={ao.id}
                  type="button"
                  onClick={() => patchPerf({ aoQuality: ao.id })}
                  className={`rounded border px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                    settings.aoQuality === ao.id
                      ? 'border-sky-500/80 bg-sky-500/15 text-sky-200'
                      : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {ao.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">FPS Cap</span>
              <span className="font-mono-num text-[10px] text-slate-400">
                {settings.fpsCap === 0 ? 'Uncapped' : `${settings.fpsCap} FPS`}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {FPS_OPTIONS.map((fps) => (
                <button
                  key={fps.id}
                  type="button"
                  onClick={() => patchVisual({ fpsCap: fps.id })}
                  className={`rounded border px-1.5 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                    settings.fpsCap === fps.id
                      ? 'border-sky-500/80 bg-sky-500/15 text-sky-200'
                      : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {fps.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
          <button
            type="button"
            onClick={() =>
              patchPerf({
                bloomEnabled: !settings.bloomEnabled,
                bloomIntensity:
                  !settings.bloomEnabled && settings.bloomIntensity <= 0.05
                    ? defaults.bloomIntensity
                    : settings.bloomIntensity,
              })
            }
            className={`rounded border px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
              settings.bloomEnabled
                ? 'border-amber-500/70 bg-amber-500/15 text-amber-200'
                : 'border-slate-800 bg-slate-900 text-slate-400'
            }`}
          >
            {settings.bloomEnabled ? 'Bloom: On' : 'Bloom: Off'}
          </button>

          <label className="flex min-w-[180px] flex-1 items-center gap-2.5 text-[11px]">
            <span className="text-slate-300 whitespace-nowrap">Bloom Intensity</span>
            <input
              type="range"
              aria-label="Bloom Intensity"
              min={0}
              max={1.5}
              step={0.05}
              disabled={!settings.bloomEnabled}
              value={settings.bloomIntensity}
              onChange={(e) => patchPerf({ bloomIntensity: Number(e.target.value) })}
              className="h-1.5 flex-1 accent-amber-400 cursor-pointer disabled:opacity-40"
            />
            <span className="w-10 text-right font-mono-num font-semibold text-amber-300">
              {settings.bloomIntensity.toFixed(2)}
            </span>
          </label>
        </div>
      </div>

      {/* Camera & Post Atmosphere */}
      <div className="rounded-md border border-slate-800 bg-slate-950/75 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-200">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
          <span>Camera Perspective &amp; Atmosphere</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">Camera Pitch</span>
              <span className="font-mono-num font-semibold text-emerald-300">
                {Math.round(settings.cameraPitchDeg)}°
              </span>
            </div>
            <input
              type="range"
              aria-label="Camera Pitch"
              min={0}
              max={45}
              step={1}
              value={settings.cameraPitchDeg}
              onChange={(e) => patchVisual({ cameraPitchDeg: Number(e.target.value) })}
              className="h-1.5 w-full accent-emerald-400 cursor-pointer"
            />
          </label>

          <label className="block space-y-1 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">Camera FOV</span>
              <span className="font-mono-num font-semibold text-emerald-300">
                {Math.round(settings.cameraFovDeg)}°
              </span>
            </div>
            <input
              type="range"
              aria-label="Camera FOV"
              min={40}
              max={90}
              step={1}
              value={settings.cameraFovDeg}
              onChange={(e) => patchVisual({ cameraFovDeg: Number(e.target.value) })}
              className="h-1.5 w-full accent-emerald-400 cursor-pointer"
            />
          </label>

          <label className="block space-y-1 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">Camera Yaw</span>
              <span className="font-mono-num font-semibold text-emerald-300">
                {Math.round(settings.cameraYawDeg)}°
              </span>
            </div>
            <input
              type="range"
              aria-label="Camera Yaw"
              min={-45}
              max={45}
              step={1}
              value={settings.cameraYawDeg}
              onChange={(e) => patchVisual({ cameraYawDeg: Number(e.target.value) })}
              className="h-1.5 w-full accent-emerald-400 cursor-pointer"
            />
          </label>
        </div>

        {/* First-Person Mouse Speed (slider 0.1..5.0 + uncapped direct numeric entry) */}
        <div className="rounded border border-slate-800/80 bg-[#070a0f] p-2.5 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-300 font-medium">
              Mouse Speed <span className="text-slate-500 font-normal">(First-Person Look · Uncapped typing)</span>
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                aria-label="Mouse Speed Value"
                data-testid="mouse-speed-input"
                min={0.01}
                step="any"
                value={mouseDraft}
                onChange={(e) => handleMouseDraftChange(e.target.value)}
                onBlur={handleMouseDraftBlur}
                className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-right font-mono-num text-xs font-semibold text-emerald-300 focus:border-emerald-400 focus:outline-none"
              />
              <span className="font-mono-num text-[11px] text-slate-400">x</span>
            </div>
          </div>
          <input
            type="range"
            aria-label="Mouse Speed"
            data-testid="mouse-speed-slider"
            min={0.1}
            max={5.0}
            step={0.05}
            value={Math.min(5.0, Math.max(0.1, settings.mouseSensitivity))}
            onChange={(e) => {
              const v = Number(e.target.value);
              setMouseDraft(v.toFixed(2));
              patchVisual({ mouseSensitivity: v });
            }}
            className="h-1.5 w-full accent-emerald-400 cursor-pointer"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">Vignette Intensity</span>
              <span className="font-mono-num font-semibold text-slate-200">
                {settings.vignetteIntensity.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              aria-label="Vignette Intensity"
              min={0}
              max={1.5}
              step={0.05}
              value={settings.vignetteIntensity}
              onChange={(e) => patchVisual({ vignetteIntensity: Number(e.target.value) })}
              className="h-1.5 w-full accent-slate-300 cursor-pointer"
            />
          </label>

          <label className="block space-y-1 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">Film Grain</span>
              <span className="font-mono-num font-semibold text-slate-200">
                {settings.filmGrain.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              aria-label="Film Grain"
              min={0}
              max={1.0}
              step={0.02}
              value={settings.filmGrain}
              onChange={(e) => patchVisual({ filmGrain: Number(e.target.value) })}
              className="h-1.5 w-full accent-slate-300 cursor-pointer"
            />
          </label>
        </div>

        <div className="space-y-1.5 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-300">Color Grade</span>
            <span className="font-mono-num text-[10px] text-slate-400">
              {GRADE_OPTIONS.find((g) => g.id === settings.colorGrade)?.label}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {GRADE_OPTIONS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => patchVisual({ colorGrade: g.id })}
                className={`rounded border px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                  settings.colorGrade === g.id
                    ? 'border-emerald-500/70 bg-emerald-500/15 text-emerald-200'
                    : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:text-slate-200'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* HDR1000 & Tone Mapping */}
      <div className="rounded-md border border-slate-800 bg-slate-950/75 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-200">
            <Sun className="h-3.5 w-3.5 text-amber-400" />
            <span>HDR1000 Display &amp; Tone Mapping</span>
          </div>
          <span
            className={`rounded border px-2 py-0.5 text-[10px] font-semibold font-mono-num ${
              hdrActive
                ? 'border-amber-500/60 bg-amber-950/60 text-amber-200'
                : 'border-slate-700 bg-[#070a0f] text-slate-400'
            }`}
          >
            {caps.displayHdr ? 'HDR Display Detected' : 'SDR Display'} ·{' '}
            {hdrActive ? 'Extended HalfFloat Active' : 'Standard sRGB Output'}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">HDR Output Mode</span>
              <span className="font-mono-num text-[10px] text-slate-400">
                {rendererBackend ?? (caps.webgpuAvailable ? 'WebGPU' : 'WebGL2')}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {HDR_MODE_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => patchVisual({ hdrMode: m.id })}
                  className={`rounded border px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                    settings.hdrMode === m.id
                      ? 'border-amber-500/70 bg-amber-500/15 text-amber-200'
                      : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">Tone Mapping</span>
              <span className="font-mono-num text-[10px] text-slate-400">
                {caps.wideGamutP3 ? 'P3 / scRGB' : 'Rec.709'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {TONE_MAP_OPTIONS.map((tm) => (
                <button
                  key={tm.id}
                  type="button"
                  onClick={() => patchVisual({ toneMapping: tm.id })}
                  className={`rounded border px-1.5 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                    settings.toneMapping === tm.id
                      ? 'border-amber-500/70 bg-amber-500/15 text-amber-200'
                      : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tm.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block space-y-1 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">HDR Peak Luminance</span>
              <span className="font-mono-num font-semibold text-amber-300">
                {Math.round(settings.hdrPeakNits)} nits
              </span>
            </div>
            <input
              type="range"
              aria-label="HDR Peak Luminance"
              min={400}
              max={1600}
              step={50}
              disabled={settings.hdrMode === 'OFF'}
              value={settings.hdrPeakNits}
              onChange={(e) => patchVisual({ hdrPeakNits: Number(e.target.value) })}
              className="h-1.5 w-full accent-amber-400 cursor-pointer disabled:opacity-40"
            />
          </label>

          <label className="block space-y-1 rounded border border-slate-800/80 bg-[#070a0f] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">Paper White Brightness</span>
              <span className="font-mono-num font-semibold text-amber-300">
                {Math.round(settings.hdrPaperWhiteNits)} nits
              </span>
            </div>
            <input
              type="range"
              aria-label="Paper White Brightness"
              min={80}
              max={400}
              step={5}
              disabled={settings.hdrMode === 'OFF'}
              value={settings.hdrPaperWhiteNits}
              onChange={(e) => patchVisual({ hdrPaperWhiteNits: Number(e.target.value) })}
              className="h-1.5 w-full accent-amber-400 cursor-pointer disabled:opacity-40"
            />
          </label>
        </div>
      </div>
    </div>
  );
};
