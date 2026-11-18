import Link from "next/link";

import { SECONDARY } from "@/lib/nav";
import { requireOwner } from "@/lib/auth";

import s from "../analysis.module.css";

export const metadata = { title: "More · Psycho" };

/** Phone-only index of the pages that don't fit in the bottom bar. */
export default async function MorePage() {
  await requireOwner();
  return (
    <main className={s.page}>
      <header className={s.head}>
        <h1 className={`display ${s.title}`}>More</h1>
      </header>
      <section className={s.band}>
        <ul className={s.list}>
          {SECONDARY.map((it) => (
            <li key={it.href}>
              <Link className={s.item} href={it.href} prefetch={false}>
                <span className={s.itemMain}>
                  <span className={s.itemName}>{it.label}</span>
                  <span className={s.itemMeta}>{it.blurb}</span>
                </span>
                <span className={s.itemValue} aria-hidden>
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
