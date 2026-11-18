"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SECONDARY } from "@/lib/nav";

import s from "./ui.module.css";

const PRIMARY = [
  { href: "/", label: "Today" },
  { href: "/form", label: "Form" },
  { href: "/runs", label: "Runs" },
  { href: "/recovery", label: "Recovery" },
] as const;


/** Bottom bar on phones (12 px top radius), left rail from 1024 px. */
export function Nav({ current }: { current?: string }) {
  const path = usePathname();
  const active = current ?? path;
  // /activity/… belongs to Runs; secondary pages light up More on phones.
  const isActive = (href: string) => active === href || (href === "/runs" && active.startsWith("/activity/"));
  const inMore = active === "/more" || SECONDARY.some((it) => active === it.href);
  const items = [
    ...PRIMARY.map((it) => ({ ...it, li: undefined, current: isActive(it.href) })),
    { href: "/more", label: "More", li: s.navMoreItem, current: inMore },
    ...SECONDARY.map((it) => ({ href: it.href, label: it.label, li: s.navExtraItem, current: isActive(it.href) })),
  ];
  return (
    <nav className={s.nav} aria-label="Main">
      <ul className={s.navList}>
        {items.map((it) => (
          <li key={it.href} className={it.li}>
            <Link href={it.href} className={s.navLink} aria-current={it.current ? "page" : undefined} prefetch={false}>
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
