import type { ReactElement } from "react";
import type { LoaderPlugin } from "fumadocs-core/source";
import type { Icon } from "@phosphor-icons/react";
import {
  ArrowsLeftRight,
  BookOpen,
  Books,
  ChartLineUp,
  ClockCounterClockwise,
  CloudArrowUp,
  Code,
  Cpu,
  Database,
  FileArrowDown,
  Flask,
  Function as FunctionIcon,
  Gauge,
  Gear,
  GitPullRequest,
  GraduationCap,
  HardDrives,
  House,
  Key,
  ListChecks,
  Package,
  Path,
  PlugsConnected,
  Pulse,
  Question,
  Robot,
  Rocket,
  Scales,
  ShieldCheck,
  Sigma,
  Sparkle,
  SquaresFour,
  Swap,
  Table,
  Terminal,
  TreeStructure,
  UserCheck,
} from "@phosphor-icons/react/ssr";

export const ICONS: Record<string, Icon> = {
  ArrowsLeftRight,
  BookOpen,
  Books,
  ChartLineUp,
  ClockCounterClockwise,
  CloudArrowUp,
  Code,
  Cpu,
  Database,
  FileArrowDown,
  Flask,
  Function: FunctionIcon,
  Gauge,
  Gear,
  GitPullRequest,
  GraduationCap,
  HardDrives,
  House,
  Key,
  ListChecks,
  Package,
  Path,
  PlugsConnected,
  Pulse,
  Question,
  Robot,
  Rocket,
  Scales,
  ShieldCheck,
  Sigma,
  Sparkle,
  SquaresFour,
  Swap,
  Table,
  Terminal,
  TreeStructure,
  UserCheck,
};

export function iconFor(name: string | undefined): ReactElement | undefined {
  if (name === undefined) return undefined;
  const Found = ICONS[name];
  if (!Found) return undefined;
  return <Found />;
}

type TreeNode = { icon?: unknown };

function withPhosphorIcon<T extends TreeNode>(node: T): T {
  if (node.icon === undefined || typeof node.icon === "string") node.icon = iconFor(node.icon as string | undefined);
  return node;
}

export function phosphorIconsPlugin(): LoaderPlugin {
  return {
    name: "modelstill:phosphor-icons",
    transformPageTree: {
      file: withPhosphorIcon,
      folder: withPhosphorIcon,
      separator: withPhosphorIcon,
    },
  };
}
