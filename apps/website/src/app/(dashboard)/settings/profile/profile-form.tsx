"use client";

import { useRouter } from "next/navigation";
import { ProfileSettings } from "@/components/settings/profile-settings";
import { authClient, signOut } from "@/lib/auth-client";

export function ProfileForm({ initialName, email }: { initialName: string; email: string }) {
  const router = useRouter();
  return (
    <ProfileSettings
      initialName={initialName}
      email={email}
      save={async (name) => {
        const { error } = await authClient.updateUser({ name });
        if (error) throw new Error(error.message ?? "Could not save your name");
        router.refresh();
      }}
      onSignOut={async () => {
        await signOut();
        window.location.assign("/login");
      }}
    />
  );
}
