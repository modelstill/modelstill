import { cn } from "@modelstill/ui/lib/utils";
import { ModelPill } from "@modelstill/ui/vendor/helicone/model-pill";
import { ProviderIcon } from "./provider-icon";

export function ModelName({ model, className }: { model: string | null | undefined; className?: string }) {
  return (
    <span data-slot="model-name" className={cn("inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle", className)}>
      {model ? <ProviderIcon model={model} size={14} /> : null}
      <ModelPill model={model} className="min-w-0" />
    </span>
  );
}
