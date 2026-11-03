"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Open orders" },
  { href: "/producers", label: "Producers" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="site-nav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
