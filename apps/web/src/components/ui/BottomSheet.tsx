"use client";

import { useEffect, useId, useRef } from "react";

import s from "./ui.module.css";

/** Modal sheet that slides up from the bottom. Esc and the backdrop close it; focus moves in on
 * open and returns to the opener on close. Motion is removed under prefers-reduced-motion. */
export function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])");
        const first = f[0];
        const last = f[f.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className={s.backdrop} onClick={onClose}>
      <div
        ref={panel}
        className={s.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.grabber} aria-hidden />
        <div className={s.sheetHead}>
          <h2 id={id} className={s.sheetTitle}>
            {title}
          </h2>
          <button type="button" className={s.close} onClick={onClose}>
            Close
          </button>
        </div>
        <div className={s.sheetBody}>{children}</div>
      </div>
    </div>
  );
}
