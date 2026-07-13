"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";

export type AuthorityConnection =
  "connected" | "reconnecting" | "offline" | "stale" | "session_expired" | "forbidden";

const copy: Record<AuthorityConnection, string> = {
  connected: "Live updates connected",
  reconnecting: "Reconnecting to live updates",
  offline: "Offline. Showing the last authoritative response",
  stale: "Live updates are stale. Refreshing",
  session_expired: "Session expired. Sign in to resume",
  forbidden: "This account cannot access the live stream",
};

export function LiveAuthorityStatus() {
  const router = useRouter();
  const [status, setStatus] = useState<AuthorityConnection>("reconnecting");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let backoff = 1_000;
    const refresh = () => {
      if (refreshTimer.current) return;
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        startTransition(() => router.refresh());
      }, 350);
    };
    const wait = (milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

    const connect = async () => {
      while (!stopped) {
        if (!navigator.onLine) {
          setStatus("offline");
          await wait(1_000);
          continue;
        }
        const cursor = window.localStorage.getItem("airline-manager:event-cursor") ?? "0";
        setStatus("reconnecting");
        try {
          const response = await fetch(`/backend/v1/events?cursor=${encodeURIComponent(cursor)}`, {
            credentials: "include",
            headers: { accept: "text/event-stream", "last-event-id": cursor },
            cache: "no-store",
            signal: controller.signal,
          });
          if (response.status === 401) {
            setStatus("session_expired");
            return;
          }
          if (response.status === 403) {
            setStatus("forbidden");
            return;
          }
          if (!response.ok || !response.body) throw new Error("stream_unavailable");
          setStatus("connected");
          backoff = 1_000;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let lastActivity = Date.now();
          while (!stopped) {
            const chunk = await reader.read();
            if (chunk.done) break;
            lastActivity = Date.now();
            buffer += decoder.decode(chunk.value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              const id = frame
                .split("\n")
                .find((line) => line.startsWith("id: "))
                ?.slice(4)
                .trim();
              if (id && /^\d+$/.test(id)) {
                const current = BigInt(
                  window.localStorage.getItem("airline-manager:event-cursor") ?? "0",
                );
                if (BigInt(id) > current) {
                  window.localStorage.setItem("airline-manager:event-cursor", id);
                  refresh();
                }
              }
            }
            if (Date.now() - lastActivity > 45_000) {
              setStatus("stale");
              break;
            }
          }
        } catch (error) {
          if (stopped || (error instanceof DOMException && error.name === "AbortError")) return;
          setStatus(navigator.onLine ? "reconnecting" : "offline");
        }
        await wait(backoff);
        backoff = Math.min(backoff * 2, 30_000);
      }
    };
    const online = () => {
      setStatus("reconnecting");
      refresh();
    };
    const offline = () => setStatus("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    void connect();
    return () => {
      stopped = true;
      controller.abort();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [router]);

  return (
    <p className="authority-status" data-connection={status} role="status" aria-live="polite">
      <span aria-hidden />
      {copy[status]}
    </p>
  );
}
