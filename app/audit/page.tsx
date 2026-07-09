import Link from 'next/link';
import { readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  listSchemas, listTables, listViews, getFiles, getSnapshots, getPartitions,
  getPartitionRowCounts, getDataPath, getAllReferencedFilenames,
  type TableRow,
} from '@/lib/ducklake';
import { refreshCatalog } from '@/lib/connection';
import { Sidebar } from '@/components/Sidebar';
import {
  runAnalyzers, orphanFilesAnalyzer,
  type Finding, type Severity, SEVERITY_RANK,
} from '@/lib/analyzers';
import { summarizeAudit, type SummaryResult } from '@/lib/llm';

export const dynamic = 'force-dynamic';

interface TableFindings {
  table: TableRow;
  findings: Finding[];
}

export default async function AuditPage() {
  await refreshCatalog();

  // The DuckDB Node connection is a single serialized queue — running
  // ~4 queries per table via Promise.all against 6+ tables would interleave
  // and silently drop rows. Iterate sequentially.
  const schemas = await listSchemas();
  const tables = await listTables();
  const views = await listViews();
  const dataPath = await getDataPath();
  const referenced = await getAllReferencedFilenames();

  const perTable: TableFindings[] = [];
  for (const t of tables) {
    const files = await getFiles(t.table_id);
    const snapshots = await getSnapshots(t.table_id);
    const partitions = await getPartitions(t.table_id);
    const partitionRowCounts = await getPartitionRowCounts(t.table_id);
    const findings = runAnalyzers({
      schema: t.schema_name,
      table: t.table_name,
      files, snapshots, partitions, partitionRowCounts,
    });
    perTable.push({ table: t, findings });
  }

  let orphan: Finding[] = [];
  let orphanError: string | null = null;
  if (dataPath) {
    try {
      const parquet = await walkParquet(resolve(dataPath));
      orphan = orphanFilesAnalyzer({
        dataPath,
        filesystemFilenames: parquet,
        referencedFilenames: referenced,
      });
    } catch (e) {
      orphanError = (e as Error).message;
    }
  }

  const totalFindings = perTable.reduce((a, t) => a + t.findings.length, 0) + orphan.length;
  const bySev: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const t of perTable) for (const f of t.findings) bySev[f.severity]++;
  for (const f of orphan) bySev[f.severity]++;

  const worst = [...perTable].sort((a, b) => sevScore(b.findings) - sevScore(a.findings));

  const allFindings = [
    ...orphan,
    ...perTable.flatMap(t => t.findings.map(f => ({ ...f, title: `[${t.table.schema_name}.${t.table.table_name}] ${f.title}` }))),
  ];
  const summary = await summarizeAudit(allFindings, tables.length);

  return (
    <div className="flex h-screen">
      <Sidebar
        schemas={schemas}
        tables={tables}
        views={views}
        metadataPath={process.env.DUCKLAKE_METADATA_PATH}
        auditActive
      />

      <main className="flex-1 overflow-y-auto">
        <div className="px-8 pt-6">
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-dim mb-1">catalog</div>
          <h1 className="text-[22px] font-semibold tracking-tight leading-tight">
            <span className="bg-brandHi px-1 rounded-sm">Audit</span>
          </h1>
          <p className="text-[13px] text-dim mt-1.5 max-w-2xl">
            Hygiene &amp; optimization findings across every table — ranked by severity,
            each with copy-paste remediation SQL.
          </p>
        </div>

        <div className="px-8 py-6 space-y-6">
          <SummaryBar
            tablesScanned={tables.length}
            totalFindings={totalFindings}
            bySev={bySev}
            dataPath={dataPath}
          />

          <AISummaryCard summary={summary} />

          {orphanError && (
            <div className="border border-coral/40 bg-coral/10 rounded-lg px-4 py-3 text-[12.5px]">
              <span className="text-coral font-semibold">orphan-scan skipped:</span>{' '}
              <span className="text-dim font-mono">{orphanError}</span>
            </div>
          )}

          {orphan.length > 0 && (
            <section className="space-y-2">
              <SectionHeader title="Catalog-level findings" />
              {orphan.map((f, i) => <CatalogFindingCard key={i} f={f} />)}
            </section>
          )}

          <section className="space-y-3">
            <SectionHeader title="Per-table findings" />
            {worst.filter(t => t.findings.length).map(t => (
              <TableRow2 key={`${t.table.schema_name}.${t.table.table_name}`} t={t} />
            ))}
            {worst.every(t => t.findings.length === 0) && (
              <div className="border border-green/40 bg-green/10 rounded-lg px-4 py-3 text-[13px]">
                <span className="text-green font-medium">Clean.</span>{' '}
                <span className="text-dim">Every table passes every analyzer at default thresholds.</span>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function sevScore(fs: Finding[]): number {
  return fs.reduce((a, f) => a + (SEVERITY_RANK[f.severity] + 1) * 10, 0);
}

async function walkParquet(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await visit(full);
      else if (e.isFile() && e.name.endsWith('.parquet')) out.push(e.name);
    }
  }
  await visit(root);
  return out;
}

const SEV_STYLE: Record<Severity, { chip: string; bar: string; label: string }> = {
  critical: { chip: 'bg-coral/15 text-coral border-coral/40', bar: 'bg-coral',  label: 'CRIT' },
  high:     { chip: 'bg-brand/15 text-brand border-brand/40', bar: 'bg-brand',  label: 'HIGH' },
  medium:   { chip: 'bg-violet/15 text-violet border-violet/40', bar: 'bg-violet', label: 'MED'  },
  low:      { chip: 'bg-teal/15 text-teal border-teal/40', bar: 'bg-teal',   label: 'LOW'  },
  info:     { chip: 'bg-raised text-dim border-line', bar: 'bg-dim2', label: 'INFO' },
};

function SectionHeader({ title }: { title: string }) {
  return <h2 className="text-[10.5px] uppercase tracking-[0.14em] text-dim font-semibold">{title}</h2>;
}

function AISummaryCard({ summary }: { summary: SummaryResult }) {
  if (summary.kind === 'disabled') {
    return (
      <div className="border border-line border-dashed rounded-lg bg-surface px-5 py-4 text-[12.5px] text-dim">
        <span className="inline-block bg-brandHi/60 px-1.5 rounded-sm text-ink text-[10.5px] font-semibold mr-2 tracking-wider">AI</span>
        {summary.reason}
      </div>
    );
  }
  if (summary.kind === 'error') {
    return (
      <div className="border border-coral/40 bg-coral/10 rounded-lg px-5 py-4 text-[12.5px]">
        <span className="text-coral font-semibold">AI summary failed:</span>{' '}
        <span className="text-dim font-mono">{summary.reason}</span>
        {summary.model && <span className="ml-2 text-[10px] font-mono text-dim2">({summary.model})</span>}
      </div>
    );
  }
  return (
    <div className="border border-brand/30 rounded-lg bg-brandHi/10 px-5 py-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="bg-brandHi px-1.5 rounded-sm text-ink text-[10.5px] font-semibold tracking-wider">AI</span>
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-dim font-semibold">Executive summary</span>
        <span className="ml-auto text-[10px] font-mono text-dim2">{summary.model}</span>
      </div>
      <div className="prose-summary text-[13px] leading-relaxed text-ink/90">
        {renderMarkdown(summary.text)}
      </div>
    </div>
  );
}

function renderMarkdown(md: string): React.ReactNode {
  // Minimal renderer — bold, italics, numbered lists, paragraphs, inline code.
  const blocks = md.trim().split(/\n{2,}/);
  return blocks.map((block, i) => {
    const isList = /^\s*\d+\.\s/.test(block);
    if (isList) {
      const items = block.split(/\n(?=\s*\d+\.\s)/).map(l => l.replace(/^\s*\d+\.\s*/, ''));
      return (
        <ol key={i} className="list-decimal ml-5 space-y-1 my-2">
          {items.map((it, j) => <li key={j}>{formatInline(it)}</li>)}
        </ol>
      );
    }
    return <p key={i} className="my-2">{formatInline(block)}</p>;
  });
}

function formatInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  const patterns: Array<{ re: RegExp; wrap: (s: string) => React.ReactNode }> = [
    { re: /\*\*([^*]+)\*\*/, wrap: s => <strong className="font-semibold text-ink">{s}</strong> },
    { re: /`([^`]+)`/,       wrap: s => <code className="px-1 py-0.5 rounded bg-raised border border-line font-mono text-[12px] text-teal">{s}</code> },
    { re: /\*([^*]+)\*/,     wrap: s => <em className="italic">{s}</em> },
  ];
  while (rest) {
    let earliest = -1;
    let picked: typeof patterns[number] | null = null;
    let match: RegExpExecArray | null = null;
    for (const p of patterns) {
      const m = p.re.exec(rest);
      if (m && (earliest === -1 || m.index < earliest)) {
        earliest = m.index;
        picked = p;
        match = m;
      }
    }
    if (!picked || !match) { parts.push(rest); break; }
    if (match.index > 0) parts.push(rest.slice(0, match.index));
    parts.push(<span key={key++}>{picked.wrap(match[1])}</span>);
    rest = rest.slice(match.index + match[0].length);
  }
  return parts;
}

function SummaryBar({
  tablesScanned, totalFindings, bySev, dataPath,
}: {
  tablesScanned: number;
  totalFindings: number;
  bySev: Record<Severity, number>;
  dataPath: string | null;
}) {
  const order: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
  return (
    <div className="border border-line rounded-lg bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] font-mono">
        <span>
          Scanned <span className="text-brand tabular-nums font-semibold">{tablesScanned}</span>{' '}
          {tablesScanned === 1 ? 'table' : 'tables'}
        </span>
        <span className="text-line2">·</span>
        <span>
          <span className="text-brand tabular-nums font-semibold">{totalFindings}</span>{' '}
          {totalFindings === 1 ? 'finding' : 'findings'}
        </span>
        {order.filter(s => bySev[s]).map(s => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${SEV_STYLE[s].bar}`} />
            <span className="tabular-nums">{bySev[s]}</span>
            <span className="text-dim2 uppercase text-[10px] tracking-[0.14em]">{s}</span>
          </span>
        ))}
        {dataPath && (
          <span className="ml-auto text-dim text-[11px]">
            data_path=<span className="text-ink/80">{dataPath}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function CatalogFindingCard({ f }: { f: Finding }) {
  const s = SEV_STYLE[f.severity];
  return (
    <div className="border border-line rounded-lg bg-surface overflow-hidden">
      <div className="flex items-stretch">
        <div className={`w-1 ${s.bar}`} />
        <div className="flex-1 p-4 space-y-2">
          <div className="flex items-start gap-3 flex-wrap">
            <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${s.chip} tracking-wider`}>{s.label}</span>
            <span className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-dim mt-0.5">{f.analyzer}</span>
          </div>
          <div className="text-[13.5px] font-medium">{f.title}</div>
          <div className="text-[12.5px] text-dim leading-relaxed">{f.detail}</div>
          <pre className="text-[12px] font-mono bg-raised border border-line rounded-md p-3 whitespace-pre-wrap text-ink/90 overflow-x-auto">{f.remediation_sql}</pre>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] font-mono">
            {Object.entries(f.evidence).map(([k, v]) => (
              <span key={k} className="text-dim">{k}=<span className="text-ink/85 tabular-nums">{String(v)}</span></span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TableRow2({ t }: { t: TableFindings }) {
  const worstSev = t.findings.reduce<Severity>(
    (acc, f) => SEVERITY_RANK[f.severity] > SEVERITY_RANK[acc] ? f.severity : acc,
    'info'
  );
  const s = SEV_STYLE[worstSev];
  const savings = t.findings.reduce((a, f) => a + (f.estimated_monthly_savings_usd ?? 0), 0);
  const qName = `${t.table.schema_name}.${t.table.table_name}`;

  return (
    <details className="border border-line rounded-lg bg-surface overflow-hidden group">
      <summary className="flex items-stretch cursor-pointer list-none">
        <div className={`w-1 ${s.bar}`} />
        <div className="flex-1 flex items-center gap-3 px-4 py-3 flex-wrap">
          <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${s.chip} tracking-wider`}>{s.label}</span>
          <Link
            href={`/?t=${encodeURIComponent(qName)}&tab=health`}
            className="text-[13.5px] font-medium hover:text-brand transition-colors"
          >
            {qName}
          </Link>
          <span className="text-[12px] font-mono text-dim">
            {t.findings.length} {t.findings.length === 1 ? 'finding' : 'findings'}
          </span>
          <span className="text-[11px] font-mono text-dim/80">
            {t.findings.map(f => f.analyzer).join(', ')}
          </span>
          {savings > 0 && (
            <span className="ml-auto text-[11.5px] font-mono text-teal">
              ≈ ${savings.toFixed(2)}/mo
            </span>
          )}
          <span className="text-dim2 text-[11px] group-open:rotate-90 transition-transform inline-block">▸</span>
        </div>
      </summary>
      <div className="px-4 pb-4 pt-1 space-y-3 pl-6 border-t border-line/60">
        {t.findings.map((f, i) => <CatalogFindingCard key={i} f={f} />)}
      </div>
    </details>
  );
}
