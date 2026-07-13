"use client";

import { useEffect, useRef, useState } from "react";
import { createMapLibreAdapter } from "./maplibre-adapter";
import type { AirportMapAdapterInstance, AirportMapAirport, AirportMapRenderStatus } from "./types";
import styles from "./airport-map.module.css";

type AirportMapCanvasProps = Readonly<{
  airports: readonly AirportMapAirport[];
  selectedAirportId?: string;
  interactive: boolean;
  label: string;
  onSelect?(airportId: string): void;
  styleUrl?: string;
}>;

const statusCopy: Readonly<Record<AirportMapRenderStatus, string>> = {
  loading: "Loading published airport coordinates.",
  ready: "Published airport layer ready.",
  degraded: "Base map unavailable. Published airport points remain available.",
  unavailable: "Interactive map unavailable. Use the airport list to continue.",
  error: "Map could not start. Use the airport list or retry this page.",
};

export function AirportMapCanvas({
  airports,
  selectedAirportId,
  interactive,
  label,
  onSelect,
  styleUrl,
}: AirportMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<AirportMapAdapterInstance | null>(null);
  const airportsRef = useRef(airports);
  const selectedAirportIdRef = useRef(selectedAirportId);
  const onSelectRef = useRef(onSelect);
  const [status, setStatus] = useState<AirportMapRenderStatus>("loading");
  const hasAirports = airports.length > 0;

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasAirports) return;
    let disposed = false;
    const updateStatus = (nextStatus: AirportMapRenderStatus) => {
      if (!disposed) setStatus(nextStatus);
    };
    queueMicrotask(() => updateStatus("loading"));
    try {
      instanceRef.current = createMapLibreAdapter().mount(container, {
        airports: airportsRef.current,
        ...(selectedAirportIdRef.current === undefined
          ? {}
          : { selectedAirportId: selectedAirportIdRef.current }),
        interactive,
        label,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        ...(styleUrl === undefined ? {} : { styleUrl }),
        onSelect: (airportId) => onSelectRef.current?.(airportId),
        onReady: (mode) => {
          if (!disposed)
            setStatus((current) =>
              mode === "fallback" && current === "degraded" ? current : "ready",
            );
        },
        onFallback: () => updateStatus("degraded"),
        onUnavailable: () => updateStatus("unavailable"),
        onError: () => updateStatus("error"),
      });
    } catch {
      queueMicrotask(() => updateStatus("error"));
    }
    return () => {
      disposed = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [hasAirports, interactive, label, styleUrl]);

  useEffect(() => {
    airportsRef.current = airports;
    selectedAirportIdRef.current = selectedAirportId;
    instanceRef.current?.update(airports, selectedAirportId);
  }, [airports, selectedAirportId]);

  if (!hasAirports) {
    return (
      <div className={styles.emptyState} role="status">
        <strong>No published airports available</strong>
        <span>Retry after the catalog service is available.</span>
      </div>
    );
  }

  return (
    <div className={styles.canvasFrame} data-map-status={status}>
      <div ref={containerRef} className={styles.canvas} data-testid="airport-map-canvas" />
      {status !== "ready" ? (
        <p className={styles.mapStatus} role={status === "error" ? "alert" : "status"}>
          {statusCopy[status]}
        </p>
      ) : null}
      <span className={styles.srOnly}>
        {label}. {statusCopy[status]}
      </span>
    </div>
  );
}
