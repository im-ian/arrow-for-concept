# forjs

JS에 `for (start -> end)` 범위 루프 문법을 추가하는 실험용 트랜스파일러.

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

const max = 3;
for (let b = max -> max + 2) {} // 표현식 경계 가능
```

변환 결과: `for (let i = 1 -> 10)` → `for (let i = 1, _end = 10, _step = i <= _end ? 1 : -1; _step > 0 ? i <= _end : i >= _end; i += _step)`

카운터를 쓰려면 `let 이름 =` 필수. 암묵 변수 없음 — `for (1 -> 3)` 형태는 body에서 카운터 접근 불가, 단순 반복 전용.

`10 -> 1` 처럼 시작이 크면 자동으로 내림차순. 방향은 런타임에 결정 (경계가 표현식일 수 있으므로).

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

## 파일 구성

| 파일 | 역할 |
|------|------|
| `forjs.mjs` | `transpile()` + CLI 러너 + self-check |
| `hooks.mjs` | Node module load hook (`.forjs` 트랜스파일) |
| `register.mjs` | hook 등록 진입점 (`--import`용) |
| `demo.forjs` | 신문법 데모 |
| `main.mjs` | loader hook 데모 진입점 |

## 제약 (알려진 한계)

- regex 기반 치환 — 진짜 파서 아님. 문자열/주석 안의 `->`, `f(1)` 같은 괄호 포함 경계값에서 깨짐. 필요해지면 acorn 기반으로 교체.
- 경계값에 `=` 포함 불가 (파싱 모호성).
- 표준 JS 엔진은 런타임 문법 확장이 불가능하므로 "진짜 네이티브" 지원은 엔진(QuickJS 등) 파서 패치가 필요.
