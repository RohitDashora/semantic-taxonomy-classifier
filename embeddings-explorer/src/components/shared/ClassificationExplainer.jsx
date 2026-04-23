import { useState } from 'react';
import { ChevronRight, ChevronDown, FileText } from 'lucide-react';

export default function ClassificationExplainer({ inputText, selectedChannel }) {
  const [open, setOpen] = useState(false);

  if (!inputText) return null;

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--bg-tertiary)] mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)]/30 transition-colors rounded-lg"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)] flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)] flex-shrink-0" />
        )}
        <FileText className="w-3.5 h-3.5 text-[var(--accent)] flex-shrink-0" />
        <span className="text-xs font-medium text-[var(--text-primary)]">
          Pipeline Input: What the Model Sees
        </span>
        <span className="text-[10px] text-[var(--text-secondary)] ml-auto">
          {inputText.length} chars
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3">
          {selectedChannel && (
            <div className="flex items-center gap-2 mb-2 text-xs text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">{selectedChannel.title}</span>
              {selectedChannel.primaryCategory && (
                <span className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[10px]">
                  {selectedChannel.primaryCategory}
                </span>
              )}
            </div>
          )}
          <pre className="text-[10px] text-[var(--text-secondary)] font-mono bg-[var(--bg-primary)] rounded p-2 leading-relaxed overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-words">
            {inputText}
          </pre>
        </div>
      )}
    </div>
  );
}
