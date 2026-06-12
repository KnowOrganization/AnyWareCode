"use client";

import { useEffect, useState } from "react";
import { chapters } from "./chapters";
import { cn } from "@/lib/cn";

/**
 * Fixed right-edge chapter index (xl+ only). Scrollspy via
 * IntersectionObserver; the active chapter shows its label, the rest collapse
 * to mono numbers.
 */
export function ChapterIndex() {
  const [active, setActive] = useState<string>(chapters[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      // A thin band around the viewport's vertical center decides the chapter.
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const c of chapters) {
      const el = document.getElementById(c.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      aria-label="Chapters"
      className="fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-end gap-2.5 xl:flex"
    >
      {chapters.map((c) => {
        const isActive = active === c.id;
        return (
          <a
            key={c.id}
            href={`#${c.id}`}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "label-mono flex items-center gap-2 transition-colors duration-300",
              isActive ? "text-primary" : "text-faint hover:text-muted",
            )}
          >
            <span
              className={cn(
                "overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300",
                isActive ? "max-w-32 opacity-100" : "max-w-0 opacity-0",
              )}
            >
              {c.label}
            </span>
            <span>{c.n}</span>
            <span
              className={cn(
                "h-px transition-all duration-300",
                isActive ? "w-6 bg-primary" : "w-3 bg-line-strong",
              )}
            />
          </a>
        );
      })}
    </nav>
  );
}
