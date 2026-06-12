import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const display = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "800"],
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const TITLE = "AnyWareCode — The accountable Discord-native coding agent";
const DESCRIPTION =
  "Belongs to the server, not a seat. AnyWareCode ships code in public threads, signs its work, and waits for humans to merge. Every PR carries a named human sponsor and a provenance receipt; Repro Gate filters slop before it costs a human minute.";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
  ),
  title: { default: TITLE, template: "%s · AnyWareCode" },
  description: DESCRIPTION,
  keywords: [
    "Discord coding agent",
    "AI pull requests",
    "GitHub bot",
    "Claude agent",
    "provenance receipt",
    "AnyWareCode",
  ],
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "AnyWareCode",
    images: [{ url: "/brand/anywarecode-lockup.png", width: 1938, height: 760 }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/brand/anywarecode-lockup.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#07090a",
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
