export function Wordmark() {
  return <span className="font-serif text-[28px] leading-none font-bold sm:text-[33px] tracking-[-0.05em] text-[#1b1b1b]">modelstill</span>;
}

export function StillMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 142 108" className={className} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <g stroke="#1b1b1b" strokeWidth="1.6">
        <path d="M16 20l3 3M19 20l-3 3" />
        <path d="M52 5l2.5 2.5M54.5 5l-2.5 2.5" />
        <path d="M96 46l2.5 2.5M98.5 46l-2.5 2.5" />
        <path d="M66 22h2" />
        <path d="M22 9h2" />
        <path d="M8 34h2" />
      </g>
      <g stroke="#6b8e12" strokeWidth="5.5">
        <path d="M30 96c-9-3-15-12-15-22 0-11 7-19 15-23V30" />
        <path d="M46 96c9-3 15-12 15-22 0-11-7-19-15-23V30" />
        <path d="M26 30h24" />
        <path d="M30 96h16" />
        <path d="M38 30V18c0-6 5-10 11-10h14" />
        <path d="M22 70c5 4 11 6 16 6s11-2 16-6" strokeWidth="3.5" />
        <path d="M38 40v14" strokeWidth="3.5" />
      </g>
      <g stroke="#f47c0e" strokeWidth="3.5" transform="translate(20 2)">
        <path className="burst-ray" style={{ "--ray": 0 } as React.CSSProperties} d="M70 100l-4-16" />
        <path className="burst-ray" style={{ "--ray": 1 } as React.CSSProperties} d="M78 100l-1-20" />
        <path className="burst-ray" style={{ "--ray": 2 } as React.CSSProperties} d="M86 100l3-19" />
        <path className="burst-ray" style={{ "--ray": 3 } as React.CSSProperties} d="M94 100l8-17" />
        <path className="burst-ray" style={{ "--ray": 4 } as React.CSSProperties} d="M101 100l13-13" />
        <path className="burst-ray" style={{ "--ray": 5 } as React.CSSProperties} d="M106 102l14-7" />
        <path className="burst-ray" style={{ "--ray": 6 } as React.CSSProperties} d="M63 100l-10-12" />
        <path d="M82 104h.01M90 104h.01M74 104h.01" strokeWidth="2.5" />
      </g>
    </svg>
  );
}

export function Burst({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 72 44" className={className} fill="none" stroke="#f47c0e" strokeWidth="2.6" strokeLinecap="round">
      <path d="M36 40V8" />
      <path d="M31 40L27 9" />
      <path d="M41 40l4-31" />
      <path d="M27 40L17 13" />
      <path d="M45 40l10-27" />
      <path d="M23 40L9 20" />
      <path d="M49 40l14-20" />
      <path d="M19 41L4 29" />
      <path d="M53 41l15-12" />
      <path d="M16 42L2 37" />
      <path d="M56 42l14-5" />
      <path d="M33 43h.01M39 43h.01M36 44h.01" strokeWidth="2" />
    </svg>
  );
}
