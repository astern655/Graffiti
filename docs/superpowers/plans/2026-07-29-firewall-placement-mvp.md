# 자재 가중치 기반 방화벽 배치 최적화 MVP — 개발 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브라우저에서 index.html 하나로 — 구역별 자재 선택 → 위험 히트맵 → 최적 방화벽 배치 → 균등가중 대비 기대손실 감소율(%)을 보여주는 단일 파일 데모를 만든다.

**Architecture:** 순수 프론트엔드. 서버·빌드·설치 없음. 확산 = 그래프 최단도착시간 전파(구획=노드, 경계=엣지, 방화벽=엣지 차단). 최적화 = 후보 경계 전수탐색(2^10 × 발화구획). UI = canvas 평면도 + 패널. 계산 로직(data/engine)은 DOM에 의존하지 않는 순수 함수로 분리해 `node`로 단독 테스트 가능하게 만든다.

**Tech Stack:** Vanilla JS (ES 없이 classic `<script>`), HTML5 canvas. 외부 의존성 0. 로컬 `file://` 직접 열기로 동작(모듈/fetch 금지).

## Global Constraints

- **단일 배포물**: 최종 산출물은 `index.html`(+ 같은 폴더의 classic script 파일들). `file://`로 더블클릭 실행돼야 함. ES module `import`·`fetch`·CDN 금지(로컬 CORS로 막힘). classic `<script src>`만 사용.
- **확산 모델(고정)**: 각 구획의 **최단 화재 도착시간**을 전파. 엣지 통과시간 `τ`는 **불이 옮겨붙는 쪽(수신 구획) 자재의 발화성**에 의존(발화 어려운 자재일수록 τ 큼). 방화벽 엣지는 통과 불가. T=1800s 내 도착한 구획 면적 합 = 소실면적.
- **비교식(고정)**: 균등가중 최적배치 `x_u`와 자재가중 최적배치 `x_m`를 **둘 다 자재(진짜) 가중치로** 평가하고, **벽 개수 k를 동일 고정**해 비교. `reduction = (E_m(x_u) − E_m(x_m)) / E_m(x_u)`, 항상 ≥ 0.
- **상수 계수는 튜닝 노브**: τ·가중치 계수는 상대 비교용 상수이며 코드 상단에 모아 조정 가능하게 둔다(발표 방어용 "CFAST 보정이 다음 단계").
- **역할 병렬**: A=data.js / B=engine.js / C·D=ui.js·발표. 파일 경계가 곧 담당 경계.

---

### Task 1: 데이터 상수 + 그래프 (담당 A)

**Files:**
- Create: `data.js`
- Test: `selftest.js` (Task 4에서 확장, 여기선 그래프 구성만 검증)

**Interfaces:**
- Produces:
  - `COMPARTMENTS`: `[{id, name, x, y, w, d, area, material}]` (area = w*d 자동 계산)
  - `MATERIALS`: `{ [key]: {ig, alpha} }` (ig=정규화 발화률, alpha=t² 성장계수)
  - `EDGES`: `[{id, a, b, candidate}]` (후보 경계 10개 candidate:true, 주동선 2개 false)
  - `buildAdjacency(comps, edges)` → `{ [compId]: [{edgeId, to}] }` 무방향 인접리스트
  - `TUNING`: `{ tauBase: 300, igToTau: 10, T: 1800 }` (계수 한곳에 모음)

- [ ] **Step 1: `data.js`에 상수 3종 정의**

명세의 표를 객체 배열로 옮긴다. area는 코드로 계산해 손계산 오류 제거.

```js
const MATERIALS = {
  flammable_liq:  { ig: .30, alpha: .40   },
  plastic_rack:   { ig: .20, alpha: .1876 },
  cardboard_rack: { ig: .20, alpha: .0469 },
  mixed_goods:    { ig: .15, alpha: .0117 },
  office:         { ig: .10, alpha: .0117 },
  metal_parts:    { ig: .05, alpha: .003  },
};

const _RAW = [
  // id, name, x, y, w, d, material
  ["STOR_A","보관A",0,0,30,20,"cardboard_rack"],
  ["STOR_B","보관B",30,0,30,20,"plastic_rack"],
  ["STOR_C","보관C",0,20,26,16,"metal_parts"],
  ["HAZMAT","위험물실",30,20,14,16,"flammable_liq"],
  ["PICK","피킹",44,20,16,16,"mixed_goods"],
  ["DOCK","하역장",0,36,44,8,"mixed_goods"],
  ["OFFICE","사무실",44,36,16,8,"office"],
];
const COMPARTMENTS = _RAW.map(([id,name,x,y,w,d,material]) =>
  ({ id, name, x, y, w, d, area: w*d, material }));
```

- [ ] **Step 2: EDGES 정의 — HAZMAT을 허브로**

②vs③ 격차 확보 레버: 위험물실(최고 ig·alpha)을 연결 허브로 배치하고 그 주변 경계를 후보로 넣는다. 후보 10개 + 주동선 2개(candidate:false). 인접한 구획끼리만 엣지.

```js
const EDGES = [
  { id:"E1",  a:"STOR_A", b:"STOR_B", candidate:true  },
  { id:"E2",  a:"STOR_A", b:"STOR_C", candidate:true  },
  { id:"E3",  a:"STOR_B", b:"HAZMAT", candidate:true  },
  { id:"E4",  a:"STOR_C", b:"HAZMAT", candidate:true  },
  { id:"E5",  a:"HAZMAT", b:"PICK",   candidate:true  },
  { id:"E6",  a:"STOR_C", b:"DOCK",   candidate:true  },
  { id:"E7",  a:"HAZMAT", b:"DOCK",   candidate:true  },
  { id:"E8",  a:"PICK",   b:"OFFICE", candidate:true  },
  { id:"E9",  a:"DOCK",   b:"OFFICE", candidate:true  },
  { id:"E10", a:"STOR_B", b:"PICK",   candidate:true  },
  { id:"E11", a:"STOR_A", b:"DOCK",   candidate:false }, // 주동선
  { id:"E12", a:"PICK",   b:"DOCK",   candidate:false }, // 주동선
];
const TUNING = { tauBase: 300, igToTau: 10, T: 1800 };
```

- [ ] **Step 3: `buildAdjacency` 작성**

```js
function buildAdjacency(comps, edges) {
  const adj = {}; comps.forEach(c => adj[c.id] = []);
  edges.forEach(e => {
    adj[e.a].push({ edgeId: e.id, to: e.b });
    adj[e.b].push({ edgeId: e.id, to: e.a });
  });
  return adj;
}
```

- [ ] **Step 4: node에서 그래프 정합성 확인**

`selftest.js`에 임시 검증(모든 엣지의 a,b가 실제 구획 id인지, 후보 candidate 개수 10인지). `node selftest.js` 실행 → 통과.

```js
const cand = EDGES.filter(e => e.candidate).length;
console.assert(cand === 10, `후보 경계 ${cand} != 10`);
const ids = new Set(COMPARTMENTS.map(c=>c.id));
EDGES.forEach(e => console.assert(ids.has(e.a)&&ids.has(e.b), `엣지 ${e.id} 잘못된 구획`));
console.log("data OK");
```

- [ ] **Step 5: Commit** — `git add data.js selftest.js && git commit -m "feat: 구획/자재/경계 상수와 인접리스트"`

---

### Task 2: 확산 엔진 — 최단 도착시간 전파 (담당 B)

**Files:**
- Create: `engine.js`
- Test: `selftest.js`

**Interfaces:**
- Consumes: `COMPARTMENTS, MATERIALS, EDGES, TUNING, buildAdjacency`
- Produces:
  - `edgeTau(receivingCompId)` → number. `τ = tauBase / (1 + igToTau * MATERIALS[mat].alpha)` where mat = 수신 구획 자재. (발화성 높을수록 τ 작음 = 빨리 옮겨붙음)
  - `spread(sourceId, wallSet)` → `{ burnedArea, arrival: {compId:time} }`. wallSet = 차단된 edgeId의 Set. 다익스트라로 각 구획 최단 도착시간 계산, `arrival < T`인 구획 area 합.

- [ ] **Step 1: 실패 테스트 작성 (selftest.js)**

벽 없을 때 HAZMAT 발화가 최소 자기 자신은 태우고, 강한 자재(flammable_liq)라 여러 구획으로 번지는지. 벽으로 전부 막으면 소실=발화구획 면적만.

```js
// 벽 없음: HAZMAT 발화는 자기 포함 여러 구획 소실
const noWall = spread("HAZMAT", new Set());
console.assert(noWall.arrival["HAZMAT"] === 0, "발화구획 도착시간 0");
console.assert(noWall.burnedArea > compArea("HAZMAT"), "확산 안 됨");
// HAZMAT의 모든 인접 후보엣지 차단 → 자기 면적만
const seal = new Set(["E3","E4","E5","E7"]);
const sealed = spread("HAZMAT", seal);
console.assert(sealed.burnedArea === compArea("HAZMAT"), "완전차단 실패");
console.log("spread OK");
```
`compArea(id)`는 헬퍼(engine.js에 `const compArea = id => COMPARTMENTS.find(c=>c.id===id).area;`).

- [ ] **Step 2: 테스트 실패 확인** — `node selftest.js` → `spread is not defined`.

- [ ] **Step 3: `edgeTau` + `spread` 구현 (다익스트라)**

홉 수 BFS가 아니라 **누적 도착시간 최단경로**. 노드 7개라 배열 선형탐색으로 충분.

```js
const ADJ = buildAdjacency(COMPARTMENTS, EDGES);
const compArea = id => COMPARTMENTS.find(c => c.id === id).area;

function edgeTau(receivingId) {
  const mat = COMPARTMENTS.find(c => c.id === receivingId).material;
  return TUNING.tauBase / (1 + TUNING.igToTau * MATERIALS[mat].alpha);
}

function spread(sourceId, wallSet) {
  const arrival = {}; COMPARTMENTS.forEach(c => arrival[c.id] = Infinity);
  arrival[sourceId] = 0;
  const visited = new Set();
  while (visited.size < COMPARTMENTS.length) {
    // 미방문 중 최소 도착시간 노드
    let u = null, best = Infinity;
    for (const c of COMPARTMENTS)
      if (!visited.has(c.id) && arrival[c.id] < best) { best = arrival[c.id]; u = c.id; }
    if (u === null) break;               // 나머지 도달 불가
    visited.add(u);
    if (arrival[u] >= TUNING.T) continue; // T 넘으면 더 안 번짐
    for (const { edgeId, to } of ADJ[u]) {
      if (wallSet.has(edgeId)) continue;          // 방화벽 차단
      const t = arrival[u] + edgeTau(to);          // 수신 구획 자재로 지연
      if (t < arrival[to]) arrival[to] = t;
    }
  }
  let burnedArea = 0;
  for (const c of COMPARTMENTS) if (arrival[c.id] < TUNING.T) burnedArea += c.area;
  return { burnedArea, arrival };
}
```

- [ ] **Step 4: 테스트 통과 확인** — `node selftest.js` → `spread OK`.

- [ ] **Step 5: Commit** — `git commit -m "feat: 다익스트라 확산 엔진(수신자재 기반 τ)"`

---

### Task 3: 평가 + 전수탐색 최적화 (담당 B)

**Files:**
- Modify: `engine.js`
- Test: `selftest.js`

**Interfaces:**
- Consumes: `spread, COMPARTMENTS, MATERIALS, EDGES`
- Produces:
  - `weights(mode)` → `{compId: w}`. mode "material" = ig 정규화(합=1). mode "uniform" = 모든 발화구획 균등(합=1).
  - `evaluate(wallSet, w)` → number. `Σ_z w[z] * spread(z, wallSet).burnedArea` (모든 구획 z를 발화점 후보로).
  - `CANDIDATES` = 후보 edgeId 배열(길이 10).
  - `enumerate(w)` → `[{walls:Set, k, eLoss}]` 1024개. `bestByK(results)` → `{k: {walls, eLoss}}` k별 최소.

- [ ] **Step 1: 실패 테스트**

벽 개수 늘수록(k별 최적) 기대손실 단조 감소해야(더 많은 차단 = 손실 ≤). material 최적이 uniform 최적보다 material가중 평가에서 손실 작거나 같아야.

```js
const wm = weights("material");
const res = enumerate(wm);
const bk = bestByK(res);
console.assert(bk[0].eLoss >= bk[3].eLoss, "k 늘었는데 손실 증가");
console.log("optimize OK");
```

- [ ] **Step 2: 실패 확인** — `node selftest.js` → `weights is not defined`.

- [ ] **Step 3: 구현**

```js
const CANDIDATES = EDGES.filter(e => e.candidate).map(e => e.id);

function weights(mode) {
  const w = {};
  if (mode === "uniform") {
    const n = COMPARTMENTS.length;
    COMPARTMENTS.forEach(c => w[c.id] = 1 / n);
  } else {
    let sum = 0;
    COMPARTMENTS.forEach(c => sum += MATERIALS[c.material].ig);
    COMPARTMENTS.forEach(c => w[c.id] = MATERIALS[c.material].ig / sum);
  }
  return w;
}

function evaluate(wallSet, w) {
  let e = 0;
  for (const c of COMPARTMENTS) e += w[c.id] * spread(c.id, wallSet).burnedArea;
  return e;
}

function enumerate(w) {
  const out = [];
  const N = CANDIDATES.length;               // 10
  for (let mask = 0; mask < (1 << N); mask++) {
    const walls = new Set();
    for (let i = 0; i < N; i++) if (mask & (1 << i)) walls.add(CANDIDATES[i]);
    out.push({ walls, k: walls.size, eLoss: evaluate(walls, w) });
  }
  return out;
}

function bestByK(results) {
  const best = {};
  for (const r of results)
    if (!best[r.k] || r.eLoss < best[r.k].eLoss) best[r.k] = r;
  return best;
}
```

- [ ] **Step 4: 통과 + 성능 확인** — `node selftest.js` → `optimize OK`. 1024×7 spread ≈ 7천회, 1초 미만 확인(console.time).

- [ ] **Step 5: Commit** — `git commit -m "feat: 가중치/평가/전수탐색 최적화"`

---

### Task 4: ②vs③ 감소율 + Day1 게이트 (담당 B)

**Files:**
- Modify: `engine.js`, `selftest.js`

**Interfaces:**
- Consumes: `weights, enumerate, bestByK, evaluate`
- Produces:
  - `compareAtK(k)` → `{ xUniform:Set, xMaterial:Set, eMuUnderMaterial, eMmUnderMaterial, reduction }`.
    `x_u` = uniform가중 k-최적 배치, `x_m` = material가중 k-최적 배치. **둘 다 material 가중치로 평가**해 `reduction = (E_m(x_u) − E_m(x_m)) / E_m(x_u)`.

- [ ] **Step 1: 실패 테스트 — Day1 게이트 수치화**

핵심 가설 게이트: k=3에서 감소율 ≥ 10%. 그리고 민감도: HAZMAT 자재를 metal_parts(저발화)로 바꾸면 최적 배치가 달라진다.

```js
const c3 = compareAtK(3);
console.assert(c3.reduction >= 0, "reduction 음수 — 비교식 오류");
console.log(`k=3 감소율 = ${(c3.reduction*100).toFixed(1)}%`);
console.assert(c3.reduction >= 0.10, `게이트 미달: ${(c3.reduction*100).toFixed(1)}%`);

// 민감도: HAZMAT 자재 교체 → 최적 배치 변화
const before = [...compareAtK(3).xMaterial].sort().join(",");
COMPARTMENTS.find(c=>c.id==="HAZMAT").material = "metal_parts";
const after = [...compareAtK(3).xMaterial].sort().join(",");
COMPARTMENTS.find(c=>c.id==="HAZMAT").material = "flammable_liq"; // 복원
console.assert(before !== after, "자재 바꿔도 배치 동일 — 민감도 실패");
console.log("gate OK");
```

- [ ] **Step 2: 실패 확인** — `node selftest.js` → `compareAtK is not defined`.

- [ ] **Step 3: 구현**

```js
function compareAtK(k) {
  const wu = weights("uniform"), wm = weights("material");
  const xUniform  = bestByK(enumerate(wu))[k].walls;
  const xMaterial = bestByK(enumerate(wm))[k].walls;
  const eMu = evaluate(xUniform,  wm);   // 균등최적을 진짜(자재)로 평가
  const eMm = evaluate(xMaterial, wm);   // 자재최적을 진짜로 평가
  return {
    xUniform, xMaterial,
    eMuUnderMaterial: eMu, eMmUnderMaterial: eMm,
    reduction: eMu === 0 ? 0 : (eMu - eMm) / eMu,
  };
}
```

- [ ] **Step 4: 게이트 실행**

`node selftest.js`. 감소율 < 10%면 **모델 구조는 불변**, 다음 노브만 조정: (a) HAZMAT 엣지 후보 늘리기, (b) `TUNING.igToTau` 키워 자재 대비 강화, (c) 자재 배치 비대칭 강화. 조정 후 재실행.

- [ ] **Step 5: Commit** — `git commit -m "feat: k고정 ②vs③ 감소율 + Day1 게이트 통과"`

---

### Task 5: canvas 평면도 + 위험 히트맵 (담당 C)

**Files:**
- Create: `index.html`, `ui.js`
- Verify: 브라우저(playwright/수동)

**Interfaces:**
- Consumes: `COMPARTMENTS, MATERIALS, weights, spread`
- Produces: `drawPlan(ctx, {walls, highlight})`, `riskColor(compId)` (발화률×alpha 기반 빨강 농도)

- [ ] **Step 1: `index.html` 골격**

classic script만. 좌: canvas, 우: 패널. 스크립트 로드 순서 data→engine→ui.

```html
<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>방화벽 배치 최적화 MVP</title>
<style>
  body{display:flex;gap:16px;font-family:system-ui;margin:16px}
  #plan{border:1px solid #ccc}
  #panel{width:280px}
  .num{font-size:2rem;font-weight:700}
</style></head><body>
  <canvas id="plan" width="640" height="480"></canvas>
  <div id="panel">
    <div>선택 구획: <select id="mat"></select></div>
    <button id="optBtn">최적 배치</button>
    <button id="cmpBtn">균등 vs 자재 비교</button>
    <div id="result"></div>
  </div>
  <script src="data.js"></script>
  <script src="engine.js"></script>
  <script src="ui.js"></script>
</body></html>
```

- [ ] **Step 2: `drawPlan` + `riskColor`**

좌표계 스케일(모델 m → px). 각 구획 사각형 + 이름 + 위험 농도 채우기. 방화벽 엣지는 굵은 적색선.

```js
const cv = document.getElementById("plan"), ctx = cv.getContext("2d");
const SCALE = 10, PAD = 20;
function riskColor(id) {
  const c = COMPARTMENTS.find(c=>c.id===id), m = MATERIALS[c.material];
  const r = Math.min(1, (m.ig * (1 + m.alpha) ) * 3);  // 0~1 상대 위험
  return `rgba(220,40,40,${0.15 + 0.7*r})`;
}
function drawPlan({ walls = new Set(), highlight = null } = {}) {
  ctx.clearRect(0,0,cv.width,cv.height);
  for (const c of COMPARTMENTS) {
    const x = PAD+c.x*SCALE, y = PAD+c.y*SCALE, w = c.w*SCALE, h = c.d*SCALE;
    ctx.fillStyle = riskColor(c.id); ctx.fillRect(x,y,w,h);
    ctx.strokeStyle = c.id===highlight ? "#0a6" : "#888";
    ctx.lineWidth = c.id===highlight ? 3 : 1; ctx.strokeRect(x,y,w,h);
    ctx.fillStyle = "#222"; ctx.font="12px system-ui";
    ctx.fillText(`${c.name}`, x+4, y+16);
  }
  // 방화벽: 두 구획 경계 중점에 굵은 적색선
  for (const e of EDGES) if (walls.has(e.id)) drawWall(ctx, e);
}
```
`drawWall`은 두 구획 중심을 잇는 선분의 중간을 적색 굵은 선으로(간단 근사).

- [ ] **Step 3: 초기 렌더 + 브라우저 확인**

`drawPlan()` 호출. playwright로 `index.html`(file://) 열어 스크린샷 — 7개 구획·이름·히트맵 농도 차이(HAZMAT 진함) 확인.

- [ ] **Step 4: Commit** — `git commit -m "feat: canvas 평면도 + 위험 히트맵"`

---

### Task 6: 구획 클릭 → 자재 변경 → 재계산 (담당 C)

**Files:** Modify `ui.js`

**Interfaces:**
- Consumes: `drawPlan, COMPARTMENTS, MATERIALS`
- Produces: `selectComp(id)`, `onMaterialChange(newMat)` — 선택 구획 material 갱신 후 `drawPlan` 재호출(+ 현재 배치 있으면 재최적화)

- [ ] **Step 1: canvas 클릭 → 구획 판정**

클릭 좌표를 모델 좌표로 역변환해 어느 사각형인지. `selectComp(id)`가 드롭다운을 그 구획 자재로 세팅하고 highlight 렌더.

```js
cv.addEventListener("click", ev => {
  const r = cv.getBoundingClientRect();
  const mx = (ev.clientX-r.left-PAD)/SCALE, my=(ev.clientY-r.top-PAD)/SCALE;
  const hit = COMPARTMENTS.find(c => mx>=c.x&&mx<=c.x+c.w&&my>=c.y&&my<=c.y+c.d);
  if (hit) selectComp(hit.id);
});
```

- [ ] **Step 2: 드롭다운 채우기 + 변경 핸들러**

`#mat`에 MATERIALS 키 옵션. 변경 시 선택 구획 material 갱신 → 히트맵 즉시 갱신. 배치가 표시 중이면 재최적화(Task 7의 함수 재사용).

- [ ] **Step 3: 브라우저 확인** — 구획 클릭 → 자재 바꾸면 히트맵 색이 즉시 변하는지 playwright로 확인.

- [ ] **Step 4: Commit** — `git commit -m "feat: 구획 선택/자재 변경 인터랙션"`

---

### Task 7: 최적 배치 버튼 + 결과 패널 (담당 D)

**Files:** Modify `ui.js`

**Interfaces:**
- Consumes: `compareAtK, drawPlan`
- Produces: `showOptimal(k=3)` — 자재최적 배치를 굵은 적색선으로, 우측 패널에 벽 수·E[Loss]·감소율%

- [ ] **Step 1: `showOptimal`**

```js
let currentK = 3;
function showOptimal(k = currentK) {
  const c = compareAtK(k);
  drawPlan({ walls: c.xMaterial });
  document.getElementById("result").innerHTML =
    `<div>벽 개수: ${k}</div>
     <div>E[Loss](자재최적): ${c.eMmUnderMaterial.toFixed(0)}</div>
     <div class="num">${(c.reduction*100).toFixed(1)}%</div>
     <div>균등가정 대비 손실 감소</div>`;
}
document.getElementById("optBtn").onclick = () => showOptimal();
```

- [ ] **Step 2: 브라우저 확인** — 버튼 클릭 → 적색 방벽선 + 감소율 숫자 표시. playwright 스크린샷.

- [ ] **Step 3: Commit** — `git commit -m "feat: 최적 배치 버튼 + 결과 패널"`

---

### Task 8: 균등 vs 자재 비교 토글 (담당 D)

**Files:** Modify `ui.js`, `index.html`

**Interfaces:**
- Consumes: `compareAtK, drawPlan`
- Produces: `showCompare(k)` — 두 canvas(또는 좌/우 전환)로 `x_u` vs `x_m` 배치 나란히 + 감소율 크게

- [ ] **Step 1: 비교 뷰**

두 번째 canvas를 추가하거나, 토글로 `x_uniform`↔`x_material` 배치를 전환하며 같은 화면에 비교. 배치가 실제로 **다르다**는 걸 시각적으로(다른 엣지에 벽) 보여주는 게 핵심.

```js
function showCompare(k = currentK) {
  const c = compareAtK(k);
  drawPlan({ walls: c.xUniform });   // 좌: 균등최적
  drawPlanRight({ walls: c.xMaterial }); // 우: 자재최적
  document.getElementById("result").innerHTML =
    `<div>같은 벽 ${k}개, 배치만 다름</div>
     <div class="num">${(c.reduction*100).toFixed(1)}%</div>
     <div>자재 고려 시 손실 ↓</div>`;
}
```

- [ ] **Step 2: 브라우저 확인** — 두 배치의 벽 위치가 다르고 감소율이 크게 뜨는지 playwright로 확인.

- [ ] **Step 3: Commit** — `git commit -m "feat: 균등 vs 자재 배치 비교 뷰"`

---

### Task 9 (여유 시): 벽 개수 슬라이더 (담당 D)

**Files:** Modify `index.html`, `ui.js`

- [ ] **Step 1**: `<input type=range min=1 max=5>` → `currentK` 갱신 → `showOptimal(k)` 재호출. k별 감소율 표(캡처용) 콘솔/패널 출력.
- [ ] **Step 2**: 브라우저 확인 후 Commit — `git commit -m "feat: 벽 개수 슬라이더"`

---

### Task 10: 리허설 + 백업 (담당 D)

- [ ] **Step 1**: 시연 스크립트 4단계 확정 — ①자재 입력(구획 클릭·변경) → ②히트맵 → ③최적 배치·감소율 → ④HAZMAT 자재 교체로 배치 변화.
- [ ] **Step 2**: k별 감소율 표 캡처, 화면 3회 리허설 녹화 백업.
- [ ] **Step 3**: 한계·향후 계획 슬라이드 1장 텍스트 작성(τ 상수=상대 비교용 → CFAST 보정 다음 단계, 루프 데이터→생성모델 확장, 법정 구획 하한 준수).

---

## Self-Review (계획 검토)

- **명세 커버리지**: 히트맵(T5)·자재선택 재계산(T6)·최적배치(T7)·②vs③ 감소율(T4,T8)·민감도(T4)·k 슬라이더(T9)·산출물(T10) — 명세 6개 데모 요소 모두 태스크에 매핑됨. ✅
- **잘라낸 것 유지**: CFAST/GA/발화특정/소방브리핑 없음 — 계획에 미포함(T10 슬라이드로만 언급). ✅
- **타입 일관성**: `spread`→`{burnedArea,arrival}`, `wallSet`=Set(edgeId), `weights(mode)`→`{compId:w}`, `bestByK`→`{k:{walls,eLoss}}`, `compareAtK`→`{xUniform,xMaterial,reduction,...}` — 태스크 간 시그니처 일치. ✅
- **file:// 안전성**: 전 파일 classic script, import/fetch/CDN 0. ✅
- **테스트 seam**: data.js·engine.js는 DOM 무관 → `node selftest.js`로 Day1 게이트까지 자동 검증. ui.js만 브라우저 확인. ✅

## 리스크 & 노브 (한 곳에 모음)

| 리스크 | 신호 | 대응(모델 불변) |
|---|---|---|
| 감소율 < 10% | T4 게이트 실패 | HAZMAT 엣지 후보↑ / `igToTau`↑ / 자재 비대칭↑ |
| 자재 바꿔도 배치 동일 | T4 민감도 실패 | 수신자재 τ 의존 확인, `igToTau`↑ |
| 전수탐색 느림 | 1초 초과 | 후보 10개 유지(2^10), 12개 넘기지 말 것 |
| 로컬 실행 실패 | file:// 빈 화면 | module/fetch 사용 여부 점검 |
