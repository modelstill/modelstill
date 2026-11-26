import type { ReactNode } from "react";
import { cn } from "@modelstill/ui/lib/utils";
import { BrandHome, SceneAside } from "@/components/auth/auth-split";
import { StepTransition } from "./step-transition";

export function OnboardingHeader({ step, total, skip }: { step: number; total: number; skip?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-4">
      <BrandHome />
      <div className="flex items-center gap-4">
        <ol className="flex items-center gap-1.5" aria-label={`Step ${step} of ${total}`}>
          {Array.from({ length: total }, (_, index) => (
            <li
              key={index}
              className={cn(
                "h-1 w-9 rounded-full transition-colors duration-250",
                index + 1 === step ? "bg-primary" : index + 1 < step ? "bg-primary/40" : "bg-border",
              )}
            />
          ))}
        </ol>
        {skip}
      </div>
    </header>
  );
}

export function OnboardingSplit({
  step,
  total,
  title,
  sub,
  aside,
  headline,
  skip,
  children,
}: {
  step: number;
  total: number;
  title: string;
  sub?: ReactNode;
  aside: ReactNode;
  headline: ReactNode;
  skip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-screen grid-cols-1 bg-sidebar text-foreground lg:grid-cols-[minmax(520px,44%)_1fr] lg:gap-2 lg:p-2">
      <div className="flex flex-col bg-background px-6 py-8 sm:px-10 lg:rounded-lg lg:border lg:border-border lg:px-14 lg:shadow-xs">
        <OnboardingHeader step={step} total={total} skip={skip} />
        <div className="flex flex-1 items-center py-12">
          <StepTransition step={step}>
            <div className="w-full max-w-[480px]">
              <h1 className="text-[24px] leading-[1.2] font-semibold tracking-[-0.01em] text-foreground">{title}</h1>
              {sub && <p className="mt-2 text-[14px] leading-5 text-muted-foreground">{sub}</p>}
              <div className="mt-8">{children}</div>
            </div>
          </StepTransition>
        </div>
      </div>
      <SceneAside headline={headline}>{aside}</SceneAside>
    </main>
  );
}
