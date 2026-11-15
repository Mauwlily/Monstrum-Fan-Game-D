import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Film } from 'lucide-react';
import { RunStats } from '../game/types';

interface EscapeCutsceneModalProps {
  stats: RunStats;
  onAdvanceFrame?: () => void;
  onComplete: () => void;
}

interface CutsceneFrame {
  reelLabel: string;
  headline: string;
  caption: string;
  renderSvg: () => React.ReactNode;
}

const HELI_FRAMES: CutsceneFrame[] = [
  {
    reelLabel: 'REEL 01 · STERN HELIDECK',
    headline: 'CLEAR FOR UNQUALIFIED TAKEOFF',
    caption:
      'Against every aviation statute known to humanity, you duct-taped a turbine fuse in the dark and hopped into a chopper you learned to fly purely by pressing E.',
    renderSvg: () => (
      <svg viewBox="0 0 640 300" className="h-full w-full bg-[#060606]" aria-hidden="true">
        <defs>
          <radialGradient id="noirSpot1" cx="52%" cy="46%" r="54%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
            <stop offset="65%" stopColor="#9ca3af" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.95" />
          </radialGradient>
        </defs>
        <rect width="640" height="300" fill="#060606" />
        <rect width="640" height="300" fill="url(#noirSpot1)" />
        {/* Deck horizon & stanchions */}
        <line x1="0" y1="238" x2="640" y2="238" stroke="#d4d4d4" strokeWidth="2.5" />
        <text x="108" y="274" fill="#525252" fontSize="34" fontWeight="800" fontFamily="monospace">
          H
        </text>
        {/* Spinning blur blades */}
        <ellipse cx="330" cy="112" rx="185" ry="12" fill="none" stroke="#e5e5e5" strokeWidth="3" strokeDasharray="18 10" />
        <line x1="140" y1="112" x2="520" y2="112" stroke="#ffffff" strokeWidth="4" />
        {/* Chopper body */}
        <ellipse cx="330" cy="166" rx="88" ry="38" fill="#1a1a1a" stroke="#e5e5e5" strokeWidth="3" />
        <path d="M242,162 L135,146 L135,164 L245,176 Z" fill="#262626" stroke="#d4d4d4" strokeWidth="2.5" />
        <rect x="126" y="132" width="12" height="36" fill="#e5e5e5" />
        {/* Skids */}
        <line x1="276" y1="204" x2="268" y2="236" stroke="#d4d4d4" strokeWidth="4" />
        <line x1="382" y1="204" x2="390" y2="236" stroke="#d4d4d4" strokeWidth="4" />
        <line x1="246" y1="236" x2="416" y2="236" stroke="#ffffff" strokeWidth="5" />
        {/* Cockpit window with goofy giant :D survivor */}
        <path d="M342,135 Q404,138 410,168 L342,168 Z" fill="#0a0a0a" stroke="#ffffff" strokeWidth="2.5" />
        <circle cx="368" cy="156" r="14" fill="#f5f5f5" />
        <circle cx="363" cy="152" r="2.2" fill="#000000" />
        <circle cx="373" cy="152" r="2.2" fill="#000000" />
        <path d="M361,158 Q368,167 375,158 Z" fill="#000000" />
        {/* Confused Brute silhouette left behind on deck */}
        <g transform="translate(86, 178)">
          <path d="M-24,58 L-18,12 L18,12 L24,58 Z" fill="#171717" stroke="#a3a3a3" strokeWidth="2.2" />
          <circle cx="0" cy="4" r="14" fill="#171717" stroke="#d4d4d4" strokeWidth="2.2" />
          <circle cx="-4" cy="2" r="2.2" fill="#ffffff" />
          <circle cx="4" cy="2" r="2.2" fill="#ffffff" />
          <text x="16" y="-8" fill="#e5e5e5" fontSize="22" fontWeight="700" fontFamily="monospace">
            ?!
          </text>
        </g>
      </svg>
    ),
  },
  {
    reelLabel: 'REEL 02 · ABOVE THE HULL',
    headline: 'NO LICENCE, NO COMPASS, BIG SMILE',
    caption:
      'Half the ship manual blew out the side door while you tried yanking the collective stick both ways at once. Somehow, verticality was achieved :D',
    renderSvg: () => (
      <svg viewBox="0 0 640 300" className="h-full w-full bg-[#050505]" aria-hidden="true">
        <rect width="640" height="300" fill="#050505" />
        {/* Rain streaks */}
        {[60, 140, 220, 310, 410, 505, 580].map((rx, i) => (
          <line
            key={rx}
            x1={rx}
            y1={20 + (i % 3) * 30}
            x2={rx - 28}
            y2={135 + (i % 2) * 45}
            stroke="#525252"
            strokeWidth="1.5"
            strokeDasharray="8 10"
          />
        ))}
        {/* Tilted erratic helicopter */}
        <g transform="translate(335, 136) rotate(-17)">
          <line x1="-155" y1="-54" x2="155" y2="-54" stroke="#ffffff" strokeWidth="4.5" />
          <ellipse cx="0" cy="-54" rx="165" ry="9" fill="none" stroke="#a3a3a3" strokeWidth="2" />
          <rect x="-8" y="-54" width="16" height="22" fill="#e5e5e5" />
          <ellipse cx="0" cy="0" rx="82" ry="34" fill="#171717" stroke="#ffffff" strokeWidth="3" />
          <path d="M-80,-4 L-170,-16 L-170,2 L-80,12 Z" fill="#262626" stroke="#d4d4d4" strokeWidth="2.5" />
          {/* Flying crew manual pages out the window */}
          <rect x="-48" y="34" width="18" height="14" transform="rotate(24 -48 34)" fill="#f5f5f5" />
          <rect x="-88" y="54" width="16" height="12" transform="rotate(-18 -88 54)" fill="#d4d4d4" />
          <text x="-43" y="44" fill="#000" fontSize="8" fontWeight="800">
            ?
          </text>
          {/* Cockpit with joyful :D face */}
          <path d="M18,-28 Q74,-22 76,4 L18,4 Z" fill="#0a0a0a" stroke="#ffffff" strokeWidth="2.5" />
          <circle cx="44" cy="-10" r="14" fill="#ffffff" />
          <circle cx="39" cy="-13" r="2.2" fill="#000000" />
          <circle cx="49" cy="-13" r="2.2" fill="#000000" />
          <path d="M37,-7 Q44,2 51,-7 Z" fill="#000000" />
        </g>
        {/* Distant shrinking ship silhouette */}
        <path d="M35,274 L210,274 L225,256 L24,256 Z" fill="#262626" stroke="#737373" strokeWidth="2" />
        <rect x="64" y="236" width="38" height="20" fill="#171717" stroke="#737373" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    reelLabel: 'REEL 03 · OPEN NORTH ATLANTIC',
    headline: 'FUEL GAUGE: ZERO · VIBES: IMMACULATE :D',
    caption:
      'The low-fuel buzzer is screaming, the cabin smells like burnt fuse wire, and you still forgot where land is—but at least the Brute cannot swim up here.',
    renderSvg: () => (
      <svg viewBox="0 0 640 300" className="h-full w-full bg-[#040404]" aria-hidden="true">
        <rect width="640" height="300" fill="#040404" />
        {/* Moonlit noir clouds & ocean */}
        <circle cx="515" cy="76" r="34" fill="#f5f5f5" />
        <circle cx="502" cy="70" r="32" fill="#040404" />
        <path d="M0,252 Q80,242 160,252 T320,252 T480,252 T640,252" fill="none" stroke="#737373" strokeWidth="2.5" />
        <path d="M0,272 Q90,262 180,272 T360,272 T540,272 T640,272" fill="none" stroke="#525252" strokeWidth="2" />
        {/* Close-up of cockpit dash + giant happy survivor */}
        <rect x="130" y="96" width="380" height="175" rx="18" fill="#111111" stroke="#e5e5e5" strokeWidth="3.5" />
        {/* Instrument gauges */}
        <circle cx="205" cy="198" r="24" fill="#000000" stroke="#d4d4d4" strokeWidth="2.5" />
        <text x="197" y="203" fill="#ffffff" fontSize="14" fontWeight="800" fontFamily="monospace">
          E!
        </text>
        <circle cx="268" cy="198" r="20" fill="#000000" stroke="#a3a3a3" strokeWidth="2" />
        <line x1="268" y1="198" x2="254" y2="186" stroke="#ffffff" strokeWidth="2.5" />
        {/* Survivor giving thumbs-up inside frame */}
        <circle cx="388" cy="176" r="46" fill="#f5f5f5" stroke="#ffffff" strokeWidth="3" />
        <circle cx="372" cy="166" r="6" fill="#000000" />
        <circle cx="404" cy="166" r="6" fill="#000000" />
        <path d="M366,184 Q388,214 410,184 Z" fill="#000000" />
        {/* Thumbs up */}
        <rect x="448" y="182" width="28" height="24" rx="5" fill="#e5e5e5" />
        <rect x="454" y="156" width="12" height="28" rx="5" fill="#ffffff" />
        <text x="166" y="142" fill="#f5f5f5" fontSize="22" fontWeight="800" fontFamily="monospace">
          ESCAPED ALIVE :D
        </text>
      </svg>
    ),
  },
];

const LIFEBOAT_FRAMES: CutsceneFrame[] = [
  {
    reelLabel: 'REEL 01 · BOW DAVIT RAIL',
    headline: 'FULL SPEED DOWNWARD',
    caption:
      'The hydraulic davit crank screamed louder than a foghorn. You slammed the release pin, vaulted inside, and forgot whether lifeboats come with brakes.',
    renderSvg: () => (
      <svg viewBox="0 0 640 300" className="h-full w-full bg-[#060606]" aria-hidden="true">
        <rect width="640" height="300" fill="#060606" />
        {/* Ship bow wall & crane arms */}
        <rect x="40" y="54" width="170" height="215" fill="#171717" stroke="#d4d4d4" strokeWidth="3" />
        <line x1="178" y1="74" x2="345" y2="52" stroke="#e5e5e5" strokeWidth="8" strokeLinecap="round" />
        <line x1="210" y1="95" x2="380" y2="70" stroke="#a3a3a3" strokeWidth="6" strokeLinecap="round" />
        {/* Taut vertical cables */}
        <line x1="330" y1="54" x2="330" y2="162" stroke="#d4d4d4" strokeWidth="2" strokeDasharray="5 3" />
        <line x1="400" y1="68" x2="400" y2="162" stroke="#d4d4d4" strokeWidth="2" strokeDasharray="5 3" />
        {/* Dropping lifeboat + happy survivor */}
        <g transform="translate(366, 174) rotate(8)">
          <path d="M-68,-8 L68,-8 L52,24 L-52,24 Z" fill="#e5e5e5" stroke="#ffffff" strokeWidth="3" />
          <circle cx="0" cy="-24" r="16" fill="#ffffff" />
          <circle cx="-5" cy="-27" r="2.4" fill="#000000" />
          <circle cx="5" cy="-27" r="2.4" fill="#000000" />
          <path d="M-7,-20 Q0,-10 7,-20 Z" fill="#000000" />
        </g>
        {/* Choppy waves below */}
        <path d="M210,256 Q270,242 330,256 T450,256 T570,256 T640,256" fill="none" stroke="#d4d4d4" strokeWidth="3" />
        <text x="456" y="138" fill="#a3a3a3" fontSize="18" fontWeight="700" fontFamily="monospace">
          WHEEE!!
        </text>
      </svg>
    ),
  },
  {
    reelLabel: 'REEL 02 · SPLASHDOWN',
    headline: 'DUCT-TAPE HULL INTEGRITY HOLDING (MOSTLY)',
    caption:
      'A textbook 40-foot belly-flop into pitch-black swells! Two bolted hull patches rattled loose—good news: you brought a bucket and an unstoppable grin :D',
    renderSvg: () => (
      <svg viewBox="0 0 640 300" className="h-full w-full bg-[#050505]" aria-hidden="true">
        <rect width="640" height="300" fill="#050505" />
        {/* Dramatic splash plumes */}
        <path d="M215,212 Q180,130 135,152 Q165,180 185,215" fill="none" stroke="#ffffff" strokeWidth="4" />
        <path d="M425,212 Q465,120 515,148 Q480,180 455,215" fill="none" stroke="#ffffff" strokeWidth="4" />
        <circle cx="155" cy="118" r="5" fill="#e5e5e5" />
        <circle cx="495" cy="110" r="6" fill="#e5e5e5" />
        {/* Lifeboat bouncing in froth */}
        <g transform="translate(320, 200) rotate(-11)">
          <path d="M-84,-10 L84,-10 L62,28 L-62,28 Z" fill="#d4d4d4" stroke="#ffffff" strokeWidth="3" />
          {/* Bolted patch */}
          <rect x="-34" y="2" width="28" height="14" fill="#262626" stroke="#ffffff" strokeWidth="1.5" />
          {/* Survivor waving oar */}
          <line x1="22" y1="-12" x2="62" y2="-56" stroke="#ffffff" strokeWidth="4" />
          <circle cx="8" cy="-28" r="18" fill="#ffffff" />
          <circle cx="2" cy="-31" r="2.6" fill="#000000" />
          <circle cx="14" cy="-31" r="2.6" fill="#000000" />
          <path d="M0,-23 Q8,-12 16,-23 Z" fill="#000000" />
        </g>
        <path d="M0,232 Q80,214 160,232 T320,232 T480,232 T640,232" fill="none" stroke="#ffffff" strokeWidth="3.5" />
      </svg>
    ),
  },
  {
    reelLabel: 'REEL 03 · ADRIFT AT SEA',
    headline: 'PADDLING WITH ZERO DIRECTION :D',
    caption:
      'You forgot oars, flares, and a GPS, yet somehow the Marine Battery powers a tiny disco-bright searchlight while you drift cheerfully out of Brute range.',
    renderSvg: () => (
      <svg viewBox="0 0 640 300" className="h-full w-full bg-[#040404]" aria-hidden="true">
        <rect width="640" height="300" fill="#040404" />
        <circle cx="110" cy="68" r="26" fill="#e5e5e5" />
        {/* Tiny shrinking ship silhouette */}
        <path d="M52,196 L158,196 L166,184 L46,184 Z" fill="#262626" stroke="#737373" strokeWidth="1.5" />
        {/* Ocean waves */}
        <path d="M0,224 Q90,212 180,224 T360,224 T540,224 T640,224" fill="none" stroke="#a3a3a3" strokeWidth="2.5" />
        <path d="M0,256 Q75,244 150,256 T300,256 T450,256 T600,256" fill="none" stroke="#525252" strokeWidth="2" />
        {/* Hero close-up in lifeboat */}
        <g transform="translate(380, 198)">
          <path d="M-92,-12 L92,-12 L68,30 L-68,30 Z" fill="#262626" stroke="#ffffff" strokeWidth="3" />
          <circle cx="0" cy="-36" r="32" fill="#ffffff" />
          <circle cx="-11" cy="-42" r="4.2" fill="#000000" />
          <circle cx="11" cy="-42" r="4.2" fill="#000000" />
          <path d="M-15,-30 Q0,-10 15,-30 Z" fill="#000000" />
          <text x="-72" y="-76" fill="#ffffff" fontSize="20" fontWeight="800" fontFamily="monospace">
            BYE BRUTE :D
          </text>
        </g>
      </svg>
    ),
  },
];

export const EscapeCutsceneModal: React.FC<EscapeCutsceneModalProps> = ({
  stats,
  onAdvanceFrame,
  onComplete,
}) => {
  const frames = useMemo(
    () => (stats.escapeMethod === 'HELICOPTER' ? HELI_FRAMES : LIFEBOAT_FRAMES),
    [stats.escapeMethod]
  );
  const [frameIdx, setFrameIdx] = useState(0);
  const currentFrame = frames[frameIdx] ?? frames[0];
  const isLastFrame = frameIdx >= frames.length - 1;

  const handleNext = () => {
    onAdvanceFrame?.();
    if (isLastFrame) {
      onComplete();
    } else {
      setFrameIdx((prev) => prev + 1);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        handleNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black px-4 py-6 text-neutral-100 select-none"
      role="dialog"
      aria-label="Escape Cutscene"
    >
      {/* Monochrome 35mm Projector Scanline & Grain Overlay */}
      <div
        className="pointer-events-none fixed inset-0 opacity-20"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 3px)',
        }}
      />

      <div className="relative w-full max-w-3xl border border-neutral-700 bg-neutral-950 shadow-2xl">
        {/* Top 35mm Sprocket Strip */}
        <div className="flex items-center justify-between border-b border-neutral-800 bg-black px-4 py-2">
          <div className="flex items-center gap-2 text-xs font-mono-num tracking-widest text-neutral-400">
            <Film className="h-3.5 w-3.5 text-neutral-200" />
            <span>{currentFrame.reelLabel}</span>
          </div>
          <span className="font-mono-num text-xs text-neutral-400">
            FRAME {frameIdx + 1} / {frames.length}
          </span>
        </div>

        {/* Monochrome Animated Noir Illustration Frame */}
        <div className="relative aspect-[16/8] w-full overflow-hidden border-b border-neutral-800 bg-black">
          {currentFrame.renderSvg()}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at center, transparent 58%, rgba(0, 0, 0, 0.78) 100%)',
            }}
          />
        </div>

        {/* Noir Storyboard Caption & Controls */}
        <div className="p-6">
          <h2 className="font-display text-3xl font-bold tracking-wide text-white">
            {currentFrame.headline}
          </h2>
          <p className="mt-2 min-h-[3.2rem] text-sm leading-relaxed text-neutral-300">
            {currentFrame.caption}
          </p>

          <div className="mt-6 flex items-center justify-between gap-4 border-t border-neutral-800 pt-4">
            <button
              type="button"
              onClick={() => {
                onAdvanceFrame?.();
                onComplete();
              }}
              className="rounded border border-neutral-700 bg-transparent px-3.5 py-2 text-xs font-medium text-neutral-400 transition-colors hover:border-neutral-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              Skip to Summary
            </button>

            <button
              type="button"
              onClick={handleNext}
              className="flex items-center gap-1.5 rounded bg-neutral-100 px-5 py-2.5 text-xs font-bold tracking-wider text-black uppercase transition-colors hover:bg-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>{isLastFrame ? 'Finish Escape [Space]' : 'Next Reel Frame [Space]'}</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
