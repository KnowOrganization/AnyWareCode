"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import * as site from "@/lib/site";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled
          ? "border-b border-line bg-bg/60 backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <Container>
        <nav className="flex h-16 items-center justify-between gap-4">
          {/* Wordmark */}
          <Link
            href="/"
            className="group flex items-center gap-2.5"
            onClick={() => setOpen(false)}
          >
            <span className="size-7 rounded-lg bg-gradient-to-br from-indigo via-violet to-cyan shadow-[0_6px_20px_-6px_rgba(124,92,255,0.7)] transition-transform duration-200 group-hover:scale-105" />
            <span className="font-display text-lg font-semibold tracking-tight text-fg">
              AnywhereCode
            </span>
          </Link>

          {/* Center links */}
          <div className="hidden items-center gap-1 md:flex">
            {site.nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-full px-3 py-2 text-sm text-muted transition-colors hover:text-fg"
              >
                {item.label}
              </a>
            ))}
          </div>

          {/* Right CTAs */}
          <div className="hidden items-center gap-2 md:flex">
            <Button variant="ghost" size="sm" href={site.DASHBOARD_URL}>
              Sign in
            </Button>
            <Button variant="primary" size="sm" href={site.INSTALL_URL}>
              Add to Discord
            </Button>
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="relative flex size-10 items-center justify-center rounded-xl border border-line-strong text-fg transition-colors hover:bg-surface md:hidden"
          >
            <span className="flex flex-col items-center justify-center gap-[5px]">
              <span
                className={cn(
                  "h-0.5 w-5 rounded-full bg-fg transition-all duration-300",
                  open && "translate-y-[7px] rotate-45",
                )}
              />
              <span
                className={cn(
                  "h-0.5 w-5 rounded-full bg-fg transition-all duration-300",
                  open && "opacity-0",
                )}
              />
              <span
                className={cn(
                  "h-0.5 w-5 rounded-full bg-fg transition-all duration-300",
                  open && "-translate-y-[7px] -rotate-45",
                )}
              />
            </span>
          </button>
        </nav>
      </Container>

      {/* Mobile dropdown panel */}
      <div
        className={cn(
          "overflow-hidden transition-[max-height,opacity] duration-300 md:hidden",
          open ? "max-h-[28rem] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <Container className="pb-4">
          <div className="glass-strong flex flex-col gap-1 rounded-2xl border border-line p-3">
            {site.nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-4 py-3 text-sm text-muted transition-colors hover:bg-surface hover:text-fg"
              >
                {item.label}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
              <Button
                variant="secondary"
                size="md"
                href={site.DASHBOARD_URL}
                className="w-full"
              >
                Sign in
              </Button>
              <Button
                variant="primary"
                size="md"
                href={site.INSTALL_URL}
                className="w-full"
              >
                Add to Discord
              </Button>
            </div>
          </div>
        </Container>
      </div>
    </header>
  );
}
