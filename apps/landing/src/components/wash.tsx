import type { ReactNode } from "react";

export function WashFilters() {
  return (
    <svg aria-hidden="true" width="0" height="0" className="absolute">
      <defs>
        <filter id="wash-streak" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.003 0.06" numOctaves="3" seed="7" result="streaks" />
          <feDisplacementMap in="SourceGraphic" in2="streaks" scale="60" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="wash-edge" x="-3%" y="-3%" width="106%" height="106%">
          <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="3" result="edges" />
          <feDisplacementMap in="SourceGraphic" in2="edges" scale="9" xChannelSelector="G" yChannelSelector="R" />
        </filter>
        <filter id="rough-line" x="-5%" y="-300%" width="110%" height="700%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.4" numOctaves="2" seed="11" result="wobble" />
          <feDisplacementMap in="SourceGraphic" in2="wobble" scale="5" />
        </filter>
      </defs>
    </svg>
  );
}

export function Wash({ variant, className, children }: { variant: "strata" | "hills" | "mist"; className?: string; children: ReactNode }) {
  return (
    <div className={`relative ${className ?? ""}`}>
      <div aria-hidden="true" className="absolute inset-0" style={{ filter: "url(#wash-edge)" }}>
        <div className="absolute inset-0 overflow-hidden">
          <div className={`absolute -inset-[40px] wash-${variant}`} style={{ filter: "url(#wash-streak)" }} />
        </div>
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
