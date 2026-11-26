"use client";

import { useId, useState } from "react";
import { CheckIcon, CircleNotchIcon, SignOutIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@modelstill/ui/components/button";
import { Input } from "@modelstill/ui/components/input";
import { Label } from "@modelstill/ui/components/label";
import { Card } from "@/components/dashboard/primitives";

export function ProfileSettings({
  initialName,
  email,
  save,
  onSignOut,
}: {
  initialName: string;
  email: string;
  save: (name: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const nameId = useId();
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const trimmed = name.trim();

  async function submit() {
    setPending(true);
    try {
      await save(trimmed);
      setSaved(true);
      toast.success("Saved");
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save your name");
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await onSignOut();
    } catch {
      setSigningOut(false);
      toast.error("Could not sign out");
    }
  }

  return (
    <>
      <Card className="mt-2" contentClassName="space-y-6 p-5">
        <div>
          <Label htmlFor={nameId} className="block text-[13px] font-medium text-foreground">
            Name
          </Label>
          <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-8" />
        </div>
        <div>
          <span className="block text-[13px] font-medium text-foreground">Email</span>
          <span className="mt-2 block text-[14px] text-foreground">{email}</span>
          <p className="mt-1 text-[12px] text-muted-foreground">You sign in with a one-time code sent to this address.</p>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={() => void submit()} disabled={pending || !trimmed} className="h-8 px-5">
            {pending ? <CircleNotchIcon aria-hidden="true" className="animate-spin" /> : saved ? <CheckIcon aria-hidden="true" /> : null}
            {saved ? "Saved" : "Save changes"}
          </Button>
        </div>
      </Card>

      <Card className="mt-5" contentClassName="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="type-title text-foreground">Sign out</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">End this session on this browser. API keys keep working.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void signOut()} disabled={signingOut} className="h-8">
          {signingOut ? <CircleNotchIcon aria-hidden="true" className="animate-spin" /> : <SignOutIcon aria-hidden="true" />}
          Sign out
        </Button>
      </Card>
    </>
  );
}
