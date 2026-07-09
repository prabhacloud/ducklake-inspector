import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { dirname, resolve } from 'node:path';

const META_PATH = process.env.DUCKLAKE_METADATA_PATH;
if (!META_PATH) throw new Error('DUCKLAKE_METADATA_PATH not set');
const META_ABS = resolve(META_PATH);
const META_DIR = dirname(META_ABS);

declare global {
  // eslint-disable-next-line no-var
  var __dlInstance: DuckDBInstance | undefined;
  // eslint-disable-next-line no-var
  var __dlConn: DuckDBConnection | undefined;
}

const ATTACH_SQL = `ATTACH 'ducklake:${META_ABS.replace(/'/g, "''")}' AS lake`;

async function bootstrap(): Promise<DuckDBConnection> {
  // The catalog may store data_path as relative — DuckLake resolves it against
  // the process CWD, so we briefly chdir to the metadata dir, then restore.
  // Restoring is critical: Tailwind's postcss plugin resolves the `content`
  // globs against CWD lazily on each request; leaving CWD at /tmp yields zero
  // matched files and blank utility CSS.
  const originalCwd = process.cwd();
  try { process.chdir(META_DIR); } catch { /* already in correct dir */ }
  try {
    const inst = await DuckDBInstance.create(':memory:');
    const conn = await inst.connect();
    await conn.run(`INSTALL ducklake`);
    await conn.run(`LOAD ducklake`);
    await conn.run(ATTACH_SQL);
    globalThis.__dlInstance = inst;
    globalThis.__dlConn = conn;
    return conn;
  } finally {
    try { process.chdir(originalCwd); } catch { /* best-effort */ }
  }
}

// Re-attach drops the catalog cache so new tables/snapshots written by other
// processes become visible. Cheap for local catalogs (low double-digit ms).
export async function refreshCatalog(): Promise<void> {
  const conn = await getConn();
  const originalCwd = process.cwd();
  try { process.chdir(META_DIR); } catch { /* already in correct dir */ }
  try {
    await conn.run(`DETACH lake`);
    await conn.run(ATTACH_SQL);
  } finally {
    try { process.chdir(originalCwd); } catch { /* best-effort */ }
  }
}

export async function getConn(): Promise<DuckDBConnection> {
  if (globalThis.__dlConn) return globalThis.__dlConn;
  return bootstrap();
}

export async function metaQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const conn = await getConn();
  const reader = await conn.runAndReadAll(meta(sql));
  return reader.getRowObjectsJson() as T[];
}

export async function lakeQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const conn = await getConn();
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJson() as T[];
}

// Rewrites bare references to ducklake_* tables to qualify them with the metadata
// catalog. The metadata catalog name is __ducklake_metadata_lake (DuckDB attaches it
// alongside the user-visible `lake` catalog).
function meta(sql: string): string {
  return sql.replace(
    /\b(ducklake_[a-z_0-9]+)\b/g,
    '__ducklake_metadata_lake.main.$1'
  );
}
