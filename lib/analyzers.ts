import type { FileRow, SnapshotRow, PartitionCol, PartitionRowCount } from './ducklake';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0, low: 1, medium: 2, high: 3, critical: 4,
};

export interface Finding {
  analyzer: string;
  severity: Severity;
  title: string;
  detail: string;
  remediation_sql: string;
  evidence: Record<string, string | number>;
  estimated_monthly_savings_usd?: number;
  preview?: CompactionPreview;
}

export interface CompactionBucket {
  merged: number;
  total_bytes: number;
}
export interface CompactionPreview {
  kind: 'compaction';
  before: { files: number; total_bytes: number; avg_bytes: number };
  after:  { files: number; target_bytes: number; avg_bytes: number };
  buckets: CompactionBucket[];
}

// Bin-pack files greedily into target-size buckets, in file-id order (mirrors
// DuckLake's merge_adjacent_files heuristic). Purely predictive — we don't
// actually rewrite anything.
export function planCompaction(sizes: number[], target: number): CompactionPreview {
  const before_bytes = sizes.reduce((a, b) => a + b, 0);
  const buckets: CompactionBucket[] = [];
  let current: CompactionBucket = { merged: 0, total_bytes: 0 };
  for (const s of sizes) {
    if (current.total_bytes + s > target && current.merged > 0) {
      buckets.push(current);
      current = { merged: 0, total_bytes: 0 };
    }
    current.merged += 1;
    current.total_bytes += s;
  }
  if (current.merged > 0) buckets.push(current);

  return {
    kind: 'compaction',
    before: {
      files: sizes.length,
      total_bytes: before_bytes,
      avg_bytes: sizes.length ? Math.round(before_bytes / sizes.length) : 0,
    },
    after: {
      files: buckets.length,
      target_bytes: target,
      avg_bytes: buckets.length ? Math.round(before_bytes / buckets.length) : 0,
    },
    buckets,
  };
}

export interface AnalyzerInputs {
  schema: string;
  table: string;
  files: FileRow[];
  snapshots: SnapshotRow[];
  partitions?: PartitionCol[];
  partitionRowCounts?: PartitionRowCount[];
}

const MIB = 1024 * 1024;

interface SmallFilesOpts {
  target_file_bytes?: number;
  min_small_files?: number;
  min_small_ratio?: number;
  s3_get_cost_per_1k?: number;
  queries_per_month?: number;
}

export function smallFilesAnalyzer(inp: AnalyzerInputs, opts: SmallFilesOpts = {}): Finding[] {
  const target = opts.target_file_bytes ?? 128 * MIB;
  const minCount = opts.min_small_files ?? 10;
  const minRatio = opts.min_small_ratio ?? 0.25;
  const costPer1k = opts.s3_get_cost_per_1k ?? 0.0004;
  const qpm = opts.queries_per_month ?? 1000;

  const total = inp.files.length;
  if (total === 0) return [];
  const sizes = inp.files.map(f => Number(f.file_size_bytes));
  const totalBytes = sizes.reduce((a, b) => a + b, 0);
  const smallSizes = sizes.filter(s => s < target);
  const small = smallSizes.length;
  const ratio = small / total;
  if (small < minCount || ratio < minRatio) return [];

  const idealFiles = Math.max(1, Math.floor(totalBytes / target));
  const excess = Math.max(0, total - idealFiles);
  const savings = Math.round((excess * qpm * costPer1k / 1000) * 100) / 100;

  const severity: Severity =
    ratio >= 0.9 && small >= 100 ? 'critical' :
    ratio >= 0.75 || small >= 500 ? 'high' :
    ratio >= 0.5 ? 'medium' : 'low';

  const orderedSizes = [...inp.files]
    .sort((a, b) => Number(a.data_file_id) - Number(b.data_file_id))
    .map(f => Number(f.file_size_bytes));

  return [{
    analyzer: 'small-files',
    severity,
    title: `${small} of ${total} files under ${fmtBytes(target)}`,
    detail:
      `${Math.round(ratio * 100)}% of data files are smaller than the target size of ${fmtBytes(target)}. ` +
      `Small files inflate object-store GET costs and slow query planning. ` +
      `Compact via DuckLake's file-merging maintenance call.`,
    remediation_sql: `CALL merge_adjacent_files('lake', '${inp.schema}.${inp.table}');`,
    estimated_monthly_savings_usd: savings,
    evidence: {
      small_files: small,
      total_files: total,
      small_ratio: Math.round(ratio * 1000) / 1000,
      avg_file_bytes: Math.round(totalBytes / total),
      target_file_bytes: target,
    },
    preview: planCompaction(orderedSizes, target),
  }];
}

interface SnapshotBloatOpts {
  max_snapshots?: number;
  max_age_days?: number;
}

export function snapshotBloatAnalyzer(inp: AnalyzerInputs, opts: SnapshotBloatOpts = {}): Finding[] {
  const maxCount = opts.max_snapshots ?? 20;
  const maxAgeDays = opts.max_age_days ?? 30;
  const snaps = inp.snapshots;
  if (snaps.length === 0) return [];

  const times = snaps
    .map(s => Date.parse(s.snapshot_time))
    .filter(n => Number.isFinite(n));
  if (times.length === 0) return [];

  const now = Date.now();
  const oldestMs = Math.min(...times);
  const oldestDays = Math.round((now - oldestMs) / (1000 * 60 * 60 * 24));
  const count = snaps.length;

  const overCount = count > maxCount;
  const overAge = oldestDays > maxAgeDays;
  if (!overCount && !overAge) return [];

  const severity: Severity =
    count > 100 || oldestDays > 180 ? 'critical' :
    count > 50 || oldestDays > 90 ? 'high' :
    count > maxCount || oldestDays > maxAgeDays ? 'medium' : 'low';

  const parts: string[] = [];
  if (overCount) parts.push(`${count} snapshots retained (>${maxCount})`);
  if (overAge) parts.push(`oldest is ${oldestDays}d old (>${maxAgeDays}d)`);

  return [{
    analyzer: 'snapshot-bloat',
    severity,
    title: parts.join(', '),
    detail:
      `Every retained snapshot pins its data + delete files, blocking cleanup. ` +
      `Expire snapshots that are past your recovery window to shrink metadata and free space.`,
    remediation_sql:
      `CALL ducklake_expire_snapshots('lake', older_than => NOW() - INTERVAL 7 DAY);\n` +
      `CALL ducklake_cleanup_old_files('lake', cleanup_all => true);`,
    evidence: {
      total_snapshots: count,
      oldest_days: oldestDays,
      max_snapshots: maxCount,
      max_age_days: maxAgeDays,
    },
  }];
}

interface PartitionSkewOpts {
  min_partitions?: number;
  hot_share_threshold?: number;
  cold_share_threshold?: number;
}

export function partitionSkewAnalyzer(inp: AnalyzerInputs, opts: PartitionSkewOpts = {}): Finding[] {
  const parts = inp.partitions ?? [];
  const rc = inp.partitionRowCounts ?? [];
  if (parts.length === 0 || rc.length === 0) return [];

  const minParts = opts.min_partitions ?? 3;
  const hotShare = opts.hot_share_threshold ?? 0.5;
  const coldShare = opts.cold_share_threshold ?? 0.001;
  if (rc.length < minParts) return [];

  const counts = rc.map(r => Number(r.record_count));
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return [];

  const hotIdx = counts.reduce((best, v, i) => v > counts[best] ? i : best, 0);
  const hotCount = counts[hotIdx];
  const hotFrac = hotCount / total;
  const cold = counts.filter(c => c / total < coldShare).length;

  const overHot = hotFrac >= hotShare;
  const overCold = cold >= Math.max(3, Math.floor(rc.length * 0.5));
  if (!overHot && !overCold) return [];

  const severity: Severity =
    hotFrac >= 0.9 ? 'critical' :
    hotFrac >= 0.75 ? 'high' :
    hotFrac >= 0.5 || overCold ? 'medium' : 'low';

  const specStr = parts.map(p => p.transform === 'identity' ? p.column_name : `${p.transform}(${p.column_name})`).join(', ');
  const parts_bits: string[] = [];
  if (overHot) parts_bits.push(`hottest partition holds ${Math.round(hotFrac * 100)}% of rows`);
  if (overCold) parts_bits.push(`${cold} partitions below ${(coldShare * 100).toFixed(1)}% share`);

  return [{
    analyzer: 'partition-skew',
    severity,
    title: parts_bits.join(', '),
    detail:
      `Partition spec: ${specStr}. Skewed partitions defeat pruning — one partition ` +
      `dominates scans while cold partitions add planning overhead. Consider re-partitioning ` +
      `on a higher-cardinality column or a coarser time bucket.`,
    remediation_sql:
      `-- Rewrite with a different partition spec (needs a fresh CTAS or ALTER TABLE ... SET PARTITIONED BY).\n` +
      `-- Example: coarser time bucket\n` +
      `-- ALTER TABLE ${inp.schema}.${inp.table} SET PARTITIONED BY (month(<ts_column>));`,
    evidence: {
      partitions: rc.length,
      hot_partition_share: Math.round(hotFrac * 1000) / 1000,
      hot_partition_rows: hotCount,
      cold_partitions: cold,
      total_rows: total,
    },
  }];
}

interface OrphanFilesOpts {
  min_orphans?: number;
}

export function orphanFilesAnalyzer(inp: {
  dataPath: string;
  filesystemFilenames: string[];
  referencedFilenames: Set<string>;
}, opts: OrphanFilesOpts = {}): Finding[] {
  const minOrphans = opts.min_orphans ?? 1;
  const orphans = inp.filesystemFilenames.filter(n => !inp.referencedFilenames.has(n));
  if (orphans.length < minOrphans) return [];

  const severity: Severity =
    orphans.length >= 1000 ? 'critical' :
    orphans.length >= 100 ? 'high' :
    orphans.length >= 10 ? 'medium' : 'low';

  const preview = orphans.slice(0, 3).join(', ');

  return [{
    analyzer: 'orphan-files',
    severity,
    title: `${orphans.length} data files present but not referenced by any snapshot`,
    detail:
      `Orphan files sit on disk but no live or historical snapshot references them. ` +
      `They're typically left behind by failed writes, aborted compactions, or expired snapshots ` +
      `whose files weren't cleaned up. First few: ${preview}.`,
    remediation_sql: `CALL ducklake_cleanup_old_files('lake', cleanup_all => true, dry_run => false);`,
    evidence: {
      orphan_count: orphans.length,
      data_path: inp.dataPath,
      filesystem_files: inp.filesystemFilenames.length,
      referenced_files: inp.referencedFilenames.size,
    },
  }];
}

const TABLE_ANALYZERS: Array<(i: AnalyzerInputs) => Finding[]> = [
  smallFilesAnalyzer,
  snapshotBloatAnalyzer,
  partitionSkewAnalyzer,
];

export function runAnalyzers(inp: AnalyzerInputs): Finding[] {
  const all: Finding[] = [];
  for (const a of TABLE_ANALYZERS) all.push(...a(inp));
  all.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return all;
}

export function fmtBytes(v: number): string {
  if (!v) return '0 B';
  const k = 1024;
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(v) / Math.log(k));
  return `${(v / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}
