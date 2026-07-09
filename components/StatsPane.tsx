import type { ColumnStats } from '@/lib/ducklake';

export function StatsPane({ stats }: { stats: ColumnStats[] }) {
  if (stats.length === 0) {
    return (
      <div className="px-8 py-6 text-[13px] text-dim leading-relaxed max-w-2xl">
        No columns to summarize.
      </div>
    );
  }

  const hasAnyStats = stats.some(s => s.file_count > 0);
  const totalRows = stats.reduce((a, c) => Math.max(a, c.value_count + c.null_count), 0);

  if (!hasAnyStats) {
    return (
      <div className="px-8 py-6 text-[13px] text-dim leading-relaxed max-w-2xl">
        No file-level stats yet. Small tables may still be inlined —{' '}
        <code className="mx-1 px-1.5 py-0.5 bg-raised border border-line rounded font-mono text-[12px] text-teal">
          CALL ducklake_flush_inlined_data(&apos;lake&apos;)
        </code>
        to materialize Parquet files and compute per-column stats.
      </div>
    );
  }

  return (
    <div className="px-8 py-6 space-y-4">
      <div className="flex flex-wrap gap-4 text-[12px] font-mono text-dim">
        <span><span className="text-brand tabular-nums">{stats.length}</span> columns</span>
        <span className="text-line2">·</span>
        <span><span className="text-teal tabular-nums">{totalRows.toLocaleString()}</span> rows</span>
      </div>
      <div className="border border-line rounded-lg overflow-hidden bg-surface">
        <table className="w-full text-[13px]">
          <thead className="bg-raised text-dim text-[10px] uppercase tracking-[0.14em]">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Column</th>
              <th className="text-left px-3 py-2 font-semibold w-32">Type</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Values</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Nulls</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Null %</th>
              <th className="text-left px-3 py-2 font-semibold">Min</th>
              <th className="text-left px-3 py-2 font-semibold">Max</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Size</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {stats.map(c => {
              const total = c.value_count + c.null_count;
              const nullPct = total > 0 ? (c.null_count / total) * 100 : 0;
              return (
                <tr key={c.column_id} className="border-t border-line/60 hover:bg-raised/40">
                  <td className="px-3 py-1.5 text-ink font-medium">{c.column_name}</td>
                  <td className="px-3 py-1.5 text-teal">{c.column_type}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink">{c.value_count.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-dim">{c.null_count.toLocaleString()}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${nullPct > 25 ? 'text-coral' : nullPct > 0 ? 'text-brand' : 'text-dim2'}`}>
                    {nullPct === 0 ? '—' : nullPct < 0.1 ? '<0.1%' : `${nullPct.toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-1.5 text-ink/85 truncate max-w-[16ch]" title={c.min_value ?? ''}>
                    {c.min_value ?? <span className="text-dim2">∅</span>}
                  </td>
                  <td className="px-3 py-1.5 text-ink/85 truncate max-w-[16ch]" title={c.max_value ?? ''}>
                    {c.max_value ?? <span className="text-dim2">∅</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-violet">{fmtBytes(c.column_size_bytes)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-dim2 font-mono max-w-3xl leading-relaxed">
        Stats aggregated across all live data files. Min/max compared as numbers
        for numeric columns, lexicographically otherwise.
      </div>
    </div>
  );
}

function fmtBytes(v: number): string {
  if (!v) return '0 B';
  const k = 1024;
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(v) / Math.log(k));
  return `${(v / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}
