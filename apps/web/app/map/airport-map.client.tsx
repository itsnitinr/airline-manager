"use client";

import { useEffect, useRef, useState } from "react";
import { createMapLibreAdapter } from "./maplibre-adapter";
import type { AirportMapAdapterInstance, AirportMapAirport, AirportMapRenderStatus } from "./types";
import styles from "./airport-map.module.css";

type AirportMapCanvasProps = Readonly<{
  airports: readonly AirportMapAirport[];
  selectedAirportIds?: readonly string[];
  route?: Readonly<{ originAirportId: string; destinationAirportId: string }>;
  interactive: boolean;
  selectable: boolean;
  label: string;
  presentation: "contained" | "shell";
  onSelect?(airportId: string): void;
  styleUrl?: string;
}>;

const statusCopy: Readonly<Record<AirportMapRenderStatus, string>> = {
  loading: "Loading published airport coordinates.",
  ready: "Published airport layer ready.",
  degraded: "Base map unavailable. Published airport points remain available.",
  unavailable: "Interactive map unavailable. Published airport data remains available.",
  error: "Map could not start. Retry this page to restore the geographic view.",
};

export function AirportMapCanvas({
  airports,
  selectedAirportIds = [],
  route,
  interactive,
  selectable,
  label,
  presentation,
  onSelect,
  styleUrl,
}: AirportMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<AirportMapAdapterInstance | null>(null);
  const airportsRef = useRef(airports);
  const selectedAirportIdsRef = useRef(selectedAirportIds);
  const routeRef = useRef(route);
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
        selectedAirportIds: selectedAirportIdsRef.current,
        ...(routeRef.current === undefined ? {} : { route: routeRef.current }),
        interactive,
        selectable,
        label,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        ...(presentation === "shell" ? { cameraPadding: shellCameraPadding() } : {}),
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
  }, [hasAirports, interactive, label, presentation, selectable, styleUrl]);

  useEffect(() => {
    const resize = () => instanceRef.current?.resize();
    window.addEventListener("resize", resize, { passive: true });
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    airportsRef.current = airports;
    selectedAirportIdsRef.current = selectedAirportIds;
    routeRef.current = route;
    instanceRef.current?.update(airports, selectedAirportIds, route);
  }, [airports, route, selectedAirportIds]);

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

function shellCameraPadding() {
  if (window.innerWidth <= 640) return { top: 96, right: 24, bottom: 172, left: 24 };
  if (window.innerWidth <= 900) return { top: 104, right: 32, bottom: 120, left: 32 };
  return { top: 112, right: 400, bottom: 116, left: 124 };
}
