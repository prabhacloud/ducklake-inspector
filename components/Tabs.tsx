import Link from 'next/link';

const TABS = ['schema', 'stats', 'snapshots', 'files', 'preview', 'health'] as const;
export type TabKey = (typeof TABS)[number];

export function Tabs({ table, active }: { table: string; active: TabKey }) {
  return (
    <div className="flex items-end gap-0 border-b border-line">
      {TABS.map(t => {
        const isActive = t === active;
        return (
          <Link
            key={t}
            href={`/?t=${encodeURIComponent(table)}&tab=${t}`}
            className={
              'px-4 py-2 text-[12.5px] capitalize border-b-2 -mb-px transition-colors font-medium ' +
              (isActive
                ? 'border-brand text-brand'
                : 'border-transparent text-dim hover:text-ink')
            }
          >
            {t}
          </Link>
        );
      })}
    </div>
  );
}

export const ALL_TABS = TABS;
