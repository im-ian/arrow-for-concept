// forjs v2 — tokenizer 기반 `for (start -> end)` 트랜스파일러
// 사용: node forjs.mjs <file>   → 트랜스파일 후 실행
//       node forjs.mjs          → self-check
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { pathToFileURL } from 'node:url';

// ── tokenizer ────────────────────────────────────────────────
// 목적에 필요한 만큼만 lexing: 문자열/템플릿/주석/regex 리터럴을
// 통짜 토큰으로 삼켜서 그 안의 `for`, `->`, 괄호가 코드로 오인되지 않게 함.

const REGEX_ALLOWED_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

// `/` 가 나눗셈인지 regex 리터럴 시작인지 직전 토큰으로 판별 (표준 heuristic)
function isRegexAllowed(prev) {
  if (!prev) return true;
  if (prev.type === 'punct') return !')]}'.includes(prev.value); // ponytail: `}` 뒤는 나눗셈 취급
  if (prev.type === 'ident') return REGEX_ALLOWED_KEYWORDS.has(prev.value);
  return false; // number, string, template, regex 뒤는 나눗셈
}

export function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  let braceDepth = 0;
  const templateStack = []; // `${` 진입 시점의 braceDepth 저장

  // 백틱 or `}` 재개 지점부터 템플릿 텍스트를 lexing. `${` 만나면 중단.
  function lexTemplateChunk(start) {
    i = start + 1;
    while (i < n) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') { i++; break; }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        templateStack.push(braceDepth);
        braceDepth = 0;
        break;
      }
      i++;
    }
    toks.push({ type: 'template', start, end: i });
  }

  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      toks.push({ type: 'comment', start, end: i });
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(i + 2, n);
      toks.push({ type: 'comment', start, end: i });
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i;
      i++;
      while (i < n && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      toks.push({ type: 'string', start, end: i });
      continue;
    }
    if (c === '`') { lexTemplateChunk(i); continue; }
    if (c === '{') { toks.push({ type: 'punct', value: '{', start: i, end: ++i }); braceDepth++; continue; }
    if (c === '}') {
      if (braceDepth === 0 && templateStack.length) {
        braceDepth = templateStack.pop();
        lexTemplateChunk(i); // `}` 부터 템플릿 텍스트 재개
        continue;
      }
      braceDepth--;
      toks.push({ type: 'punct', value: '}', start: i, end: ++i });
      continue;
    }
    if (c === '/' && isRegexAllowed(toks.findLast((t) => t.type !== 'comment'))) {
      const start = i;
      i++;
      let inClass = false;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) { i++; break; }
        i++;
      }
      while (i < n && /[a-z]/i.test(src[i])) i++; // flags
      toks.push({ type: 'regex', start, end: i });
      continue;
    }
    if (c === '-' && src[i + 1] === '>') {
      toks.push({ type: 'punct', value: '->', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
      const start = i;
      while (i < n && /[\w.]/.test(src[i])) i++;
      toks.push({ type: 'number', start, end: i });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < n && /[\w$]/.test(src[i])) i++;
      toks.push({ type: 'ident', value: src.slice(start, i), start, end: i });
      continue;
    }
    toks.push({ type: 'punct', value: c, start: i, end: ++i });
  }
  return toks;
}

// ── transform ────────────────────────────────────────────────

const emitHead = (name, start, end) =>
  name === null
    ? // 빈 destructuring 패턴 = 바인딩 0개. Array(n)은 sparse라 실메모리 할당 없음.
      `for (const {} of Array(Math.abs((${start}) - (${end})) + 1).keys())`
    : `for (let ${name} = ${start}, _end = ${end}, _step = ${name} <= _end ? 1 : -1; ` +
      `_step > 0 ? ${name} <= _end : ${name} >= _end; ${name} += _step)`;

export function transpile(src) {
  const toks = tokenize(src).filter((t) => t.type !== 'comment');
  let out = '';
  let cursor = 0;
  for (let ti = 0; ti < toks.length; ti++) {
    const t = toks[ti];
    if (t.type !== 'ident' || t.value !== 'for') continue;
    if (toks[ti + 1]?.value !== '(') continue;
    // 헤드의 닫는 괄호 + top-level `->` 를 토큰 레벨 depth 로 탐색
    let depth = 0;
    let arrow = -1;
    let close = -1;
    for (let j = ti + 1; j < toks.length; j++) {
      const v = toks[j].type === 'punct' ? toks[j].value : null;
      if (v === '(') depth++;
      else if (v === ')') {
        depth--;
        if (depth === 0) { close = j; break; }
      } else if (v === '->' && depth === 1 && arrow === -1) arrow = j;
    }
    if (close === -1 || arrow === -1) continue;
    // optional `let name =` 프리픽스
    let name = null;
    let exprFrom = toks[ti + 1].end;
    const [kw, id, eq] = [toks[ti + 2], toks[ti + 3], toks[ti + 4]];
    if (kw?.value === 'let' && id?.type === 'ident' && eq?.value === '=' && ti + 4 < arrow) {
      name = id.value;
      exprFrom = eq.end;
    }
    const startExpr = src.slice(exprFrom, toks[arrow].start).trim();
    const endExpr = src.slice(toks[arrow].end, toks[close].start).trim();
    out += src.slice(cursor, t.start) + emitHead(name, startExpr, endExpr);
    cursor = toks[close].end;
    ti = close;
  }
  return out + src.slice(cursor);
}

// ── CLI / self-check ─────────────────────────────────────────

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const file = isMain && process.argv[2];
if (file) {
  const js = transpile(readFileSync(file, 'utf8'));
  await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
} else if (isMain) {
  // v1 과 동일한 변환 결과
  assert.equal(
    transpile('for (1 -> 10) {}'),
    'for (const {} of Array(Math.abs((1) - (10)) + 1).keys()) {}',
  );
  assert.equal(
    transpile('for (let max = 1 -> 10) {}'),
    'for (let max = 1, _end = 10, _step = max <= _end ? 1 : -1; ' +
      '_step > 0 ? max <= _end : max >= _end; max += _step) {}',
  );
  // 실행 의미
  const out = [];
  eval(transpile('for (1 -> 3) { out.push(0) }'));
  assert.equal(out.length, 3);
  const out2 = [];
  eval(transpile('for (let k = 2 -> 4) { out2.push(k) }'));
  assert.deepEqual(out2, [2, 3, 4]);
  const out3 = [];
  eval(transpile('for (let d = 5 -> 1) { out3.push(d) }'));
  assert.deepEqual(out3, [5, 4, 3, 2, 1]);
  let leaked = false;
  eval(transpile('for (1 -> 1) { try { _i; leaked = true } catch {} }'));
  assert.equal(leaked, false, 'no internal binding visible in body');
  // v1(regex)이 못 하던 것들
  assert.equal(transpile('const s = "for (1 -> 2)"'), 'const s = "for (1 -> 2)"');
  assert.equal(transpile('// for (1 -> 2)'), '// for (1 -> 2)');
  assert.equal(transpile('const t = `for (1 -> 2) ${x}`'), 'const t = `for (1 -> 2) ${x}`');
  const f = (v) => v + 1;
  const out4 = [];
  eval(transpile('for (let x = f(0) -> f(2)) { out4.push(x) }'));
  assert.deepEqual(out4, [1, 2, 3]);
  const out5 = [];
  eval(transpile('const r = /[)]/; for (1 -> 2) { out5.push(String(r)) }'));
  assert.equal(out5.length, 2, 'regex literal must not confuse paren matching');
  assert.equal(
    transpile('for (let i = 0; i < 3; i++) {}'),
    'for (let i = 0; i < 3; i++) {}',
    'plain for loop untouched',
  );
  console.log('self-check ok');
}
