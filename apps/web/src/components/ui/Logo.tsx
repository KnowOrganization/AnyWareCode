import { cn } from "@/lib/cn";
import Image from "next/image";

/**
 * AnyWareCode brand mark — a single continuous wave (the "AW" double-hump)
 * resolving into a signed dot: the human sponsor cradled in the final curve.
 * Stroke is gradient teal; scales crisp from favicon to hero. Pure SVG so it
 * themes, never ships a black PNG box onto the near-black surface.
 */
export function LogoMark({
  className,
  title = "AnyWareCode",
}: {
  className?: string;
  title?: string;
}) {
  return (
    // <svg
    //   viewBox="0 0 124 62"
    //   role="img"
    //   aria-label={title}
    //   className={cn("block", className)}
    // >
    //   <defs>
    //     <linearGradient id="awc-stroke" x1="8" y1="48" x2="116" y2="14" gradientUnits="userSpaceOnUse">
    //       <stop offset="0" stopColor="#5ffbe6" />
    //       <stop offset="0.55" stopColor="#00f5d4" />
    //       <stop offset="1" stopColor="#13c9b3" />
    //     </linearGradient>
    //   </defs>
    //   <g
    //     fill="none"
    //     stroke="url(#awc-stroke)"
    //     strokeWidth="9"
    //     strokeLinecap="round"
    //     strokeLinejoin="round"
    //   >
    //     <path d="M14 46 C7 47 8 39 16 39 C25 39 26 14 37 14 C48 14 48 45 57 51 C63 55 69 51 73 42 C79 28 83 16 93 16 C101 16 103 38 109 43 C112 45 116 43 119 38" />
    //   </g>
    //   {/* signed dot — the human sponsor cradled in the final curve */}
    //   <circle cx="102" cy="41" r="5.4" fill="#00f5d4" />
    // </svg>
    <>
    <Image
      src="/brand/anywarecode-glyph.png"
      alt={title}
      width={160}
      height={80}
      className={cn("block", className)}
      />

      </>
  );
}

/** Glyph + wordmark lockup. "AnyWare" in fg, "Code" in the signature teal. */
export function Logo({
  className,
  markClassName,
  withWordmark = true,
}: {
  className?: string;
  markClassName?: string;
  withWordmark?: boolean;
}) {
  return (
    <>
      {withWordmark && (<>
        <Image
        src="/brand/anywarecode-lockup.png"
        alt="AnyWareCode"
        width={200}
        height={80}
        className={cn("block", className)}
        />
        </>
      ) || <LogoMark className={cn("h-7 w-auto", markClassName)} />}
    </>
  );
}


/** Glyph + wordmark lockup. "AnyWare" in fg, "Code" in the signature teal. */
export function LogoWord({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
  withWordmark?: boolean;
}) {
  return (
    <>
        <Image
        src="/brand/anywarecode-word.png"
        alt="AnyWareCode"
        width={200}
        height={90}
        className={cn("block", className)}
        />
    </>
  );
}