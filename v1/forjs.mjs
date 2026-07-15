// forjs — `for (start -> end)` 문법 지원 (테스트용)
// 사용: node forjs.mjs <file>   → 트랜스파일 후 실행
//       node forjs.mjs          → self-check
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { pathToFileURL } from 'node:url';

// ponytail: regex 치환, 진짜 파서 아님 — 문자열/주석 안의 `->`, f(1) 같은
// 괄호 포함 경계값에서 깨짐. 필요해지면 acorn 기반으로 교체.
export function transpile(src) {
  return src.replace(
    /for\s*\(\s*(?:let\s+([A-Za-z_$][\w$]*)\s*=\s*)?([^()=]+?)\s*->\s*([^()]+?)\s*\)/g,
    (_, name, start, end) =>
      name === undefined
        ? // 빈 destructuring 패턴 = 바인딩 0개, body에서 접근 가능한 변수 없음.
          // Array(n)은 sparse라 큰 범위도 실메모리 할당 없음.
          `for (const {} of Array(Math.abs((${start}) - (${end})) + 1).keys())`
        : `for (let ${name} = ${start}, _end = ${end}, _step = ${name} <= _end ? 1 : -1; ` +
          `_step > 0 ? ${name} <= _end : ${name} >= _end; ${name} += _step)`,
  );
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const file = isMain && process.argv[2];
if (file) {
  const js = transpile(readFileSync(file, 'utf8'));
  await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
} else if (isMain) {
  assert.equal(
    transpile('for (1 -> 10) {}'),
    'for (const {} of Array(Math.abs((1) - (10)) + 1).keys()) {}',
  );
  const out = [];
  eval(transpile('for (1 -> 3) { out.push(0) }'));
  assert.equal(out.length, 3);
  let leaked = false;
  eval(transpile('for (1 -> 1) { try { _i; leaked = true } catch {} }'));
  assert.equal(leaked, false, 'no internal binding visible in body');
  const n = 4;
  const out2 = [];
  eval(transpile('for (let j = n - 2 -> n) { out2.push(j) }'));
  assert.deepEqual(out2, [2, 3, 4]);
  assert.equal(
    transpile('for (let max = 1 -> 10) {}'),
    'for (let max = 1, _end = 10, _step = max <= _end ? 1 : -1; ' +
      '_step > 0 ? max <= _end : max >= _end; max += _step) {}',
  );
  const out3 = [];
  eval(transpile('for (let k = 2 -> 4) { out3.push(k) }'));
  assert.deepEqual(out3, [2, 3, 4]);
  const out4 = [];
  eval(transpile('for (let d = 5 -> 1) { out4.push(d) }'));
  assert.deepEqual(out4, [5, 4, 3, 2, 1]);
  console.log('self-check ok');
}
