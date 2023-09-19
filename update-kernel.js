const fs = require("fs")
const crypto = require("crypto")

async function main() {
  const pluginPath = 'src/plugin.ts'
  let pluginContents = await fs.promises.readFile(pluginPath, 'utf8');

  const kernelPath = 'wasm/extism-runtime.wasm'
  const kernelBase64 = (await fs.promises.readFile(kernelPath)).toString('base64');
  const kernelHash = await crypto.createHash('sha256').update(kernelPath).digest('hex');

  pluginContents = pluginContents.replace(/embeddedRuntime =\s*'.*'/, `embeddedRuntime =\n\t'${kernelBase64}'`);
  pluginContents = pluginContents.replace(/embeddedRuntimeHash =\s*'.*''/, `embeddedRuntimeHash = '${kernelHash}'`);

  await fs.promises.writeFile(pluginPath, pluginContents);
}

main();