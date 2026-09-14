import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createServer, type ShowWorkspaceHandler } from './create-server.js';
import { connectStdio } from './stdio.js';

const stubHandler: ShowWorkspaceHandler = (args) => ({ ok: true, summary: 'stub', args });

type Harness = {
  send: (message: unknown) => void;
  raw: (line: string) => void;
  lines: (count: number) => Promise<Array<Record<string, unknown>>>;
  disconnect: () => void;
};

function harness(handler: ShowWorkspaceHandler = stubHandler): Harness {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = createServer(handler, { description: 'stub' });
  const disconnect = connectStdio(server, { input, output });

  const received: Array<Record<string, unknown>> = [];
  const waiters: Array<() => void> = [];
  let buffer = '';
  output.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      received.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
    waiters.splice(0).forEach((resolve) => resolve());
  });

  return {
    send: (message: unknown) => input.write(`${JSON.stringify(message)}\n`),
    raw: (line: string) => input.write(line),
    lines: async (count: number) => {
      while (received.length < count) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      return received;
    },
    disconnect,
  };
}

describe('connectStdio', () => {
  it('answers tools/list with one tool over the stream', async () => {
    const io = harness();

    io.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const [response] = await io.lines(1);

    const tools = (response.result as { tools: Array<{ name: string }> }).tools;
    expect(tools).toEqual([{ name: 'show_workspace', description: 'stub', inputSchema: { type: 'object' } }]);
    io.disconnect();
  });

  it('frames one response per line, in request order', async () => {
    const io = harness();

    io.send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    io.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    io.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const lines = await io.lines(2);

    expect(lines.map((line) => line.id)).toEqual([1, 2]);
    io.disconnect();
  });

  it('keeps replies ordered when a handler resolves out of order', async () => {
    const delays = [20, 0];
    let call = 0;
    const io = harness(async () => {
      const wait = delays[call++] ?? 0;
      await new Promise((resolve) => setTimeout(resolve, wait));
      return { call };
    });

    io.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'show_workspace' } });
    io.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'show_workspace' } });
    const lines = await io.lines(2);

    expect(lines.map((line) => line.id)).toEqual([1, 2]);
    io.disconnect();
  });

  it('handles a request split across chunks', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const disconnect = connectStdio(createServer(stubHandler), { input, output });

    const line = new Promise<Record<string, unknown>>((resolve) => {
      output.once('data', (chunk: Buffer) => resolve(JSON.parse(chunk.toString('utf8'))));
    });
    input.write('{"jsonrpc":"2.0","id":7,"me');
    input.write('thod":"tools/list"}\n');

    expect((await line).id).toBe(7);
    disconnect();
  });

  it('answers a malformed line with a parse error and keeps the session', async () => {
    const io = harness();

    io.raw('not json\n');
    io.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const lines = await io.lines(2);

    expect((lines[0].error as { code: number }).code).toBe(-32700);
    expect(lines[1].id).toBe(2);
    io.disconnect();
  });

  it('ignores blank lines', async () => {
    const io = harness();

    io.raw('\n   \n');
    io.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const lines = await io.lines(1);

    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe(1);
    io.disconnect();
  });
});
