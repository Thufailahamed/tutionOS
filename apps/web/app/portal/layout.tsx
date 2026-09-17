import { PortalShell } from "../../src/components/portalShell";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
