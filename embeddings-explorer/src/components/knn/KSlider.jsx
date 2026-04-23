const K_OPTIONS = [3, 5, 10, 15, 20];

export default function KSlider({ k, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-[var(--text-secondary)]">K =</label>
      <div className="flex rounded-lg overflow-hidden border border-[var(--bg-tertiary)]">
        {K_OPTIONS.map(val => (
          <button
            key={val}
            onClick={() => onChange(val)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              k === val
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {val}
          </button>
        ))}
      </div>
    </div>
  );
}
