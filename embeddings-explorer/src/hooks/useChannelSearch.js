import { useState, useCallback, useRef } from 'react';

export function useChannelSearch() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  const search = useCallback((query) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query || query.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/channels/search?q=${encodeURIComponent(query)}&limit=10`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResults(data.channels);
      } catch (err) {
        setResults([]);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  const selectChannel = useCallback(async (channelId) => {
    try {
      const res = await fetch(`/api/channels/${channelId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  return { results, loading, error, search, selectChannel };
}
