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
      const path = require("path");

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
        polyfills: combValue('polyfills'),
        define: combValue('define'),
      }

      const resolved = args.reduce((acc, xs) => {
        for (var key in xs) {
          const combinator = combine[key] || lastValue(key);
          acc[key] = combinator(acc, xs);
        }
        return acc;
      }, {})

      const { polyfills, ...config } = resolved;

      config.plugins = [{
        name: 'resolve',
        setup (build) {
          const items = Object.keys(polyfills).map(xs => xs.replace(/\./g, '\\.').replace(/\//g, '\\/'));
          build.onResolve({ namespace: 'file', filter: /^\..*\.ts\$/g }, async args => {
            if (!args.path.startsWith('.')) {
              return { path: args.path, external: true }
            }

            const resolved = path.resolve(args.resolveDir, args.path)
            const replaced = resolved.replace(process.cwd(), '.').replaceAll(path.sep, path.posix.sep)

            if (!(replaced in polyfills)) {
              return { path: path.resolve(args.resolveDir, args.path) }
            }

            const result = polyfills[replaced]
            if (result[0] === '.') {
              return { path: path.resolve(result) }
            }

            return { path: result, external: true }
          })
        } 
      }];


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
    tsc --emitDeclarationOnly --module esnext --project ./tsconfig.json --declaration --outDir dist/{{ out }}

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
        "polyfills": {
          "./src/polyfills/deno-capabilities.ts": "./src/polyfills/node-capabilities.ts",
          "./src/polyfills/node-fs.ts": "node:fs/promises",
          "./src/polyfills/deno-wasi.ts": "./src/polyfills/node-wasi.ts",
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
          "node:worker_threads": "./src/polyfills/worker-node-worker_threads.ts"
        },
        "polyfills": {
          "./src/polyfills/deno-capabilities.ts": "./src/polyfills/browser-capabilities.ts",
          "./src/polyfills/node-fs.ts": "./src/polyfills/browser-fs.ts",
          "./src/polyfills/deno-wasi.ts": "./src/polyfills/browser-wasi.ts",
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
        "polyfills": {
          "./src/polyfills/deno-capabilities.ts": "./src/polyfills/node-capabilities.ts",
          "./src/polyfills/deno-minimatch.ts": "./src/polyfills/node-minimatch.ts",
          "./src/worker-url.ts": "./dist/worker/node/worker-url.ts",
          "./src/polyfills/node-fs.ts": "node:fs/promises",
          "./src/polyfills/deno-wasi.ts": "./src/polyfills/node-wasi.ts",
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
        "polyfills": {
          "./src/polyfills/deno-capabilities.ts": "./src/polyfills/node-capabilities.ts",
          "./src/polyfills/deno-minimatch.ts": "./src/polyfills/node-minimatch.ts",
          "./src/worker-url.ts": "./dist/worker/node/worker-url.ts",
          "./src/polyfills/node-fs.ts": "node:fs/promises",
          "./src/polyfills/deno-wasi.ts": "./src/polyfills/node-wasi.ts",
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
        "polyfills": {
          "./src/worker-url.ts": "./src/polyfills/bun-worker-url.ts",
          "./src/polyfills/response-to-module.ts": "./src/polyfills/bun-response-to-module.ts",
          "./src/polyfills/deno-minimatch.ts": "./src/polyfills/node-minimatch.ts",
          "./src/polyfills/deno-capabilities.ts": "./src/polyfills/bun-capabilities.ts",
          "./src/polyfills/node-fs.ts": "node:fs/promises",
          "./src/polyfills/deno-wasi.ts": "./src/polyfills/node-wasi.ts",
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
          "node:worker_threads": "./src/polyfills/host-node-worker_threads.ts"
        },
        "polyfills": {
          "./src/polyfills/deno-capabilities.ts": "./src/polyfills/browser-capabilities.ts",
          "./src/polyfills/deno-minimatch.ts": "./src/polyfills/node-minimatch.ts",
          "./src/polyfills/node-fs.ts": "./src/polyfills/browser-fs.ts",
          "./src/worker-url.ts": "./dist/worker/browser/worker-url.ts",
          "./src/polyfills/deno-wasi.ts": "./src/polyfills/browser-wasi.ts",
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

_test:
    #!/bin/bash
    set -eou pipefail
    just serve 8124 false &
    cleanup() {
      &>/dev/null curl http://localhost:8124/quit
    }
    trap cleanup EXIT
    trap cleanup ERR

    sleep 0.1
    deno test -A src/mod.test.ts
    node --no-warnings --test --experimental-global-webcrypto dist/tests/cjs/*.test.js
    node --no-warnings --test --experimental-global-webcrypto dist/tests/esm/*.test.js
    if &>/dev/null which bun; then bun run dist/tests/bun/*.test.js; fi
    playwright test --browser all tests/playwright.test.js --trace retain-on-failure

test: build && _test test-artifacts

bake:
    while just _test; do true; done

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
    # if &>/dev/null which bun; then bun run index.js; fi

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
