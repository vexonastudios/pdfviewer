import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = process.cwd();
await mkdir(path.join(root, 'public/pdfjs'), { recursive: true });
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(path.join(root, 'node_modules/pdfjs-dist', directory), path.join(root, 'public/pdfjs', directory), { recursive: true });
}
await mkdir(path.join(root, 'public/ocr/core'), { recursive: true });
await mkdir(path.join(root, 'public/ocr/lang'), { recursive: true });
await cp(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'), path.join(root, 'public/ocr/worker.min.js'));
await cp(path.join(root, 'node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz'), path.join(root, 'public/ocr/lang/eng.traineddata.gz'));
for (const file of await readdir(path.join(root, 'node_modules/tesseract.js-core'))) {
  if (/^tesseract-core.*-lstm\.(wasm|wasm\.js)$/.test(file)) await cp(path.join(root, 'node_modules/tesseract.js-core', file), path.join(root, 'public/ocr/core', file));
}
const svg = await readFile(path.join(root, 'public/icon.svg'), 'utf8');
const images = [16, 24, 32, 48, 64, 128, 256].map(size => ({ size, png: new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng() }));
await writeFile(path.join(root, 'public/app-icon.png'), new Resvg(svg, { fitTo: { mode: 'width', value: 256 } }).render().asPng());
const header = Buffer.alloc(6 + 16 * images.length); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach(({ size, png }, index) => { const start = 6 + index * 16; header[start] = header[start + 1] = size === 256 ? 0 : size; header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6); header.writeUInt32LE(png.length, start + 8); header.writeUInt32LE(offset, start + 12); offset += png.length; });
await writeFile(path.join(root, 'public/app-icon.ico'), Buffer.concat([header, ...images.map(image => image.png)]));
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
  notices.push(`\n${pkg.name} ${pkg.version}\nLicense: ${pkg.license || 'See license text below'}\n${'='.repeat(60)}\n`);
  const files = await readdir(directory);
  for (const file of files.filter(file => /^(licen[cs]e|copying|notice|ofl)(\.|$|-)/i.test(file))) {
    try { notices.push(await readFile(path.join(directory, file), 'utf8')); } catch { /* License folders are not files. */ }
  }
  for (const dependency of Object.keys(pkg.dependencies || {})) await visit(dependency, directory);
}
for (const name of ['react', 'react-dom', 'lucide-react', 'pdfjs-dist', 'pdf-lib', '@pdf-lib/fontkit', 'papaparse', 'jszip', '@fontsource/inter', 'tesseract.js', '@tesseract.js-data/eng']) await visit(name);
await writeFile(path.join(root, 'public/THIRD_PARTY_NOTICES.txt'), notices.join('\n'));
console.log('Prepared offline PDF.js assets and third-party notices.');
