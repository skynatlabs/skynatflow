// The layout for a page that lives inside somebody else's website.
//
// No shell, no navigation, no background of its own — the host page supplies
// the surroundings, and a widget that paints its own full-page background
// arrives as a white rectangle stuck in the middle of a dark site. Everything
// here is deliberately narrow and transparent.

import type { ReactNode } from "react";

export default function EmbedLayout({ children }: { children: ReactNode }) {
  return <div className="embed-root">{children}</div>;
}
