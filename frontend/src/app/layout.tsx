import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Roboto_Condensed } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const sportFont = Roboto_Condensed({
  variable: "--font-sport",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "SimSoccer | Match centre",
  description: "Live scores, fixtures, and league tables from the SimSoccer world.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sportFont.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
