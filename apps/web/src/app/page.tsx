import { Preloader } from "@/components/fx/Preloader";
import { Cursor } from "@/components/fx/Cursor";
import { SmoothScroll } from "@/components/fx/SmoothScroll";
import { ProgressRule } from "@/components/landing/fx/ProgressRule";
import { LedgerRails } from "@/components/landing/LedgerRails";
import { ChapterIndex } from "@/components/landing/ChapterIndex";
import { LandingNav } from "@/components/landing/LandingNav";
import { Hero } from "@/components/landing/Hero";
import { Ticker } from "@/components/landing/Ticker";
import { Interstitial } from "@/components/landing/Interstitial";
import { Entries } from "@/components/landing/Entries";
import { Pipeline } from "@/components/landing/Pipeline";
import { ThreatModel } from "@/components/landing/ThreatModel";
import { Receipts } from "@/components/landing/Receipts";
import { Faq } from "@/components/landing/Faq";
import { SignOff } from "@/components/landing/SignOff";
import { Footer } from "@/components/landing/Footer";

/**
 * Landing v5 — "The Ledger", cinematic edition. The signed-manifest system of
 * v4 plus a boot-sequence preloader, a WebGL manifest grid under the hero,
 * and a scroll-pinned 3D chain-of-custody scene in chapter 02. Preloader must
 * stay the first child: it holds the intro gate before sibling fx build.
 */
export default function Home() {
  return (
    <>
      <Preloader />
      <Cursor />
      <SmoothScroll />
      <ProgressRule />
      <LedgerRails />
      <ChapterIndex />
      <LandingNav />
      <main className="relative z-10 overflow-x-clip">
        <Hero />
        <Ticker />
        <Interstitial
          kicker="¶ THE PREMISE"
          text="Every server has a backlog nobody owns. [[Give it an engineer]] the whole room can watch."
        />
        <Entries />
        <Interstitial
          kicker="¶ THE WALKTHROUGH"
          text="Here is one task's journey — [[prompt to pull request]], nothing off the books."
        />
        <Pipeline />
        <Interstitial
          kicker="¶ THE OBJECTION"
          text="An agent inside your repos should make you nervous. [[It makes us nervous too.]]"
        />
        <ThreatModel />
        <Receipts />
        <Faq />
        <SignOff />
      </main>
      <Footer />
    </>
  );
}
