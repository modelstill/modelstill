import { redirect } from "next/navigation";
import { CONNECT_HREF } from "@/lib/nav";

export default function ConnectPage() {
  redirect(CONNECT_HREF);
}
