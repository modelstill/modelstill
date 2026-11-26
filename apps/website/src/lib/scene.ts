export type FlowStepKey = "record" | "distil" | "gate" | "serve";

export type FlowStepState = "done" | "checking" | "waiting";

export type FlowStep = { key: FlowStepKey; label: string; state: FlowStepState };

export const EXAMPLE_FLOW: readonly FlowStep[] = [
  { key: "record", label: "Record", state: "done" },
  { key: "distil", label: "Distil", state: "done" },
  { key: "gate", label: "Gate", state: "checking" },
  { key: "serve", label: "Serve", state: "waiting" },
];
