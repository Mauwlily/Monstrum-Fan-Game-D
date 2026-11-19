import React from 'react';
import { BookOpen, CheckCircle2, Compass, Package, Wrench, X } from 'lucide-react';
import { HudSnapshot, ITEM_CATALOG, ItemId } from '../game/types';

interface EscapeJournalModalProps {
  hud: HudSnapshot;
  onClose: () => void;
}

const HELI_PARTS: Array<{ id: ItemId; note: string }> = [
  { id: 'AVIATION_FUEL', note: 'Refuels port external turbine tank cell' },
  { id: 'ROTOR_FUSE', note: 'Restores starboard high-voltage rotor bus' },
  { id: 'IGNITION_KEY', note: 'Powers cockpit avionics & starter switch' },
];

const LIFEBOAT_PARTS: Array<{ id: ItemId; note: string }> = [
  { id: 'HULL_PATCH', note: 'Seals fractured upper lifeboat fiberglass hull' },
  { id: 'WINCH_CRANK', note: 'Couples hydraulic davit swing winch & cables' },
  { id: 'MARINE_BATTERY', note: 'Energizes crane floodlight & release solenoid' },
];

const SUBMARINE_PARTS: Array<{ id: ItemId; note: string }> = [
  { id: 'SUB_BATTERY', note: 'Powers Deck 1 submersible hull & ballast array' },
  { id: 'BALLAST_PUMP', note: 'Pressurizes moonpool trim & dive tanks' },
  { id: 'DIVE_KEY', note: 'Engages submersible conning drive & rudder' },
];

function getPartStatus(
  id: ItemId,
  installed: ItemId[],
  inventory: ItemId[]
): 'INSTALLED' | 'IN_PACK' | 'MISSING' {
  if (installed.includes(id)) return 'INSTALLED';
  if (inventory.includes(id)) return 'IN_PACK';
  return 'MISSING';
}

export const EscapeJournalModal: React.FC<EscapeJournalModalProps> = ({ hud, onClose }) => {
  const renderPartRow = (part: { id: ItemId; note: string }, installed: ItemId[]) => {
    const status = getPartStatus(part.id, installed, hud.inventory);
    const meta = ITEM_CATALOG[part.id];

    return (
      <div
        key={part.id}
        className="flex items-center justify-between gap-3 rounded border border-slate-800/90 bg-slate-950/75 px-3 py-2"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {status === 'INSTALLED' ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            ) : status === 'IN_PACK' ? (
              <Package className="h-3.5 w-3.5 shrink-0 text-amber-300" />
            ) : (
              <Wrench className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            )}
            <span
              className={`text-xs font-semibold ${
                status === 'INSTALLED'
                  ? 'text-emerald-300'
                  : status === 'IN_PACK'
                    ? 'text-slate-100'
                    : 'text-slate-400'
              }`}
            >
              {meta.name}
            </span>
          </div>
          <p className="mt-0.5 pl-5 text-[11px] text-slate-500 truncate">{part.note}</p>
        </div>

        <span
          className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap ${
            status === 'INSTALLED'
              ? 'border-emerald-700/60 bg-emerald-950/70 text-emerald-300'
              : status === 'IN_PACK'
                ? 'border-amber-600/60 bg-amber-950/60 text-amber-200'
                : 'border-slate-800 bg-slate-900 text-slate-500'
          }`}
        >
          {status === 'INSTALLED' ? 'INSTALLED' : status === 'IN_PACK' ? 'IN PACK' : 'MISSING'}
        </span>
      </div>
    );
  };

  const heliStatusText =
    hud.heliState === 'READY'
      ? 'Rotors at full RPM — Press E at Stern Helideck to Escape'
      : hud.heliState === 'ACTIVATING'
        ? `Turbine Spinning Up (${Math.round(hud.heliActivationProgress * 100)}%) — Hold out until 100%`
        : hud.heliParts.length === 3 && hud.heliChainsRemaining === 0
          ? 'All 3 parts fitted & chains cut — Hold E at Chopper to Spin Up'
          : hud.heliParts.length === 3
            ? `All 3 parts fitted — Cut ${hud.heliChainsRemaining} remaining steel chains (Hold E w/ Bolt Cutters)`
            : `Fit 3 parts (~5s each) & cut 6 chains w/ Bolt Cutters (2s each) — ${hud.heliParts.length}/3 fitted`;

  const boatStatusText =
    hud.lifeboatState === 'READY'
      ? 'Boat swung clear over bow rail — Press E to Board & Escape'
      : hud.lifeboatState === 'ACTIVATING'
        ? `Hydraulic Davit Lowering (${Math.round(hud.lifeboatActivationProgress * 100)}%) — Survive until 100%`
        : hud.lifeboatParts.length === 3
          ? 'All 3 parts fitted — Hold E at Bow Davit to Swing Boat Clear'
          : `Install each held part one by one (Hold E · ~5s each) — ${hud.lifeboatParts.length}/3 fitted`;

  const subStatusText =
    hud.submarineState === 'READY'
      ? 'Moonpool flooded & pressurized — Press E at Submersible to Dive'
      : hud.submarineState === 'ACTIVATING'
        ? `Floodgate Deluge (${Math.round(hud.submarineActivationProgress * 100)}%) — Survive until 100%`
        : hud.submarineParts.length === 3
          ? 'All 3 parts fitted — Hold E on Moonpool Floodgate Lever to Launch'
          : `Install each held part one by one (Hold E · ~5s each) — ${hud.submarineParts.length}/3 fitted`;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/78 px-4 backdrop-blur-sm"
      role="dialog"
      aria-label="Escape Field Journal"
    >
      <div className="w-full max-w-4xl rounded-lg border border-slate-700/90 bg-[#0b1017] p-6 shadow-2xl text-slate-100 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-amber-600/40 bg-amber-950/40 text-amber-300">
              <BookOpen className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold tracking-wide text-slate-50">
                Crew Escape Field Journal
              </h2>
              <p className="text-xs text-slate-400">
                Inspect salvage progress — three escape craft span Deck 3, Deck 2, and Deck 1.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close journal"
            className="flex h-8 items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
            <span>Close [J]</span>
          </button>
        </div>

        {/* Three Routes Grid */}
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {/* Deck 3: Stern Helicopter */}
          <div className="rounded-md border border-slate-800 bg-[#0f1621] p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-lg font-semibold text-amber-300">
                Helideck Chopper · D3
              </h3>
              <span className="font-mono-num text-xs font-semibold text-slate-300">
                {hud.heliParts.length}/3
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 rounded border border-slate-800/90 bg-slate-950/80 px-2.5 py-1 text-[11px]">
              <span className="text-slate-400">Steel Chains Cut</span>
              <span
                className={`font-mono-num font-semibold ${
                  hud.heliChainsRemaining === 0 ? 'text-emerald-300' : 'text-amber-300'
                }`}
              >
                {6 - hud.heliChainsRemaining}/6
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">{heliStatusText}</p>
            <div className="mt-3 space-y-2">
              {HELI_PARTS.map((p) => renderPartRow(p, hud.heliParts))}
            </div>
          </div>

          {/* Deck 2: Bow Lifeboat Davit */}
          <div className="rounded-md border border-slate-800 bg-[#0f1621] p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-lg font-semibold text-sky-300">
                Bow Lifeboat · D2
              </h3>
              <span className="font-mono-num text-xs font-semibold text-slate-300">
                {hud.lifeboatParts.length}/3
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">{boatStatusText}</p>
            <div className="mt-3 space-y-2">
              {LIFEBOAT_PARTS.map((p) => renderPartRow(p, hud.lifeboatParts))}
            </div>
          </div>

          {/* Deck 1: Moonpool Submarine */}
          <div className="rounded-md border border-slate-800 bg-[#0f1621] p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-lg font-semibold text-emerald-300">
                Submarine Bay · D1
              </h3>
              <span className="font-mono-num text-xs font-semibold text-slate-300">
                {hud.submarineParts.length}/3
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">{subStatusText}</p>
            <div className="mt-3 space-y-2">
              {SUBMARINE_PARTS.map((p) => renderPartRow(p, hud.submarineParts))}
            </div>
          </div>
        </div>

        {/* Pack Capacity & Field Notes Footer */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-800/90 bg-slate-950/70 px-4 py-3 text-xs">
          <div className="flex items-center gap-2.5">
            <Compass className="h-4 w-4 shrink-0 text-orange-400" />
            <div>
              <span className="font-semibold text-slate-200">
                Pack Capacity: {hud.inventory.length}/{hud.maxInventorySlots} Slots
              </span>
              <span className="mx-2 text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className={hud.hasBackpack ? 'text-orange-300 font-medium' : 'text-slate-400'}>
                {hud.hasBackpack
                  ? 'Crew Backpack Equipped (+2 Bonus Slots)'
                  : 'Base Satchel (Find Crew Backpack aboard ship for +2 slots)'}
              </span>
            </div>
          </div>
          <span className="text-[11px] text-slate-400">
            <span className="font-semibold text-slate-200">Bolt Cutters</span> are reusable on padlocked vaults &amp; chopper chains ·{' '}
            <span className="font-semibold text-slate-200">[G]</span> drops held item.
          </span>
        </div>
      </div>
    </div>
  );
};
