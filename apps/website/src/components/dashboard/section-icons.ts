import {
  BarbellIcon,
  DatabaseIcon,
  FlaskIcon,
  GaugeIcon,
  GearSixIcon,
  KeyIcon,
  ListChecksIcon,
  PlugsConnectedIcon,
  PulseIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  SquaresFourIcon,
  StackIcon,
  UserIcon,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";
import type { NavKey, PageSection, TaskSectionKey } from "@/lib/nav";

export const SECTION_ICONS: Record<TaskSectionKey, ComponentType<{ className?: string }>> = {
  overview: SquaresFourIcon,
  traffic: PulseIcon,
  monitoring: GaugeIcon,
  evals: FlaskIcon,
  review: ListChecksIcon,
  datasets: DatabaseIcon,
  gates: ShieldCheckIcon,
  training: BarbellIcon,
  deployment: RocketLaunchIcon,
};

export const PAGE_ICONS: Record<PageSection, ComponentType<{ className?: string }>> = {
  ...SECTION_ICONS,
  tasks: StackIcon,
  settings: GearSixIcon,
};

export const NAV_ICONS: Record<NavKey, ComponentType<{ className?: string }>> = {
  tasks: StackIcon,
  connect: PlugsConnectedIcon,
  "api-keys": KeyIcon,
  profile: UserIcon,
  "task-settings": GearSixIcon,
};
