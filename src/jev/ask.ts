import { JEV_MODEL, type JevChartRequest, type JevChartResponse } from './chart-choice.js';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export async function askJev(
  request: JevChartRequest,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JevChartResponse> {
  const key = apiKey.trim();
  if (!key) throw new Error('TYPESAFE_API_KEY is empty.');

  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...request, model: JEV_MODEL }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Jev ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as JevChartResponse;
}
