/**
 * Databricks Foundation Model API client for text embeddings.
 * Endpoint is selected via the EMBEDDING_ENDPOINT_NAME env var (set by the
 * 'serving-endpoint' resource binding in app.yaml). Default is
 * databricks-gte-large-en (1024-dim).
 */

import { getHost, getToken } from './auth.js';

const MODEL = process.env.EMBEDDING_ENDPOINT_NAME || 'databricks-gte-large-en';

export async function embedText(text) {
  const token = await getToken();
  const endpointUrl = `${getHost()}/serving-endpoints/${MODEL}/invocations`;

  const res = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: [text],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const embedding = data.data?.[0]?.embedding;
  if (!embedding) {
    throw new Error('Embedding API returned empty result — check model endpoint configuration');
  }
  return embedding;
}
