import { AppShell } from "../../src/components/shell";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
