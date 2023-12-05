import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

export function copyWorkers() {
  return {
    name: 'copy-worker',
    load() {
      this.addWatchFile(resolve('./node_modules/pino/lib/worker.js'));
      this.addWatchFile(resolve('./node_modules/pino/lib/worker-pipeline.js'));
      this.addWatchFile(resolve('./node_modules/pino/file.js'));
      this.addWatchFile(resolve('./node_modules/thread-stream/lib/worker.js'));
      this.addWatchFile(resolve('./node_modules/@salesforce/core/lib/logger/transformStream.js'));
    },
    closeBundle() {
      console.debug('ff', existsSync('./node_modules/pino/lib/worker.js'));
      console.debug('ff', existsSync('./lana/out/worker.js'));

      mkdirSync('./lana/out', { recursive: true });

      copyFileSync(
        resolve('./node_modules/@salesforce/core/lib/logger/transformStream.js'),
        resolve('./lana/out/transformStream.js'),
      );

      copyFileSync(
        resolve('./node_modules/pino/lib/worker.js'),
        resolve('./lana/out/pino-worker.js'),
      );

      copyFileSync(
        resolve('./node_modules/pino/lib/worker-pipeline.js'),
        resolve('./lana/out/pino-pipeline-worker.js'),
      );

      copyFileSync(resolve('./node_modules/pino/file.js'), resolve('./lana/out/pino-file.js'));

      copyFileSync(
        resolve('./node_modules/thread-stream/lib/worker.js'),
        resolve('./lana/out/thread-stream-worker.js'),
      );
    },
  };
}
