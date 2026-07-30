/* ui.js — 공간 화재 위험도 히트맵. 방화벽 랭킹 없음. */
(function () {
  "use strict";
  const D = window.FIRE_DATA, R = window.FIRE_RISK;
  const { LAYOUTS, MATERIALS } = D;
  const cv = document.getElementById("plan"), ctx = cv.getContext("2d");
  const $ = id => document.getElementById(id);

  let layout = null, field = null, selectedId = null, layer = "risk";
  let mode = "map", srcSet = new Set(), scen = null; // 발화점 시나리오 상태
  let graphRef = null, wallsRef = null, matNoMap = {}, editTarget = null, ping = -1, pathRes = null, weightField = null;
  const compName = id => layout.comps.find(c => c.id === id).name;
  const compMat = id => layout.comps.find(c => c.id === id).material;
  const LAYER_NAME = { risk: "통합(열+유독가스)", fire: "화염", gas: "유독가스", hard: "경도(파괴 난이도)" };
  const MODE_NAME = { map: "위험도 지도", scenario: "발화점 시나리오", weight: "발화 가중치" };

  // 위험도 0~1 → 색 (파랑→청록→노랑→주황→적)
  const STOPS = [[40, 87, 180], [40, 170, 120], [240, 200, 40], [240, 130, 30], [220, 40, 40]];
  function heat(t) {
    t = Math.max(0, Math.min(1, t));
    const seg = t * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(seg)), u = seg - i;
    const a = STOPS[i], b = STOPS[i + 1];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  }

  // ── 도면 선택 ──
  function buildSelect() {
    const byGeo = {};
    LAYOUTS.forEach(L => (byGeo[L.geoName] = byGeo[L.geoName] || []).push(L));
    let html = "";
    for (const geo of Object.keys(byGeo)) {
      html += `<optgroup label="${geo}">`;
      byGeo[geo].forEach(L => { const sub = L.title.split("·")[1] ? L.title.split("·")[1].trim() : L.title; html += `<option value="${L.id}">${sub} (${L.id})</option>`; });
      html += `</optgroup>`;
    }
    $("planSel").innerHTML = html;
    $("planSel").addEventListener("change", e => selectLayout(e.target.value));
  }

  function selectLayout(id) {
    layout = JSON.parse(JSON.stringify(LAYOUTS.find(L => L.id === id)));
    selectedId = null; $("matEdit").classList.remove("show"); $("planSel").value = id;
    srcSet.clear(); scen = null; ping = -1; pathRes = null; editTarget = null;
    layout.weightPings = {}; weightField = null; // 격자 인덱스 의존 상태 초기화
    recompute();
    if (mode === "scenario") recomputeScenario();
    $("bldTitle").textContent = `${layout.geoName} — ${layout.title.split("·")[1].trim()}`;
    $("bldSub").textContent = `${layout.comps.length}개 구역 · ${field.grid.cols}×${field.grid.rows} 격자`;
    $("planMeta").textContent = `구역 ${layout.comps.length} · 셀 ${D.RISK.cell}m`;
  }

  function recompute() { graphRef = D.computeGraph(layout); wallsRef = buildWalls(); computeMatNumbers(); field = R.computeField(layout, false); render(); fillPanel(); fillWallLegend(); }
  function recomputeWeight() { weightField = R.computeField(layout, true); render(); }

  // 자재별 번호(도면에 쓰인 모든 자재: 구조·바닥·벽, 등장 순). 같은 자재=같은 번호.
  function computeMatNumbers() {
    matNoMap = {}; let n = 0;
    const add = m => { if (m && !(m in matNoMap)) matNoMap[m] = ++n; };
    for (const c of layout.comps) { add(c.material); add(c.floorMat || c.material); }
    for (const w of wallsRef) add(wallMatResolved(w));
  }

  // 클릭 지점에서 가장 가까운 벽(내벽+외벽). 임계 이내면 반환.
  function nearestWall(mx, my) {
    let best = null, bd = 1.4; // m
    for (const w of wallsRef) {
      const { x1, y1, x2, y2 } = w.seg;
      const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
      let t = ((mx - x1) * dx + (my - y1) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const px = x1 + t * dx, py = y1 + t * dy, dd = Math.hypot(mx - px, my - py);
      if (dd < bd) { bd = dd; best = w; }
    }
    return best;
  }
  const wallMatOf = eid => (layout.wallMat && layout.wallMat[eid]) || null;

  // ── 좌표 ──
  const box = () => layout.box;
  function scale() { const [W, H] = box(), pad = 24; return Math.min((cv.width - 2 * pad) / W, (cv.height - 2 * pad) / H); }
  const ox = () => (cv.width - box()[0] * scale()) / 2, oy = () => (cv.height - box()[1] * scale()) / 2;
  const tx = x => ox() + x * scale(), ty = y => oy() + y * scale();

  // ── 렌더 공통 헬퍼 ──
  function drawHeat(g, data) {
    const s = scale();
    const off = document.createElement("canvas"); off.width = g.cols; off.height = g.rows;
    const octx = off.getContext("2d"), img = octx.createImageData(g.cols, g.rows);
    for (let i = 0; i < g.cols * g.rows; i++) {
      const p = i * 4;
      if (g.room[i] < 0) { img.data[p + 3] = 0; continue; }
      const c = heat(data[i]);
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 190;
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, g.cols, g.rows, tx(0), ty(0), box()[0] * s, box()[1] * s);
  }
  // 히트맵 위 가독성: 흰 후광 + 채움
  function label(txt, x, y, color, font) {
    ctx.save(); ctx.font = font; ctx.lineJoin = "round"; ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,.92)"; ctx.strokeText(txt, x, y);
    ctx.fillStyle = color; ctx.fillText(txt, x, y); ctx.restore();
  }

  function drawOutlines() {
    const s = scale();
    for (const c of layout.comps) {
      const x = tx(c.x), y = ty(c.y), w = c.w * s, h = c.d * s;
      ctx.lineWidth = c.id === selectedId ? 2.5 : 1;
      ctx.strokeStyle = c.id === selectedId ? "#1f8a5b" : "rgba(40,55,70,.55)";
      ctx.strokeRect(x, y, w, h);
      label(c.name, x + 7, y + 17, "#101820", "700 12.5px system-ui");
      const sm = matNoMap[c.material], fm = matNoMap[c.floorMat || c.material];
      const mt = sm === fm ? `자재 #${sm}` : `구조 #${sm} · 바닥 #${fm}`;
      label(mt, x + 7, y + 32, "#3a4650", "11px system-ui");
    }
    ctx.lineWidth = 2; ctx.strokeStyle = "#3a4550";
    ctx.strokeRect(tx(0), ty(0), box()[0] * s, box()[1] * s);
  }
  function drawGridLines(g) {
    ctx.save(); ctx.strokeStyle = "rgba(40,55,70,.10)"; ctx.lineWidth = 0.5;
    for (let gx = 0; gx <= g.cols; gx++) { const X = tx(gx * g.cs); ctx.beginPath(); ctx.moveTo(X, ty(0)); ctx.lineTo(X, ty(box()[1])); ctx.stroke(); }
    for (let gy = 0; gy <= g.rows; gy++) { const Y = ty(gy * g.cs); ctx.beginPath(); ctx.moveTo(tx(0), Y); ctx.lineTo(tx(box()[0]), Y); ctx.stroke(); }
    ctx.restore();
  }
  const cellXY = (g, i) => [tx(g.wx[i]), ty(g.wy[i])];

  // 발화 가중치 = 점(핑) 5단계. 위험도 지도 전 기능(레이어 포함) + 가중치.
  const PLEVELS = ["#3ba55d", "#a8c53a", "#e0a520", "#e5622d", "#d21f1f"];
  function drawPings() {
    const g = weightField ? weightField.grid : field.grid;
    for (const [cell, level] of Object.entries(layout.weightPings || {})) {
      const [X, Y] = cellXY(g, +cell);
      drawPin(X, Y, PLEVELS[Math.min(5, level) - 1], String(level));
    }
  }
  function renderWeight() {
    if (layer === "hard") renderHardness();               // 경도도 지원
    else { if (weightField) drawHeat(weightField.grid, weightField[layer].field); drawOutlines(); drawWalls(mapWallColor); }
    drawPings();
  }

  function render() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (mode === "scenario") return renderScenario();
    if (mode === "weight") return renderWeight();
    if (layer === "hard") return renderHardness();
    drawHeat(field.grid, field[layer].field);
    drawOutlines();
    drawWalls(mapWallColor);
    $("layerName").textContent = LAYER_NAME[layer];
  }

  // 벽 목록: 내벽(computeGraph) + 외벽(프레임 = box 경계에 접한 방 변). 번호 부여.
  function buildWalls() {
    const walls = [];
    graphRef.edges.forEach(e => walls.push({ id: e.id, seg: e.seg, a: e.a, b: e.b, ext: false }));
    const [W, H] = layout.box;
    for (const c of layout.comps) {
      const S = [
        ["L", c.x === 0, { x1: c.x, y1: c.y, x2: c.x, y2: c.y + c.d }],
        ["R", c.x + c.w === W, { x1: c.x + c.w, y1: c.y, x2: c.x + c.w, y2: c.y + c.d }],
        ["T", c.y === 0, { x1: c.x, y1: c.y, x2: c.x + c.w, y2: c.y }],
        ["B", c.y + c.d === H, { x1: c.x, y1: c.y + c.d, x2: c.x + c.w, y2: c.y + c.d }],
      ];
      for (const [s, on, seg] of S) if (on) walls.push({ id: `X${c.id}_${s}`, seg, a: c.id, b: null, ext: true });
    }
    walls.forEach((w, i) => w.no = i + 1);
    return walls;
  }
  function wallMatResolved(w) {
    const wm = wallMatOf(w.id); if (wm) return wm;
    if (w.ext) return compMat(w.a);
    const a = compMat(w.a), b = compMat(w.b);           // 내벽 기본 = 경도 단단한 쪽
    return MATERIALS[a].hard >= MATERIALS[b].hard ? a : b;
  }
  const wallTier = w => D.breachTier(MATERIALS[wallMatResolved(w)].hard);
  const mapWallColor = w => ({ stroke: wallMatOf(w.id) ? "#6a4cff" : "#9aa4ae", width: wallMatOf(w.id) ? 7 : 5 });
  const tierWallColor = w => ({ stroke: wallTier(w).color, width: wallMatOf(w.id) ? 7 : 5 });

  // 모든 벽을 굵게 + 번호 배지로. colorFn(w) → {stroke,width}
  function drawWalls(colorFn) {
    if (!wallsRef) return;
    for (const w of wallsRef) {
      const sel = editTarget && editTarget.type === "wall" && editTarget.eid === w.id, co = colorFn(w);
      ctx.save(); ctx.strokeStyle = sel ? "#1f8a5b" : co.stroke; ctx.lineWidth = sel ? 9 : co.width; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(tx(w.seg.x1), ty(w.seg.y1)); ctx.lineTo(tx(w.seg.x2), ty(w.seg.y2)); ctx.stroke(); ctx.restore();
      const bx = tx((w.seg.x1 + w.seg.x2) / 2), by = ty((w.seg.y1 + w.seg.y2) / 2);
      ctx.save();
      ctx.beginPath(); ctx.arc(bx, by, 8.5, 0, 7); ctx.fillStyle = "#fff"; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = sel ? "#1f8a5b" : co.stroke; ctx.stroke();
      ctx.fillStyle = "#243040"; ctx.font = "700 10px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(matNoMap[wallMatResolved(w)], bx, by); ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
      ctx.restore();
    }
  }

  // 자재 번호 범례: 번호 → 자재명 (구획·벽 사용처)
  function fillWallLegend() {
    if (!wallsRef) { $("wallLegend").innerHTML = ""; return; }
    const wc = {}, rc = {};
    for (const w of wallsRef) { const m = wallMatResolved(w); wc[m] = (wc[m] || 0) + 1; }
    for (const c of layout.comps) for (const m of new Set([c.material, c.floorMat || c.material])) rc[m] = (rc[m] || 0) + 1;
    const rows = Object.entries(matNoMap).sort((a, b) => a[1] - b[1]);
    $("wallLegend").innerHTML = rows.map(([m, no]) => {
      const use = []; if (rc[m]) use.push(`구획 ${rc[m]}`); if (wc[m]) use.push(`벽 ${wc[m]}`);
      return `<div style="display:flex;gap:8px;padding:4px 2px;align-items:center;border-bottom:1px solid #eef1f4">
        <b style="min-width:22px;height:22px;border-radius:6px;background:#243040;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px">${no}</b>
        <span style="flex:1">${MATERIALS[m].label}</span>
        <span style="color:#6b7684">${use.join(" · ")}</span></div>`;
    }).join("");
  }

  // 마커(핀): 이중 링 + 라벨
  function drawPin(X, Y, color, label) {
    ctx.save();
    ctx.globalAlpha = .25; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X, Y, 16, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X, Y, 10, 0, 7); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = "#fff"; ctx.stroke();
    if (label) { ctx.fillStyle = "#fff"; ctx.font = "700 10px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, X, Y); ctx.textAlign = "start"; ctx.textBaseline = "alphabetic"; }
    ctx.restore();
  }

  // 경도(파괴 난이도) — 방 채움 tier + 벽(내벽+외벽) tier + 번호
  function renderHardness() {
    const s = scale();
    for (const c of layout.comps) {
      const t = D.breachTier(MATERIALS[c.material].hard);
      ctx.save(); ctx.globalAlpha = .22; ctx.fillStyle = t.color;
      ctx.fillRect(tx(c.x), ty(c.y), c.w * s, c.d * s); ctx.restore();
    }
    drawOutlines();
    drawWalls(tierWallColor);
    for (const c of layout.comps) {
      const t = D.breachTier(MATERIALS[c.material].hard);
      label(`진입: ${t.short}`, tx(c.x) + 7, ty(c.y) + 48, t.color, "700 11px system-ui");
    }
  }

  const dirOf = (g, i, comp) => {
    const rx = (g.wx[i] - comp.x) / comp.w, ry = (g.wy[i] - comp.y) / comp.d;
    return ((ry < .34 ? "북" : ry > .66 ? "남" : "") + (rx < .34 ? "서" : rx > .66 ? "동" : "")) || "중앙";
  };

  function renderScenario() {
    const g = field.grid;
    if (scen && srcSet.size) drawHeat(scen.grid, scen.field);
    drawGridLines(g);
    drawOutlines();
    drawWalls(tierWallColor);   // 시나리오에도 경도(벽 진입난이도)+번호
    // 안전 진입 경로
    if (pathRes && pathRes.path.length > 1) {
      ctx.save(); ctx.strokeStyle = "#2e78ff"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      pathRes.path.forEach((c, k) => { const [X, Y] = cellXY(g, c); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.stroke(); ctx.restore();
      const [ex, ey] = cellXY(g, pathRes.entry); drawPin(ex, ey, "#2e78ff", "진입");
    }
    for (const i of srcSet) { const [X, Y] = cellXY(g, i); drawPin(X, Y, "#e5322d", "발화"); }
    if (scen && srcSet.size && scen.safe >= 0) { const [X, Y] = cellXY(g, scen.safe); drawPin(X, Y, "#1f8a5b", "안전"); }
    if (ping >= 0) { const [X, Y] = cellXY(g, ping); drawPin(X, Y, "#9b30ff", "핑"); }
  }

  function recomputeScenario() {
    scen = srcSet.size ? R.scenarioField(layout, [...srcSet]) : null;
    const g = field.grid, n = g.cols * g.rows;
    const fld = scen ? scen.field : new Float64Array(n);
    pathRes = ping >= 0 ? R.safestPath(g, fld, ping) : null;
    render();
    if (!srcSet.size && ping < 0) {
      $("scenInfo").textContent = "좌클릭 = 발화점 지정, 우클릭 = 목표 핑(안전 진입경로).";
      $("scenSafe").textContent = ""; return;
    }
    $("scenInfo").textContent = srcSet.size ? `발화점 ${srcSet.size}곳 확산 시뮬레이션` : "발화점을 지정하면 위험 확산이 계산됩니다.";
    let html = "";
    if (scen && scen.safe >= 0) { const comp = layout.comps[g.room[scen.safe]]; html += `가장 안전: <span style="color:#1f8a5b">${comp.name} ${dirOf(g, scen.safe, comp)}측</span><br>`; }
    html += pathRes ? `<span style="color:#2e78ff">안전 진입경로</span> 표시됨` : `<span class="muted">우클릭으로 핑을 찍으면 안전 진입경로 표시</span>`;
    $("scenSafe").innerHTML = html;
  }

  // ── 패널 ──
  function hotspot() {
    const g = field.grid, data = field.risk.field; let mi = -1;
    for (let i = 0; i < data.length; i++) if (g.room[i] >= 0 && (mi < 0 || data[i] > data[mi])) mi = i;
    const comp = layout.comps[g.room[mi]];
    // 구획 내 방위(그라데이션 위치)
    const rx = (g.wx[mi] - comp.x) / comp.w, ry = (g.wy[mi] - comp.y) / comp.d;
    const ns = ry < .34 ? "북" : ry > .66 ? "남" : "", ew = rx < .34 ? "서" : rx > .66 ? "동" : "";
    const dir = (ns + ew) || "중앙";
    return { comp, dir };
  }

  function fillPanel() {
    const hs = hotspot();
    $("hotSpot").textContent = `${hs.comp.name} ${hs.dir}측 (${MATERIALS[hs.comp.material].label})`;
    // 화염/가스 위험 수준(절대) — 히트맵과 같은 기준(refFire·refGas) 대비 0~100%
    const fm = field.raw.fireMax, gm = field.raw.gasMax;
    const fp = Math.min(100, Math.round(fm / D.RISK.refFire * 100));
    const gp = Math.min(100, Math.round(gm / D.RISK.refGas * 100));
    $("firePc").textContent = fp + ""; $("gasPc").textContent = gp + "";
    $("fireBar").style.width = fp + "%"; $("gasBar").style.width = gp + "%";
    $("riskNote").textContent = gm > fm
      ? "유독가스가 화염보다 넓게 퍼져 위험을 지배합니다. 원거리 구역도 안전하지 않습니다."
      : "화염 위험이 지배적입니다. 발화 가능 구역 인접부가 위험합니다.";
  }

  // 모드·레이어에 맞는 범례 표시
  function updateLegends() {
    const hardView = layer === "hard" && mode !== "scenario"; // 시나리오는 노출 그라데이션
    $("hardLegend").style.display = hardView ? "" : "none";
    $("riskLegend").style.display = hardView ? "none" : "";
    $("weightLegend").style.display = mode === "weight" ? "" : "none";
    $("layerSeg").style.opacity = mode === "scenario" ? .45 : 1;
    $("viewLabel").textContent = mode === "scenario"
      ? `${MODE_NAME[mode]} · 좌클릭 발화점 / 우클릭 목표핑`
      : `${MODE_NAME[mode]} · ${LAYER_NAME[layer]}`;
  }

  // ── 레이어 토글 ──
  $("layerSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    layer = b.dataset.l;
    [...$("layerSeg").children].forEach(x => x.classList.toggle("on", x === b));
    updateLegends();
    render();
  });

  // ── 모드 토글 ──
  $("modeSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    mode = b.dataset.m;
    [...$("modeSeg").children].forEach(x => x.classList.toggle("on", x === b));
    const scenMode = mode === "scenario", weightMode = mode === "weight";
    $("layerSeg").style.opacity = scenMode ? .4 : 1;   // 레이어는 시나리오만 비활성(가중치는 전부 사용)
    $("layerSeg").style.pointerEvents = scenMode ? "none" : "auto";
    $("scenCard").style.display = scenMode ? "" : "none";
    updateLegends();
    if (scenMode) { $("matEdit").classList.remove("show"); selectedId = null; recomputeScenario(); }
    else if (weightMode) recomputeWeight();
    else render();
  });
  $("scenClear").addEventListener("click", () => { srcSet.clear(); ping = -1; recomputeScenario(); });

  // ── 캔버스 클릭: 지도=자재변경 / 시나리오=발화점 토글 ──
  cv.addEventListener("click", ev => {
    if (!layout) return;
    const r = cv.getBoundingClientRect();
    const ix = (ev.clientX - r.left) * (cv.width / r.width), iy = (ev.clientY - r.top) * (cv.height / r.height);
    const s = scale(), mx = (ix - ox()) / s, my = (iy - oy()) / s;
    const g = field.grid, cellAt = () => {
      const gx = Math.floor(mx / g.cs), gy = Math.floor(my / g.cs);
      if (gx < 0 || gy < 0 || gx >= g.cols || gy >= g.rows) return -1;
      const i = gy * g.cols + gx; return g.room[i] < 0 ? -1 : i;
    };
    if (mode === "scenario") {               // 좌클릭 = 발화점 토글
      const i = cellAt(); if (i < 0) return;
      srcSet.has(i) ? srcSet.delete(i) : srcSet.add(i);
      recomputeScenario(); return;
    }
    // 지도·가중치 모드: 좌클릭 = 자재 선택(벽 우선, 아니면 구획)
    const w = nearestWall(mx, my);
    if (w) return selectWall(w);
    const hit = layout.comps.find(c => mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.d);
    if (hit) selectComp(hit.id);
  });

  // 우클릭: 시나리오=목표 핑, 가중치=자재 편집(구획/벽)
  cv.addEventListener("contextmenu", ev => {
    ev.preventDefault();
    if (!layout) return;
    const r = cv.getBoundingClientRect();
    const ix = (ev.clientX - r.left) * (cv.width / r.width), iy = (ev.clientY - r.top) * (cv.height / r.height);
    const s = scale(), mx = (ix - ox()) / s, my = (iy - oy()) / s;
    if (mode === "scenario") {
      const g = field.grid, gx = Math.floor(mx / g.cs), gy = Math.floor(my / g.cs);
      if (gx < 0 || gy < 0 || gx >= g.cols || gy >= g.rows) return;
      const i = gy * g.cols + gx; if (g.room[i] < 0) return;
      ping = (ping === i) ? -1 : i; recomputeScenario(); return;
    }
    if (mode === "weight") {                  // 우클릭 = 발화가중 핑 1→5단계(넘으면 해제)
      const g = field.grid, gx = Math.floor(mx / g.cs), gy = Math.floor(my / g.cs);
      if (gx < 0 || gy < 0 || gx >= g.cols || gy >= g.rows) return;
      const i = gy * g.cols + gx; if (g.room[i] < 0) return;
      const lv = (layout.weightPings[i] || 0) + 1;
      if (lv > 5) delete layout.weightPings[i]; else layout.weightPings[i] = lv;
      recomputeWeight();
    }
  });

  const matOptions = (sel) => Object.keys(MATERIALS).map(m => `<option value="${m}" ${m === sel ? "selected" : ""}>${MATERIALS[m].label}</option>`).join("");

  function selectComp(id) {
    editTarget = { type: "room", id }; selectedId = id;
    const comp = layout.comps.find(c => c.id === id);
    $("matEdit").classList.add("show");
    $("selTitle").textContent = "구획 자재 (구조/벽 기본)";
    $("selName").textContent = `· ${comp.name}`;
    $("matSel").innerHTML = matOptions(comp.material);
    $("floorRow").style.display = "";
    $("floorSel").innerHTML = matOptions(comp.floorMat || comp.material);
    $("matHelp").textContent = "구조 자재 + 바닥 자재를 합쳐 발화·연소·유독가스를 계산합니다.";
    render();
  }

  function selectWall(w) {
    editTarget = { type: "wall", eid: w.id }; selectedId = null;
    const cur = wallMatOf(w.id);
    const label = w.ext ? `외벽 · ${compName(w.a)}` : `${compName(w.a)} ↔ ${compName(w.b)}`;
    $("matEdit").classList.add("show");
    $("selTitle").textContent = `벽 자재 (번호 ${matNoMap[wallMatResolved(w)]})`;
    $("selName").textContent = `· ${label}`;
    $("floorRow").style.display = "none";
    $("matSel").innerHTML = `<option value="__auto__" ${!cur ? "selected" : ""}>자동(방 기준)</option>` + matOptions(cur);
    $("matHelp").textContent = w.ext ? "외벽(프레임)의 진입 난이도·차단을 결정합니다." : "이 벽의 확산 차단(방화벽=완화)·경도를 결정합니다.";
    render();
  }

  $("matSel").addEventListener("change", e => {
    if (!editTarget) return;
    if (editTarget.type === "room") layout.comps.find(c => c.id === editTarget.id).material = e.target.value;
    else {
      layout.wallMat = layout.wallMat || {};
      if (e.target.value === "__auto__") delete layout.wallMat[editTarget.eid];
      else layout.wallMat[editTarget.eid] = e.target.value;
    }
    recompute(); if (mode === "scenario") recomputeScenario(); else if (mode === "weight") recomputeWeight();
  });

  $("floorSel").addEventListener("change", e => {
    if (!editTarget || editTarget.type !== "room") return;
    layout.comps.find(c => c.id === editTarget.id).floorMat = e.target.value;
    recompute(); if (mode === "scenario") recomputeScenario(); else if (mode === "weight") recomputeWeight();
  });

  buildSelect();
  selectLayout(LAYOUTS[1].id); // L02 패널 경제형 — 위험 뚜렷
  updateLegends();
})();
