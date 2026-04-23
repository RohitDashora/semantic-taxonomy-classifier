import { X } from 'lucide-react';
import { getTier1Color } from '../../lib/colors.js';

export default function CategoryDetail({ category, onClose }) {
  if (!category) return null;

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-[var(--text-primary)]">{category.name}</h3>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{category.tierPath}</p>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
          <X className="w-4 h-4 text-[var(--text-secondary)]" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-xs text-[var(--text-secondary)]">Similarity</span>
          <div className="font-mono text-lg" style={{ color: category.similarity >= 0.5 ? '#22c55e' : '#3b82f6' }}>
            {(category.similarity * 100).toFixed(1)}%
          </div>
        </div>
        <div>
          <span className="text-xs text-[var(--text-secondary)]">Tier Level</span>
          <div className="text-lg">{category.tierLevel}</div>
        </div>
        <div>
          <span className="text-xs text-[var(--text-secondary)]">Tier 1 Parent</span>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getTier1Color(category.tier1Parent) }} />
            <span className="text-sm">{category.tier1Parent}</span>
          </div>
        </div>
        <div>
          <span className="text-xs text-[var(--text-secondary)]">IAB ID</span>
          <div className="text-sm font-mono">{category.id}</div>
        </div>
      </div>

      {category.description && (
        <div className="mt-3 pt-3 border-t border-[var(--bg-tertiary)]">
          <span className="text-xs text-[var(--text-secondary)]">Description</span>
          <p className="text-sm text-[var(--text-primary)] mt-1">{category.description}</p>
        </div>
      )}
    </div>
  );
}
