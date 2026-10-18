"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/networking/feed", label: "Feed", icon: "⌂" },
  { href: "/networking/connections", label: "My network", icon: "♙" },
  { href: "/networking/messages", label: "Messages", icon: "✉" },
  { href: "/networking/profile", label: "My profile", icon: "◉" },
];

export default function NetworkingNavigation() {
  const pathname = usePathname();

  return (
    <nav className="network-navigation" aria-label="Professional network">
      <div className="network-navigation-inner">
        <span className="network-navigation-label">Your network</span>
        <div className="network-navigation-links">
          {items.map((item) => {
            const active = pathname === item.href ||
              (item.href === "/networking/feed" && pathname === "/") ||
              (item.href === "/networking/profile" && pathname.startsWith("/profiles/"));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "network-navigation-link is-active" : "network-navigation-link"}
                aria-current={active ? "page" : undefined}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
