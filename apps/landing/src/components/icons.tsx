import {
  ChartLineUpIcon,
  CurrencyDollarIcon,
  FileTextIcon,
  FlaskIcon,
  GitDiffIcon,
  MagnifyingGlassIcon,
  PathIcon,
  PulseIcon,
  ReceiptIcon,
  RulerIcon,
  ShieldCheckIcon,
  StackIcon,
  SwapIcon,
  TicketIcon,
  TimerIcon,
  UsersIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { ComponentType } from "react";

type IconComponent = ComponentType<{ className?: string; size?: number | string; weight?: "regular" | "bold" | "fill" | "duotone" }>;

export const ICONS: Record<string, IconComponent> = {
  ticket: TicketIcon,
  receipt: ReceiptIcon,
  route: PathIcon,
  file: FileTextIcon,
  search: MagnifyingGlassIcon,
  stack: StackIcon,
  ruler: RulerIcon,
  shield: ShieldCheckIcon,
  users: UsersIcon,
  swap: SwapIcon,
  pulse: PulseIcon,
  flask: FlaskIcon,
  chart: ChartLineUpIcon,
  diff: GitDiffIcon,
  cost: CurrencyDollarIcon,
  timer: TimerIcon,
};

export const TONE_TEXT: Record<string, string> = {
  sun: "text-[#f47c0e]",
  sky: "text-[#1697e0]",
  plum: "text-[#d24fe0]",
  leaf: "text-[#6b8e12]",
};
