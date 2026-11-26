import type { Metadata } from "next";
import { SettingsPage, SettingsSection } from "@/components/dashboard/layout";
import { currentSession } from "@/lib/server-session";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const session = await currentSession();
  const user = session.status === "signed-in" ? session.user : null;
  return (
    <SettingsPage>
      <SettingsSection title="Profile" description="Your name and the email you sign in with.">
        <ProfileForm initialName={user?.name ?? ""} email={user?.email ?? ""} />
      </SettingsSection>
    </SettingsPage>
  );
}
