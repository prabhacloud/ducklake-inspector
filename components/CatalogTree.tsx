import Link from 'next/link';
import { Database, Table2, Eye } from 'lucide-react';
import type { SchemaRow, TableRow, ViewRow } from '@/lib/ducklake';

interface Props {
  schemas: SchemaRow[];
  tables: TableRow[];
  views: ViewRow[];
  selected?: string;
}

export function CatalogTree({ schemas, tables, views, selected }: Props) {
  return (
    <nav className="text-sm py-3">
      <div className="px-4 pb-2 text-[10.5px] uppercase tracking-[0.14em] text-dim font-semibold">
        Catalog
      </div>
      <ul className="space-y-3">
        {schemas.map(s => {
          const schemaTables = tables.filter(t => t.schema_name === s.schema_name);
          const schemaViews = views.filter(v => v.schema_name === s.schema_name);
          const isEmpty = schemaTables.length === 0 && schemaViews.length === 0;
          return (
            <li key={s.schema_id}>
              <div className="flex items-center gap-1.5 px-4 py-1 text-ink">
                <Database size={12} className="text-dim2 shrink-0" />
                <span className="font-medium">{s.schema_name}</span>
                <span className="ml-auto text-[10px] font-mono text-dim2">
                  {schemaTables.length + schemaViews.length}
                </span>
              </div>
              {isEmpty && (
                <div className="pl-9 pr-4 text-[11px] text-dim2 italic py-1">empty</div>
              )}
              <ul className="mt-0.5">
                {schemaTables.map(t => {
                  const key = `${t.schema_name}.${t.table_name}`;
                  const active = selected === key;
                  return (
                    <li key={`t-${t.table_id}`}>
                      <Link
                        href={`/?t=${encodeURIComponent(key)}&tab=schema`}
                        className={rowCls(active)}
                      >
                        <Table2 size={11} className={active ? 'text-brand shrink-0' : 'text-dim2 shrink-0'} />
                        <span className="truncate">{t.table_name}</span>
                        {t.record_count != null && (
                          <span className="ml-auto text-[10px] font-mono text-dim2 tabular-nums">
                            {formatCount(Number(t.record_count))}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
                {schemaViews.map(v => {
                  const key = `${v.schema_name}.${v.view_name}`;
                  const active = selected === key;
                  return (
                    <li key={`v-${v.view_id}`}>
                      <Link
                        href={`/?t=${encodeURIComponent(key)}&tab=schema`}
                        className={rowCls(active)}
                      >
                        <Eye size={11} className={active ? 'text-violet shrink-0' : 'text-dim2 shrink-0'} />
                        <span className="truncate italic">{v.view_name}</span>
                        <span className="ml-auto text-[9.5px] font-mono uppercase tracking-wider text-violet/80">
                          view
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function rowCls(active: boolean): string {
  return (
    'flex items-center gap-1.5 pl-9 pr-4 py-1 transition-colors border-l-2 ' +
    (active
      ? 'bg-raised/60 border-brand text-ink'
      : 'border-transparent text-ink/75 hover:bg-raised/30 hover:text-ink')
  );
}

function formatCount(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
