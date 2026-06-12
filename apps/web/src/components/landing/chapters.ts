/** Ledger chapters — single source for section ids, numbering, and labels. */
export const chapters = [
  { id: "hero", n: "00", label: "Manifest" },
  { id: "features", n: "01", label: "Entries" },
  { id: "how", n: "02", label: "Custody" },
  { id: "security", n: "03", label: "Threat model" },
  { id: "pricing", n: "04", label: "Receipts" },
  { id: "faq", n: "05", label: "Queries" },
  { id: "signoff", n: "06", label: "Sign-off" },
] as const;

export type Chapter = (typeof chapters)[number];
