import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const display = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"], display: "swap", variable: "--font-display" });

export const metadata: Metadata = {
  metadataBase: new URL("https://modelstill.com"),
  title: "ModelStill - open-source LLM evals and release gate for CI",
  description: "Regression-test every prompt and model change against a golden dataset, with LLM-as-a-judge checked against people and a pass or fail in CI. Open source and self-hosted.",
  openGraph: { type: "website", siteName: "ModelStill", title: "ModelStill", description: "The release gate for dependable AI." },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
