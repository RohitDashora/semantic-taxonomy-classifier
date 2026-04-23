/**
 * Databricks authentication for Apps runtime.
 *
 * In Databricks Apps, DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET are
 * auto-injected (service principal). We exchange them for an OAuth token
 * via the client credentials flow.
 *
 * Locally, DATABRICKS_TOKEN can be set directly (e.g. from CLI profile).
 */

let cachedToken = null;
let tokenExpiry = 0;

export function getHost() {
  const host = process.env.DATABRICKS_HOST || '';
  return host.startsWith('http') ? host : `https://${host}`;
}

export async function getToken() {
  // Local dev: use DATABRICKS_TOKEN directly if set
  const staticToken = process.env.DATABRICKS_TOKEN;
  if (staticToken) return staticToken;

  // Databricks Apps runtime: OAuth client credentials
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;

  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing auth: set DATABRICKS_TOKEN (local) or ensure DATABRICKS_CLIENT_ID/SECRET are injected (Apps runtime)'
    );
  }

  const host = getHost();
  const res = await fetch(`${host}/oidc/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'all-apis',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token error ${res.status}: ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // Refresh 60s before expiry
  tokenExpiry = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}
