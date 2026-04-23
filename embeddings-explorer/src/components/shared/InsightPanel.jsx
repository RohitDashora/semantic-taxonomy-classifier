import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export default function InsightPanel({ title, icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-[#1e293b]/90 backdrop-blur rounded-lg border border-[#475569]/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#334155]/30 transition-colors"
      >
        {icon && <span className="text-[var(--accent)] flex-shrink-0">{icon}</span>}
        <span className="text-xs font-semibold text-[var(--text-primary)] flex-1">{title}</span>
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
          : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        }
      </button>
      {open && (
        <div className="px-3 pb-3 text-xs text-[var(--text-secondary)] leading-relaxed border-t border-[#475569]/30 pt-2">
          {children}
        </div>
      )}
    </div>
  );
}
