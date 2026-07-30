/* risk.js — 공간 위험도 필드.
 * 도면을 고정 셀로 나눠 '모든 셀이 발화원'인 케이스를 전부 돌려 합산.
 * 두 채널: 화염(근거리·벽에 막힘) + 유독가스(원거리·벽 통과). 방 안에서도 그라데이션. */
(function (root) {
  "use strict";
  const D = (typeof module !== "undefined" && module.exports) ? require("./data.js") : root.FIRE_DATA;
  const { MATERIALS, RISK, roomFireProps } = D;
  const MAX_ALPHA = 0.40;

  // 셀 격자 구성: 셀 중심이 속한 구획 → 자재 상속. (구획이 box를 타일링)
  function buildGrid(layout) {
    const [W, H] = layout.box, cs = RISK.cell;
    const cols = Math.ceil(W / cs), rows = Math.ceil(H / cs);
    const room = new Array(cols * rows).fill(-1);
    const wx = new Array(cols * rows), wy = new Array(cols * rows);
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
      const cx = (gx + 0.5) * cs, cy = (gy + 0.5) * cs, i = gy * cols + gx;
      wx[i] = cx; wy[i] = cy;
      // 격자 오버행(box보다 큰 마지막 행/열) 보정: 질의점을 box 안으로 클램프
      const qx = Math.min(cx, W - 1e-6), qy = Math.min(cy, H - 1e-6);
      const r = layout.comps.findIndex(c => qx >= c.x && qx < c.x + c.w && qy >= c.y && qy < c.y + c.d);
      room[i] = r; // -1 = 실제 타일링 갭만
    }
    // 방별 실효 화재특성(바닥+벽 블렌드) 및 화염 통과성 사전계산
    const eff = layout.comps.map(roomFireProps);
    const combust = eff.map(e => RISK.burnMin + (1 - RISK.burnMin) * (e.alpha / MAX_ALPHA));
    return { cols, rows, cs, room, wx, wy, comps: layout.comps, layout, eff, combust };
  }

  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // 두 방 사이 벽의 방화 차단성능(resist). 벽 자재 지정(layout.wallMat) 우선, 없으면 두 방 중 MAX.
  function wallResist(grid, ra, rb) {
    const comps = grid.comps, i = Math.min(ra, rb), j = Math.max(ra, rb);
    const eid = `W${comps[i].id}__${comps[j].id}`;
    const wm = grid.layout.wallMat && grid.layout.wallMat[eid];
    if (wm && MATERIALS[wm]) return MATERIALS[wm].resist;
    return Math.max(MATERIALS[comps[ra].material].resist, MATERIALS[comps[rb].material].resist);
  }
  // 벽 통과 페널티 배율: 차단성능 높을수록 큼(방화벽 = 강한 차단·완화).
  const wallFactor = (grid, ra, rb) => 0.4 + 3.0 * wallResist(grid, ra, rb);

  // 분리형 박스 블러(void 무시). 발화원 격자 봉우리 → 부드러운 그라데이션.
  function blurField(a, room, cols, rows, rad) {
    if (!rad) return a.slice();
    const n = cols * rows, tmp = new Float64Array(n), out = new Float64Array(n);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let s = 0, cnt = 0;
      for (let k = -rad; k <= rad; k++) { const xx = x + k; if (xx < 0 || xx >= cols) continue; const i = y * cols + xx; if (room[i] < 0) continue; s += a[i]; cnt++; }
      tmp[y * cols + x] = cnt ? s / cnt : 0;
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const idx = y * cols + x; if (room[idx] < 0) { out[idx] = 0; continue; }
      let s = 0, cnt = 0;
      for (let k = -rad; k <= rad; k++) { const yy = y + k; if (yy < 0 || yy >= rows) continue; const i = yy * cols + x; if (room[i] < 0) continue; s += tmp[i]; cnt++; }
      out[idx] = cnt ? s / cnt : 0;
    }
    return out;
  }

  // 다익스트라 거리장(한 발화원 → 전 셀). mode: "fire" | "gas"
  function dist(grid, src, mode) {
    const { cols, rows, cs, room } = grid, n = cols * rows;
    const d = new Float64Array(n).fill(Infinity);
    d[src] = 0;
    // 간단 이진 힙
    const heap = [[0, src]];
    const push = (p, v) => { heap.push([p, v]); let c = heap.length - 1; while (c > 0) { const par = (c - 1) >> 1; if (heap[par][0] <= heap[c][0]) break;[heap[par], heap[c]] = [heap[c], heap[par]]; c = par; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (; ;) { let l = 2 * c + 1, r = l + 1, m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break;[heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    while (heap.length) {
      const [du, u] = pop();
      if (du > d[u]) continue;
      const ux = u % cols, uy = (u / cols) | 0;
      for (const [dx, dy] of N4) {
        const nx = ux + dx, ny = uy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const v = ny * cols + nx;
        if (room[v] < 0) continue; // void
        const cross = room[v] !== room[u];
        let cost = mode === "fire" ? cs / grid.combust[room[v]] : cs;
        if (cross) cost += (mode === "fire" ? RISK.wallF : RISK.wallG) * wallFactor(grid, room[u], room[v]);
        const nd = du + cost;
        if (nd < d[v]) { d[v] = nd; push(nd, v); }
      }
    }
    return d;
  }

  // 전체 위험도 필드. 모든 유효 셀을 발화원으로 합산. applyPings=발화가중 핑 반영.
  function computeField(layout, applyPings) {
    const grid = buildGrid(layout);
    const { cols, rows, room, comps } = grid, n = cols * rows;
    const fire = new Float64Array(n), gas = new Float64Array(n);
    // 발화원을 srcStride 간격으로 샘플(성능). 렌더 격자는 그대로 촘촘.
    const str = RISK.srcStride, sources = [];
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
      if (gy % str === 0 && gx % str === 0) { const i = gy * cols + gx; if (room[i] >= 0) sources.push(i); }
    }
    // 소스 = 기본(자재 발화성) 격자 + (옵션) 발화가중 핑(내용물 자체 연소)
    const emit = (s, weight, aI, tI) => {
      const df = dist(grid, s, "fire"), dg = dist(grid, s, "gas");
      for (let c = 0; c < n; c++) {
        if (room[c] < 0) continue;
        if (df[c] < Infinity) fire[c] += weight * aI * Math.exp(-df[c] / RISK.lamF);
        if (dg[c] < Infinity) gas[c] += weight * tI * Math.exp(-dg[c] / RISK.lamG);
      }
    };
    for (const s of sources) { const M = grid.eff[room[s]]; emit(s, M.ig, M.alpha, M.tox); }
    if (applyPings && layout.weightPings)                     // 점 가중치(핑, 1~5단계)
      for (const [cell, level] of Object.entries(layout.weightPings)) {
        const s = +cell; if (room[s] >= 0) emit(s, level * RISK.pingW, RISK.pingAlpha, RISK.pingTox);
      }
    // 발화원 격자 봉우리를 블러로 퍼뜨려 점무늬 제거
    const fb = blurField(fire, room, cols, rows, RISK.blur);
    const gb = blurField(gas, room, cols, rows, RISK.blur);
    const riskRaw = new Float64Array(n);
    for (let c = 0; c < n; c++) if (room[c] >= 0) riskRaw[c] = RISK.wF * fb[c] + RISK.wG * gb[c];
    const maxOf = a => { let m = 0; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; };
    // 절대 기준 정규화(clamp) — 안전 설계는 낮게, 가연 설계만 높게
    const disp = (a, ref) => { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i++) o[i] = room[i] < 0 ? 0 : Math.min(1, a[i] / ref); return { field: o, max: maxOf(a) }; };
    return {
      grid,
      fire: disp(fb, RISK.refFire),
      gas: disp(gb, RISK.refGas),
      risk: disp(riskRaw, RISK.refRisk),
      raw: { fireMax: maxOf(fb), gasMax: maxOf(gb), riskMax: maxOf(riskRaw) },
    };
  }

  // 수동 발화점 시나리오: 지정한 발화 셀들만의 확산 → 노출 필드 + 가장 안전한 셀.
  // 각 발화점 세기 = 그 지점 자재의 연소강도(화염)·유독가스 발생(가스).
  function scenarioField(layout, srcList) {
    const grid = buildGrid(layout);
    const { cols, rows, room, comps } = grid, n = cols * rows;
    const fire = new Float64Array(n), gas = new Float64Array(n);
    for (const s of srcList) {
      if (room[s] < 0) continue;
      const M = grid.eff[room[s]];              // 바닥+벽 블렌드
      const df = dist(grid, s, "fire"), dg = dist(grid, s, "gas");
      for (let c = 0; c < n; c++) {
        if (room[c] < 0) continue;
        if (df[c] < Infinity) fire[c] += M.alpha * Math.exp(-df[c] / RISK.lamF);
        if (dg[c] < Infinity) gas[c] += M.tox * Math.exp(-dg[c] / RISK.lamG);
      }
    }
    const fb = blurField(fire, room, cols, rows, RISK.blur), gb = blurField(gas, room, cols, rows, RISK.blur);
    const comb = new Float64Array(n); let mx = 0;
    for (let c = 0; c < n; c++) { if (room[c] < 0) continue; comb[c] = RISK.wF * fb[c] + RISK.wG * gb[c]; if (comb[c] > mx) mx = comb[c]; }
    const field = new Float64Array(n); let safe = -1;
    for (let c = 0; c < n; c++) {
      if (room[c] < 0) continue;
      field[c] = mx > 0 ? comb[c] / mx : 0;
      if (safe < 0 || field[c] < field[safe]) safe = c;
    }
    return { grid, field, safe };
  }

  // 가장 안전한 진입 경로: 외곽 최저노출 지점(진입점) → target 핑까지 노출 최소 경로.
  function safestPath(grid, field, target) {
    const { cols, rows, room } = grid, n = cols * rows;
    if (target < 0 || room[target] < 0) return null;
    let entry = -1;                    // 외곽(퍼리미터) 셀 중 노출 최소 = 안전 진입점
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
      const i = gy * cols + gx; if (room[i] < 0) continue;
      if (!(gx === 0 || gy === 0 || gx === cols - 1 || gy === rows - 1)) continue;
      if (entry < 0 || field[i] < field[entry]) entry = i;
    }
    if (entry < 0) return null;
    const d = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
    d[entry] = 0;
    const heap = [[0, entry]];
    const push = (p, v) => { heap.push([p, v]); let c = heap.length - 1; while (c > 0) { const par = (c - 1) >> 1; if (heap[par][0] <= heap[c][0]) break;[heap[par], heap[c]] = [heap[c], heap[par]]; c = par; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (; ;) { let l = 2 * c + 1, r = l + 1, m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break;[heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    while (heap.length) {
      const [du, u] = pop(); if (du > d[u]) continue; if (u === target) break;
      const ux = u % cols, uy = (u / cols) | 0;
      for (const [dx, dy] of N4) {
        const nx = ux + dx, ny = uy + dy; if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const v = ny * cols + nx; if (room[v] < 0) continue;
        let cost = 1 + field[v] * 8;                                       // 이동 + 노출가중
        if (room[v] !== room[u]) cost += 3 + 6 * wallResist(grid, room[u], room[v]); // 벽 통과(문/차단)
        const nd = du + cost;
        if (nd < d[v]) { d[v] = nd; prev[v] = u; push(nd, v); }
      }
    }
    if (d[target] === Infinity) return null;
    const path = []; for (let c = target; c >= 0; c = prev[c]) path.push(c);
    return { entry, target, path: path.reverse() };
  }

  const api = { buildGrid, computeField, scenarioField, safestPath, wallResist };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FIRE_RISK = api;
})(typeof window !== "undefined" ? window : globalThis);
