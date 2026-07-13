import type { CatalogRepository, PublishedCatalog } from "@airline-manager/domain";
import type { QueryContext, QueryHandler } from "./index.js";

export type GetPublishedCatalog = Readonly<{ worldRulesetVersion: string }>;

export class GetCurrentPublishedCatalogHandler implements QueryHandler<
  Readonly<Record<string, never>>,
  PublishedCatalog | undefined
> {
  public constructor(private readonly repository: CatalogRepository) {}

  public execute(
    _query: Readonly<Record<string, never>>,
    context: QueryContext,
  ): Promise<PublishedCatalog | undefined> {
    void context;
    return this.repository.findCurrentPublishedCatalog();
  }
}

export class GetPublishedCatalogHandler implements QueryHandler<
  GetPublishedCatalog,
  PublishedCatalog | undefined
> {
  public constructor(private readonly repository: CatalogRepository) {}

  public execute(
    query: GetPublishedCatalog,
    context: QueryContext,
  ): Promise<PublishedCatalog | undefined> {
    void context;
    return this.repository.findPublishedCatalogByWorldRuleset(query.worldRulesetVersion);
  }
}
