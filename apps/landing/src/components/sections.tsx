import { ArrowDownIcon, CaretDownIcon, CheckCircleIcon, InfoIcon } from "@phosphor-icons/react/dist/ssr";
import { EVALUATE, GATE_CHECKS, SWAP } from "@/lib/content";
import { ICONS, TONE_TEXT } from "./icons";
import { Burst } from "./marks";
import { Reveal } from "./reveal";
import { Wash } from "./wash";

type Feature = { icon: string; tone: string; title: string; text: string };

export function Divider() {
  return (
    <Reveal variant="fade" className="mx-auto mt-[64px] flex w-full max-w-[1130px] items-center gap-[14px] px-4 lg:mt-[110px] xl:px-0">
      <span className="h-[2px] flex-1 rounded-full bg-[#e6e4df]" style={{ filter: "url(#rough-line)" }} />
      <Burst className="h-[44px] w-[72px]" />
      <span className="h-[2px] flex-1 rounded-full bg-[#e6e4df]" style={{ filter: "url(#rough-line)" }} />
    </Reveal>
  );
}

function InlineIcon({ name }: { name: string }) {
  const Icon = ICONS[name]!;
  return <Icon size="0.95em" className="mx-[0.12em] inline-block -translate-y-[0.04em] text-leaf" />;
}

function Features({ items }: { items: readonly Feature[] }) {
  return (
    <ul className="mt-[52px] flex flex-col">
      {items.map((item, index) => {
        const Icon = ICONS[item.icon]!;
        return (
          <li key={item.title} className={index === 0 ? "" : "border-t border-line"}>
            <Reveal delay={120 + index * 90} className={`flex gap-[18px] py-[25px] ${index === 0 ? "pt-0" : ""}`}>
              <Icon size={23} className={`mt-[1px] shrink-0 ${TONE_TEXT[item.tone]}`} />
              <div>
                <h3 className="text-[16px] leading-[22px] font-medium text-text">{item.title}</h3>
                <p className="mt-[8px] text-[16px] leading-[22px] tracking-[0.01em] text-muted">{item.text}</p>
              </div>
            </Reveal>
          </li>
        );
      })}
    </ul>
  );
}

function GateCard() {
  const tiles = ["bg-[#111111] text-white", "bg-[#6d5efc] text-white", "bg-[#cfe8fb] text-[#0b3a82]", "bg-[#f47c0e] text-white"];
  const icons = ["diff", "swap", "cost", "timer"];
  return (
    <div className="mx-auto flex h-[456px] w-[267px] flex-col rounded-[14px] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.08)]">
      <div className="px-[13px] pt-[24px]">
        <div className="flex items-center justify-between text-[9.5px] text-text">
          <span>ticket-priority</span>
          <span>Gate №070490</span>
        </div>
        <p className="mt-[8px] flex items-center gap-[6px] text-[23px] leading-none font-medium text-[#1b1b1b]">
          Passed <CaretDownIcon size={10} weight="bold" />
        </p>
        <p className="mt-[20px] pl-[12px] text-[8px] text-muted">Compared with the accepted baseline</p>
        <div className="mt-[6px] overflow-hidden rounded-[4px]">
          <div className="flex h-[35px] items-center gap-[7px] bg-[#f3f3f1] px-[11px] text-[12px] text-text">
            <CheckCircleIcon size={16} weight="fill" className="text-up" />
            <span>307 cases</span>
            <span className="text-muted">|</span>
            <span className="text-[#b9b9b9]">-0.4%</span>
          </div>
          <div className="flex h-[25px] items-center gap-[6px] bg-[#ffdd2d] px-[11px] text-[8px] font-medium text-[#3b2f00]">
            <CheckCircleIcon size={11} weight="fill" />
            Inside the allowed regression
          </div>
        </div>
        <div className="mt-[24px] border-t border-line" />
        <p className="mt-[24px] pl-[12px] text-[8px] text-muted">Checks</p>
        <ul className="mt-[7px] grid grid-cols-4 gap-[6px]">
          {GATE_CHECKS.map((check, index) => {
            const Icon = ICONS[icons[index]!]!;
            return (
              <li key={check} title={check} className={`flex h-[28px] items-center justify-center rounded-[4px] ${tiles[index]}`}>
                <Icon size={15} weight="bold" />
                <span className="sr-only">{check}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="mt-auto border-t border-line p-[6px]">
        <div className="flex h-[34px] items-center justify-center rounded-[6px] bg-[#f0f0ee] text-[11px] text-[#b5b5b5]">Ship the candidate</div>
      </div>
    </div>
  );
}

function TrendCard() {
  return (
    <div className="rounded-[14px] bg-white p-[18px] shadow-[0_1px_2px_rgb(0_0_0/0.08)] sm:p-[24px]">
      <div className="flex items-start justify-between gap-2">
        <p className="mt-[10px] flex items-center gap-[7px] text-[14px] whitespace-nowrap text-text">
          Flip rate <InfoIcon size={11} weight="fill" className="text-muted" />
        </p>
        <div className="flex items-center gap-[8px]">
          <span className="inline-flex h-[30px] items-center rounded-[5px] bg-[#f3f3f1] px-[9px] text-[13px] whitespace-nowrap text-text sm:h-[33px] sm:px-[12px] sm:text-[14px]">See details</span>
          <span className="inline-flex h-[30px] items-center gap-[7px] rounded-[5px] border border-line px-[8px] text-[13px] whitespace-nowrap text-text sm:h-[33px] sm:gap-[9px] sm:px-[9px] sm:text-[14px]">
            All tasks <CaretDownIcon size={11} className="text-muted" />
          </span>
        </div>
      </div>
      <p className="mt-[4px] flex items-baseline gap-[9px]">
        <span className="text-[30px] leading-none font-medium tracking-[-0.02em] text-[#1b1b1b]">7.35%</span>
        <span className="inline-flex items-center gap-[3px] text-[15px] text-down">
          <ArrowDownIcon size={13} weight="bold" />
          2.65%
        </span>
      </p>
      <p className="mt-[28px] text-[16px] leading-[24px] tracking-[0.01em] text-text">
        The share of cases whose answer changed between the baseline and the candidate.
      </p>
      <svg aria-hidden="true" viewBox="0 0 468 150" className="mt-[26px] h-[150px] w-full overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6b8e12" stopOpacity="0" />
            <stop offset="1" stopColor="#6b8e12" stopOpacity="0.14" />
          </linearGradient>
        </defs>
        <path className="trend-fill" d="M0 80L58 148L175 86L292 102L410 47L468 0V150H0Z" fill="url(#trend-fill)" />
        <path className="trend-line" pathLength={1} d="M0 80L58 148L175 86L292 102L410 47L468 0" fill="none" stroke="#6b8e12" strokeWidth="1.5" />
        <circle className="trend-dot" cx="468" cy="0" r="4" fill="#6b8e12" />
      </svg>
    </div>
  );
}

export function EvaluateSection() {
  return (
    <section id={EVALUATE.id} className="mx-auto mt-[56px] grid w-full max-w-[1130px] scroll-mt-10 gap-12 px-4 lg:mt-[84px] lg:grid-cols-[466px_564px] lg:justify-between xl:px-0">
      <div>
        <Reveal>
          <h2 className="display text-[34px] leading-[38px] sm:text-[40px] sm:leading-[43px]">
            Know every change
            <br />
            is safe <InlineIcon name="shield" /> before
            <br />
            it reaches your
            <br />
            users.
          </h2>
        </Reveal>
        <Features items={EVALUATE.features} />
      </div>
      <Reveal variant="settle" delay={140}>
        <Wash variant="hills" className="h-[506px] py-[25px]">
          <GateCard />
        </Wash>
      </Reveal>
    </section>
  );
}

export function SwapSection() {
  return (
    <section id={SWAP.id} className="mx-auto mt-[90px] grid w-full max-w-[1130px] scroll-mt-10 gap-12 px-4 pb-[70px] lg:mt-[186px] lg:grid-cols-[562px_464px] lg:justify-between lg:pb-[110px] xl:px-0">
      <Reveal variant="settle" className="order-2 lg:order-1">
        <Wash variant="mist" className="px-[14px] py-[36px] sm:px-[27px] lg:h-[506px] lg:pt-[74px] lg:pb-0">
          <TrendCard />
        </Wash>
      </Reveal>
      <div className="order-1 lg:order-2">
        <Reveal>
          <h2 className="display text-[34px] leading-[38px] sm:text-[40px] sm:leading-[43px]">
            {SWAP.before} <InlineIcon name="chart" /> {SWAP.after}
          </h2>
        </Reveal>
        <Features items={SWAP.features} />
      </div>
    </section>
  );
}
