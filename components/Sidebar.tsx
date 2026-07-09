import Link from 'next/link';
import { CatalogTree } from './CatalogTree';
import type { SchemaRow, TableRow, ViewRow } from '@/lib/ducklake';

interface Props {
  schemas: SchemaRow[];
  tables: TableRow[];
  views: ViewRow[];
  selected?: string;
  metadataPath?: string;
  auditActive?: boolean;
}

export function Sidebar({ schemas, tables, views, selected, metadataPath, auditActive }: Props) {
  return (
    <aside className="w-72 shrink-0 border-r border-line bg-surface overflow-y-auto">
      <div className="px-4 pt-5 pb-4 border-b border-line">
        <Link href="/" className="block">
          <div className="text-[15px] font-semibold tracking-tight text-ink">
            <span className="bg-brandHi px-1 rounded-sm">Duck</span>Lake{' '}
            <span className="text-dim font-normal">Inspector</span>
          </div>
        </Link>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green" />
          <div className="text-[11px] font-mono text-dim truncate" title={metadataPath}>
            {metadataPath}
          </div>
        </div>
        <Link
          href="/audit"
          className={
            'mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-mono transition-colors ' +
            (auditActive ? 'text-brand font-semibold' : 'text-dim hover:text-brand')
          }
        >
          <span className={`w-1.5 h-1.5 rounded-full ${auditActive ? 'bg-brand' : 'bg-dim2'}`} />
          catalog audit →
        </Link>
      </div>
      <CatalogTree schemas={schemas} tables={tables} views={views} selected={selected} />
    </aside>
  );
}
