import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Parallax } from "./fx/Parallax";
import * as site from "@/lib/site";
import { LogoWord } from "../ui/Logo";

/**
 * Colophon: link columns over a giant outline wordmark, closed by the
 * ledger line.
 */
export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-line">
      <Container>
        <div className="grid gap-10 py-14 sm:grid-cols-[1.2fr_repeat(3,minmax(0,1fr))]">
          <div>
            <LogoWord className="h-48" />
            <p className="mt-3 max-w-xs text-sm text-muted">
              The accountable Discord-native coding agent. Belongs to the
              server, not a seat.
            </p>
          </div>
          {site.footerColumns.map((col) => (
            <div key={col.title}>
              <p className="label-mono text-faint">{col.title}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.href.startsWith("#") || /^https?:/.test(l.href) ? (
                      <a
                        href={l.href}
                        className="text-sm text-muted transition-colors hover:text-fg"
                        {...(/^https?:/.test(l.href)
                          ? { target: "_blank", rel: "noopener noreferrer" }
                          : {})}
                      >
                        {l.label}
                      </a>
                    ) : (
                      <Link
                        href={l.href}
                        className="text-sm text-muted transition-colors hover:text-fg"
                      >
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Parallax axis="x" speed={0.7}>
          <p
            aria-hidden
            className="text-outline select-none whitespace-nowrap text-center font-display text-[clamp(3rem,11.5vw,9.5rem)] font-bold uppercase leading-none tracking-tight"
          >
            AnyWareCode
          </p>
        </Parallax>

        <div className="label-mono flex flex-col items-start justify-between gap-2 border-t border-line py-6 text-faint sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} ANYWARECODE — LEDGER CLOSED</span>
          <span>EVERY PR SIGNS ITS NAME</span>
        </div>
      </Container>
    </footer>
  );
}
