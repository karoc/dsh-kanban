/**
 * Self-contained tsdown config for the external kanban bundle. Mirrors the
 * repository's `packages/client/tsdown.client.ts` essentials so the built
 * `lib/client.js` speaks the loader's module-table contract
 * (`window.__ModuleLoader__.load({ id, factory })`), with the platform packages
 * left external (resolved at runtime from the frozen module table) and
 * everything else inlined. The node half keeps its DSH host imports external
 * too — they resolve from the profile's node_modules at load time.
 */

import { defineConfig } from 'tsdown'

const ID = 'dsh-kanban'

/** Externals answered by the loader module table (platform seed + runtime store exemption). */
const CLIENT_EXTERNALS: readonly string[] = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-connection/client',
  '@deepseek-ai/dsh-client-locale/client',
]

/** Node-half library entry (host apply: board tools + /kanban/api route). */
const node = {
  name: ID,
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools'],
  },
}

/** Browser client bundle served at /plugins/dsh-kanban/client.js. */
const client = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([node, client])
