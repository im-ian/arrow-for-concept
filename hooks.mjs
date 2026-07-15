import { readFile } from 'node:fs/promises';
import { transpile } from './forjs.mjs';

export async function load(url, context, next) {
  if (url.endsWith('.forjs')) {
    const src = await readFile(new URL(url), 'utf8');
    return { format: 'module', source: transpile(src), shortCircuit: true };
  }
  return next(url, context);
}
