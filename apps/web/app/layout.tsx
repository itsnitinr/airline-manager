import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/manrope/wght.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

export const metadata: Metadata = {
  title: { default: "Airline Manager", template: "%s | Airline Manager" },
  description: "Plan and operate a persistent airline career.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
