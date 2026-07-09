import { metaQuery, lakeQuery } from './connection';

// BIGINT round-trips through JSON as a string. Treat numeric IDs as strings end-to-end.
type Int = string;

export interface SchemaRow { schema_id: Int; schema_name: string; }
export interface TableRow { table_id: Int; table_name: string; schema_name: string; record_count: Int | null; file_size_bytes: Int | null; }
export interface ViewRow { view_id: Int; view_name: string; schema_name: string; sql: string; }
export interface ColumnRow { column_order: Int; column_name: string; column_type: string; nulls_allowed: boolean; default_value: string | null; }
export interface SnapshotRow { snapshot_id: Int; snapshot_time: string; changes_made: string | null; commit_message: string | null; author: string | null; }
export interface FileRow { data_file_id: Int; path: string; file_format: string; record_count: Int; file_size_bytes: Int; begin_snapshot: Int; end_snapshot: Int | null; }
export interface PartitionCol { column_name: string; transform: string; }
export interface SortKey { expression: string; sort_direction: string; null_order: string; }
export interface PreviewResult { columns: string[]; rows: unknown[][]; }
export interface PartitionRowCount { partition_key: string; record_count: Int; file_count: Int; }
export interface ColumnStats {
  column_id: Int;
  column_name: string;
  column_type: string;
  value_count: number;
  null_count: number;
  column_size_bytes: number;
  min_value: string | null;
  max_value: string | null;
  file_count: number;
}
export interface SchemaEventRow {
  snapshot_id: Int;
  event: 'added' | 'dropped';
  column_name: string;
  column_type: string;
}

export async function listSchemas(): Promise<SchemaRow[]> {
  return metaQuery(`
    SELECT schema_id, schema_name
    FROM ducklake_schema
    WHERE end_snapshot IS NULL
    ORDER BY schema_name
  `);
}

export async function listTables(): Promise<TableRow[]> {
  // ducklake_table_stats.record_count counts insert events without reflecting
  // subsequent overwrites, so it over-counts. Live rows come from summing
  // record_count across live data files — deletes are already applied to those
  // per-file counts as DuckLake rewrites data files.
  return metaQuery(`
    SELECT t.table_id, t.table_name, s.schema_name,
           COALESCE(d.rows, 0)::BIGINT  AS record_count,
           COALESCE(d.bytes, 0)::BIGINT AS file_size_bytes
    FROM ducklake_table t
    JOIN ducklake_schema s ON s.schema_id = t.schema_id AND s.end_snapshot IS NULL
    LEFT JOIN (
      SELECT table_id,
             SUM(record_count)    AS rows,
             SUM(file_size_bytes) AS bytes
      FROM ducklake_data_file WHERE end_snapshot IS NULL GROUP BY table_id
    ) d ON d.table_id = t.table_id
    WHERE t.end_snapshot IS NULL
    ORDER BY s.schema_name, t.table_name
  `);
}

export async function listViews(): Promise<ViewRow[]> {
  return metaQuery(`
    SELECT v.view_id, v.view_name, s.schema_name, v.sql
    FROM ducklake_view v
    JOIN ducklake_schema s ON s.schema_id = v.schema_id AND s.end_snapshot IS NULL
    WHERE v.end_snapshot IS NULL
    ORDER BY s.schema_name, v.view_name
  `);
}

export async function getPartitions(tableId: Int): Promise<PartitionCol[]> {
  const id = intLit(tableId);
  // column_id is per-table, not global — join on both ids.
  return metaQuery(`
    SELECT c.column_name, pc.transform
    FROM ducklake_partition_info pi
    JOIN ducklake_partition_column pc ON pc.partition_id = pi.partition_id
    JOIN ducklake_column c ON c.column_id = pc.column_id AND c.table_id = pi.table_id
    WHERE pi.table_id = ${id} AND pi.end_snapshot IS NULL AND c.end_snapshot IS NULL
    ORDER BY pc.partition_key_index
  `);
}

export async function getSortKeys(tableId: Int): Promise<SortKey[]> {
  const id = intLit(tableId);
  return metaQuery(`
    SELECT se.expression, se.sort_direction, se.null_order
    FROM ducklake_sort_info si
    JOIN ducklake_sort_expression se ON se.sort_id = si.sort_id
    WHERE si.table_id = ${id} AND si.end_snapshot IS NULL
    ORDER BY se.sort_key_index
  `);
}

export async function getColumns(tableId: Int): Promise<ColumnRow[]> {
  const id = intLit(tableId);
  return metaQuery(`
    SELECT column_order, column_name, column_type, nulls_allowed, default_value
    FROM ducklake_column
    WHERE table_id = ${id} AND end_snapshot IS NULL
    ORDER BY column_order
  `);
}

export async function getSnapshots(tableId: Int): Promise<SnapshotRow[]> {
  const id = intLit(tableId);
  return metaQuery(`
    WITH touched AS (
      SELECT begin_snapshot AS s FROM ducklake_data_file WHERE table_id = ${id}
      UNION SELECT end_snapshot FROM ducklake_data_file WHERE table_id = ${id} AND end_snapshot IS NOT NULL
      UNION SELECT begin_snapshot FROM ducklake_delete_file WHERE table_id = ${id}
      UNION SELECT begin_snapshot FROM ducklake_table WHERE table_id = ${id}
      UNION SELECT end_snapshot FROM ducklake_table WHERE table_id = ${id} AND end_snapshot IS NOT NULL
      UNION SELECT begin_snapshot FROM ducklake_column WHERE table_id = ${id}
      UNION SELECT end_snapshot FROM ducklake_column WHERE table_id = ${id} AND end_snapshot IS NOT NULL
    )
    SELECT s.snapshot_id, s.snapshot_time::VARCHAR AS snapshot_time,
           c.changes_made, c.commit_message, c.author
    FROM ducklake_snapshot s
    LEFT JOIN ducklake_snapshot_changes c ON c.snapshot_id = s.snapshot_id
    WHERE s.snapshot_id IN (SELECT s FROM touched WHERE s IS NOT NULL)
    ORDER BY s.snapshot_id DESC
  `);
}

export async function getSchemaEvents(tableId: Int): Promise<SchemaEventRow[]> {
  const id = intLit(tableId);
  return metaQuery(`
    WITH tbl AS (
      SELECT begin_snapshot FROM ducklake_table WHERE table_id = ${id} AND end_snapshot IS NULL
    )
    SELECT c.begin_snapshot::VARCHAR AS snapshot_id,
           'added'::VARCHAR           AS event,
           c.column_name, c.column_type
    FROM ducklake_column c
    WHERE c.table_id = ${id}
      AND c.begin_snapshot > (SELECT begin_snapshot FROM tbl)
    UNION ALL
    SELECT c.end_snapshot::VARCHAR AS snapshot_id,
           'dropped'::VARCHAR       AS event,
           c.column_name, c.column_type
    FROM ducklake_column c
    WHERE c.table_id = ${id} AND c.end_snapshot IS NOT NULL
    ORDER BY 1 DESC
  `);
}

export async function getColumnStats(tableId: Int): Promise<ColumnStats[]> {
  const id = intLit(tableId);
  // Per-file stats. Aggregate in JS so we can do type-aware min/max for numeric
  // columns (DuckLake stores min/max as varchar, and lex-compare is wrong for
  // negative/float/long-int columns).
  const rows = await metaQuery<{
    column_id: string; column_name: string; column_type: string; column_order: string;
    value_count: string | null; null_count: string | null; column_size_bytes: string | null;
    min_value: string | null; max_value: string | null;
  }>(`
    SELECT c.column_id, c.column_name, c.column_type, c.column_order,
           fcs.value_count, fcs.null_count, fcs.column_size_bytes,
           fcs.min_value, fcs.max_value
    FROM ducklake_column c
    LEFT JOIN ducklake_data_file df
      ON df.table_id = c.table_id AND df.end_snapshot IS NULL
    LEFT JOIN ducklake_file_column_stats fcs
      ON fcs.data_file_id = df.data_file_id
     AND fcs.table_id    = c.table_id
     AND fcs.column_id   = c.column_id
    WHERE c.table_id = ${id} AND c.end_snapshot IS NULL
    ORDER BY c.column_order
  `);

  const isNumeric = (t: string) => /^(TINY|SMALL|BIG|HUGE)?INT|DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC/i.test(t);
  const cmp = (a: string, b: string, t: string): number => {
    if (isNumeric(t)) {
      const na = Number(a), nb = Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  };

  const byCol = new Map<string, ColumnStats & { column_order: string }>();
  for (const r of rows) {
    let acc = byCol.get(r.column_id);
    if (!acc) {
      acc = {
        column_id: r.column_id,
        column_name: r.column_name,
        column_type: r.column_type,
        column_order: r.column_order,
        value_count: 0, null_count: 0, column_size_bytes: 0,
        min_value: null, max_value: null,
        file_count: 0,
      };
      byCol.set(r.column_id, acc);
    }
    if (r.value_count == null) continue;
    acc.file_count += 1;
    acc.value_count += Number(r.value_count);
    acc.null_count += Number(r.null_count);
    acc.column_size_bytes += Number(r.column_size_bytes);
    if (r.min_value != null) {
      acc.min_value = acc.min_value == null || cmp(r.min_value, acc.min_value, r.column_type) < 0
        ? r.min_value : acc.min_value;
    }
    if (r.max_value != null) {
      acc.max_value = acc.max_value == null || cmp(r.max_value, acc.max_value, r.column_type) > 0
        ? r.max_value : acc.max_value;
    }
  }

  return [...byCol.values()]
    .sort((a, b) => Number(a.column_order) - Number(b.column_order))
    .map(({ column_order: _co, ...rest }) => rest);
}

export async function getDataPath(): Promise<string | null> {
  const rows = await metaQuery<{ value: string }>(`
    SELECT value FROM ducklake_metadata WHERE key = 'data_path' LIMIT 1
  `);
  return rows[0]?.value ?? null;
}

export async function getAllReferencedFilenames(): Promise<Set<string>> {
  const rows = await metaQuery<{ path: string }>(`
    SELECT path FROM ducklake_data_file
    UNION
    SELECT path FROM ducklake_delete_file
  `);
  const out = new Set<string>();
  for (const r of rows) {
    const p = r.path;
    const base = p.slice(p.lastIndexOf('/') + 1);
    out.add(base);
  }
  return out;
}

export async function getPartitionRowCounts(tableId: Int): Promise<PartitionRowCount[]> {
  const id = intLit(tableId);
  return metaQuery(`
    WITH file_keys AS (
      SELECT df.data_file_id, df.record_count,
             list_aggregate(
               list(fpv.partition_value ORDER BY fpv.partition_key_index),
               'string_agg', '/'
             ) AS partition_key
      FROM ducklake_data_file df
      JOIN ducklake_file_partition_value fpv
        ON fpv.data_file_id = df.data_file_id AND fpv.table_id = df.table_id
      WHERE df.table_id = ${id} AND df.end_snapshot IS NULL
      GROUP BY df.data_file_id, df.record_count
    )
    SELECT partition_key,
           SUM(record_count)::BIGINT AS record_count,
           COUNT(*)::BIGINT          AS file_count
    FROM file_keys
    GROUP BY partition_key
    ORDER BY record_count DESC
  `);
}

export async function getFiles(tableId: Int, includeHistorical = false): Promise<FileRow[]> {
  const id = intLit(tableId);
  return metaQuery(`
    SELECT data_file_id, path, file_format, record_count, file_size_bytes,
           begin_snapshot, end_snapshot
    FROM ducklake_data_file
    WHERE table_id = ${id}
      ${includeHistorical ? '' : 'AND end_snapshot IS NULL'}
    ORDER BY data_file_id
  `);
}

function intLit(n: Int): string {
  if (!/^-?\d+$/.test(n)) throw new Error(`expected integer, got ${n}`);
  return n;
}

export async function previewRows(schema: string, table: string, snapshot?: number, limit = 100): Promise<PreviewResult> {
  const qSchema = sqlIdent(schema);
  const qTable = sqlIdent(table);
  const at = snapshot != null ? `AT (VERSION => ${Number(snapshot)})` : '';
  const sql = `SELECT * FROM lake.${qSchema}.${qTable} ${at} LIMIT ${Number(limit)}`;
  const rows = await lakeQuery(sql);
  const columns = rows.length ? Object.keys(rows[0] as object) : [];
  return { columns, rows: rows.map(r => columns.map(c => (r as Record<string, unknown>)[c])) };
}

// Now consumed by getColumns/getSnapshots/getFiles above

function sqlIdent(s: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`invalid identifier: ${s}`);
  return `"${s}"`;
}
