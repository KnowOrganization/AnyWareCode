import { AuroraBackground } from "@/components/ui/AuroraBackground";
import { SmoothScroll } from "@/components/fx/SmoothScroll";
import { ScrollProgress } from "@/components/fx/ScrollProgress";
import { ScrollScene } from "@/components/three/ScrollScene";
import { Nav } from "@/components/sections/Nav";
import { Hero } from "@/components/sections/Hero";
import { LogoCloud } from "@/components/sections/LogoCloud";
import { Features } from "@/components/sections/Features";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Security } from "@/components/sections/Security";
import { Pricing } from "@/components/sections/Pricing";
import { Faq } from "@/components/sections/Faq";
import { CtaBand } from "@/components/sections/CtaBand";
import { Footer } from "@/components/sections/Footer";

export default function Home() {
  return (
    <>
      <SmoothScroll />
      <ScrollProgress />
      <AuroraBackground />
      {/* Fixed WebGL layer: the repo→PR node graph the scroll flies through */}
      <ScrollScene />
      <Nav />
      <main className="relative overflow-x-clip">
        <Hero />
        <LogoCloud />
        <Features />
        <HowItWorks />
        <Security />
        <Pricing />
        <Faq />
        <CtaBand />
      </main>
      <Footer />
    </>
  );
}
