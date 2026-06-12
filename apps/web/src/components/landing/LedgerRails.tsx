/**
 * Fixed document chrome: two vertical hairlines framing the content column
 * (ledger margins) plus a faint film-grain wash. Pure CSS, renders nothing
 * interactive.
 */
export function LedgerRails() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      <div className="mx-auto hidden h-full w-full max-w-6xl border-x border-line/60 lg:block" />
      <div className="noise absolute inset-0 opacity-[0.05]" />
    </div>
  );
}
