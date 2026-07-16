// xjs — AST 기반 JS 문법 확장 트랜스파일러
// 문법: `for (start -> end)` 범위 루프, `match v { pat => expr ... }` 표현식
// acorn 파서 플러그인으로 문법 확장 → 커스텀 AST 노드 → astring codegen
// 사용: node xjs.mjs <file>   → 트랜스파일 후 실행
//       node xjs.mjs          → self-check
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { pathToFileURL } from 'node:url';
import { Parser, TokenType, tokTypes as tt } from 'acorn';
import { generate, GENERATOR } from 'astring';

// ── parser plugin ────────────────────────────────────────────

const arrowRange = new TokenType('->', { beforeExpr: true });

// `match` 는 예약어가 아니므로 뒤에 표현식 시작 토큰(식별자/리터럴)이 올 때만 키워드 취급.
// `(` 는 제외 → `match(x)` 는 평범한 함수 호출로 남는다.
const MATCH_HEAD = /^\s*(?:[\p{L}\p{Nl}$_0-9]|['"`])/u;

const XjsParser = Parser.extend(
  (P) =>
    class extends P {
      getTokenFromCode(code) {
        // `-` 뒤가 `>` 면 커스텀 토큰. `-->` 는 pos+1 이 `-` 라 여기 안 걸림 (`a-- > b` 유지)
        if (code === 45 && this.input.charCodeAt(this.pos + 1) === 62) {
          this.pos += 2;
          return this.finishToken(arrowRange);
        }
        return super.getTokenFromCode(code);
      }

      // acorn 의 parseForStatement 는 init 파싱 후 일반 C-style 이면 parseFor 로 넘어옴.
      // 그 시점에 `->` 토큰이면 range 문법으로 분기, 아니면 원래 동작.
      parseFor(node, init) {
        if (this.type === arrowRange) {
          this.next();
          node.init = init; // bare: Expression, named: VariableDeclaration
          node.rangeEnd = this.parseExpression();
          this.expect(tt.parenR);
          node.body = this.parseStatement('for');
          this.exitScope();
          this.labels.pop();
          return this.finishNode(node, 'ForRangeStatement');
        }
        return super.parseFor(node, init);
      }

      parseExprAtom(refDestructuringErrors, forInit, forNew) {
        if (
          this.type === tt.name &&
          this.value === 'match' &&
          !this.containsEsc &&
          MATCH_HEAD.test(this.input.slice(this.end))
        ) {
          return this.parseMatchExpression();
        }
        return super.parseExprAtom(refDestructuringErrors, forInit, forNew);
      }

      // match disc { pat => expr [,] ... } — 패턴을 parseMaybeConditional 로 파싱해서
      // `_ => x` 가 화살표 함수로 흡수되지 않게 함 (arrow 인식은 parseMaybeAssign 진입 시점에만 켜짐).
      parseMatchExpression() {
        const node = this.startNode();
        this.next(); // `match` 소비
        node.discriminant = this.parseMaybeConditional(false);
        this.expect(tt.braceL);
        node.arms = [];
        while (!this.eat(tt.braceR)) {
          const arm = this.startNode();
          arm.test = this.parseMaybeConditional(false);
          this.expect(tt.arrow);
          arm.consequent = this.parseMaybeAssign(false);
          this.eat(tt.comma); // arm 사이 콤마는 선택
          node.arms.push(this.finishNode(arm, 'MatchArm'));
        }
        return this.finishNode(node, 'MatchExpression');
      }
    },
);

export function parse(src) {
  return XjsParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
}

// ── codegen ──────────────────────────────────────────────────

const xjsGenerator = {
  ...GENERATOR,
  ForRangeStatement(node, state) {
    const emit = (expr) => this[expr.type](expr, state);
    if (node.init.type === 'VariableDeclaration') {
      const { id, init } = node.init.declarations[0];
      const name = id.name;
      state.write(`for (let ${name} = (`);
      emit(init);
      state.write('), _end = (');
      emit(node.rangeEnd);
      state.write(
        `), _step = ${name} <= _end ? 1 : -1; ` +
          `_step > 0 ? ${name} <= _end : ${name} >= _end; ${name} += _step) `,
      );
    } else {
      // 빈 destructuring 패턴 = 바인딩 0개. Array(n)은 sparse라 실메모리 할당 없음.
      state.write('for (const {} of Array(Math.abs((');
      emit(node.init);
      state.write(') - (');
      emit(node.rangeEnd);
      state.write(')) + 1).keys()) ');
    }
    this[node.body.type](node.body, state);
  },
  MatchExpression(node, state) {
    const emit = (expr) => this[expr.type](expr, state);
    // ponytail: 화살표 IIFE + switch. `this` 는 유지되지만 arm 안에서 `await`/`yield` 불가 —
    // 필요해지면 do-expression 스타일 임시변수 hoisting 으로 교체.
    state.write('(() => { switch (');
    emit(node.discriminant);
    state.write(') {');
    let hasWildcard = false;
    for (const arm of node.arms) {
      if (arm.test.type === 'Identifier' && arm.test.name === '_') {
        hasWildcard = true;
        state.write(' default: return ');
      } else {
        state.write(' case ');
        emit(arm.test);
        state.write(': return ');
      }
      emit(arm.consequent);
      state.write(';');
    }
    // `_` 없이 어떤 arm 도 안 맞으면 undefined 대신 명시적 에러 (Rust match 의 non-exhaustive 유사)
    if (!hasWildcard) state.write(' default: throw new TypeError("match: no arm matched");');
    state.write(' } })()');
  },
};

export function transpile(src) {
  return generate(parse(src), { generator: xjsGenerator });
}

// ── CLI / self-check ─────────────────────────────────────────

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const file = isMain && process.argv[2];
if (file) {
  const js = transpile(readFileSync(file, 'utf8'));
  await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
} else if (isMain) {
  // 변환 형태 (AST 재생성이라 v2 처럼 문자열 완전 일치 대신 구조 확인)
  assert.match(transpile('for (1 -> 10) {}'), /const \{\} of Array\(Math\.abs/);
  assert.match(transpile('for (let i = 1 -> 10) {}'), /let i = \(1\), _end = \(10\)/);
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
  // 문자열/템플릿/regex 리터럴은 acorn 이 정확히 구분
  assert.ok(transpile('const s = "for (1 -> 2)";').includes('"for (1 -> 2)"'));
  assert.ok(transpile('const t = `for (1 -> 2) ${x}`;').includes('for (1 -> 2) ${'));
  const out4 = [];
  eval(transpile('const r = /[)]/; for (1 -> 2) { out4.push(String(r)) }'));
  assert.equal(out4.length, 2);
  // 괄호 포함 경계값
  const f = (v) => v + 1;
  const out5 = [];
  eval(transpile('for (let x = f(0) -> f(2)) { out5.push(x) }'));
  assert.deepEqual(out5, [1, 2, 3]);
  // 일반 for 는 의미 보존
  const out6 = [];
  eval(transpile('for (let i = 0; i < 3; i++) { out6.push(i) }'));
  assert.deepEqual(out6, [0, 1, 2]);
  // `a-- > b` 가 `->` 로 오인되지 않음
  const out7 = [];
  eval(transpile('let a = 2; while (a-- > 0) { out7.push(a) }'));
  assert.deepEqual(out7, [1, 0]);
  // v3 신규: 잘못된 소스는 위치 포함 SyntaxError (v1/v2 는 진단 없음)
  assert.throws(() => transpile('const = 1'), SyntaxError);
  assert.throws(() => transpile('for (1 -> ) {}'), SyntaxError);
  // ── match 표현식 ──
  assert.match(transpile('match x { _ => 1 }'), /switch/);
  assert.equal(eval(transpile('match "b" { "a" => 1 "b" => 2 _ => 0 }')), 2);
  assert.equal(eval(transpile('match "zz" { "a" => 1 _ => 0 }')), 0); // 와일드카드
  assert.throws(() => eval(transpile('match "x" { "a" => 1 }')), TypeError); // 미매치는 명시적 에러
  // 판별값은 한 번만 평가 (switch 로 변환되므로)
  assert.deepEqual(
    eval(transpile('let n = 0; const f = () => (n++, "hit"); const r = match f() { "hit" => 1 _ => 0 }; [n, r]')),
    [1, 1],
  );
  // arm 사이 콤마 허용, arm 결과는 임의 표현식
  assert.equal(eval(transpile('const S = { a: 1, b: 2 }; match "b" { "a" => S.a, "b" => S.b, _ => 0 }')), 2);
  // `match` 는 여전히 일반 식별자 (`(` 가 뒤따르면 함수 호출)
  assert.equal(eval(transpile('const match = (v) => v + 1; match(2)')), 3);
  // for-range 와 조합
  const out8 = [];
  eval(transpile('for (let i = 1 -> 3) { out8.push(match i { 1 => "one" 2 => "two" _ => "many" }) }'));
  assert.deepEqual(out8, ['one', 'two', 'many']);
  console.log('self-check ok');
}
