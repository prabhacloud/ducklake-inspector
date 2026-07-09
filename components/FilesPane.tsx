import type { FileRow } from '@/lib/ducklake';

export function FilesPane({ files }: { files: FileRow[] }) {
  if (files.length === 0) {
    return (
      <div className="px-8 py-6 text-[13px] text-dim leading-relaxed max-w-2xl">
        No live data files. Small writes may still be inlined — flush with
        <code className="mx-1 px-1.5 py-0.5 bg-raised border border-line rounded font-mono text-[12px] text-teal">
          ducklake_flush_inlined_data(&apos;lake&apos;)
        </code>
        to materialize Parquet.
      </div>
    );
  }

  const totalRows = files.reduce((a, f) => a + Number(f.record_count ?? 0), 0);
  const totalBytes = files.reduce((a, f) => a + Number(f.file_size_bytes ?? 0), 0);

  return (
    <div className="px-8 py-6 space-y-4">
      <div className="flex flex-wrap gap-4 text-[12px] font-mono text-dim">
        <span><span className="text-brand tabular-nums">{files.length}</span> {files.length === 1 ? 'file' : 'files'}</span>
        <span className="text-line2">·</span>
        <span><span className="text-teal tabular-nums">{totalRows.toLocaleString()}</span> rows</span>
        <span className="text-line2">·</span>
        <span><span className="text-violet">{fmtBytes(totalBytes)}</span></span>
      </div>
      <div className="border border-line rounded-lg overflow-hidden bg-surface">
        <table className="w-full text-[13px]">
          <thead className="bg-raised text-dim text-[10px] uppercase tracking-[0.14em]">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Path</th>
              <th className="text-left px-3 py-2 font-semibold w-20">Format</th>
              <th className="text-right px-3 py-2 font-semibold w-28">Rows</th>
              <th className="text-right px-3 py-2 font-semibold w-28">Size</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Added</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {files.map(f => (
              <tr key={f.data_file_id} className="border-t border-line/60 hover:bg-raised/40">
                <td className="px-3 py-1.5 truncate max-w-md text-ink/85" title={f.path}>{f.path}</td>
                <td className="px-3 py-1.5 text-teal">{f.file_format}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink">
                  {Number(f.record_count).toLocaleString()}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-violet">{fmtBytes(Number(f.file_size_bytes))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-brand">v{f.begin_snapshot}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
