import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.filippogalbo.com/assayindex"),
  title: {
    default: "AssayIndex",
    template: "%s | AssayIndex",
  },
  description:
    "A source-transparent index of reference laboratory tests and validated discovery data.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
