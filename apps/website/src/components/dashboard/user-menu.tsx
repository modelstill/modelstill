"use client";

import { useState } from "react";
import { CaretUpDownIcon, CircleNotchIcon, GearSixIcon, QuestionIcon, SignOutIcon, UserIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@modelstill/ui/components/avatar";
import { Button } from "@modelstill/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@modelstill/ui/components/dropdown-menu";
import { cn } from "@modelstill/ui/lib/utils";
import { DOCS_URL } from "@/lib/links";
import { API_KEYS_HREF, PROFILE_HREF } from "@/lib/nav";
import type { SessionUser } from "@/lib/session";

export type AccountActions = {
  onSignOut: () => Promise<void>;
  navigate: (href: string) => void;
};

export function displayName(user: SessionUser | null): string {
  if (!user) return "ModelStill";
  return user.name.trim() || user.email.split("@")[0]!;
}

export function UserAvatar({ user, size }: { user: SessionUser | null; size: number }) {
  const initial = displayName(user).charAt(0).toUpperCase();
  return (
    <Avatar style={{ width: size, height: size }} className="shrink-0 ring-1 ring-border">
      <AvatarFallback className="bg-primary text-[12px] font-medium text-primary-foreground">{initial}</AvatarFallback>
    </Avatar>
  );
}

export function AccountMenuItems({ user, onSignOut, navigate }: AccountActions & { user: SessionUser | null }) {
  const [pending, setPending] = useState(false);
  const display = displayName(user);

  async function signOut() {
    setPending(true);
    try {
      await onSignOut();
      navigate("/login");
    } catch {
      setPending(false);
      toast.error("Could not sign out");
    }
  }

  return (
    <>
      <div className="flex items-center gap-2.5 px-2 py-2">
        <UserAvatar user={user} size={32} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] leading-4 font-medium text-foreground">{display}</span>
          {user && <span className="block truncate text-[12px] text-muted-foreground">{user.email}</span>}
        </span>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => navigate(PROFILE_HREF)} className="cursor-pointer gap-3 px-2 py-2">
        <UserIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="text-[13.5px] text-foreground">Profile</span>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => navigate(API_KEYS_HREF)} className="cursor-pointer gap-3 px-2 py-2">
        <GearSixIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="text-[13.5px] text-foreground">Settings</span>
      </DropdownMenuItem>
      <DropdownMenuItem asChild className="cursor-pointer gap-3 px-2 py-2">
        <a href={DOCS_URL} target="_blank" rel="noreferrer">
          <QuestionIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="text-[13.5px] text-foreground">Help &amp; docs</span>
        </a>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          if (!pending) void signOut();
        }}
        className="cursor-pointer gap-2.5 px-2 py-2 text-negative focus:bg-status-fail-bg focus:text-status-fail"
      >
        {pending ? <CircleNotchIcon aria-hidden="true" className="size-4 animate-spin" /> : <SignOutIcon aria-hidden="true" className="size-4" />}
        <span className="text-[13px] font-medium">Log out</span>
      </DropdownMenuItem>
    </>
  );
}

export function UserMenu({ user, compact = false, onSignOut, navigate }: AccountActions & { user: SessionUser | null; compact?: boolean }) {
  const display = displayName(user);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label={compact ? display : undefined}
          className={cn(
            "flex h-auto items-center rounded-md py-1.5 text-left font-normal hover:bg-sidebar-accent/70 data-[state=open]:bg-sidebar-accent",
            compact ? "w-auto justify-center px-1.5" : "w-full justify-start gap-2.5 px-1.5",
          )}
        >
          <UserAvatar user={user} size={28} />
          {!compact && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-4 font-medium text-foreground">{display}</span>
                {user && <span className="block truncate text-[12px] text-muted-foreground">{user.email}</span>}
              </span>
              <CaretUpDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-[256px] bg-popover p-2">
        <AccountMenuItems user={user} onSignOut={onSignOut} navigate={navigate} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
