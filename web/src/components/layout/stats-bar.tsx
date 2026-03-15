interface StatsBarProps {
  stats: {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
  };
}

function Readout({ label, value, color = "text-[#00e5ff]" }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-2 px-4">
      <span className="font-display text-[8px] text-[#556677] tracking-[0.15em] whitespace-nowrap">{label}</span>
      <span className={`font-data text-sm font-semibold tabular-nums ${color}`}>
        {value}
      </span>
    </div>
  );
}

export function StatsBar({ stats }: StatsBarProps) {
  if (stats.total === 0) return null;

  const openTasks = stats.byStatus["open"] ?? 0;
  const inProgress = stats.byStatus["in-progress"] ?? 0;
  const done = stats.byStatus["done"] ?? 0;

  return (
    <div className="border-b border-[#1a2538]/60 bg-[#050810]/60 backdrop-blur-sm">
      <div className="flex items-center py-2 overflow-x-auto">
        <Readout label="NODES" value={stats.total} />
        <div className="w-px h-4 bg-[#1a2538]/60" />
        <Readout label="SPACES" value={stats.byType["space"] ?? 0} />
        <div className="w-px h-4 bg-[#1a2538]/60" />
        <Readout label="OPEN" value={openTasks} color="text-[#ffb800]" />
        <div className="w-px h-4 bg-[#1a2538]/60" />
        <Readout label="ACTIVE" value={inProgress} color="text-[#00e5ff]" />
        <div className="w-px h-4 bg-[#1a2538]/60" />
        <Readout label="DONE" value={done} color="text-[#22d3ee]" />
      </div>
    </div>
  );
}
