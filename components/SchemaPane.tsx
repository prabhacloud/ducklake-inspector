import type { ColumnRow, TableRow, PartitionCol, SortKey } from '@/lib/ducklake';

interface Props {
  table: TableRow;
  columns: ColumnRow[];
  partitions: PartitionCol[];
  sortKeys: SortKey[];
}

export function SchemaPane({ table, columns, partitions, sortKeys }: Props) {
  const propLine = buildPropLine(partitions, sortKeys);
  return (
    <div className="px-8 py-6 space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Rows" value={fmtNum(table.record_count)} accent="brand" />
        <Stat label="Size" value={fmtBytes(table.file_size_bytes)} accent="teal" />
        <Stat label="Columns" value={String(columns.length)} accent="violet" />
      </div>

      {propLine.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {propLine.map((p, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-2 rounded-full bg-raised border border-line pl-2.5 pr-3 py-1 text-[11.5px]"
            >
              <span className="text-dim uppercase tracking-[0.14em] text-[9.5px] font-semibold">
                {p.label}
              </span>
              <span className="font-mono text-ink">{p.value}</span>
            </span>
          ))}
        </div>
      )}

      <div>
        <h3 className="text-[10.5px] uppercase tracking-[0.14em] text-dim mb-2 font-semibold">Columns</h3>
        <div className="border border-line rounded-lg overflow-hidden bg-surface">
          <table className="w-full text-[13px]">
            <thead className="bg-raised text-dim text-[10px] uppercase tracking-[0.14em]">
              <tr>
                <th className="text-left px-3 py-2 font-semibold w-10">#</th>
                <th className="text-left px-3 py-2 font-semibold">Name</th>
                <th className="text-left px-3 py-2 font-semibold">Type</th>
                <th className="text-left px-3 py-2 font-semibold w-20">Nullable</th>
                <th className="text-left px-3 py-2 font-semibold">Default</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {columns.map(c => (
                <tr key={c.column_order} className="border-t border-line/60 hover:bg-raised/40">
                  <td className="px-3 py-1.5 text-dim2 tabular-nums">{c.column_order}</td>
                  <td className="px-3 py-1.5 text-ink">{c.column_name}</td>
                  <td className="px-3 py-1.5 text-teal">{c.column_type}</td>
                  <td className="px-3 py-1.5">
                    {c.nulls_allowed
                      ? <span className="text-dim">yes</span>
                      : <span className="text-coral">no</span>}
                  </td>
                  <td className="px-3 py-1.5 text-dim">
                    {c.default_value ?? <span className="text-dim2">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: 'brand' | 'teal' | 'violet' }) {
  const accentCls =
    accent === 'brand' ? 'text-brand' : accent === 'teal' ? 'text-teal' : 'text-violet';
  return (
    <div className="border border-line rounded-lg px-4 py-3 bg-surface">
      <div className="text-[10px] uppercase tracking-[0.14em] text-dim font-semibold">{label}</div>
      <div className={`text-[20px] font-mono mt-1 tabular-nums ${accentCls}`}>{value}</div>
    </div>
  );
}

function buildPropLine(partitions: PartitionCol[], sortKeys: SortKey[]): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (partitions.length) {
    out.push({
      label: 'Partition',
      value: partitions
        .map(p => (p.transform === 'identity' ? p.column_name : `${p.transform}(${p.column_name})`))
        .join(', '),
    });
  }
  if (sortKeys.length) {
    out.push({
      label: 'Sort',
      value: sortKeys
        .map(k => `${k.expression} ${k.sort_direction}${k.null_order === 'NULLS_LAST' ? '' : ' ' + k.null_order}`)
        .join(', '),
    });
  }
  return out;
}

function fmtNum(n: string | number | null): string {
  if (n == null) return '—';
  return Number(n).toLocaleString();
}

function fmtBytes(n: string | number | null): string {
  if (n == null) return '—';
  const v = Number(n);
  if (v === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(v) / Math.log(k));
  return `${(v / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}
