import type { ReactNode } from 'react';

/** Embeds must be frameable from storyvenue.com (see next.config.ts headers). */
export default function EmbedLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
