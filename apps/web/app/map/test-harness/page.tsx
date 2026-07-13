import { notFound } from "next/navigation";
import { MapTestHarness } from "./map-test-harness";

export default function MapTestHarnessPage() {
  if (process.env.MAP_TEST_HARNESS !== "enabled") notFound();
  return <MapTestHarness />;
}
