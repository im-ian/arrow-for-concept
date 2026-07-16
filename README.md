# new-syntax-test

JS에 새 문법을 추가하는 실험 (xjs). v3 — **AST 기반** (acorn 파서 플러그인). 현재 문법 2개: `for (start -> end)` 범위 루프, `match` 표현식.

```js
for (let i = 1 -> 5) {
  console.log(i); // 1~5 (양끝 포함)
}

for (let d = 5 -> 1) {
  console.log(d); // 내림차순 자동
}

for (1 -> 3) {
  console.log('tick'); // 카운터 없이 N회 반복
}

for (let m = Math.min(1, 5) -> Math.max(1, 3)) {} // 임의 표현식 경계
```

변환 결과:

- `for (let i = 1 -> 10)` → `for (let i = (1), _end = (10), _step = i <= _end ? 1 : -1; _step > 0 ? i <= _end : i >= _end; i += _step)`
- `for (1 -> 10)` (bare) → `for (const {} of Array(Math.abs((1) - (10)) + 1).keys())` — 빈 destructuring 패턴이라 바인딩 0개, body에서 내부 변수 접근 불가능.

방향은 런타임 결정 (경계가 표현식일 수 있으므로). 카운터를 쓰려면 `let 이름 =` 필수, 암묵 변수 없음.

## `match` 표현식

```js
const color = match fruit {
  'apple' => 'red'
  'banana' => 'yellow'
  _ => 'unknown'
};

// 인자 위치에서 바로 사용 + 식별자 패턴(값 비교) + 중첩
const NOT_FOUND = 404;
console.log(match status {
  200 => 'ok'
  NOT_FOUND => 'not found'
  _ => match kind { 'net' => 'network error' _ => 'other' }
});
```

- **표현식** — 값 위치 어디서나 사용 가능 (`const x = match ...`, 인자, 다른 match 의 arm 안 등).
- 패턴은 `===` 비교 (내부적으로 `switch` 로 변환). 리터럴 외에 식별자·멤버 표현식도 패턴 가능 — 값으로 평가해 비교. `_` 만 와일드카드.
- arm 사이 콤마는 선택. 판별값은 한 번만 평가.
- `_` 없이 어떤 arm 도 안 맞으면 `TypeError` (조용한 `undefined` 대신 명시적 에러).
- `match` 는 예약어가 아님 — 뒤에 식별자/리터럴이 올 때만 키워드로 해석되고, `match(x)` 는 평범한 함수 호출로 남는다.

변환 결과: `match v { 'a' => 1 _ => 0 }` → `(() => { switch (v) { case 'a': return 1; default: return 0; } })()`

제한: 화살표 IIFE 로 감싸므로 arm 안에서 `await`/`yield` 불가.

## 실행 방법

요구사항: Node.js 20.6+, `npm install` (acorn + astring)

### 1. CLI로 단일 파일 실행

```bash
node xjs.mjs demo.xjs
```

### 2. Loader hook — `.xjs`를 모듈처럼 import

```bash
node --import ./register.mjs main.mjs
```

`main.mjs`에서 `import './demo.xjs'` 하면 import 시점에 자동 트랜스파일된다. TypeScript가 동작하는 것과 같은 방식.

### 3. Self-check

```bash
node xjs.mjs
# → self-check ok
```

## 구현 (v3: acorn 플러그인 + AST)

실제 트랜스파일러(Babel 등)와 같은 3단계 파이프라인:

1. **파서 확장** — acorn `Parser.extend()` 서브클래스.
   - `getTokenFromCode()` 오버라이드로 `->` 를 커스텀 토큰으로 lexing (`a-- > b` 의 `-->` 는 오인 안 됨).
   - acorn 이 for 헤드의 init 을 파싱한 뒤 C-style 판정 직전에 호출하는 `parseFor()` 를 오버라이드 — 현재 토큰이 `->` 면 `ForRangeStatement` 커스텀 AST 노드 생성, 아니면 원래 동작. JSX 가 acorn-jsx 플러그인으로 동작하는 것과 같은 방식.
   - `parseExprAtom()` 오버라이드로 `match` 를 컨텍스트 키워드로 처리 — 식별자 `match` 뒤에 표현식 시작 토큰이 올 때만 `MatchExpression` 파싱 (평범한 JS 에선 식별자 두 개 연속이 SyntaxError 라 기존 코드와 충돌 없음).
2. **AST** — 표준 ESTree 트리 + `ForRangeStatement { init, rangeEnd, body }` + `MatchExpression { discriminant, arms: MatchArm[] }`.
3. **codegen** — astring 커스텀 generator 가 커스텀 노드를 만나면 표준 JS 로 출력 (for 문 / switch IIFE), 나머지 노드는 기본 generator 그대로.

### 버전 히스토리 (v1 → v3)

| 버전 | 방식 | 한계 |
|------|------|------|
| `v1/` | regex 텍스트 치환 | 문자열/주석 안 패턴 오변환, 괄호 경계값 불가, `=` 금지 |
| `v2/` | 자체 tokenizer + 토큰 레벨 치환 | v1 한계 해소. 표현식 구조는 모름, 문법 진단 없음 |
| 루트 (v3) | acorn 플러그인 + AST + astring | 표현식 완전 이해, 잘못된 소스에 위치 포함 SyntaxError |

## 파일 구성

| 파일 | 역할 |
|------|------|
| `xjs.mjs` | 파서 플러그인 + `transpile()` + CLI 러너 + self-check |
| `hooks.mjs` | Node module load hook (`.xjs` 트랜스파일) |
| `register.mjs` | hook 등록 진입점 (`--import`용) |
| `demo.xjs` | 신문법 데모 |
| `main.mjs` | loader hook 데모 진입점 |
| `v1/`, `v2/` | 이전 버전 (비교용 보존) |

## 제약 (알려진 한계)

- AST 재생성 방식이라 **주석과 원본 포매팅이 보존되지 않음** (astring 특성). 보존이 필요하면 recast 같은 포맷 보존 프린터로 교체.
- sourcemap 없음 — 에러 스택의 줄 번호가 변환 후 코드 기준.
- 표준 JS 엔진은 런타임 문법 확장이 불가능하므로 "진짜 네이티브" 지원은 엔진(QuickJS 등) 파서 패치가 필요.
