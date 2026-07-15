# new-syntax-test

JS에 `for (start -> end)` 범위 루프 문법을 추가하는 실험. v3 — **AST 기반** (acorn 파서 플러그인).

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

## 실행 방법

요구사항: Node.js 20.6+, `npm install` (acorn + astring)

### 1. CLI로 단일 파일 실행

```bash
node forjs.mjs demo.forjs
```

### 2. Loader hook — `.forjs`를 모듈처럼 import

```bash
node --import ./register.mjs main.mjs
```

`main.mjs`에서 `import './demo.forjs'` 하면 import 시점에 자동 트랜스파일된다. TypeScript가 동작하는 것과 같은 방식.

### 3. Self-check

```bash
node forjs.mjs
# → self-check ok
```

## 구현 (v3: acorn 플러그인 + AST)

실제 트랜스파일러(Babel 등)와 같은 3단계 파이프라인:

1. **파서 확장** — acorn `Parser.extend()` 서브클래스.
   - `getTokenFromCode()` 오버라이드로 `->` 를 커스텀 토큰으로 lexing (`a-- > b` 의 `-->` 는 오인 안 됨).
   - acorn 이 for 헤드의 init 을 파싱한 뒤 C-style 판정 직전에 호출하는 `parseFor()` 를 오버라이드 — 현재 토큰이 `->` 면 `ForRangeStatement` 커스텀 AST 노드 생성, 아니면 원래 동작. JSX 가 acorn-jsx 플러그인으로 동작하는 것과 같은 방식.
2. **AST** — 표준 ESTree 트리 + `ForRangeStatement { init, rangeEnd, body }`.
3. **codegen** — astring 커스텀 generator 가 `ForRangeStatement` 를 만나면 표준 for 문으로 출력, 나머지 노드는 기본 generator 그대로.

### 버전 히스토리 (v1 → v3)

| 버전 | 방식 | 한계 |
|------|------|------|
| `v1/` | regex 텍스트 치환 | 문자열/주석 안 패턴 오변환, 괄호 경계값 불가, `=` 금지 |
| `v2/` | 자체 tokenizer + 토큰 레벨 치환 | v1 한계 해소. 표현식 구조는 모름, 문법 진단 없음 |
| 루트 (v3) | acorn 플러그인 + AST + astring | 표현식 완전 이해, 잘못된 소스에 위치 포함 SyntaxError |

## 파일 구성

| 파일 | 역할 |
|------|------|
| `forjs.mjs` | 파서 플러그인 + `transpile()` + CLI 러너 + self-check |
| `hooks.mjs` | Node module load hook (`.forjs` 트랜스파일) |
| `register.mjs` | hook 등록 진입점 (`--import`용) |
| `demo.forjs` | 신문법 데모 |
| `main.mjs` | loader hook 데모 진입점 |
| `v1/`, `v2/` | 이전 버전 (비교용 보존) |

## 제약 (알려진 한계)

- AST 재생성 방식이라 **주석과 원본 포매팅이 보존되지 않음** (astring 특성). 보존이 필요하면 recast 같은 포맷 보존 프린터로 교체.
- sourcemap 없음 — 에러 스택의 줄 번호가 변환 후 코드 기준.
- 표준 JS 엔진은 런타임 문법 확장이 불가능하므로 "진짜 네이티브" 지원은 엔진(QuickJS 등) 파서 패치가 필요.
