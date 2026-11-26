import type { Deployment, DeploymentUpdate, Mode } from "./api";

export const DEFAULT_SHADOW_SAMPLE = 0.1;

export function modeUpdate(current: Deployment, mode: Mode): DeploymentUpdate | null {
  if (current.targetError === null) return null;
  return {
    mode,
    studentModel: current.studentModel,
    threshold: current.threshold,
    targetError: current.targetError,
    shadowSample: current.shadowSample ?? DEFAULT_SHADOW_SAMPLE,
    activeFrom: null,
  };
}

export function serveBlocker(current: Deployment): string | null {
  if (current.studentModel === null) return "Serving needs a student model. Push a deployment that names one first.";
  if (current.threshold === null) return "Serving needs a calibrated threshold. Run modelstill serve calibrate first.";
  return null;
}
