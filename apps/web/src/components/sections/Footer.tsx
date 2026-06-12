import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/Reveal";
import { cn } from "@/lib/cn";
import { footerColumns } from "@/lib/site";

const legalLinks = [
  { label: "Terms", href: "/legal/terms" },
  { label: "Privacy", href: "/legal/privacy" },
] as const;

function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

function FooterLink({ href, label }: { href: string; label: string }) {
  const className = "text-muted transition-colors hover:text-fg";
  if (isExternal(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className={className}
      >
        {label}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}

export function Footer() {
  return (
    <footer className="relative border-t border-line py-14">
      <Container>
        <Reveal className="grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div className="lg:pr-6">
            <span className="font-display text-2xl font-semibold tracking-tight">
              Anywhere<span className="text-gradient">Code</span>
            </span>
            <p className="mt-3 max-w-xs text-sm text-muted">
              Your server&apos;s shared coding agent.
            </p>
            <p className="mt-4 max-w-xs text-xs leading-relaxed text-faint">
              BYO LLM key · isolated containers · opens PRs, never pushes to main.
            </p>
          </div>

          {/* Link columns */}
          {footerColumns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3 className="text-sm font-medium uppercase tracking-wide text-faint">
                {col.title}
              </h3>
              <ul className="mt-4 space-y-3 text-sm">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <FooterLink href={link.href} label={link.label} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </Reveal>

        {/* Bottom bar */}
        <div
          className={cn(
            "mt-10 flex flex-col gap-4 border-t border-line pt-6",
            "sm:flex-row sm:items-center sm:justify-between",
          )}
        >
          <p className="text-sm text-faint">
            © AnywhereCode. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-sm text-faint">
            {legalLinks.map((link) => (
              <FooterLink key={link.label} href={link.href} label={link.label} />
            ))}
          </div>
        </div>
      </Container>
    </footer>
  );
}
