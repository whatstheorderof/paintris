import type { Metadata, Viewport } from "next";
import { Bungee, Space_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

// Bungee is signage lettering — chunky and loud, for the logo and headings.
// Space Grotesk carries the reading text without feeling like a terminal.
const display = Bungee({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const ui = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Paintris — a game by zaney.dev",
  description: "A physics-based colour puzzle where every block splashes into living paint.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
