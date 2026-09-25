import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stem de Hit — kies wat hierna komt",
  description: "Scan, voeg een muziekwens toe en stem samen op het volgende nummer.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
