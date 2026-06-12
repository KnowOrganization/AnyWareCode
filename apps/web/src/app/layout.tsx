import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const TITLE = "AnywhereCode — Ship code from your Discord server";
const DESCRIPTION =
  "One shared AI engineer for your whole Discord community — and it signs its work. Every PR carries a named human sponsor and a provenance receipt; Repro Gate filters slop bug reports before they cost a human minute.";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
  ),
  title: { default: TITLE, template: "%s · AnywhereCode" },
  description: DESCRIPTION,
  keywords: [
    "Discord coding agent",
    "AI pull requests",
    "GitHub bot",
    "Claude agent",
    "AnywhereCode",
  ],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "AnywhereCode",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#06060d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${display.variable} ${mono.variable}`}
    >
      <body className="min-h-dvh bg-bg font-sans text-fg antialiased">
        {children}
      </body>
    </html>
  );
}
