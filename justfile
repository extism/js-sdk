export PATH := env_var("PATH") + ":" + justfile_directory() + "/node_modules/.bin"

set export := true

_help:
    @just --list

prepare:
    #!/bin/bash
    set -eou pipefail

    if ! &>/dev/null which deno; then
      >&2 echo 'Deno not found. Please install it using the steps described here: https://docs.deno.com/runtime/manual/getting_started/installation'
      exit 1
    fi

    if ! &>/dev/null which node; then
      >&2 echo 'Node not found. Please install the appropriate LTS package from here: https://nodejs.org/'
      exit 1
    fi

    if ! &>/dev/null which jq; then
      >&2 echo 'jq not found. Please install jq (https://jqlang.github.io/jq/) using your favorite package manager.'
      exit 1
    fi

    if [ ! -e node_modules ]; then
      npm ci
    fi

    playwright install --with-deps

_build out args='[]': prepare
    #!/bin/bash
    set -eou pipefail

    if [ -e dist/{{ out }} ]; then
      rm -rf dist/{{ out }}
    fi

    node <<EOF
      const { build } = require("esbuild");

      const args = [{
          sourcemap: true,
          outdir: "dist/{{ out }}",
          bundle: true,
          minify: true,
          drop: [],
      }, ...$args];

      const accValue = key => (acc, xs) => [...(acc[key] ?? []), ...(xs[key] ?? [])]
      const combValue = key => (acc, xs) => ({...(acc[key] ?? {}), ...(xs[key] ?? {})})
      const lastValue = key => (acc, xs) => xs[key] ?? acc[key]

      const combine = {
        entryPoints: accValue('entryPoints'),
        external: accValue('external'),
        alias: combValue('alias'),
        define: combValue('define'),
      }

      const config = args.reduce((acc, xs) => {
        for (var key in xs) {
          const combinator = combine[key] || lastValue(key);
          acc[key] = combinator(acc, xs);
        }
        return acc;
      }, {})

      if (config.platform === 'browser' && config.outdir.startsWith('dist/tests/')) {
        config.plugins = [].concat(config.plugins || [], [
          require('esbuild-node-builtin').nodeBuiltin()
        ]);
      }

      build({
          ...config
      });
    EOF

    # bsd sed vs gnu sed: the former "-i" REQUIRES an argument, the latter
    # REQUIRES not having an argument
    find "dist/{{ out }}" -name '*.js' | if [ $(uname) == 'Darwin' ]; then
      xargs -I{} sed -i '' -e '/^((ex|im)port|} from)/s/.ts"/.js"/g' '{}'
    else
      xargs -I{} sed -i -e '/^((ex|im)port|} from)/s/.ts"/.js"/g' '{}'
    fi

    # build types (TODO: switch module target based on incoming args)
    tsc --emitDeclarationOnly --project ./tsconfig.json --declaration --outDir dist/{{ out }}

build_worker out args='[]':
    #!/bin/bash
    config="$(<<<'{{ args }}' jq -cM '
      [{
        "entryPoints": ["src/worker.ts"],
        "bundle": true,
        "minify": true,
        "format": "esm"
      }] + .
    ')"
    just _build {{ out }} "$config"

    if [ $(uname) == 'Darwin' ]; then
      flag="-b"
    else
      flag="-w"
    fi

    echo "export const WORKER_URL = new URL($(
      <dist/{{ out }}/worker.js base64 ${flag} 0 |
      jq -cMRS '"data:text/javascript;base64," + .'
    ));" > dist/{{ out }}/worker-url.ts

build_worker_node out='worker/node' args='[]':
    #!/bin/bash
    config="$(<<<'{{ args }}' jq -cM '
      [{
        "platform": "node",
        "alias": {
          "js-sdk:capabilities": "./src/polyfills/node-capabilities.ts",
          "js-sdk:fs": "node:fs",
          "js-sdk:wasi": "./src/polyfills/node-wasi.ts",
        }
      }] + .
    ')"
    just build_worker {{ out }} "$config"

build_worker_browser out='worker/browser' args='[]':
    #!/bin/bash
    config="$(<<<'{{ args }}' jq -cM '
      [{
        "format": "esm",
        "alias": {
          "js-sdk:capabilities": "./src/polyfills/browser-capabilities.ts",
          "node:worker_threads": "./src/polyfills/worker-node-worker_threads.ts",
          "js-sdk:fs": "./src/polyfills/browser-fs.ts",
          "js-sdk:wasi": "./src/polyfills/browser-wasi.ts",
        }
      }] + .
    ')"
    just build_worker {{ out }} "$config"

build_node_cjs out='cjs' args='[]':
    #!/bin/bash
    config="$(<<<'{{ args }}' jq -cM '
      [{
        "entryPoints": ["src/mod.ts"],
        "platform": "node",
        "minify": false,
        "alias": {
          "js-sdk:capabilities": "./src/polyfills/node-capabilities.ts",
          "js-sdk:response-to-module": "./src/polyfills/response-to-module.ts",
          "js-sdk:minimatch": "./src/polyfills/node-minimatch.ts",
          "js-sdk:worker-url": "./dist/worker/node/worker-url.ts",
          "js-sdk:fs": "node:fs/promises",
          "js-sdk:wasi": "./src/polyfills/node-wasi.ts",
        },
        "define": {
          "import.meta.url": "__filename"
        }
      }] + .
    ')"
    just _build {{ out }} "$config"
    echo '{"type":"commonjs"}' > dist/{{ out }}/package.json
    cat > dist/{{ out }}/index.js <<EOF
      const mod = require('./mod.js')
      module.exports = Object.assign(mod.default, mod)
    EOF

    cat > dist/{{ out }}/index.d.ts <<EOF
      export * from './mod.d.ts'
    EOF

build_node_esm out='esm' args='[]':
    #!/bin/bash
    config="$(<<<'{{ args }}' jq -cM '
      [{
        "entryPoints": ["src/mod.ts"],
        "platform": "node",
        "format": "esm",
        "minify": false,
        "alias": {
          "js-sdk:capabilities": "./src/polyfills/node-capabilities.ts",
          "js-sdk:response-to-module": "./src/polyfills/response-to-module.ts",
          "js-sdk:minimatch": "./src/polyfills/node-minimatch.ts",
          "js-sdk:worker-url": "./dist/worker/node/worker-url.ts",
          "js-sdk:fs": "node:fs/promises",
          "js-sdk:wasi": "./src/polyfills/node-wasi.ts",
        }
      }] + .
    ')"
    just _build {{ out }} "$config"
    echo '{"type":"module"}' > dist/{{ out }}/package.json

build_bun out='bun' args='[]':
    #!/bin/bash
    config="$(<<<'{{ args }}' jq -cM '
      [{
        "entryPoints": ["src/mod.ts", "src/worker.ts"],
        "platform": "node",
        "format": "esm",
        "minify": false,
        "alias": {
          "js-sdk:worker-url": "./src/polyfills/bun-worker-url.ts",
          "js-sdk:response-to-module": "./src/polyfills/bun-response-to-module.ts",
          "js-sdk:minimatch": "./src/polyfills/node-minimatch.ts",
          "js-sdk:capabilities": "./src/polyfills/bun-capabilities.ts",
          "js-sdk:fs": "node:fs/promises",
          "js-sdk:wasi": "./src/polyfills/node-wasi.ts",
        }
      }] + .
    ')"
    just _build {{ out }} "$config"
    echo '{"type":"module"}' > dist/{{ out }}/package.json

build_browser out='browser' args='[]':
    #!/bin/bash
    config="$(<<<'{{ args }}' jq -cM '
      [{
        "entryPoints": ["src/mod.ts"],
        "platform": "browser",
        "define": {"global": "globalThis"},
        "format": "esm",
        "alias": {
          "js-sdk:capabilities": "./src/polyfills/browser-capabilities.ts",
          "js-sdk:response-to-module": "./src/polyfills/response-to-module.ts",
          "js-sdk:minimatch": "./src/polyfills/node-minimatch.ts",
          "node:worker_threads": "./src/polyfills/host-node-worker_threads.ts",
          "js-sdk:fs": "./src/polyfills/browser-fs.ts",
          "js-sdk:worker-url": "./dist/worker/browser/worker-url.ts",
          "js-sdk:wasi": "./src/polyfills/browser-wasi.ts",
        }
      }] + .
    ')"
    just _build {{ out }} "$config"
    echo '{"type":"module"}' > dist/{{ out }}/package.json

_build_node_tests:
    just build_node_cjs 'tests/cjs' '[{"minify": false, "entryPoints":["src/mod.test.ts"]}]'
    just build_node_esm 'tests/esm' '[{"minify": false, "entryPoints":["src/mod.test.ts"]}]'

_build_bun_tests:
    just build_bun 'tests/bun' '[{"minify": false, "entryPoints":["src/mod.test.ts"], "alias": {"node:test": "tape"}}]'

_build_browser_tests out='tests/browser' args='[]':
    #!/bin/bash
    config="$(<<<'{{ args }}' jq -cM '
      [{
        "entryPoints": ["src/mod.test.ts"],
        "alias": {
          "node:test": "tape"
        },
        "minify": false
      }] + .
    ')"
    just build_browser {{ out }} "$config"
    echo '{"type":"module"}' > dist/{{ out }}/package.json
    echo '<html><script type="module" src="/dist/{{ out }}/mod.test.js"></script></html>' > dist/{{ out }}/index.html

build: prepare build_worker_node build_worker_browser build_browser build_node_esm build_node_cjs build_bun _build_browser_tests _build_node_tests _build_bun_tests
    npm pack --pack-destination dist/

test: build && test-artifacts
    #!/bin/bash
    set -eou pipefail
    just serve 8124 false &
    cleanup() {
      &>/dev/null curl http://localhost:8124/quit
    }
    trap cleanup EXIT
    trap cleanup ERR

    sleep 0.5
    deno test -A src/mod.test.ts
    node --no-warnings --test --experimental-global-webcrypto dist/tests/cjs/*.test.js
    node --no-warnings --test --experimental-global-webcrypto dist/tests/esm/*.test.js
    if &>/dev/null which bun; then bun run dist/tests/bun/*.test.js; fi
    playwright test --browser all tests/playwright.test.js

test-artifacts:
    #!/bin/bash
    set -eou pipefail
    rm -rf tests/artifacts
    mkdir -p tests/artifacts
    cd tests/artifacts
    npm init --yes
    npm i ../../dist/extism*.tgz
    node --no-warnings <<EOF
      const assert = require('assert')
      const extism = require('@extism/extism')
      assert(typeof extism === 'function')

      async function main() {
        const plugin = await extism('../../wasm/hello.wasm')
        try {
          const text = new TextDecoder().decode(
            await plugin.call('run_test', 'this is a test')
          )
          assert.equal(text, 'Hello, world!')
        } finally {
          await plugin.close()
        }
      }
      main().catch(err => {
        console.error(err)
        process.exit(1)
      })
    EOF

    cat >./index.js <<EOF
      import extism from '@extism/extism'
      import assert from 'node:assert'

      const plugin = await extism('../../wasm/hello.wasm')
      try {
        const text = new TextDecoder().decode(
          await plugin.call('run_test', 'this is a test')
        )
        assert.equal(text, 'Hello, world!')
      } finally {
        await plugin.close()
      }
    EOF

    node --input-type=module --no-warnings <index.js
    if &>/dev/null which bun; then bun run index.js; fi

lint *args:
    eslint src tests examples $args

format:
    prettier --write src/*.ts src/**/*.ts examples/*

docs:
    typedoc src/mod.ts

serve-docs: docs
  python3 -m http.server 8000 -d docs/

watch-docs: prepare
  watchexec -r -w types -w src -w README.md just serve-docs

serve port='8124' logs='true':
    #!/usr/bin/env node

    const http = require('http')
    const fs = require('fs/promises');
    const path = require('path');
    const server = http.createServer().listen({{ port }}, console.log);
    server.on('request', async (req, res) => {
      let statusCode = 200
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin'
      }

      const url = new URL(req.url, 'http://localhost:{{port}}');

      if (url.pathname === '/quit') {
        server.close()
      }

      let body = await fs.readFile(url.pathname.slice(1)).catch(err => {
        if (err.code === 'EISDIR') {
          url.pathname = path.join(url.pathname, 'index.html')
          return fs.readFile(url.pathname.slice(1))
        }
        return null
      }).catch(() => null);

      if (!body) {
        headers['content-type'] = 'text/html'
        statusCode = 404
        body = '<html>not here sorry</html>'
      } else switch (path.extname(url.pathname)) {
        case '.html': headers['content-type'] = 'text/html'; break
        case '.wasm': headers['content-type'] = 'application/wasm'; break
        case '.json': headers['content-type'] = 'application/json'; break
        case '.js': headers['content-type'] = 'text/javascript'; break
      }

      if ({{ logs }}) {
        console.log(statusCode, url.pathname, body.length)
      }

      headers['content-length'] = body.length
      res.writeHead(statusCode, headers);
      res.end(body);
    });
