import { listSchemas, listTables, listViews, getColumns, getSnapshots, getFiles, getPartitions, getSortKeys, previewRows, getPartitionRowCounts, getColumnStats, getSchemaEvents } from '@/lib/ducklake';
import { refreshCatalog } from '@/lib/connection';
import { Sidebar } from '@/components/Sidebar';
import { Tabs, ALL_TABS, type TabKey } from '@/components/Tabs';
import { SchemaPane } from '@/components/SchemaPane';
import { SnapshotsPane } from '@/components/SnapshotsPane';
import { FilesPane } from '@/components/FilesPane';
import { PreviewPane } from '@/components/PreviewPane';
import { HealthPane } from '@/components/HealthPane';
import { StatsPane } from '@/components/StatsPane';
import { runAnalyzers } from '@/lib/analyzers';

export const dynamic = 'force-dynamic';

interface SP { t?: string; tab?: string; snap?: string; }

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await refreshCatalog();
  const [schemas, tables, views] = await Promise.all([listSchemas(), listTables(), listViews()]);
  const selected = sp.t;
  const table = tables.find(t => `${t.schema_name}.${t.table_name}` === selected);
  const view = views.find(v => `${v.schema_name}.${v.view_name}` === selected);
  const tab: TabKey = (ALL_TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as TabKey)
    : 'schema';

  return (
    <div className="flex h-screen">
      <Sidebar
        schemas={schemas}
        tables={tables}
        views={views}
        selected={selected}
        metadataPath={process.env.DUCKLAKE_METADATA_PATH}
      />

      <main className="flex-1 overflow-y-auto">
        {table ? (
          <>
            <div className="px-8 pt-6">
              <div className="text-[10.5px] uppercase tracking-[0.14em] text-dim mb-1">
                {table.schema_name}
              </div>
              <h1 className="text-[22px] font-semibold tracking-tight leading-tight">{table.table_name}</h1>
            </div>
            <div className="px-8 mt-5">
              <Tabs table={`${table.schema_name}.${table.table_name}`} active={tab} />
            </div>
            {tab === 'schema' && (
              <SchemaPane
                table={table}
                columns={await getColumns(table.table_id)}
                partitions={await getPartitions(table.table_id)}
                sortKeys={await getSortKeys(table.table_id)}
              />
            )}
            {tab === 'stats' && <StatsPane stats={await getColumnStats(table.table_id)} />}
            {tab === 'snapshots' && (
              <SnapshotsPane
                snapshots={await getSnapshots(table.table_id)}
                schemaEvents={await getSchemaEvents(table.table_id)}
              />
            )}
            {tab === 'files' && <FilesPane files={await getFiles(table.table_id)} />}
            {tab === 'preview' && (
              <PreviewPane
                result={await previewRows(
                  table.schema_name,
                  table.table_name,
                  sp.snap ? Number(sp.snap) : undefined
                )}
                snapshot={sp.snap ? Number(sp.snap) : undefined}
              />
            )}
            {tab === 'health' && (
              <HealthPane
                findings={runAnalyzers({
                  schema: table.schema_name,
                  table: table.table_name,
                  files: await getFiles(table.table_id),
                  snapshots: await getSnapshots(table.table_id),
                  partitions: await getPartitions(table.table_id),
                  partitionRowCounts: await getPartitionRowCounts(table.table_id),
                })}
              />
            )}
          </>
        ) : view ? (
          <ViewDetail view={view} />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  );
}

async function ViewDetail({ view }: { view: { schema_name: string; view_name: string; sql: string } }) {
  const preview = await previewRows(view.schema_name, view.view_name);
  return (
    <>
      <div className="px-8 pt-6">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-dim mb-1">
          {view.schema_name}
          <span className="mx-2 text-dim2">·</span>
          <span className="text-violet">view</span>
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight leading-tight italic">{view.view_name}</h1>
      </div>
      <div className="p-8 space-y-6">
        <Section title="SQL">
          <pre className="text-[13px] font-mono bg-raised border border-line rounded-lg p-4 overflow-auto whitespace-pre-wrap text-ink/90">
{view.sql}
          </pre>
        </Section>
        <Section title="Preview">
          <PreviewTable result={preview} />
        </Section>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[10.5px] uppercase tracking-[0.14em] text-dim mb-2 font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function PreviewTable({ result }: { result: { columns: string[]; rows: unknown[][] } }) {
  if (result.rows.length === 0) return <div className="text-sm text-dim">No rows.</div>;
  return (
    <div className="border border-line rounded-lg overflow-auto bg-surface">
      <table className="text-[13px] w-full">
        <thead className="bg-raised text-dim text-[10.5px] uppercase tracking-[0.14em]">
          <tr>
            {result.columns.map(c => (
              <th key={c} className="text-left px-3 py-2 font-semibold whitespace-nowrap border-b border-line">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono">
          {result.rows.map((r, ri) => (
            <tr key={ri} className="border-t border-line/60 hover:bg-raised/40">
              {r.map((v, ci) => (
                <td key={ci} className="px-3 py-1.5 whitespace-nowrap text-ink/85">{v == null ? <span className="text-dim2">∅</span> : String(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center text-dim max-w-sm px-6">
        <div className="text-[13px] font-mono mb-2 text-brand/70">// no table selected</div>
        <div className="text-sm">Pick a table or view from the catalog on the left.</div>
      </div>
    </div>
  );
}
