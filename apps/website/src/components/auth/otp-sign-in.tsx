"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAnimate, useReducedMotion } from "motion/react";
import { Fade } from "@/components/motion/fade";
import { Zoom } from "@/components/motion/zoom";
import { ArrowRightIcon, CheckIcon, CircleNotchIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { Button } from "@modelstill/ui/components/button";
import { Input } from "@modelstill/ui/components/input";
import { Label } from "@modelstill/ui/components/label";
import { DURATION, FADE, SHAKE_X } from "@/lib/motion";
import { OTP_LENGTH, sanitizeOtp } from "@/lib/otp-code";
import {
  resentCodeMessage,
  sendCodeErrorMessage,
  signInErrorMessage,
  UNREACHABLE_MESSAGE,
  verifyCodeErrorMessage,
  type AuthFailure,
} from "@/lib/sign-in-error";

type AuthResult = { error: AuthFailure | null };

export type OtpAuth = {
  sendCode: (email: string) => Promise<AuthResult>;
  verify: (email: string, code: string) => Promise<AuthResult>;
};

export type OtpMode = "login" | "signup";

const SUBMIT = "h-10 w-full text-[14px] font-medium";
const LABEL = "mb-1.5 block text-[13px] leading-4 font-medium text-muted-foreground";
const QUIET_LINK = "h-auto p-0 text-[13px] font-normal text-muted-foreground hover:text-foreground hover:no-underline";
const SHORT_CODE = `Enter all ${OTP_LENGTH} digits of the code.`;

function Pending({ children }: { children: string }) {
  return (
    <>
      <CircleNotchIcon aria-hidden="true" className="size-4 animate-spin" />
      <span className="sr-only">{children}</span>
    </>
  );
}

function ChecklistRow({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 px-3.5 py-3 text-[13px] text-foreground">
      {done ? (
        <Zoom asChild initialScale={0.6} transition={{ duration: DURATION.fast }}>
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-status-ok-bg">
            <CheckIcon aria-hidden="true" weight="bold" className="size-3 text-status-ok" />
          </span>
        </Zoom>
      ) : (
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-card ring-1 ring-border">
          <span className="size-1.5 rounded-full bg-muted-foreground" />
        </span>
      )}
      <span className={done ? undefined : "text-muted-foreground"}>{children}</span>
    </li>
  );
}

export function OtpSignIn({
  auth,
  onSignedIn,
  mode = "login",
  returnedError = null,
}: {
  auth: OtpAuth;
  onSignedIn: () => void;
  mode?: OtpMode;
  returnedError?: string | null;
}) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [returned, setReturned] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const [failures, setFailures] = useState(0);
  const [shakeScope, shake] = useAnimate<HTMLDivElement>();
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    if (failures === 0 || reduced || !shakeScope.current) return;
    void shake(shakeScope.current, { x: SHAKE_X }, { duration: DURATION.slow });
  }, [failures, reduced, shake, shakeScope]);

  function fail(message: string) {
    setError(message);
    setFailures((count) => count + 1);
  }
  const normalized = email.trim().toLowerCase();
  const urlError = signInErrorMessage(returnedError);

  async function requestCode(): Promise<boolean> {
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const { error: failure } = await auth.sendCode(normalized);
      if (failure) {
        setError(sendCodeErrorMessage(failure));
        return false;
      }
      return true;
    } catch {
      setError(UNREACHABLE_MESSAGE);
      return false;
    } finally {
      setPending(false);
    }
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (!normalized) return;
    if (await requestCode()) setStep("code");
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (code.length !== OTP_LENGTH) {
      setNotice(null);
      fail(SHORT_CODE);
      codeInput.current?.focus();
      return;
    }
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const { error: failure } = await auth.verify(normalized, code);
      if (failure) {
        setPending(false);
        fail(verifyCodeErrorMessage(failure));
        return;
      }
    } catch {
      setPending(false);
      fail(UNREACHABLE_MESSAGE);
      return;
    }
    onSignedIn();
  }

  async function resend() {
    if (await requestCode()) setNotice(resentCodeMessage(normalized));
  }

  if (step === "code") {
    return (
      <Fade asChild transition={FADE}>
      <form onSubmit={verify} noValidate className="mt-8 space-y-4">
        <ul className="divide-y divide-border/70 overflow-hidden rounded-lg bg-muted ring-1 ring-border/80">
          <ChecklistRow done>
            Code sent to <span className="font-semibold">{normalized}</span>
          </ChecklistRow>
          <ChecklistRow done={code.length === OTP_LENGTH}>
            <span id="code-hint" onClick={() => codeInput.current?.focus()} className="cursor-text">
              Enter the {OTP_LENGTH}-digit code
            </span>
          </ChecklistRow>
        </ul>

        <div ref={shakeScope}>
          <Label htmlFor="code" className={LABEL}>
            Sign-in code
          </Label>
          <Input
            id="code"
            name="code"
            ref={codeInput}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="done"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            aria-invalid={error !== null}
            aria-describedby={error ? "code-hint code-error" : "code-hint"}
            value={code}
            onChange={(event) => {
              setCode(sanitizeOtp(event.target.value));
              setError(null);
            }}
            placeholder="000000"
            className="h-10 text-center text-[18px] font-medium tracking-[0.5em]"
          />
        </div>

        {error && (
          <Fade asChild key={`${failures}-${error}`} transition={FADE}>
            <p id="code-error" role="alert" className="text-[13px] text-negative">
              {error}
            </p>
          </Fade>
        )}
        {notice && (
          <p key={notice} role="status" className="text-[13px] leading-5 text-muted-foreground">
            {notice}
          </p>
        )}

        <Button type="submit" disabled={pending} aria-busy={pending} className={SUBMIT}>
          {pending ? (
            <Pending>Checking code</Pending>
          ) : (
            <>
              Verify &amp; continue
              <ArrowRightIcon aria-hidden="true" />
            </>
          )}
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="link"
            disabled={pending}
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
              setNotice(null);
              setReturned(true);
            }}
            className={QUIET_LINK}
          >
            &larr; Use a different email
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={pending}
            onClick={() => void resend()}
            className="h-auto p-0 text-[13px] font-medium text-link hover:text-link/80 hover:no-underline"
          >
            Resend code
          </Button>
        </div>
      </form>
      </Fade>
    );
  }

  return (
    <div className="mt-8 space-y-4">
      {urlError && (
        <p role="alert" className="rounded-md bg-status-fail-bg px-3 py-2 text-[13px] leading-5 text-status-fail">
          {urlError}
        </p>
      )}
      <form onSubmit={sendCode} className="space-y-4">
        <div>
          <Label htmlFor="email" className={LABEL}>
            Work email
          </Label>
          <div className="relative">
            <EnvelopeSimpleIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              enterKeyHint="send"
              spellCheck={false}
              required
              autoFocus={returned}
              aria-invalid={error !== null}
              aria-describedby={error ? "email-error" : undefined}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              className="h-10 pl-9"
            />
          </div>
        </div>

        {error && (
          <p key={error} id="email-error" role="alert" className="text-[13px] text-negative">
            {error}
          </p>
        )}

        <Button type="submit" disabled={pending || normalized.length < 3} aria-busy={pending} className={SUBMIT}>
          {pending ? (
            <Pending>Sending code</Pending>
          ) : (
            <>
              {mode === "signup" ? "Email me a sign-in code" : "Send sign-in code"}
              <ArrowRightIcon aria-hidden="true" />
            </>
          )}
        </Button>

        {mode === "signup" && (
          <p className="text-[12px] leading-snug text-muted-foreground">
            Codes expire after five minutes. Only the latest code works.
          </p>
        )}
      </form>
    </div>
  );
}
