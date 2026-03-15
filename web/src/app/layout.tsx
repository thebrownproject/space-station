import type { Metadata } from "next";
import { Exo_2, JetBrains_Mono, Outfit } from "next/font/google";
import { CommandPalette } from "@/components/layout/command-palette";
import { QuickCreate } from "@/components/nodes/quick-create";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const exo2 = Exo_2({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Space Station",
  description: "Multi-agent workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${outfit.variable} ${jetbrains.variable} ${exo2.variable} antialiased`}
      >
        <CommandPalette />
        <QuickCreate />
        {children}
      </body>
    </html>
  );
}
