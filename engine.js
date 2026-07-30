/* engine.js — 화재 확산(다익스트라) + 손실 평가 + 전수탐색 최적화 + ②vs③ 비교.
 * DOM 무관 순수 함수. graph = { comps, edges, adj }. wallSet = 차단 edgeId의 Set. */
(function (root) {
  "use strict";

  const DATA = (typeof module !== "undefined" && module.exports) ? require("./data.js") : root.FIRE_DATA;
  const { TUNING, MATERIALS } = DATA;

  const MAX_CANDIDATES = 16; // 2^16 방어선. 실제 레이아웃은 ≤12 (selftest가 강제).

  const materialOf = (comps, id) => MATERIALS[comps.find(c => c.id === id).material];

  // 불이 옮겨붙는 쪽(수신 구획) 자재로 엣지 통과시간 결정. 발화성↑ → τ↓(빨리 번짐).
  function edgeTau(comps, receivingId) {
    const m = materialOf(comps, receivingId);
    return TUNING.tauBase / (1 + TUNING.igToTau * m.alpha);
  }

  // sourceId 발화 → 각 구획 최단 도착시간(다익스트라). T 내 도달 구획 면적 합 = 소실면적.
  function spread(graph, sourceId, wallSet) {
    const { comps, adj } = graph;
    const arrival = {};
    comps.forEach(c => arrival[c.id] = Infinity);
    arrival[sourceId] = 0;
    const visited = new Set();
    while (visited.size < comps.length) {
      let u = null, best = Infinity;
      for (const c of comps)
        if (!visited.has(c.id) && arrival[c.id] < best) { best = arrival[c.id]; u = c.id; }
      if (u === null) break;              // 나머지 도달 불가
      visited.add(u);
      if (arrival[u] >= TUNING.T) continue;
      for (const { edgeId, to } of adj[u]) {
        if (wallSet && wallSet.has(edgeId)) continue;  // 방화벽 차단
        const t = arrival[u] + edgeTau(comps, to);
        if (t < arrival[to]) arrival[to] = t;
      }
    }
    let burnedArea = 0;
    for (const c of comps) if (arrival[c.id] < TUNING.T) burnedArea += c.area;
    return { burnedArea, arrival };
  }

  // 발화 확률 가중치. material=자재 ig 정규화, uniform=모든 구획 균등.
  function weights(graph, mode) {
    const { comps } = graph, w = {};
    if (mode === "uniform") {
      comps.forEach(c => w[c.id] = 1 / comps.length);
    } else {
      let sum = 0;
      comps.forEach(c => sum += MATERIALS[c.material].ig);
      comps.forEach(c => w[c.id] = MATERIALS[c.material].ig / sum);
    }
    return w;
  }

  // 기대손실 = Σ_z (발화확률 w[z]) × (z 발화 시 소실면적). 모든 구획을 발화점으로.
  function evaluate(graph, wallSet, w) {
    let e = 0;
    for (const c of graph.comps) e += w[c.id] * spread(graph, c.id, wallSet).burnedArea;
    return e;
  }

  // 후보 경계 2^N 전수탐색. 각 조합의 (walls, k, eLoss).
  function enumerate(graph, w) {
    const cand = graph.edges.map(e => e.id);
    const N = cand.length;
    if (N > MAX_CANDIDATES) throw new Error(`후보 경계 ${N} > ${MAX_CANDIDATES} — 지오메트리 축소 필요`);
    const out = [];
    for (let mask = 0; mask < (1 << N); mask++) {
      const walls = new Set();
      for (let i = 0; i < N; i++) if (mask & (1 << i)) walls.add(cand[i]);
      out.push({ walls, k: walls.size, eLoss: evaluate(graph, walls, w) });
    }
    return out;
  }

  // 벽 개수 k별 최소 손실 배치.
  function bestByK(results) {
    const best = {};
    for (const r of results)
      if (!best[r.k] || r.eLoss < best[r.k].eLoss) best[r.k] = r;
    return best;
  }

  // 자재-블라인드 그래프: 모든 구획을 이 건물의 '평균 방'으로 치환(ig·alpha 균일).
  // 이 툴 없이 설계하는 회사가 도면만 보고 하는 가정에 해당.
  function blindGraph(graph) {
    let ig = 0, alpha = 0;
    graph.comps.forEach(c => { const m = MATERIALS[c.material]; ig += m.ig; alpha += m.alpha; });
    ig /= graph.comps.length; alpha /= graph.comps.length;
    const AVG = "__AVG__";
    MATERIALS[AVG] = { label: "평균 방", ig, alpha };
    const comps = graph.comps.map(c => ({ ...c, material: AVG }));
    return computeGraphFrom(comps);
  }
  // graph는 adj가 필요하므로 comps로부터 재구성(엣지 id는 원본과 동일 규칙).
  function computeGraphFrom(comps) {
    const edges = [];
    for (let i = 0; i < comps.length; i++)
      for (let j = i + 1; j < comps.length; j++) {
        const seg = DATA.sharedWall(comps[i], comps[j]);
        if (seg) edges.push({ id: `W${comps[i].id}__${comps[j].id}`, a: comps[i].id, b: comps[j].id, seg });
      }
    const adj = {}; comps.forEach(c => adj[c.id] = []);
    edges.forEach(e => { adj[e.a].push({ edgeId: e.id, to: e.b }); adj[e.b].push({ edgeId: e.id, to: e.a }); });
    return { comps, edges, adj };
  }

  // 무거운 전수탐색은 여기서 한 번만. 레이아웃/자재 변경 시 호출.
  function analyze(graph) {
    const wTrue = weights(graph, "material");
    const bg = blindGraph(graph);
    const bBlind = bestByK(enumerate(bg, weights(bg, "material"))); // 블라인드 물리로 최적화
    const bAware = bestByK(enumerate(graph, wTrue));                // 진짜 물리로 최적화
    const kMax = Math.max(...Object.keys(bAware).map(Number));
    const e0 = evaluate(graph, new Set(), wTrue);
    return { wTrue, bBlind, bAware, kMax, e0 };
  }

  // 가벼운 부분: 특정 k에서 두 설계안을 뽑아 진짜 물리로 평가. 슬라이더용.
  function resultAtK(graph, an, k) {
    const kk = Math.min(k, an.kMax);
    const xBlind = an.bBlind[kk] ? an.bBlind[kk].walls : new Set();
    const xAware = an.bAware[kk] ? an.bAware[kk].walls : new Set();
    const eBlind = evaluate(graph, xBlind, an.wTrue);
    const eAware = evaluate(graph, xAware, an.wTrue);
    return {
      k: kk, kMax: an.kMax, xBlind, xAware, e0: an.e0, eBlind, eAware,
      reductionVsBlind: eBlind > 0 ? (eBlind - eAware) / eBlind : 0, // 헤드라인
      reductionVsNone:  an.e0  > 0 ? (an.e0  - eAware) / an.e0  : 0,
    };
  }

  const compareAtK = (graph, k) => resultAtK(graph, analyze(graph), k); // 편의(selftest)

  // 경계별 방화 보강 우선순위(임계도, leave-one-out).
  // 규제 기본 구획이 모든 경계에 깔린 상태(전 경계 격리)에서, "그 경계만 약하면
  // 얼마나 손실이 늘어나는가" = 그 경계의 임계도. 클수록 집중 보강 대상.
  function priorityRanking(graph) {
    const w = weights(graph, "material");
    const all = new Set(graph.edges.map(e => e.id));
    const base = evaluate(graph, new Set(), w); // 규제 최소(무보강 극단) 참고값
    const eAll = evaluate(graph, all, w);        // 전 경계 격리(최대 보강)
    const scores = graph.edges.map(e => {
      const s = new Set(all); s.delete(e.id);
      return { id: e.id, crit: evaluate(graph, s, w) - eAll }; // 이 경계만 약화 시 손실 증가
    });
    const maxC = Math.max(...scores.map(s => s.crit), 1e-9);
    scores.forEach(s => { s.intensity = s.crit / maxC; }); // 0~1
    scores.sort((a, b) => b.crit - a.crit);
    scores.forEach((s, i) => {
      s.rank = i + 1;
      s.tier = s.intensity >= 0.7 ? 3 : s.intensity >= 0.4 ? 2 : 1; // 3=집중 2=보강 1=기본
    });
    return { base, eAll, scores };
  }

  const api = { edgeTau, spread, weights, evaluate, enumerate, bestByK,
                analyze, resultAtK, compareAtK, priorityRanking, blindGraph, MAX_CANDIDATES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FIRE_ENGINE = api;
})(typeof window !== "undefined" ? window : globalThis);
