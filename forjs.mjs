// forjs — `for (start -> end)` 문법 지원 (테스트용)
// 사용: node forjs.mjs <file>   → 트랜스파일 후 실행
//       node forjs.mjs          → self-check
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

// ponytail: regex 치환, 진짜 파서 아님 — 문자열/주석 안의 `->`, f(1) 같은
// 괄호 포함 경계값에서 깨짐. 필요해지면 acorn 기반으로 교체.
export function transpile(src) {
  return src.replace(
    /for\s*\(\s*([^()]+?)\s*->\s*([^()]+?)\s*\)/g,
    'for (let i = $1, _end = $2; i <= _end; i++)',
  );
}

const file = process.argv[2];
if (file) {
  const js = transpile(readFileSync(file, 'utf8'));
  await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
} else {
  assert.equal(
    transpile('for (1 -> 10) {}'),
    'for (let i = 1, _end = 10; i <= _end; i++) {}',
  );
  const out = [];
  eval(transpile('for (1 -> 3) { out.push(i) }'));
  assert.deepEqual(out, [1, 2, 3]);
  const n = 4;
  const out2 = [];
  eval(transpile('for (n - 2 -> n) { out2.push(i) }'));
  assert.deepEqual(out2, [2, 3, 4]);
  console.log('self-check ok');
}
