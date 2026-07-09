import type { Finding, Severity, CompactionPreview } from '@/lib/analyzers';

const SEV_STYLE: Record<Severity, { chip: string; bar: string; label: string }> = {
  critical: { chip: 'bg-coral/15 text-coral border-coral/40', bar: 'bg-coral',  label: 'CRIT' },
  high:     { chip: 'bg-brand/15 text-brand border-brand/40', bar: 'bg-brand',  label: 'HIGH' },
  medium:   { chip: 'bg-violet/15 text-violet border-violet/40', bar: 'bg-violet', label: 'MED'  },
  low:      { chip: 'bg-teal/15 text-teal border-teal/40', bar: 'bg-teal',   label: 'LOW'  },
  info:     { chip: 'bg-raised text-dim border-line', bar: 'bg-dim2', label: 'INFO' },
};

export function HealthPane({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <div className="px-8 py-6 max-w-2xl">
        <div className="border border-green/40 bg-green/10 rounded-lg px-4 py-3 flex items-start gap-3">
          <span className="mt-1 w-1.5 h-1.5 rounded-full bg-green shrink-0" />
          <div>
            <div className="text-[13px] text-ink font-medium">No findings.</div>
            <div className="text-[12px] text-dim mt-0.5 leading-relaxed">
              This table passes every analyzer at their default thresholds
              (small-files, snapshot-bloat). Ship it.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const counts = findings.reduce<Record<Severity, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {} as Record<Severity, number>);
  const order: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
  const totalSavings = findings.reduce((a, f) => a + (f.estimated_monthly_savings_usd ?? 0), 0);

  return (
    <div className="px-8 py-6 space-y-5">
      <div className="flex flex-wrap items-center gap-4 text-[12px] font-mono text-dim">
        <span><span className="text-brand tabular-nums">{findings.length}</span> {findings.length === 1 ? 'finding' : 'findings'}</span>
        {order.filter(s => counts[s]).map(s => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${SEV_STYLE[s].bar}`} />
            <span className="tabular-nums">{counts[s]}</span>
            <span className="text-dim2 uppercase text-[10px] tracking-[0.14em]">{s}</span>
          </span>
        ))}
        {totalSavings > 0 && (
          <>
            <span className="text-line2">·</span>
            <span>est. <span className="text-teal tabular-nums">${totalSavings.toFixed(2)}</span>/mo recoverable</span>
          </>
        )}
      </div>

      <div className="space-y-3">
        {findings.map((f, i) => <FindingCard key={i} f={f} />)}
      </div>
    </div>
  );
}

function FindingCard({ f }: { f: Finding }) {
  const s = SEV_STYLE[f.severity];
  return (
    <div className="border border-line rounded-lg bg-surface overflow-hidden">
      <div className="flex items-stretch">
        <div className={`w-1 ${s.bar}`} />
        <div className="flex-1 p-4 space-y-3">
          <div className="flex items-start gap-3 flex-wrap">
            <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${s.chip} tracking-wider`}>
              {s.label}
            </span>
            <span className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-dim mt-0.5">
              {f.analyzer}
            </span>
            {f.estimated_monthly_savings_usd != null && f.estimated_monthly_savings_usd > 0 && (
              <span className="ml-auto text-[11px] font-mono text-teal">
                ≈ ${f.estimated_monthly_savings_usd.toFixed(2)}/mo
              </span>
            )}
          </div>

          <div className="text-[13.5px] font-medium text-ink">{f.title}</div>
          <div className="text-[12.5px] text-dim leading-relaxed">{f.detail}</div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-dim mb-1.5 font-semibold">Remediation</div>
            <pre className="text-[12px] font-mono bg-raised border border-line rounded-md p-3 whitespace-pre-wrap text-ink/90 overflow-x-auto">
{f.remediation_sql}
            </pre>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-dim mb-1.5 font-semibold">Evidence</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] font-mono">
              {Object.entries(f.evidence).map(([k, v]) => (
                <span key={k} className="text-dim">
                  {k}=<span className="text-ink/85 tabular-nums">{String(v)}</span>
                </span>
              ))}
            </div>
          </div>

          {f.preview?.kind === 'compaction' && <CompactionPreviewBlock plan={f.preview} />}
        </div>
      </div>
    </div>
  );
}

function CompactionPreviewBlock({ plan }: { plan: CompactionPreview }) {
  const savedFiles = plan.before.files - plan.after.files;
  const beforeAvg = fmtBytes(plan.before.avg_bytes);
  const afterAvg = fmtBytes(plan.after.avg_bytes);
  const targetAvg = fmtBytes(plan.after.target_bytes);
  const preview = plan.buckets.slice(0, 8);
  const remaining = plan.buckets.length - preview.length;

  return (
    <details className="border border-line rounded-md bg-raised/40 open:bg-raised/60 group">
      <summary className="cursor-pointer list-none px-3 py-2 flex items-center gap-2 text-[11.5px] font-mono">
        <span className="text-dim2 group-open:rotate-90 transition-transform inline-block">▸</span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-dim font-semibold">Compaction preview</span>
        <span className="text-ink/85">
          <span className="text-brand tabular-nums">{plan.before.files}</span>
          <span className="text-dim2 mx-1">→</span>
          <span className="text-teal tabular-nums">{plan.after.files}</span>{' '}
          files
        </span>
        <span className="text-dim">
          (avg <span className="text-ink/70">{beforeAvg}</span>
          <span className="text-dim2 mx-1">→</span>
          <span className="text-teal">{afterAvg}</span>, target {targetAvg})
        </span>
        {savedFiles > 0 && (
          <span className="ml-auto text-green tabular-nums text-[11px]">−{savedFiles} files</span>
        )}
      </summary>
      <div className="px-3 pb-3 pt-1">
        <div className="text-[10.5px] font-mono text-dim mb-1.5">Resulting buckets (first {preview.length}):</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11.5px] font-mono">
          {preview.map((b, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <span className="text-dim2 tabular-nums w-6 text-right">#{i + 1}</span>
              <span className="text-ink/85">merge <span className="text-brand tabular-nums">{b.merged}</span> →</span>
              <span className="text-violet tabular-nums">{fmtBytes(b.total_bytes)}</span>
            </div>
          ))}
        </div>
        {remaining > 0 && (
          <div className="text-[11px] text-dim2 font-mono mt-1.5">…and {remaining} more bucket{remaining === 1 ? '' : 's'}.</div>
        )}
      </div>
    </details>
  );
}

function fmtBytes(v: number): string {
  if (!v) return '0 B';
  const k = 1024;
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(v) / Math.log(k));
  return `${(v / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}
