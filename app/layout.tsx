import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PrototypeInteractions from "@/components/PrototypeInteractions";

export const metadata: Metadata = {
  title: {
    default: "CareerVerse AI — Find your next move",
    template: "%s | CareerVerse AI",
  },
  description:
    "Discover work that fits your ambitions, build skills employers value, and move forward with CareerVerse AI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" data-theme="public">
      <body>
        <Header />
        <PrototypeInteractions />
        {children}
        <Footer />
      </body>
    </html>
  );
}
