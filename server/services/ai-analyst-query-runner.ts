import { neon } from '@neondatabase/serverless';
import { getDatabaseUrl } from '../db-url';
import { getPgPool, isNeonDatabaseUrl } from '../sql-client';
import {
  guardAnalystSql,
  MAX_ANALYST_QUERY_ROWS,
  type AnalystRelation,
} from './ai-analyst-sql-guard';

const QUERY_TIMEOUT_MS = 12_000;
const MODEL_RESULT_ROW_LIMIT = 200;

export interface AnalystQueryResult {
  ok: boolean;
  rows?: Array<Record<string, unknown>>;
  error?: string;
  relations?: AnalystRelation[];
  rowCount?: number;
  truncated?: boolean;
  durationMs?: number;
}

function buildAnalystRelations(
  allowedRelations: ReadonlySet<AnalystRelation>
): string {
  const relations: string[] = [];
  if (allowedRelations.has('analyst_events')) {
    relations.push(`
    analyst_events AS (
    SELECT
      e.id,
      e.organization_name,
      e.department,
      e.organization_category,
      e.school_classification,
      e.status,
      e.created_at,
      e.status_changed_at,
      e.desired_event_date,
      e.scheduled_event_date,
      COALESCE(e.scheduled_event_date, e.desired_event_date) AS effective_event_date,
      e.date_flexible,
      e.is_confirmed,
      e.show_on_volunteer_hub,
      e.estimated_sandwich_count,
      e.estimated_sandwich_count_min,
      e.estimated_sandwich_count_max,
      CASE
        WHEN e.estimated_sandwich_count > 0 THEN e.estimated_sandwich_count
        WHEN e.estimated_sandwich_count_min > 0
          AND e.estimated_sandwich_count_max > 0
          THEN ROUND(
            (e.estimated_sandwich_count_min + e.estimated_sandwich_count_max) / 2.0
          )
        WHEN e.estimated_sandwich_count_min > 0
          THEN e.estimated_sandwich_count_min
        WHEN e.estimated_sandwich_count_max > 0
          THEN e.estimated_sandwich_count_max
        ELSE 0
      END AS planned_sandwich_estimate,
      e.actual_sandwich_count,
      e.actual_attendance,
      e.estimated_attendance,
      e.drivers_needed,
      e.volunteers_needed,
      e.has_refrigeration,
      e.self_transport,
      e.previously_hosted,
      e.manual_entry_source,
      e.external_id,
      e.deleted_at
    FROM event_requests e
    WHERE e.deleted_at IS NULL
    )`);
  }
  if (allowedRelations.has('analyst_collections')) {
    relations.push(`
    analyst_collections AS (
    SELECT
      sc.id,
      sc.collection_date,
      sc.host_name,
      sc.individual_sandwiches,
      sc.individual_deli,
      sc.individual_turkey,
      sc.individual_ham,
      sc.individual_pbj,
      sc.individual_generic,
      sc.group1_name,
      sc.group1_count,
      sc.group2_name,
      sc.group2_count,
      sc.group_collections,
      sc.event_request_id,
      sc.submission_method,
      sc.submitted_at,
      sc.deleted_at
    FROM sandwich_collections sc
    WHERE sc.deleted_at IS NULL
    )`);
  }
  return `WITH ${relations.join(',')}`;
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(
      (row): row is Record<string, unknown> =>
        typeof row === 'object' && row !== null
    );
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { rows?: unknown }).rows)
  ) {
    return asRows((value as { rows: unknown }).rows);
  }
  throw new Error('The database returned an unexpected query result.');
}

function combineWithAnalystRelations(
  query: string,
  allowedRelations: ReadonlySet<AnalystRelation>
): string {
  const normalized = query.trim();
  const queryBody = /^with\b/i.test(normalized)
    ? `,${normalized.replace(/^with\b/i, '')}`
    : normalized;
  return `${buildAnalystRelations(allowedRelations)} ${queryBody}`;
}

export async function runAnalystQuery(
  rawSql: unknown,
  allowedRelations: ReadonlySet<AnalystRelation>
): Promise<AnalystQueryResult> {
  const guard = guardAnalystSql(rawSql);
  if (!guard.ok) return guard;
  const forbiddenRelation = guard.relations.find(
    (relation) => !allowedRelations.has(relation)
  );
  if (forbiddenRelation) {
    return {
      ok: false,
      error: `You do not have permission to query ${forbiddenRelation}.`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  const started = Date.now();

  try {
    const databaseUrl = getDatabaseUrl();
    if (!databaseUrl) {
      throw new Error('Database URL is not configured.');
    }
    const querySql = combineWithAnalystRelations(guard.sql, allowedRelations);
    let rows: Array<Record<string, unknown>>;
    if (isNeonDatabaseUrl(databaseUrl)) {
      const client = neon(databaseUrl, {
        fullResults: true,
        fetchOptions: { signal: controller.signal },
      });
      const results = await client.transaction([client(querySql, [])], {
        readOnly: true,
        fullResults: true,
      });
      rows = asRows(results[0]);
    } else {
      // Plain Postgres (e.g. Replit dev DB): same read-only guarantee via a
      // READ ONLY transaction, with a server-side timeout in place of abort.
      const pgClient = await getPgPool(databaseUrl).connect();
      try {
        await pgClient.query('BEGIN READ ONLY');
        await pgClient.query(
          `SET LOCAL statement_timeout = ${Number(QUERY_TIMEOUT_MS)}`
        );
        const result = await pgClient.query(querySql);
        rows = asRows(result.rows);
      } finally {
        await pgClient.query('ROLLBACK').catch(() => {});
        pgClient.release();
      }
    }

    return {
      ok: true,
      rows: rows.slice(0, MAX_ANALYST_QUERY_ROWS),
      relations: guard.relations,
      rowCount: rows.length,
      truncated: rows.length >= MAX_ANALYST_QUERY_ROWS,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      error: controller.signal.aborted
        ? `Query exceeded the ${QUERY_TIMEOUT_MS / 1_000}-second time limit.`
        : error instanceof Error
          ? `Database query failed: ${error.message}`
          : 'Database query failed.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function formatAnalystRowsForModel(
  rows: Array<Record<string, unknown>>
): string {
  if (rows.length === 0) return 'No rows returned.';

  const shownRows = rows.slice(0, MODEL_RESULT_ROW_LIMIT);
  const columns = Object.keys(shownRows[0]);
  const formatValue = (value: unknown) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.length > 500) {
      return `${value.slice(0, 500)}…`;
    }
    return value;
  };

  return JSON.stringify(
    {
      columns,
      rows: shownRows.map((row) =>
        Object.fromEntries(
          columns.map((column) => [column, formatValue(row[column])])
        )
      ),
      omittedRows: Math.max(0, rows.length - shownRows.length),
    },
    null,
    0
  );
}
