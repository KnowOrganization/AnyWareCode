"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo, LogoMark } from "@/components/ui/Logo";
import { Cta } from "./Cta";
import { chapters } from "./chapters";
import { cn } from "@/lib/cn";
import * as site from "@/lib/site";

const links = chapters.filter((c) => c.id !== "hero" && c.id !== "signoff");

/**
 * Document header: wordmark, numbered chapter links, CTA. Mobile gets a
 * full-screen overlay index with oversized entries.
 */
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while the overlay index is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300",
          scrolled || open
            ? "border-line bg-bg/80 backdrop-blur-xl"
            : "border-transparent",
        )}
      >
        <div className="mx-auto flex h-16 w-full max-w-8xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            href="/"
            className="group flex items-center gap-2.5"
            onClick={() => setOpen(false)}
          >
            {/* <LogoMark className="h-7 w-auto transition-transform duration-200 group-hover:scale-105" />
            <span className="font-display text-lg font-semibold tracking-tight">
              AnyWare<span className="text-primary">Code</span>
            </span> */}
            <Logo withWordmark={true} />

          </Link>

          <nav className="hidden items-center gap-6 md:flex" aria-label="Sections">
            {links.map((c) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                className="label-mono text-muted transition-colors hover:text-fg"
              >
                <span className="text-faint">{c.n}/</span>
                {c.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <Cta href={site.INSTALL_URL} className="h-10 px-5">
              Add to Discord
            </Cta>
          </div>

          {/* Mobile index toggle */}
          <button
            type="button"
            aria-label="Toggle index"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="label-mono flex h-10 items-center gap-2 rounded-[0.3rem] border border-line-strong px-4 text-fg transition-colors hover:bg-surface md:hidden"
          >
            {open ? "Close" : "Index"}
            <span
              className={cn(
                "inline-block text-primary transition-transform duration-300",
                open && "rotate-45",
              )}
            >
              +
            </span>
          </button>
        </div>
      </header>

      {/* Full-screen mobile index */}
      <div
        className={cn(
          "fixed inset-0 z-40 flex flex-col bg-bg/95 backdrop-blur-2xl transition-opacity duration-300 md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="mt-16 flex flex-1 flex-col justify-center px-6">
          {links.map((c, i) => (
            <a
              key={c.id}
              href={`#${c.id}`}
              onClick={() => setOpen(false)}
              className={cn(
                "group flex items-baseline gap-4 border-b border-line py-5 transition-all duration-500",
                open ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
              )}
              style={{ transitionDelay: open ? `${80 + i * 60}ms` : "0ms" }}
            >
              <span className="label-mono text-faint">{c.n}</span>
              <span className="font-display text-3xl font-bold uppercase tracking-tight transition-colors group-hover:text-primary">
                {c.label}
              </span>
            </a>
          ))}
          <div
            className={cn(
              "mt-8 flex flex-col gap-3 transition-all duration-500",
              open ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
            )}
            style={{ transitionDelay: open ? "400ms" : "0ms" }}
          >
            <Cta href={site.INSTALL_URL} className="w-full">
              Add to Discord
            </Cta>
          </div>
        </div>
        <p className="label-mono px-6 pb-8 text-faint">
          ANYWARECODE — SHIPPING MANIFEST
        </p>
      </div>
    </>
  );
}
