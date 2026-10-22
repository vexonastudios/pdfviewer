import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.cwd();
await mkdir(path.join(root, 'public/pdfjs'), { recursive: true });
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(path.join(root, 'node_modules/pdfjs-dist', directory), path.join(root, 'public/pdfjs', directory), { recursive: true });
}
const notices = ['Paperdesk PDF — third-party software notices\n'];
const visited = new Set();
async function visit(name, parent = root) {
  const require = createRequire(path.join(parent, 'package.json'));
  const directory = (require.resolve.paths(name) || []).map(base => path.join(base, name)).find(candidate => {
    try { require(path.join(candidate, 'package.json')); return true; } catch { return false; }
  });
  if (!directory || visited.has(directory)) return;
  visited.add(directory);
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  notices.push(`\n${pkg.name} ${pkg.version}\n${'='.repeat(60)}\n`);
  const files = await readdir(directory);
  for (const file of files.filter(file => /^(licen[cs]e|copying|notice|ofl)(\.|$|-)/i.test(file))) {
    try { notices.push(await readFile(path.join(directory, file), 'utf8')); } catch { /* License folders are not files. */ }
  }
  for (const dependency of Object.keys(pkg.dependencies || {})) await visit(dependency, directory);
}
for (const name of ['react', 'react-dom', 'lucide-react', 'pdfjs-dist', 'pdf-lib', '@pdf-lib/fontkit', 'papaparse', 'jszip', '@fontsource/inter']) await visit(name);
await writeFile(path.join(root, 'public/THIRD_PARTY_NOTICES.txt'), notices.join('\n'));
console.log('Prepared offline PDF.js assets and third-party notices.');
