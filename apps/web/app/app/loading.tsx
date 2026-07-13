import { Skeleton } from "../components/ui";
export default function ApplicationLoading() {
  return (
    <main className="shell-loading">
      <aside>
        <Skeleton label="Loading navigation" />
      </aside>
      <section>
        <header>
          <Skeleton label="Loading airline context" />
        </header>
        <div>
          <Skeleton label="Loading network map" />
        </div>
      </section>
    </main>
  );
}
