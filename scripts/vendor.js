// Bundles third-party browser dependencies into www/vendor so the app runs
// without any CDN at runtime (only the Whisper model weights are downloaded once).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, 'www', 'vendor');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'ort'), { recursive: true });

const common = { bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, logLevel: 'warning', legalComments: 'none' };

writeFileSync(join(root, 'scripts', '.anthropic-entry.js'), "export { default } from '@anthropic-ai/sdk';\n");
await build({ ...common, entryPoints: [join(root, 'scripts', '.anthropic-entry.js')], outfile: join(out, 'anthropic.js') });
rmSync(join(root, 'scripts', '.anthropic-entry.js'));

await build({
  ...common,
  entryPoints: [join(root, 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.web.js')],
  outfile: join(out, 'transformers.js'),
  external: ['fs', 'path', 'url', 'sharp', 'onnxruntime-node'],
});

const ortDist = join(root, 'node_modules', 'onnxruntime-web', 'dist');
for (const f of readdirSync(ortDist)) {
  if (/^ort-wasm-simd-threaded\.(jsep|asyncify)?\.?(mjs|wasm)$/.test(f) || /^ort-wasm-simd-threaded\.(mjs|wasm)$/.test(f)) {
    cpSync(join(ortDist, f), join(out, 'ort', f));
  }
}
console.log('vendor: ok ->', readdirSync(out).join(', '), '| ort:', readdirSync(join(out, 'ort')).join(', '));
