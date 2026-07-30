/* data.js — 자재 상수, 창고 지오메트리, 시나리오(레이아웃), 그래프 빌더.
 * 브라우저(classic script)와 node(require) 양쪽에서 동작.
 * 좌표 단위 = m, 정수 그리드(공유벽 판정에 정확 비교 사용). */
(function (root) {
  "use strict";

  // 전파/평가 튜닝 상수 — 상대 비교용. CFAST 보정이 향후 단계. (한 곳에 모음)
  const TUNING = { tauBase: 1200, igToTau: 10, T: 1800 };

  // 공간 위험도 필드 상수 — 전부 조정 노브(실측·CFAST 보정 전 상대값).
  const RISK = {
    cell: 2,        // 격자 셀 크기(m) — 렌더 해상도
    srcStride: 2,   // 발화원 샘플 간격(셀) — 발화원을 이 간격으로 나눠 케이스 계산(성능)
    lamF: 7,        // 화염 감쇠거리(m) — 근거리
    lamG: 26,       // 유독가스 감쇠거리(m) — 훨씬 넓게
    wallF: 16,      // 화염의 벽 통과 페널티(거리 가산, 큼)
    wallG: 5,       // 가스의 벽 통과 페널티(가스는 새어나감, 작음)
    wF: 1.0,        // 화염 항 가중
    wG: 1.3,        // 유독가스 항 가중(인명 위험 강조)
    burnMin: 0.15,  // 화염 전파 시 자재 최소 통과성(RC도 0은 아님)
    blur: 2,        // 발화원 격자 봉우리 제거용 블러 반경(셀)
    pingW: 0.6,     // 발화 가중치 핑 1단계당 발화원 세기
    pingAlpha: 0.35,// 핑(내용물 화재) 연소강도 — 방 자재와 무관하게 자체 연소
    pingTox: 0.6,   // 핑(내용물 화재) 유독가스
    // 절대 기준값 — 안전 설계는 낮게, 최악(패널) 설계가 ~1에 닿도록 보정.
    refFire: 1.0, refGas: 10.0, refRisk: 12.0,
  };

  // 기자재 = 설계 단계에서 각 구역을 짓는 '건축 자재'(구조·마감재).
  // ig=발화성(발화 확률), alpha=t² 화재성장계수(연소강도·전파성), tox=유독가스 발생도.
  // 한국 창고화재 맥락: EPS/우레탄 샌드위치패널이 최악, RC·내화벽이 최선.
  // 우레탄=이소시아네이트·HCN 등 독성 최악, EPS=농연·CO.
  // hard=경도(파괴 난이도), resist=방화 차단성능(벽으로서 확산 차단력 0~1).
  // 드라이월 최약, RC·내화벽 최강. 방화벽은 확산을 크게 완화.
  const MATERIALS = {
    eps_panel:      { label: "EPS 샌드위치패널",  ig: .30, alpha: .40,   tox: .55, hard: .15, resist: .08 },
    pur_panel:      { label: "우레탄 샌드위치패널", ig: .26, alpha: .30,   tox: .95, hard: .18, resist: .10 },
    wood_frame:     { label: "경량 목구조",       ig: .22, alpha: .1876, tox: .40, hard: .35, resist: .18 },
    clt_timber:     { label: "CLT 매스팀버",      ig: .18, alpha: .1876, tox: .38, hard: .50, resist: .40 },
    drywall:        { label: "드라이월/석고보드",  ig: .14, alpha: .0469, tox: .18, hard: .12, resist: .35 },
    curtain_glass:  { label: "커튼월/유리",       ig: .12, alpha: .0469, tox: .10, hard: .38, resist: .20 },
    gypsum_fire:    { label: "방화석고보드(내화)", ig: .08, alpha: .0117, tox: .10, hard: .24, resist: .80 },
    steel_bare:     { label: "철골(내화피복無)",   ig: .06, alpha: .0117, tox: .05, hard: .75, resist: .30 },
    alc_block:      { label: "ALC 블록",         ig: .04, alpha: .003,  tox: .03, hard: .55, resist: .78 },
    rc_concrete:    { label: "철근콘크리트(RC)",   ig: .03, alpha: .003,  tox: .02, hard: .95, resist: .92 },
    firewall_rated: { label: "내화 방화벽",        ig: .02, alpha: .003,  tox: .02, hard: .90, resist: 1.0 },
  };

  // 경도 3단계(파괴 난이도). 색은 진입 관점: 초록=쉬움, 주황=기구, 빨강=불가.
  const HARDTIER = [
    { max: .28, label: "가볍게 진입 가능", short: "쉬움", color: "#2ecc71" },
    { max: .65, label: "기구 필요",       short: "기구", color: "#f0a03c" },
    { max: 1.1, label: "진입 불가(중장비)", short: "불가", color: "#e5322d" },
  ];
  const breachTier = h => HARDTIER.find(t => h <= t.max);
  // 2중 접합(두 방 사이 벽): 가장 단단한 층이 진입 가부를 결정 → MAX.
  const wallBreach = (matA, matB) => breachTier(Math.max(MATERIALS[matA].hard, MATERIALS[matB].hard));

  // 두 축정렬 사각형이 공유하는 벽 선분을 반환(없으면 null).
  function sharedWall(a, b) {
    const aL = a.x, aR = a.x + a.w, aT = a.y, aB = a.y + a.d;
    const bL = b.x, bR = b.x + b.w, bT = b.y, bB = b.y + b.d;
    // 세로벽
    let vx = null;
    if (aR === bL) vx = aR; else if (bR === aL) vx = aL;
    if (vx !== null) {
      const y1 = Math.max(aT, bT), y2 = Math.min(aB, bB);
      if (y2 - y1 > 0) return { x1: vx, y1, x2: vx, y2 };
    }
    // 가로벽
    let hy = null;
    if (aB === bT) hy = aB; else if (bB === aT) hy = aT;
    if (hy !== null) {
      const x1 = Math.max(aL, bL), x2 = Math.min(aR, bR);
      if (x2 - x1 > 0) return { x1, y1: hy, x2, y2: hy };
    }
    return null;
  }

  // 레이아웃 → { comps, edges, adj }. 내부 공유벽 전부를 후보 방화벽으로.
  function computeGraph(layout) {
    const comps = layout.comps;
    const edges = [];
    for (let i = 0; i < comps.length; i++) {
      for (let j = i + 1; j < comps.length; j++) {
        const seg = sharedWall(comps[i], comps[j]);
        if (seg) edges.push({ id: `W${comps[i].id}__${comps[j].id}`, a: comps[i].id, b: comps[j].id, seg });
      }
    }
    const adj = {};
    comps.forEach(c => adj[c.id] = []);
    edges.forEach(e => {
      adj[e.a].push({ edgeId: e.id, to: e.b });
      adj[e.b].push({ edgeId: e.id, to: e.a });
    });
    return { comps, edges, adj };
  }

  // ── 지오메트리(건물 골격). comps는 겹침 없이 박스를 타일링. ──
  const GEOMETRIES = {
    G1: { name: "표준 물류창고", box: [60, 40], comps: [
      { id: "DOCK",   name: "하역장",   x: 0,  y: 0,  w: 60, d: 10 },
      { id: "STOR_A", name: "보관구역A", x: 0,  y: 10, w: 20, d: 20 },
      { id: "STOR_B", name: "보관구역B", x: 20, y: 10, w: 20, d: 20 },
      { id: "HAZMAT", name: "위험물실",  x: 40, y: 10, w: 20, d: 12 },
      { id: "PICK",   name: "피킹존",   x: 40, y: 22, w: 20, d: 8  },
      { id: "OFFICE", name: "사무동",   x: 0,  y: 30, w: 60, d: 10 },
    ]},
    G2: { name: "대형 분산창고", box: [80, 50], comps: [
      { id: "DOCK",   name: "하역장",    x: 0,  y: 0,  w: 80, d: 10 },
      { id: "STOR_A", name: "보관구역A", x: 0,  y: 10, w: 27, d: 25 },
      { id: "STOR_B", name: "보관구역B", x: 27, y: 10, w: 26, d: 25 },
      { id: "HAZMAT", name: "위험물실",  x: 53, y: 10, w: 27, d: 13 },
      { id: "BATT",   name: "배터리실",  x: 53, y: 23, w: 27, d: 12 },
      { id: "PICK",   name: "피킹존",    x: 0,  y: 35, w: 40, d: 15 },
      { id: "OFFICE", name: "사무동",    x: 40, y: 35, w: 40, d: 15 },
    ]},
    G3: { name: "통로형 창고", box: [50, 50], comps: [
      { id: "DOCK",   name: "하역장",   x: 0,  y: 0,  w: 30, d: 10 },
      { id: "RECV",   name: "입고검수", x: 30, y: 0,  w: 20, d: 10 },
      { id: "STOR_A", name: "보관구역A", x: 0,  y: 10, w: 25, d: 20 },
      { id: "HAZMAT", name: "위험물실",  x: 25, y: 10, w: 25, d: 20 },
      { id: "STOR_B", name: "보관구역B", x: 0,  y: 30, w: 25, d: 20 },
      { id: "PICK",   name: "피킹존",   x: 25, y: 30, w: 15, d: 20 },
      { id: "OFFICE", name: "사무동",   x: 40, y: 30, w: 10, d: 20 },
    ]},
    G4: { name: "콜드체인 창고", box: [55, 45], comps: [
      { id: "DOCK",   name: "하역장",   x: 0,  y: 0,  w: 55, d: 10 },
      { id: "COLD",   name: "냉동보관", x: 0,  y: 10, w: 20, d: 25 },
      { id: "MACH",   name: "기계실",   x: 20, y: 10, w: 20, d: 25 },
      { id: "HAZMAT", name: "위험물실", x: 40, y: 10, w: 15, d: 25 },
      { id: "STOR",   name: "일반보관", x: 0,  y: 35, w: 27, d: 10 },
      { id: "SHIP",   name: "출하장",   x: 27, y: 35, w: 28, d: 10 },
    ]},
    G5: { name: "소형 물류센터", box: [40, 30], comps: [
      { id: "DOCK",   name: "하역장",   x: 0,  y: 0,  w: 40, d: 8  },
      { id: "STOR_A", name: "보관구역A", x: 0,  y: 8,  w: 20, d: 14 },
      { id: "STOR_B", name: "보관구역B", x: 20, y: 8,  w: 20, d: 14 },
      { id: "HAZMAT", name: "위험물실",  x: 0,  y: 22, w: 20, d: 8  },
      { id: "OFFICE", name: "사무동",   x: 20, y: 22, w: 20, d: 8  },
    ]},
  };

  // ── 시나리오: 같은 건물 × 다른 건축 자재(설계안) → 다른 보강 우선순위. ──
  const SCENARIOS = [
    // G1
    { id: "L01", geo: "G1", title: "표준창고 · 철골+석고 표준", m: {
      DOCK: "steel_bare", STOR_A: "gypsum_fire", STOR_B: "gypsum_fire",
      HAZMAT: "rc_concrete", PICK: "drywall", OFFICE: "drywall" } },
    { id: "L02", geo: "G1", title: "표준창고 · 샌드위치패널 경제형", m: {
      DOCK: "pur_panel", STOR_A: "eps_panel", STOR_B: "eps_panel",
      HAZMAT: "pur_panel", PICK: "drywall", OFFICE: "drywall" } },
    { id: "L03", geo: "G1", title: "표준창고 · 내화 강화 설계", m: {
      DOCK: "steel_bare", STOR_A: "gypsum_fire", STOR_B: "gypsum_fire",
      HAZMAT: "firewall_rated", PICK: "gypsum_fire", OFFICE: "rc_concrete" } },
    // G2
    { id: "L04", geo: "G2", title: "대형창고 · 패널 혼합", m: {
      DOCK: "pur_panel", STOR_A: "eps_panel", STOR_B: "eps_panel",
      HAZMAT: "pur_panel", BATT: "eps_panel", PICK: "drywall", OFFICE: "drywall" } },
    { id: "L05", geo: "G2", title: "대형창고 · 철골 표준", m: {
      DOCK: "steel_bare", STOR_A: "steel_bare", STOR_B: "gypsum_fire",
      HAZMAT: "rc_concrete", BATT: "gypsum_fire", PICK: "drywall", OFFICE: "drywall" } },
    { id: "L06", geo: "G2", title: "대형창고 · 목구조 혼합", m: {
      DOCK: "wood_frame", STOR_A: "clt_timber", STOR_B: "clt_timber",
      HAZMAT: "gypsum_fire", BATT: "alc_block", PICK: "wood_frame", OFFICE: "drywall" } },
    // G3
    { id: "L07", geo: "G3", title: "통로형 · 철골 표준", m: {
      DOCK: "steel_bare", RECV: "drywall", STOR_A: "gypsum_fire",
      HAZMAT: "rc_concrete", STOR_B: "gypsum_fire", PICK: "drywall", OFFICE: "drywall" } },
    { id: "L08", geo: "G3", title: "통로형 · 패널 경제형", m: {
      DOCK: "pur_panel", RECV: "drywall", STOR_A: "eps_panel",
      HAZMAT: "pur_panel", STOR_B: "eps_panel", PICK: "drywall", OFFICE: "drywall" } },
    { id: "L09", geo: "G3", title: "통로형 · 내화 강화 설계", m: {
      DOCK: "steel_bare", RECV: "gypsum_fire", STOR_A: "gypsum_fire",
      HAZMAT: "firewall_rated", STOR_B: "gypsum_fire", PICK: "gypsum_fire", OFFICE: "rc_concrete" } },
    // G4
    { id: "L10", geo: "G4", title: "콜드체인 · 패널 표준", m: {
      DOCK: "pur_panel", COLD: "eps_panel", MACH: "steel_bare",
      HAZMAT: "pur_panel", STOR: "eps_panel", SHIP: "drywall" } },
    { id: "L11", geo: "G4", title: "콜드체인 · 철골+내화", m: {
      DOCK: "steel_bare", COLD: "alc_block", MACH: "steel_bare",
      HAZMAT: "rc_concrete", STOR: "gypsum_fire", SHIP: "drywall" } },
    { id: "L12", geo: "G4", title: "콜드체인 · 우레탄패널 위험", m: {
      DOCK: "pur_panel", COLD: "pur_panel", MACH: "steel_bare",
      HAZMAT: "pur_panel", STOR: "eps_panel", SHIP: "pur_panel" } },
    // G5
    { id: "L13", geo: "G5", title: "소형센터 · 철골 표준", m: {
      DOCK: "steel_bare", STOR_A: "gypsum_fire", STOR_B: "gypsum_fire",
      HAZMAT: "rc_concrete", OFFICE: "drywall" } },
    { id: "L14", geo: "G5", title: "소형센터 · 패널 경제형", m: {
      DOCK: "pur_panel", STOR_A: "eps_panel", STOR_B: "eps_panel",
      HAZMAT: "pur_panel", OFFICE: "drywall" } },
    { id: "L15", geo: "G5", title: "소형센터 · 내화 강화 설계", m: {
      DOCK: "steel_bare", STOR_A: "gypsum_fire", STOR_B: "firewall_rated",
      HAZMAT: "firewall_rated", OFFICE: "rc_concrete" } },
  ];

  function makeLayouts() {
    return SCENARIOS.map(s => {
      const g = GEOMETRIES[s.geo];
      const comps = g.comps.map(c => ({
        id: c.id, name: c.name, x: c.x, y: c.y, w: c.w, d: c.d,
        area: c.w * c.d, material: s.m[c.id], floorMat: s.m[c.id], // 바닥 기본=구조 자재
      }));
      return { id: s.id, title: s.title, geo: s.geo, geoName: g.name, box: g.box.slice(), comps };
    });
  }

  // 방의 실효 화재특성 = 벽/구조 자재 + 바닥 자재 블렌드.
  // 발화·연소는 평균(두 면 다 기여), 유독가스는 최악(인명 위험).
  function roomFireProps(comp) {
    const w = MATERIALS[comp.material], f = MATERIALS[comp.floorMat || comp.material];
    return { ig: .5 * (w.ig + f.ig), alpha: .5 * (w.alpha + f.alpha), tox: Math.max(w.tox, f.tox) };
  }

  const api = { TUNING, RISK, MATERIALS, HARDTIER, breachTier, wallBreach, roomFireProps, GEOMETRIES, sharedWall, computeGraph, makeLayouts, LAYOUTS: makeLayouts() };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FIRE_DATA = api;
})(typeof window !== "undefined" ? window : globalThis);
