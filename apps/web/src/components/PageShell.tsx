import type { ReactNode } from "react";
import Link from "next/link";
import { AuroraBackground } from "@/components/ui/AuroraBackground";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { INSTALL_URL } from "@/lib/site";

/** Wordmark used across the app shell + footer. */
export function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-display font-semibold">
      <span className="h-6 w-6 rounded-lg bg-gradient-to-br from-indigo via-violet to-cyan shadow-[0_0_18px_-2px_rgba(139,92,246,0.8)]" />
      <span className="tracking-tight">AnywhereCode</span>
    </Link>
  );
}

/** Aurora background + slim header for dashboard / legal pages. */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <AuroraBackground />
      <header className="sticky top-0 z-40 border-b border-line bg-bg/60 backdrop-blur-xl">
        <Container className="flex h-16 items-center justify-between">
          <Wordmark />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" href="/#features">
              Product
            </Button>
            <Button size="sm" variant="secondary" href={INSTALL_URL}>
              Add to Discord
            </Button>
          </div>
        </Container>
      </header>
      <main className="relative min-h-[72vh] py-12 sm:py-16">{children}</main>
    </>
  );
}
