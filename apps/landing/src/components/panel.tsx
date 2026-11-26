import { ArrowDownIcon, ArrowUpIcon, CaretDownIcon, InfoIcon } from "@phosphor-icons/react/dist/ssr";
import { CANDIDATES, RUN_DAYS, TASKS, WORKS_WITH } from "@/lib/content";
import { ICONS } from "./icons";
import { Reveal } from "./reveal";
import { ToolLogo } from "./logos";
import { Wash } from "./wash";

const AXIS = ["10%", "8%", "6%", "4%", "2%", "0%"];

function Delta({ value, better, className }: { value: string; better: boolean; className?: string }) {
  const Arrow = better ? ArrowUpIcon : ArrowDownIcon;
  return (
    <span className={`inline-flex items-center gap-[3px] ${better ? "text-up" : "text-down"} ${className ?? ""}`}>
      <Arrow size="0.9em" weight="bold" />
      {value}
    </span>
  );
}

function Control({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[29px] items-center gap-2 rounded-[5px] border border-line bg-white px-2 text-[13px] text-text shadow-[0_1px_1px_rgb(0_0_0/0.04)]">
      {children}
    </span>
  );
}

function Chart() {
  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex h-[350px] w-[32px] shrink-0 flex-col justify-between text-[10.5px] text-muted sm:w-[50px]">
        {AXIS.map((label) => (
          <span key={label} className="leading-none">
            {label}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="dots relative h-[350px] border-b border-line">
          {CANDIDATES.map((bar, index) => (
            <div
              key={bar.label}
              className={`tone-${bar.tone} absolute bottom-0 left-(--at-small) flex items-end sm:left-(--at)`}
              style={{ "--at": `${bar.at}%`, "--at-small": `${bar.atSmall}%`, "--bar-delay": `${index * 110}ms` } as React.CSSProperties}
            >
              <div className="relative w-[14px] sm:w-[21px]" style={{ height: `${bar.baseline * 35}px` }}>
                <div className="bar-fill absolute inset-0 bg-(--soft)">
                  <div className="hatch absolute inset-0" />
                </div>
                <span
                  className={`bar-tag absolute bottom-full z-10 mb-2 inline-flex h-[22px] items-center rounded-[2px] bg-(--soft) px-[4px] text-[10px] whitespace-nowrap text-(--tag-ink) sm:h-[29px] sm:px-[6px] sm:text-[13px] ${bar.at > 70 ? "right-[-14px] sm:right-auto sm:left-0" : "left-0"}`}
                >
                  {bar.label}
                </span>
              </div>
              <div className="bar-fill w-[14px] bg-(--deep) sm:w-[21px]" style={{ height: `${bar.candidate * 35}px` }} />
            </div>
          ))}
        </div>
        <div className="mt-[10px] flex justify-between px-[6px] text-[10.5px] whitespace-nowrap text-muted sm:justify-start sm:gap-[39px] sm:px-0 sm:pl-[20px]">
          {RUN_DAYS.map((day, index) => (
            <span key={day} className={`sm:w-[33px] ${index % 2 === 1 ? "hidden sm:inline" : ""}`}>
              {day}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskList() {
  return (
    <ul className="hidden w-[280px] shrink-0 flex-col gap-[21px] border-l border-line pl-[20px] lg:flex">
      {TASKS.map((task, index) => {
        const Icon = ICONS[task.icon]!;
        return (
          <li key={task.name} className="task-row flex items-center gap-[11px]" style={{ "--row": index } as React.CSSProperties}>
            <span className={`tone-${task.tone} flex size-[50px] shrink-0 items-center justify-center rounded-[3px] bg-(--soft) text-(--deep)`}>
              <Icon size={24} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-text">{task.name}</span>
              <span className="block text-[11px] text-muted">{task.cases}</span>
            </span>
            <span className="flex flex-col items-end">
              <span className="text-[14px] text-text">{task.score}</span>
              <Delta value={task.delta} better={task.better} className="text-[10px]" />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function Panel() {
  return (
    <section className="mx-auto mt-[34px] w-full max-w-[1130px] px-4 sm:mt-[46px] xl:px-0">
      <Reveal variant="settle" delay={360}>
      <Wash variant="strata" className="p-[14px] sm:p-[34px]">
        <div className="rounded-[6px] bg-white p-[16px] shadow-[0_1px_2px_rgb(0_0_0/0.06)] sm:p-[24px]">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="flex items-center gap-[6px] text-[13px] text-text">
                Flip rate by candidate <InfoIcon size={11} weight="fill" className="text-muted" />
              </p>
              <p className="mt-[6px] flex items-baseline gap-[9px]">
                <span className="font-serif text-[36px] leading-none tracking-[-0.02em] text-[#1b1b1b]">7.35%</span>
                <Delta value="2.65%" better className="text-[14px]" />
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-[9px]">
              <Control>
                Split by task
                <span className="flex h-[14px] w-[28px] items-center justify-end rounded-full bg-[#1b1b1b] p-[2px]">
                  <span className="size-[10px] rounded-full bg-white" />
                </span>
              </Control>
              <Control>
                Last 7 runs <CaretDownIcon size={11} className="text-muted" />
              </Control>
              <Control>
                Filter by task <CaretDownIcon size={11} className="text-muted" />
              </Control>
            </div>
          </div>
          <div className="mt-[46px] flex gap-[14px] sm:mt-[38px]">
            <Chart />
            <TaskList />
          </div>
        </div>
      </Wash>
      </Reveal>
      <Reveal className="mt-[40px] flex flex-col gap-6 sm:mt-[50px] xl:flex-row xl:items-center xl:justify-between">
        <p className="shrink-0 text-[14.5px] leading-[20px] tracking-[0.01em] text-text xl:max-w-[230px]">Works with the tools your team already uses</p>
        <ul className="flex flex-1 flex-wrap items-center gap-x-8 gap-y-4 xl:flex-nowrap xl:justify-between xl:gap-x-5 xl:pl-[24px]">
          {WORKS_WITH.map((tool) => (
            <li key={tool.name}>
              <ToolLogo name={tool.name} logo={tool.logo} />
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}
