import { redirect } from "next/navigation";
import { PROFILE_HREF } from "@/lib/nav";

export default function SettingsPage() {
  redirect(PROFILE_HREF);
}
