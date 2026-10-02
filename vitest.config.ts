import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        root: here('./log-viewer'),
        resolve: {
          alias: [
            {
              find: /^#test-helpers\/(.*)\.js$/,
              replacement: here('./log-viewer/src/__tests__/helpers/$1.ts'),
            },
            {
              find: /^#vscode-elements\/(?!vscode-single-select\.js$).*$/,
              replacement: here('./log-viewer/src/__tests__/mocks/emptyModule.ts'),
            },
            // Jest applied this __mocks__ file to every suite on its own; vitest needs it named.
            {
              find: /^tabulator-tables$/,
              replacement: here('./log-viewer/src/tabulator/module/__mocks__/tabulator-tables.ts'),
            },
          ],
        },
        test: {
          name: 'log-viewer',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          setupFiles: ['src/__tests__/setup.ts'],
        },
      },
      {
        root: here('./lana'),
        resolve: {
          alias: [{ find: /^vscode$/, replacement: here('./lana/src/__tests__/mocks/vscode.ts') }],
        },
        test: {
          name: 'lana',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['test/**', 'out/**', 'node_modules/**'],
          setupFiles: ['src/__tests__/setup.ts'],
        },
      },
    ],
  },
});
