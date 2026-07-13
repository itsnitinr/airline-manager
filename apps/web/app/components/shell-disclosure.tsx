"use client";

import { CaretUp, SidebarSimple, X } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

const storageKey = "airline-manager:shell-inspector:v1";
const compactQuery = "(max-width: 56.25rem)";

export function ShellDisclosure({
  children,
  mobileUtilities,
  trayTitle,
  trayDetail,
}: {
  children: ReactNode;
  mobileUtilities: ReactNode;
  trayTitle: string;
  trayDetail: string;
}) {
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const [compact, setCompact] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const media = window.matchMedia(compactQuery);
    let disposed = false;
    const applyViewport = (matches: boolean) => {
      setCompact(matches);
      if (matches) {
        setOpen(false);
        return;
      }
      try {
        const stored = window.localStorage.getItem(storageKey);
        setOpen(stored !== "closed");
      } catch {
        setOpen(true);
      }
    };
    const synchronize = window.setTimeout(() => {
      if (disposed) return;
      applyViewport(media.matches);
      setReady(true);
    }, 0);
    const onChange = (event: MediaQueryListEvent) => applyViewport(event.matches);
    media.addEventListener("change", onChange);
    return () => {
      disposed = true;
      window.clearTimeout(synchronize);
      media.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const setDisclosure = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!compact) {
      try {
        window.localStorage.setItem(storageKey, nextOpen ? "open" : "closed");
      } catch {
        // The preference is optional when storage is unavailable.
      }
    }
  };

  return (
    <div
      className="shell-disclosure"
      data-compact={compact}
      data-inspector-open={open}
      data-ready={ready}
    >
      <button
        ref={triggerRef}
        className="inspector-toggle"
        type="button"
        aria-controls="network-inspector"
        aria-expanded={open}
        onClick={() => setDisclosure(!open)}
      >
        <SidebarSimple aria-hidden />
        <span>{open ? "Minimize inspector" : "Open inspector"}</span>
      </button>
      <aside
        ref={panelRef}
        className="context-inspector"
        id="network-inspector"
        aria-label="Network inspector"
        hidden={!open}
      >
        <div className="inspector-heading">
          <span>Network inspector</span>
          <button
            type="button"
            aria-label="Close network inspector"
            onClick={() => {
              setDisclosure(false);
              triggerRef.current?.focus();
            }}
          >
            <X aria-hidden />
          </button>
        </div>
        <div className="inspector-scroll">{children}</div>
        <div className="mobile-utilities">{mobileUtilities}</div>
      </aside>
      <section className="context-tray" aria-label="Current network context">
        <button
          type="button"
          aria-controls="network-inspector"
          aria-expanded={open}
          onClick={() => setDisclosure(true)}
        >
          <span className="tray-label">Next safe action</span>
          <strong>{trayTitle}</strong>
          <small>{trayDetail}</small>
          <CaretUp aria-hidden />
        </button>
      </section>
    </div>
  );
}
