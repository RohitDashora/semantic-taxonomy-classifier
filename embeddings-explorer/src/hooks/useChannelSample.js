import { useState, useEffect, useCallback } from 'react';

export function useChannelSample() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/channels/sample');
      if (!res.ok) throw new Error(`Failed to load channel data (HTTP ${res.status})`);
      const data = await res.json();
      setChannels(data.channels || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { channels, loading, error, retry: load };
}
