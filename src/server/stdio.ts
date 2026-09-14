/**
 * stdio transport: newline-delimited JSON-RPC in, newline-delimited JSON out.
 * Nothing else may be written to stdout — a stray log breaks the frame stream.
 */
import { errorResponse, PARSE_ERROR, type JsonRpcResponse, type McpServer } from './create-server.js';

export type StdioStreams = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
};

/** Stops reading and detaches the listener. */
export type Disconnect = () => void;

export function connectStdio(
  server: McpServer,
  streams: StdioStreams = { input: process.stdin, output: process.stdout },
): Disconnect {
  const { input, output } = streams;
  let buffer = '';
  // One promise chain keeps replies in request order even when a handler awaits.
  let queue: Promise<void> = Promise.resolve();

  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      queue = queue.then(() => dispatch(server, line, output));
      newline = buffer.indexOf('\n');
    }
  };

  input.on('data', onData);
  input.setEncoding?.('utf8');

  return () => {
    input.off?.('data', onData);
    buffer = '';
  };
}

async function dispatch(
  server: McpServer,
  line: string,
  output: NodeJS.WritableStream,
): Promise<void> {
  const text = line.trim();
  if (text === '') return;

  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    write(output, errorResponse(0, PARSE_ERROR, 'Request line is not valid JSON.'));
    return;
  }

  const response = await server.handle(message);
  if (response !== null) write(output, response);
}

function write(output: NodeJS.WritableStream, response: JsonRpcResponse): void {
  output.write(`${JSON.stringify(response)}\n`);
}
