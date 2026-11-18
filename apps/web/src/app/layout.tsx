import "@psycho/tokens/tokens.css";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Hanken_Grotesk } from "next/font/google";

// Google merged "Big Shoulders Display" into "Big Shoulders" (opsz axis); optical sizing picks
// the display cut automatically at wordmark/title sizes.
const display = Big_Shoulders({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-display",
  display: "swap",
  // next/font has no metric overrides for this family; fall back to a condensed system face.
  adjustFontFallback: false,
  fallback: ["Arial Narrow", "sans-serif-condensed", "sans-serif"],
});
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Psycho",
  description: "Paul's training dashboard",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1C1613",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-PH" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
