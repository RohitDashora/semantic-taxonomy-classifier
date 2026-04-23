import { useState, useRef, useEffect } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { useChannelSearch } from '../../hooks/useChannelSearch.js';

export default function ChannelPicker({ onSelect }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const { results, loading, error, search, selectChannel } = useChannelSearch();
  const wrapperRef = useRef(null);

  useEffect(() => {
    search(query);
    setOpen(query.length >= 2);
  }, [query, search]);

  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = async (channel) => {
    setOpen(false);
    setQuery(channel.title);
    const detail = await selectChannel(channel.id);
    if (detail) onSelect(detail);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search channels by name..."
          className="w-full pl-10 pr-4 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--bg-tertiary)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)]"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-[var(--text-secondary)]" />}
      </div>

      {open && (
        <div className="absolute z-50 top-full mt-1 w-full rounded-lg border border-[var(--bg-tertiary)] bg-[var(--bg-secondary)] shadow-xl max-h-60 overflow-y-auto">
          {results.length > 0 ? (
            results.map(ch => (
              <button
                key={ch.id}
                onClick={() => handleSelect(ch)}
                className="w-full text-left px-4 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <div className="text-sm font-medium text-[var(--text-primary)]">{ch.title}</div>
                <div className="text-xs text-[var(--text-secondary)]">
                  {ch.primaryCategory} — {(ch.confidence * 100).toFixed(0)}% confidence
                </div>
              </button>
            ))
          ) : !loading ? (
            <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">
              {error ? 'Search failed — try again' : 'No channels found'}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
