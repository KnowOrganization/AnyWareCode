import { SmoothScroll } from "@/components/fx/SmoothScroll";
import { ProgressRule } from "@/components/landing/fx/ProgressRule";
import { LedgerRails } from "@/components/landing/LedgerRails";
import { ChapterIndex } from "@/components/landing/ChapterIndex";
import { LandingNav } from "@/components/landing/LandingNav";
import { Hero } from "@/components/landing/Hero";
import { Ticker } from "@/components/landing/Ticker";
import { Entries } from "@/components/landing/Entries";
import { Custody } from "@/components/landing/Custody";
import { ThreatModel } from "@/components/landing/ThreatModel";
import { Receipts } from "@/components/landing/Receipts";
import { Faq } from "@/components/landing/Faq";
import { SignOff } from "@/components/landing/SignOff";
import { Footer } from "@/components/landing/Footer";

/**
 * Landing v4 — "The Ledger". The page reads as a signed shipping manifest:
 * numbered chapters, hairline rules, perforated receipts, one teal signature
 * accent and amber reserved for provenance stamps.
 */
export default function Home() {
  return (
    <>
      <SmoothScroll />
      <ProgressRule />
      <LedgerRails />
      <ChapterIndex />
      <LandingNav />
      <main className="relative z-10 overflow-x-clip">
        <Hero />
        <Ticker />
        <Entries />
        <Custody />
        <ThreatModel />
        <Receipts />
        <Faq />
        <SignOff />
      </main>
      <Footer />
    </>
  );
}
