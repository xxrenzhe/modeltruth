import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export type ContentPageType = "home" | "provider" | "compare" | "guide" | "methodology" | "pricing" | "privacy" | "terms";

export interface ContentPageRecord {
  id: string;
  locale: string;
  type: ContentPageType;
  slug: string;
  title: string;
  description: string;
  bodyMarkdown: string;
  seoTitle?: string;
  seoDescription?: string;
  canonicalSlug?: string;
  noIndex: boolean;
  publishedAt?: string;
  updatedAt: string;
}

export interface UpsertContentPageInput {
  locale: string;
  type: ContentPageType;
  slug: string;
  title: string;
  description: string;
  bodyMarkdown: string;
  seoTitle?: string;
  seoDescription?: string;
  canonicalSlug?: string;
  noIndex?: boolean;
  publishedAt?: string;
}

export interface ContentPageRepository {
  upsert(input: UpsertContentPageInput): Promise<ContentPageRecord>;
  get(locale: string, type: ContentPageType, slug: string): Promise<ContentPageRecord | undefined>;
  listPublished(locale: string, type?: ContentPageType): Promise<ContentPageRecord[]>;
  close(): Promise<void>;
}

export async function createContentPageRepository(): Promise<ContentPageRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresContentPageRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteContentPageRepository(new DatabaseSync(config.databasePath));
}

class SqliteContentPageRepository implements ContentPageRepository {
  constructor(private readonly db: { prepare(sql: string): any; close(): void }) {}

  async upsert(input: UpsertContentPageInput): Promise<ContentPageRecord> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into content_pages (
          id, locale, type, slug, title, description, body_markdown, seo_title, seo_description,
          canonical_slug, no_index, published_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(locale, type, slug) do update set
          title = excluded.title,
          description = excluded.description,
          body_markdown = excluded.body_markdown,
          seo_title = excluded.seo_title,
          seo_description = excluded.seo_description,
          canonical_slug = excluded.canonical_slug,
          no_index = excluded.no_index,
          published_at = excluded.published_at,
          updated_at = excluded.updated_at`
      )
      .run(
        crypto.randomUUID(),
        input.locale,
        input.type,
        input.slug,
        input.title,
        input.description,
        input.bodyMarkdown,
        input.seoTitle ?? null,
        input.seoDescription ?? null,
        input.canonicalSlug ?? null,
        input.noIndex ? 1 : 0,
        input.publishedAt ?? now,
        now
      );
    return (await this.get(input.locale, input.type, input.slug))!;
  }

  async get(locale: string, type: ContentPageType, slug: string): Promise<ContentPageRecord | undefined> {
    const row = this.db
      .prepare("select * from content_pages where locale = ? and type = ? and slug = ? limit 1")
      .get(locale, type, slug) as ContentPageRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  async listPublished(locale: string, type?: ContentPageType): Promise<ContentPageRecord[]> {
    const rows = type
      ? this.db
          .prepare(
            `select * from content_pages
             where locale = ? and type = ? and no_index = 0 and published_at is not null
             order by updated_at desc`
          )
          .all(locale, type)
      : this.db
          .prepare(
            `select * from content_pages
             where locale = ? and no_index = 0 and published_at is not null
             order by updated_at desc`
          )
          .all(locale);
    return (rows as ContentPageRow[]).map(mapRow);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgresContentPageRepository implements ContentPageRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async upsert(input: UpsertContentPageInput): Promise<ContentPageRecord> {
    const now = new Date().toISOString();
    const rows = await this.sql<ContentPageRow[]>`
      insert into content_pages (
        id, locale, type, slug, title, description, body_markdown, seo_title, seo_description,
        canonical_slug, no_index, published_at, updated_at
      ) values (
        ${crypto.randomUUID()}, ${input.locale}, ${input.type}, ${input.slug}, ${input.title},
        ${input.description}, ${input.bodyMarkdown}, ${input.seoTitle ?? null}, ${input.seoDescription ?? null},
        ${input.canonicalSlug ?? null}, ${input.noIndex ? 1 : 0}, ${input.publishedAt ?? now}, ${now}
      )
      on conflict (locale, type, slug) do update set
        title = excluded.title,
        description = excluded.description,
        body_markdown = excluded.body_markdown,
        seo_title = excluded.seo_title,
        seo_description = excluded.seo_description,
        canonical_slug = excluded.canonical_slug,
        no_index = excluded.no_index,
        published_at = excluded.published_at,
        updated_at = excluded.updated_at
      returning *
    `;
    return mapRow(rows[0]);
  }

  async get(locale: string, type: ContentPageType, slug: string): Promise<ContentPageRecord | undefined> {
    const rows = await this.sql<ContentPageRow[]>`
      select * from content_pages where locale = ${locale} and type = ${type} and slug = ${slug} limit 1
    `;
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  async listPublished(locale: string, type?: ContentPageType): Promise<ContentPageRecord[]> {
    const rows = type
      ? await this.sql<ContentPageRow[]>`
          select * from content_pages
          where locale = ${locale} and type = ${type} and no_index = 0 and published_at is not null
          order by updated_at desc
        `
      : await this.sql<ContentPageRow[]>`
          select * from content_pages
          where locale = ${locale} and no_index = 0 and published_at is not null
          order by updated_at desc
        `;
    return rows.map(mapRow);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

interface ContentPageRow {
  id: string;
  locale: string;
  type: ContentPageType;
  slug: string;
  title: string;
  description: string;
  body_markdown: string;
  seo_title?: string | null;
  seo_description?: string | null;
  canonical_slug?: string | null;
  no_index: number | boolean;
  published_at?: string | null;
  updated_at: string;
}

function mapRow(row: ContentPageRow): ContentPageRecord {
  return {
    id: row.id,
    locale: row.locale,
    type: row.type,
    slug: row.slug,
    title: row.title,
    description: row.description,
    bodyMarkdown: row.body_markdown,
    seoTitle: row.seo_title ?? undefined,
    seoDescription: row.seo_description ?? undefined,
    canonicalSlug: row.canonical_slug ?? undefined,
    noIndex: Boolean(row.no_index),
    publishedAt: row.published_at ?? undefined,
    updatedAt: row.updated_at
  };
}
