import type { Motif, Post, Tone } from "@/lib/blog/types";

const WASH: Record<Tone, string> = { leaf: "wash-mist", sun: "wash-hills", sky: "wash-dunes", plum: "wash-strata" };
const INK = "#1f2a14";
const ACCENT = "#f47c0e";
const LEAF = "#6b8e12";

function Bars() {
  const pairs = [
    [62, 70],
    [80, 84],
    [54, 40],
    [72, 78],
  ];
  return (
    <g>
      {pairs.map(([before, after], index) => {
        const x = 52 + index * 64;
        return (
          <g key={x}>
            <rect x={x} y={150 - before!} width="20" height={before} rx="4" fill={INK} opacity="0.85" />
            <rect x={x + 24} y={150 - after!} width="20" height={after} rx="4" fill={after! < before! ? ACCENT : LEAF} />
          </g>
        );
      })}
      <line x1="40" x2="320" y1="151" y2="151" stroke={INK} strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

function Intervals() {
  const rows = [
    [168, 230, 292, INK],
    [130, 196, 262, ACCENT],
    [118, 186, 266, ACCENT],
  ] as const;
  return (
    <g>
      <line x1="250" x2="250" y1="40" y2="152" stroke={INK} strokeDasharray="5 5" opacity="0.5" />
      {rows.map(([low, value, high, colour], index) => {
        const y = 62 + index * 38;
        return (
          <g key={y}>
            <line x1={low} x2={high} y1={y} y2={y} stroke={colour} strokeWidth="6" strokeLinecap="round" opacity="0.4" />
            <circle cx={value} cy={y} r="9" fill={colour} />
          </g>
        );
      })}
    </g>
  );
}

function Layers() {
  return (
    <g>
      {[0, 1, 2].map((index) => (
        <g key={index} transform={`translate(${104 + index * 22} ${92 - index * 22})`}>
          <rect width="150" height="64" rx="10" fill="#ffffff" stroke={INK} strokeWidth="2" />
          <line x1="18" x2="96" y1="22" y2="22" stroke={index === 2 ? ACCENT : INK} strokeWidth="5" strokeLinecap="round" opacity={index === 2 ? 1 : 0.35} />
          <line x1="18" x2="126" y1="42" y2="42" stroke={INK} strokeWidth="5" strokeLinecap="round" opacity="0.2" />
        </g>
      ))}
    </g>
  );
}

function Scales() {
  return (
    <g fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M180 40v108M140 148h80M100 64h160" />
      <path d="M100 64l-26 50h52zM260 64l-26 50h52z" />
      <path d="M74 114a26 12 0 0 0 52 0" fill={LEAF} fillOpacity="0.35" />
      <path d="M234 114a26 12 0 0 0 52 0" fill={ACCENT} fillOpacity="0.45" />
      <circle cx="180" cy="36" r="6" fill={INK} />
    </g>
  );
}

const MOTIFS: Record<Motif, () => React.JSX.Element> = { bars: Bars, intervals: Intervals, layers: Layers, scales: Scales };

export function PostThumb({ post, className }: { post: Post; className?: string }) {
  const Drawing = MOTIFS[post.art.motif];
  return (
    <div aria-hidden="true" className={`relative overflow-hidden ${className ?? ""}`}>
      <div className={`absolute -inset-[40px] ${WASH[post.art.tone]}`} style={{ filter: "url(#wash-streak)" }} />
      <div className="absolute inset-[11%] rounded-[14px] bg-white/90 shadow-[0_1px_2px_rgb(0_0_0/0.08)]">
        <svg viewBox="0 0 360 190" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          <Drawing />
        </svg>
      </div>
    </div>
  );
}
