export default function ThresholdSlider({ threshold, onChange, assignedCount }) {
  return (
    <div className="px-4 py-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)]">
      <div className="flex items-center gap-4">
        <label
          className="text-xs text-[var(--text-secondary)] whitespace-nowrap cursor-help"
          title="Categories scoring above this cosine similarity value are considered relevant matches"
        >
          Threshold
        </label>
        <span className="text-[10px] text-[var(--text-secondary)]">Broad</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={threshold}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
          style={{
            background: `linear-gradient(to right, var(--accent) ${threshold * 100}%, var(--bg-tertiary) ${threshold * 100}%)`,
          }}
        />
        <span className="text-[10px] text-[var(--text-secondary)]">Strict</span>
        <span className="text-sm font-mono text-[var(--warning)] min-w-[3rem] text-right">
          {threshold.toFixed(2)}
        </span>
        <span className="text-xs text-[var(--text-secondary)] min-w-[5rem]">
          {assignedCount} assigned
        </span>
      </div>
      <p className="text-[10px] text-[var(--text-secondary)] mt-1">
        Categories with cosine similarity above this value are assigned as relevant.
      </p>
    </div>
  );
}
