import { HERO } from "@/lib/content";
import { CtaButton } from "./header";
import { StillMark } from "./marks";

export function Hero() {
  return (
    <section className="flex flex-col items-center px-4 pt-[28px] text-center sm:px-6 sm:pt-[52px]">
      <h1 className="display hero-enter text-[clamp(28px,8.2vw,75px)] leading-[1.05]">
        <span className="block whitespace-nowrap">
          {HERO.before}
          <span className="relative mr-[0.14em] ml-[0.1em] inline-block h-[0.6em] w-[1.78em] align-baseline">
            <StillMark className="absolute bottom-[-0.08em] left-0 h-[1.38em] w-[1.78em]" />
          </span>
          {HERO.after}
        </span>
        <span className="mt-[0.16em] block">
          <em className="pr-[0.06em] italic">{HERO.emphasis}</em> {HERO.rest}
        </span>
      </h1>
      <p className="hero-enter mt-[20px] text-[15px] tracking-[0.01em] text-text sm:mt-[26px] sm:text-[16px]" style={{ "--enter-delay": "140ms" } as React.CSSProperties}>{HERO.tagline}</p>
      <span className="hero-enter mt-[26px] inline-flex" style={{ "--enter-delay": "260ms" } as React.CSSProperties}>
        <CtaButton />
      </span>
    </section>
  );
}
