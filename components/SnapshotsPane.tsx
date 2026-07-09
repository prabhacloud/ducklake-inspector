import type { SnapshotRow, SchemaEventRow } from '@/lib/ducklake';

export function SnapshotsPane({
  snapshots, schemaEvents = [],
}: {
  snapshots: SnapshotRow[];
  schemaEvents?: SchemaEventRow[];
}) {
  if (snapshots.length === 0) {
    return <div className="px-8 py-6 text-sm text-dim">No snapshots have touched this table.</div>;
  }

  const eventsBySnap = new Map<string, SchemaEventRow[]>();
  for (const e of schemaEvents) {
    const arr = eventsBySnap.get(e.snapshot_id) ?? [];
    arr.push(e);
    eventsBySnap.set(e.snapshot_id, arr);
  }

  return (
    <div className="px-8 py-6">
      <ol className="relative space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-line">
        {snapshots.map(s => {
          const ops = parseChanges(s.changes_made ?? '');
          const schemaOps = eventsBySnap.get(s.snapshot_id) ?? [];
          return (
            <li key={s.snapshot_id} className="relative pl-8">
              <span className="absolute left-[2px] top-2 w-[10px] h-[10px] rounded-full bg-brandHi border-2 border-brand" />
              <div className="flex items-baseline gap-3 text-[13px]">
                <span className="font-mono text-brand">v{s.snapshot_id}</span>
                <span className="text-dim text-[11.5px] font-mono">{s.snapshot_time}</span>
                {s.author && <span className="text-dim2 text-[11px]">· {s.author}</span>}
              </div>
              {s.commit_message && (
                <div className="mt-1 text-[13px] text-ink/85">{s.commit_message}</div>
              )}
              {(ops.length > 0 || schemaOps.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ops.map((op, i) => <OpChip key={`o${i}`} op={op} />)}
                  {schemaOps.map((e, i) => <SchemaChip key={`s${i}`} event={e} />)}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SchemaChip({ event }: { event: SchemaEventRow }) {
  const isAdd = event.event === 'added';
  const tone = isAdd
    ? 'bg-teal/10 text-teal border-teal/35'
    : 'bg-coral/10 text-coral border-coral/35';
  const sigil = isAdd ? '+' : '−';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border pl-2 pr-2.5 py-0.5 text-[11px] ${tone}`}>
      <span className="font-mono font-medium">{sigil} col</span>
      <span className="font-mono text-ink/60 border-l border-current/30 pl-1.5">
        {event.column_name}: {event.column_type}
      </span>
    </span>
  );
}

interface Op { kind: string; detail: string; }

function parseChanges(raw: string): Op[] {
  if (!raw) return [];
  return raw.split(',').map(item => {
    const idx = item.indexOf(':');
    if (idx === -1) return { kind: item.trim(), detail: '' };
    return { kind: item.slice(0, idx).trim(), detail: item.slice(idx + 1).trim() };
  });
}

function OpChip({ op }: { op: Op }) {
  const tone = chipTone(op.kind);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border pl-2 pr-2.5 py-0.5 text-[11px] ${tone}`}>
      <span className="font-mono font-medium">{op.kind}</span>
      {op.detail && (
        <span className="font-mono text-ink/60 border-l border-current/30 pl-1.5">
          {op.detail.replace(/"/g, '')}
        </span>
      )}
    </span>
  );
}

function chipTone(kind: string): string {
  if (kind.includes('delete') || kind.includes('dropped'))
    return 'bg-coral/10 text-coral border-coral/35';
  if (kind.includes('insert'))
    return 'bg-green/10 text-green border-green/35';
  if (kind.includes('created'))
    return 'bg-teal/10 text-teal border-teal/35';
  return 'bg-raised text-dim border-line';
}
