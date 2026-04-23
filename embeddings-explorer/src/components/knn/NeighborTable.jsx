import { getTier1Color } from '../../lib/colors.js';

export default function NeighborTable({ neighbors, type = 'category' }) {
  if (!neighbors.length) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-[var(--text-secondary)] border-b border-[var(--bg-tertiary)]">
            <th className="py-2 pr-3">#</th>
            <th className="py-2 pr-3">{type === 'category' ? 'Category' : 'Channel'}</th>
            {type === 'category' && <th className="py-2 pr-3">Tier Path</th>}
            {type === 'channel' && <th className="py-2 pr-3">Primary Category</th>}
            <th className="py-2 pr-3 text-right">Similarity</th>
            <th className="py-2 text-right">Distance</th>
          </tr>
        </thead>
        <tbody>
          {neighbors.map((n, i) => (
            <tr key={n.id || i} className="border-b border-[var(--bg-tertiary)]/50 hover:bg-[var(--bg-tertiary)]/30">
              <td className="py-2 pr-3 text-xs text-[var(--text-secondary)]">{i + 1}</td>
              <td className="py-2 pr-3">
                <div className="flex items-center gap-2">
                  {type === 'category' && (
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getTier1Color(n.tier1Parent) }}
                    />
                  )}
                  <span className="text-[var(--text-primary)] font-medium truncate max-w-[200px]" title={n.name || n.title}>
                    {n.name || n.title}
                  </span>
                </div>
              </td>
              {type === 'category' && (
                <td className="py-2 pr-3 text-xs text-[var(--text-secondary)] truncate max-w-[200px]" title={n.tierPath}>
                  {n.tierPath}
                </td>
              )}
              {type === 'channel' && (
                <td className="py-2 pr-3 text-xs text-[var(--text-secondary)]">
                  {n.primaryCategory}
                </td>
              )}
              <td className="py-2 pr-3 text-right font-mono text-xs" style={{
                color: n.similarity >= 0.5 ? '#22c55e' : n.similarity >= 0.3 ? '#3b82f6' : '#64748b'
              }}>
                {n.similarity.toFixed(4)}
              </td>
              <td className="py-2 text-right font-mono text-xs text-[var(--text-secondary)]">
                {(1 - n.similarity).toFixed(4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
