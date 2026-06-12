"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { webglOk } from "@/lib/webgl";

const HeroField = dynamic(() => import("./HeroField"), { ssr: false });

/**
 * Client gate for the hero WebGL field: mounts only on motion-friendly,
 * WebGL-capable, ≥md viewports so phones and reduced-motion users get the
 * plain (still fully styled) hero.
 */
export function HeroFieldLazy() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(
      window.matchMedia("(min-width: 768px)").matches &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
        webglOk(),
    );
  }, []);

  if (!show) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 [mask-image:linear-gradient(180deg,transparent_4%,rgba(0,0,0,0.45)_36%,#000_70%)]"
    >
      <HeroField />
    </div>
  );
}
