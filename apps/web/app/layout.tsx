import "./globals.css";
import { Providers } from "../src/providers";
import type { ReactNode } from "react";

export const metadata = {
  title: "ClassFlow — Teach. Manage. Grow.",
  description: "The operating system for tuition classes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
