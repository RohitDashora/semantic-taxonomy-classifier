import { useState, useCallback } from 'react';

export function useEmbedding() {
  const [embedding, setEmbedding] = useState(null);
  const [loading, setLoading] = useState(false);
  const [latency, setLatency] = useState(null);
  const [error, setError] = useState(null);

  const embed = useCallback(async (text) => {
    if (!text?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEmbedding(data.embedding);
      setLatency(data.latencyMs);
      return data.embedding;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setEmbedding(null);
    setLatency(null);
    setError(null);
  }, []);

  return { embedding, loading, latency, error, embed, clear };
}
