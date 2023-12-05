export function setPinoWorkerPaths() {
  globalThis.__bundlerPathsOverrides = {
    'thread-stream-worker': './thread-stream-worker.js',
    'pino/file': './pino-file.js',
    'pino-worker': './pino-worker.js',
    'pino-pipeline-worker': './pino-pipeline-worker.js',
    'pino-pretty': './pino-pretty.js',
  };
}
