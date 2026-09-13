import fs from 'node:fs';

const file = process.argv[2] ?? 'selfUpdatingWeb.html';
const html = fs.readFileSync(file, 'utf8');
const required = ['<!doctype html>', '<html', '</html>', '<head>', '</head>', '<body>', '</body>'];
const missing = required.filter((marker) => !html.toLowerCase().includes(marker));

if (missing.length > 0) {
  console.error(`Missing HTML markers: ${missing.join(', ')}`);
  process.exit(1);
}

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
for (const [index, match] of scripts.entries()) {
  const tempFile = `.html-script-${process.pid}-${index}.mjs`;
  try {
    fs.writeFileSync(tempFile, match[1]);
    const source = fs.readFileSync(tempFile, 'utf8');
    new Function(source);
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
}

console.log(`${file}: valid document structure and ${scripts.length} embedded script(s).`);
