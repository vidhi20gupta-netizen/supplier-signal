import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Supplier Signal",
  description: "Soulspiti producer and order triage",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="brand">
            Soulspiti<span>Supplier Signal</span>
          </div>
          <Nav />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
