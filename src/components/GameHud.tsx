import React from 'react';
import { AlertTriangle, Backpack, BookOpen, Bug, Flashlight, PackageMinus, Pause, Volume2, VolumeX } from 'lucide-react';
import { getRoomGuidanceLabel } from '../game/renderer';
import { getDeckLabel, HudSnapshot, ITEM_CATALOG } from '../game/types';

interface GameHudProps {
  hud: HudSnapshot;
  muted: boolean;
  showDebugButton: boolean;
  debugOpen: boolean;
  onToggleMute: () => void;
  onToggleDebug: () => void;
  onToggleJournal: () => void;
  onPause: () => void;
  onSelectSlot: (idx: number) => void;
  onUseSelected: () => void;
  onDropSelected: () => void;
}

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  muted,
  showDebugButton,
  debugOpen,
  onToggleMute,
  onToggleDebug,
  onToggleJournal,
  onPause,
  onSelectSlot,
  onUseSelected,
  onDropSelected,
}) => {
  const bruteAlertText =
    hud.bruteState === 'CHASE' || hud.bruteState === 'SMASH_DOOR'
      ? 'HUNTING YOU'
      : hud.bruteState === 'STALK'
        ? 'STALKING CLUE'
        : hud.bruteState === 'CHECK_HIDING' || hud.bruteState === 'SEARCH_ROOM'
          ? 'SWEEPING AREA'
          : hud.bruteState === 'STUNNED'
            ? 'BLINDED'
            : null;

  const activeRouteAlert =
    hud.heliState === 'READY'
      ? { label: 'Chopper READY — Press E at Deck 3 Helideck', tone: 'text-emerald-300' }
      : hud.lifeboatState === 'READY'
        ? { label: 'Lifeboat READY — Press E at Deck 2 Davit', tone: 'text-emerald-300' }
        : hud.submarineState === 'READY'
          ? { label: 'Submarine READY — Press E at Deck 1 Moonpool', tone: 'text-emerald-300' }
          : hud.heliState === 'ACTIVATING'
            ? {
                label: `Turbine Spinning Up (${Math.round(hud.heliActivationProgress * 100)}%)`,
                tone: 'text-amber-300',
              }
            : hud.lifeboatState === 'ACTIVATING'
              ? {
                  label: `Davit Crane Lowering (${Math.round(hud.lifeboatActivationProgress * 100)}%)`,
                  tone: 'text-sky-300',
                }
              : hud.submarineState === 'ACTIVATING'
                ? {
                    label: `Floodgate Deluge (${Math.round(hud.submarineActivationProgress * 100)}%)`,
                    tone: 'text-emerald-300',
                  }
                : null;

  const hasSelectedItem = Boolean(hud.inventory[hud.selectedSlot]);

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-2.5 sm:p-5">
      {/* Top Row */}
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        {/* Top-Left: Location + Escape Journal Toggle */}
        <div
          data-hud-panel="top-left"
          className="pointer-events-auto rounded-md border border-slate-800/80 bg-[#090d14]/88 px-2.5 py-2 sm:px-3.5 sm:py-2.5 backdrop-blur-sm max-w-[calc(100vw-215px)] sm:max-w-none"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs">
            <span className="font-medium text-slate-400">
              {getDeckLabel(hud.currentDeck)}
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-semibold text-slate-100">
              {getRoomGuidanceLabel(hud.currentRoom)}
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono-num text-slate-400">{formatTime(hud.elapsedSeconds)}</span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono-num text-slate-400">{hud.zoom.toFixed(2)}x</span>
            {bruteAlertText && (
              <>
                <span className="text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span className="font-semibold text-orange-400">{bruteAlertText}</span>
              </>
            )}
          </div>

          <div className="mt-1.5 sm:mt-2 flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
            <button
              type="button"
              onClick={onToggleJournal}
              className={`flex items-center gap-1.5 rounded border px-2 py-0.5 sm:px-2.5 sm:py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                hud.journalOpen
                  ? 'border-amber-400/80 bg-amber-500/15 text-amber-200'
                  : 'border-slate-700/80 bg-slate-900/90 text-slate-200 hover:border-slate-500 hover:text-white'
              }`}
            >
              <BookOpen className="h-3 w-3 text-amber-300" />
              <span>Escape Journal [J]</span>
            </button>

            <span className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono-num">
              <Backpack className={`h-3.5 w-3.5 ${hud.hasBackpack ? 'text-orange-400' : 'text-slate-500'}`} />
              <span>
                Pack {hud.inventory.length}/{hud.maxInventorySlots}
              </span>
            </span>

            {activeRouteAlert && (
              <span className={`text-[11px] font-semibold ${activeRouteAlert.tone}`}>
                {activeRouteAlert.label}
              </span>
            )}
          </div>
        </div>

        {/* Top-Right: Debug (when unlocked), Audio & Pause */}
        <div data-hud-panel="top-right" className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 shrink-0">
          {showDebugButton && (
            <button
              type="button"
              onClick={onToggleDebug}
              aria-label="Toggle debug panel"
              className={`flex h-8 sm:h-9 items-center gap-1.5 rounded-md border px-2 sm:px-3 text-[11px] sm:text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                debugOpen
                  ? 'border-orange-500/80 bg-orange-500/15 text-orange-200'
                  : 'border-slate-800 bg-[#090d14]/88 text-slate-300 hover:border-slate-700 hover:text-white'
              }`}
            >
              <Bug className="h-3.5 w-3.5" />
              <span>Debug</span>
            </button>
          )}
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            className="flex h-8 sm:h-9 items-center gap-1.5 rounded-md border border-slate-800 bg-[#090d14]/88 px-2 sm:px-3 text-[11px] sm:text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            <span>{muted ? 'Muted' : 'Audio'}</span>
          </button>
          <button
            type="button"
            onClick={onPause}
            className="flex h-8 sm:h-9 items-center gap-1.5 rounded-md border border-slate-800 bg-[#090d14]/88 px-2 sm:px-3 text-[11px] sm:text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Pause className="h-3.5 w-3.5" />
            <span>Pause</span>
          </button>
        </div>
      </div>

      {/* Center-Bottom Toast & Interaction Prompt */}
      <div className="mt-auto mb-2.5 sm:mb-3.5 flex flex-col items-center gap-2 sm:gap-2.5">
        {hud.toastMessage && (
          <div className="max-w-[90vw] rounded-md border border-slate-700/80 bg-[#0c111a]/95 px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs font-medium text-slate-100 shadow-lg text-center">
            {hud.toastMessage}
          </div>
        )}

        {hud.actionLabel && (
          <div className="w-64 sm:w-72 rounded-md border border-amber-500/50 bg-[#0c111a]/95 p-2.5 text-center">
            <div className="text-xs font-semibold text-amber-300 mb-1.5">{hud.actionLabel}</div>
            <div className="h-2 w-full overflow-hidden rounded-sm bg-slate-800">
              <div
                className="h-full bg-amber-400 transition-all duration-75"
                style={{ width: `${Math.min(100, Math.round(hud.actionProgress * 100))}%` }}
              />
            </div>
          </div>
        )}

        {hud.climbLabel && (
          <div className="w-56 sm:w-64 rounded-md border border-sky-500/50 bg-[#0c111a]/95 p-2.5 text-center">
            <div className="text-xs font-semibold text-sky-300 mb-1.5">{hud.climbLabel}</div>
            <div className="h-2 w-full overflow-hidden rounded-sm bg-slate-800">
              <div
                className="h-full bg-sky-400 transition-all duration-75"
                style={{ width: `${Math.min(100, Math.round(hud.climbProgress * 100))}%` }}
              />
            </div>
          </div>
        )}

        {hud.promptText && (
          <div className="max-w-[90vw] rounded-md border border-slate-700/70 bg-[#090d14]/90 px-3.5 py-1.5 sm:px-4 sm:py-2 text-center backdrop-blur-sm">
            <div className="text-xs font-semibold text-slate-100">{hud.promptText}</div>
            {hud.promptSubtext && (
              <div className="mt-0.5 text-[11px] text-slate-400">{hud.promptSubtext}</div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Row */}
      <div className="flex flex-wrap items-end justify-between gap-2 sm:gap-4">
        {/* Bottom-Left: Stamina & Flashlight */}
        <div
          data-hud-panel="bottom-left"
          className="pointer-events-auto w-44 sm:w-60 rounded-md border border-slate-800/80 bg-[#090d14]/88 p-2.5 sm:p-3 backdrop-blur-sm space-y-2 sm:space-y-2.5 shrink-0"
        >
          {hud.steamStaggered && (
            <div className="flex items-center gap-1.5 rounded border border-rose-500/60 bg-rose-950/75 px-2 py-1 text-[10px] font-bold tracking-wide text-rose-200 uppercase">
              <AlertTriangle className="h-3 w-3 shrink-0 text-rose-400" />
              <span className="truncate">Steam Staggered · No Sprint</span>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="font-medium text-slate-300 truncate">
                {hud.hiding
                  ? 'Stamina (Hiding)'
                  : hud.steamStaggered
                    ? 'Stamina (Limping)'
                    : hud.crouching
                      ? 'Stamina (Sneak)'
                      : 'Stamina'}
              </span>
              <span className="font-mono-num text-slate-300">{Math.round(hud.stamina)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-sm bg-slate-800">
              <div
                className={`h-full transition-all duration-75 ${
                  hud.stamina < 25 ? 'bg-red-500' : 'bg-slate-200'
                }`}
                style={{ width: `${Math.round(hud.stamina)}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="flex items-center gap-1.5 font-medium text-slate-300 truncate">
                <Flashlight className="h-3 w-3 shrink-0 text-amber-300" />
                <span>Flashlight {hud.flashlightOn ? 'ON' : 'OFF'}</span>
              </span>
              <span className="font-mono-num text-slate-300">{Math.round(hud.battery)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-sm bg-slate-800">
              <div
                className={`h-full transition-all duration-75 ${
                  hud.battery < 20 ? 'bg-orange-500' : 'bg-amber-300'
                }`}
                style={{ width: `${Math.round(hud.battery)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Bottom-Right: Dynamic 4-to-6 Slot Survival Tool & Escape Pack */}
        <div
          data-hud-panel="bottom-right"
          className="pointer-events-auto flex items-center gap-1 sm:gap-1.5 rounded-md border border-slate-800/80 bg-[#090d14]/88 p-1.5 sm:p-2 backdrop-blur-sm max-w-full overflow-x-auto"
        >
          {Array.from({ length: hud.maxInventorySlots }, (_, slotIdx) => {
            const itemId = hud.inventory[slotIdx];
            const meta = itemId ? ITEM_CATALOG[itemId] : null;
            const selected = hud.selectedSlot === slotIdx;
            const isEscapePart =
              meta?.category === 'LIFEBOAT_PART' ||
              meta?.category === 'HELI_PART' ||
              meta?.category === 'SUBMARINE_PART';

            return (
              <button
                key={slotIdx}
                type="button"
                onClick={() => {
                  if (selected && meta) {
                    onUseSelected();
                  } else {
                    onSelectSlot(slotIdx);
                  }
                }}
                title={
                  meta
                    ? `${meta.name}: ${meta.description} (Press G to drop)`
                    : `Empty Slot ${slotIdx + 1}`
                }
                className={`flex h-11 sm:h-12 flex-col items-start justify-between rounded border px-1.5 py-1 sm:px-2 sm:py-1.5 text-left transition-colors cursor-pointer shrink-0 ${
                  hud.maxInventorySlots > 4 ? 'w-12 sm:w-[68px]' : 'w-14 sm:w-20'
                } ${
                  selected
                    ? 'border-orange-400 bg-slate-800/90 text-white'
                    : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="font-mono-num text-[10px] text-slate-500">{slotIdx + 1}</span>
                  {meta && (
                    <span
                      className="h-1.5 w-1.5 rounded-xs"
                      style={{
                        backgroundColor: isEscapePart ? meta.color : '#94a3b8',
                      }}
                    />
                  )}
                </div>
                <span className="w-full truncate text-[10px] sm:text-[11px] font-medium">
                  {meta ? meta.shortName : 'Empty'}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            disabled={!hasSelectedItem}
            onClick={onDropSelected}
            title="Drop selected item onto the deck without using it (G)"
            className={`ml-0.5 sm:ml-1 flex h-11 sm:h-12 flex-col items-center justify-center rounded border px-2 sm:px-2.5 text-[10px] font-medium transition-colors whitespace-nowrap shrink-0 ${
              hasSelectedItem
                ? 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500 hover:text-white cursor-pointer'
                : 'border-slate-800/70 bg-slate-950/40 text-slate-600 cursor-not-allowed'
            }`}
          >
            <PackageMinus className="h-3.5 w-3.5 mb-0.5" />
            <span>Drop [G]</span>
          </button>
        </div>
      </div>
    </div>
  );
};
