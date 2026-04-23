import { useMemo, useState } from 'react';
import { getTier1Color } from '../../lib/colors.js';

export default function ConfusionMatrix({ categories }) {
  const [hoveredCell, setHoveredCell] = useState(null);

  const { tier1Names, clusterIds, matrix, maxCount } = useMemo(() => {
    // Gather unique Tier 1 names and KMeans cluster IDs
    const t1Set = new Set();
    const kSet = new Set();
    categories.forEach(cat => {
      t1Set.add(cat.tier1Parent);
      kSet.add(cat.clusterKmeans);
    });

    const t1Names = [...t1Set].sort();
    const kIds = [...kSet].sort((a, b) => Number(a) - Number(b));

    // Build overlap matrix
    const mat = {};
    let max = 0;
    t1Names.forEach(t1 => {
      mat[t1] = {};
      kIds.forEach(k => { mat[t1][k] = 0; });
    });
    categories.forEach(cat => {
      mat[cat.tier1Parent][cat.clusterKmeans]++;
    });
    t1Names.forEach(t1 => {
      kIds.forEach(k => {
        if (mat[t1][k] > max) max = mat[t1][k];
      });
    });

    return { tier1Names: t1Names, clusterIds: kIds, matrix: mat, maxCount: max };
  }, [categories]);

  const cellSize = Math.max(14, Math.min(22, Math.floor(700 / clusterIds.length)));

  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        {/* Column headers (cluster IDs) */}
        <div className="flex" style={{ paddingLeft: 140 }}>
          {clusterIds.map(k => (
            <div
              key={k}
              className="text-[9px] text-[var(--text-secondary)] text-center font-mono"
              style={{ width: cellSize, minWidth: cellSize }}
            >
              {k}
            </div>
          ))}
        </div>

        {/* Rows */}
        {tier1Names.map(t1 => (
          <div key={t1} className="flex items-center">
            {/* Row label */}
            <div className="flex items-center gap-1.5 shrink-0" style={{ width: 140 }}>
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: getTier1Color(t1) }}
              />
              <span className="text-[10px] text-[var(--text-secondary)] truncate">{t1}</span>
            </div>

            {/* Cells */}
            {clusterIds.map(k => {
              const count = matrix[t1][k];
              const intensity = maxCount > 0 ? count / maxCount : 0;
              const isHovered = hoveredCell?.t1 === t1 && hoveredCell?.k === k;

              return (
                <div
                  key={k}
                  className="relative border border-[var(--bg-primary)]"
                  style={{
                    width: cellSize,
                    height: cellSize,
                    minWidth: cellSize,
                    backgroundColor: count > 0
                      ? `rgba(56, 189, 248, ${0.1 + intensity * 0.8})`
                      : 'rgba(30, 41, 59, 0.3)',
                    outline: isHovered ? '2px solid var(--accent)' : 'none',
                    outlineOffset: -1,
                  }}
                  onMouseEnter={() => setHoveredCell({ t1, k, count })}
                  onMouseLeave={() => setHoveredCell(null)}
                />
              );
            })}
          </div>
        ))}

        {/* Axis label */}
        <div className="flex justify-center mt-2" style={{ paddingLeft: 140 }}>
          <span className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider">KMeans Cluster ID</span>
        </div>
      </div>

      {/* Tooltip */}
      {hoveredCell && hoveredCell.count > 0 && (
        <div className="mt-2 text-xs text-[var(--text-secondary)]">
          <span style={{ color: getTier1Color(hoveredCell.t1) }} className="font-medium">{hoveredCell.t1}</span>
          {' → '}
          <span className="text-[var(--text-primary)] font-mono">Cluster {hoveredCell.k}</span>
          {': '}
          <span className="text-[var(--accent)] font-mono font-semibold">{hoveredCell.count}</span> categories
        </div>
      )}
    </div>
  );
}
