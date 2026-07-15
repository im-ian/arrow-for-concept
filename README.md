# forjs

JS에 `for (start -> end)` 범위 루프 문법을 추가하는 실험용 트랜스파일러. v2 — **토크나이저 기반**.

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

for (let m = Math.min(1, 5) -> Math.max(1, 3)) {} // 괄호 포함 경계값 OK
```

변환 결과:

- `for (let i = 1 -> 10)` → `for (let i = 1, _end = 10, _step = i <= _end ? 1 : -1; _step > 0 ? i <= _end : i >= _end; i += _step)`
- `for (1 -> 10)` (bare) → `for (const {} of Array(Math.abs((1) - (10)) + 1).keys())` — 빈 destructuring 패턴이라 바인딩 0개, body에서 내부 변수 접근 불가능.

방향은 런타임 결정 (경계가 표현식일 수 있으므로). 카운터를 쓰려면 `let 이름 =` 필수, 암묵 변수 없음.

## 실행 방법

요구사항: Node.js 20.6+ (loader hook 사용 시)

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

## 구현 (v2: tokenizer)

v1은 regex 텍스트 치환이라 코드 구조를 몰랐다. v2는 2단계:

1. **tokenize()** — 소스를 토큰 스트림으로 분해. 문자열/템플릿 리터럴(`${}` 중첩 포함)/주석/regex 리터럴을 통짜 토큰으로 삼켜서, 그 안의 `for`·`->`·괄호가 코드로 오인되지 않는다. `/`의 나눗셈 vs regex 판별은 직전 토큰 기반 heuristic (실제 lexer들의 표준 기법).
2. **transpile()** — 토큰 스트림에서 `for` `(` 를 찾고, 토큰 레벨 괄호 depth로 매칭 `)` 와 top-level `->` 탐색. 헤드만 새 코드로 치환, 나머지는 원본 그대로 복사.

이로써 v1의 한계 세 가지가 해소됨: 문자열/주석 안의 패턴 오변환, `f(1)` 같은 괄호 포함 경계값, 경계값 내 `=` 금지.

## 파일 구성

| 파일 | 역할 |
|------|------|
| `forjs.mjs` | `tokenize()` + `transpile()` + CLI 러너 + self-check |
| `hooks.mjs` | Node module load hook (`.forjs` 트랜스파일) |
| `register.mjs` | hook 등록 진입점 (`--import`용) |
| `demo.forjs` | 신문법 데모 |
| `main.mjs` | loader hook 데모 진입점 |
| `v1/` | regex 기반 초기 버전 (비교용 보존) |

## 제약 (알려진 한계)

- 진짜 파서(AST)는 아님 — 표현식 내부 구조는 이해하지 않고 토큰 레벨에서만 동작.
- `}` 뒤의 `/` 는 나눗셈으로 간주 (블록 뒤 regex 리터럴이라는 드문 케이스에서 오판 가능).
- 잘못된 소스에 대한 문법 진단 없음 — garbage in, garbage out.
- 표준 JS 엔진은 런타임 문법 확장이 불가능하므로 "진짜 네이티브" 지원은 엔진(QuickJS 등) 파서 패치가 필요.
