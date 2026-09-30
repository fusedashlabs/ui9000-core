/**
 * Ask Jev which chart to draw for three utterances.
 *
 * Prints the request. Loads ui9000-core/.env, then calls the API when
 * TYPESAFE_API_KEY is set.
 * Does not change show_workspace.
 *
 * From ui9000-core: yarn tsx scripts/jev-chart-choice.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DataProfile } from '../src/spec/data-profile.js';
import { askJev } from '../src/jev/ask.js';
import {
  acceptReading,
  classChoiceRequest,
  offeredChartIds,
  type JevColumn,
} from '../src/jev/chart-choice.js';

const SCENARIOS: {
  utterance: string;
  columns: JevColumn[];
  profile: DataProfile;
}[] = [
  {
    utterance: 'Compare incident counts by team over months, as a line, not a bar.',
    columns: [
      { name: 'team', role: 'category' },
      { name: 'month', role: 'temporal' },
      { name: 'incidents', role: 'metric' },
    ],
    profile: {
      hasCategory: true,
      hasNumericMetric: true,
      hasTemporal: true,
      categoryCardinality: 4,
      rowCount: 24,
    },
  },
  {
    utterance: 'Show incidents on a map by country.',
    columns: [
      { name: 'country', role: 'geo' },
      { name: 'incidents', role: 'metric' },
    ],
    profile: {
      hasGeo: true,
      hasNumericMetric: true,
      hasMapToken: true,
      hasCategory: false,
      categoryCardinality: 0,
      rowCount: 40,
    },
  },
  {
    utterance: 'Give me the total number of incidents.',
    columns: [{ name: 'incidents', role: 'metric' }],
    profile: {
      hasNumericMetric: true,
      hasCategory: false,
      categoryCardinality: 0,
      rowCount: 4,
    },
  },
];

/** Local `.env` only. Does not override a key already in the environment. */
function loadLocalEnv(): void {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (process.env[name]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[name] = value;
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const apiKey = process.env.TYPESAFE_API_KEY?.trim() ?? '';
  for (const scenario of SCENARIOS) {
    const request = classChoiceRequest({ ...scenario, intent: 'comparison', askNamedChart: true });
    const allowed = offeredChartIds(request);
    console.log('\n---');
    console.log(scenario.utterance);
    console.log('offered:', allowed.join(', '));
    if (!apiKey) {
      console.log(JSON.stringify(request, null, 2));
      continue;
    }
    const response = await askJev(request, apiKey);
    const accepted = acceptReading(response, allowed);
    console.log(
      JSON.stringify(
        {
          intent: response.answers?.intent,
          chart: response.answers?.chart,
          named_chart: response.answers?.named_chart,
          accepted,
        },
        null,
        2,
      ),
    );
  }
  if (!apiKey) {
    console.log('\nNo TYPESAFE_API_KEY. Requests above are ready to paste into the Jev playground or POST /v1/systemone.');
  }
}

const isDirectRun = process.argv[1]?.includes('jev-chart-choice');
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
