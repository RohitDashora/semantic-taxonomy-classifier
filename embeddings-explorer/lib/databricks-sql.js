/**
 * Databricks SQL Statement Execution API client.
 * Pure HTTP — no native drivers needed.
 */

import { getHost, getToken } from './auth.js';

export async function executeSQL(sql, params = {}) {
  const token = await getToken();
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  const statementUrl = `${getHost()}/api/2.0/sql/statements`;

  const body = {
    warehouse_id: warehouseId,
    statement: sql,
    wait_timeout: '50s',
    disposition: 'INLINE',
    format: 'JSON_ARRAY',
  };

  const res = await fetch(statementUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Databricks SQL error ${res.status}: ${text}`);
  }

  const data = await res.json();

  if (data.status?.state === 'FAILED') {
    throw new Error(`SQL failed: ${data.status.error?.message || 'Unknown error'}`);
  }

  // Wait for completion if still running
  if (data.status?.state === 'PENDING' || data.status?.state === 'RUNNING') {
    return pollStatement(data.statement_id);
  }

  return parseResult(data);
}

async function pollStatement(statementId) {
  const token = await getToken();
  const url = `${getHost()}/api/2.0/sql/statements/${statementId}`;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.status?.state === 'SUCCEEDED') return parseResult(data);
    if (data.status?.state === 'FAILED') {
      throw new Error(`SQL failed: ${data.status.error?.message}`);
    }
  }
  throw new Error('SQL statement timed out');
}

function parseResult(data) {
  const columns = data.manifest?.schema?.columns?.map(c => c.name) || [];
  const rows = data.result?.data_array || [];
  return rows.map(row => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}
