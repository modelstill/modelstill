import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DM_Sans, Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "@modelstill/ui/globals.css";
import { MotionProvider } from "@/components/motion/motion-provider";
import { themeProviderProps } from "@/lib/theme";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

const dmSans = DM_Sans({ subsets: ["latin"], display: "swap", variable: "--font-dm-sans", style: ["normal"] });

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
  weight: ["400", "500", "600"],
});

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:4323").replace(/\/+$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "ModelStill - the release gate for AI features", template: "%s - ModelStill" },
  description: "Check every model and prompt change against an accepted baseline, case by case, and know whether it is safe to ship.",
  applicationName: "ModelStill",
  openGraph: { type: "website", siteName: "ModelStill", title: "ModelStill", description: "The release gate for AI features." },
  twitter: { card: "summary_large_image", title: "ModelStill", description: "The release gate for AI features." },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${dmSans.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider {...themeProviderProps()}>
          <MotionProvider>{children}</MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
