import type { PreviewResult } from '@/lib/ducklake';

export function PreviewPane({ result, snapshot }: { result: PreviewResult; snapshot?: number }) {
  const { columns, rows } = result;
  if (rows.length === 0) {
    return <div className="px-8 py-6 text-sm text-dim">Table is empty.</div>;
  }

  return (
    <div className="px-8 py-6 space-y-3">
      <div className="text-[12px] font-mono text-dim">
        <span className="text-brand tabular-nums">{rows.length}</span> row preview
        {snapshot != null && (
          <span className="ml-2 text-teal">@ v{snapshot}</span>
        )}
      </div>
      <div className="border border-line rounded-lg overflow-auto max-h-[70vh] bg-surface">
        <table className="text-[13px] w-full">
          <thead className="bg-raised text-dim text-[10px] uppercase tracking-[0.14em] sticky top-0">
            <tr>
              {columns.map(c => (
                <th key={c} className="text-left px-3 py-2 font-semibold whitespace-nowrap border-b border-line">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((r, ri) => (
              <tr key={ri} className="border-t border-line/60 hover:bg-raised/40">
                {r.map((v, ci) => (
                  <td key={ci} className="px-3 py-1.5 whitespace-nowrap text-ink/85">{render(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function render(v: unknown): React.ReactNode {
  if (v == null) return <span className="text-dim2">∅</span>;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
