/* selftest.js — node로 실행: `node selftest.js`
 * 레이아웃 정합성 + 공간 위험도 필드(그라데이션·2채널·건축자재 논지). */
const D = require("./data.js");
const R = require("./risk.js");
const { LAYOUTS, MATERIALS } = D;

let fail = 0;
const check = (cond, msg) => { if (!cond) { console.error("  FAIL:", msg); fail++; } };
const overlap = (a, b) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0 &&
  Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > 0;

console.log(`레이아웃 ${LAYOUTS.length}개 검증\n`);
console.log("ID   | 셀격자  | 방내 그라데이션폭 | 화염max | 가스max | 위험지수");
console.log("-----|--------|-----------------|--------|--------|--------");

const danger = {};
let maxMs = 0, maxIntraRel = 0;
for (const L of LAYOUTS) {
  // 1) 자재 + tox 존재, 겹침 없음
  L.comps.forEach(c => {
    check(MATERIALS[c.material], `${L.id} ${c.id} 자재 오타: ${c.material}`);
    check(typeof MATERIALS[c.material].tox === "number", `${L.id} ${c.material} tox 없음`);
  });
  for (let i = 0; i < L.comps.length; i++)
    for (let j = i + 1; j < L.comps.length; j++)
      check(!overlap(L.comps[i], L.comps[j]), `${L.id} 구획 겹침`);

  // 2) 위험도 필드
  const t0 = process.hrtime.bigint();
  const f = R.computeField(L);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6; maxMs = Math.max(maxMs, ms);
  const g = f.grid, n = g.cols * g.rows;

  // 3) void(구획 밖) 셀 비율 낮아야 — 구획이 box를 타일링
  let voids = 0; for (let i = 0; i < n; i++) if (g.room[i] < 0) voids++;
  check(voids / n < 0.03, `${L.id} void 셀 과다 ${(voids / n * 100).toFixed(0)}% (구획 미타일링?)`);

  // 4) 절대 정규화 [0,1] (안전 설계는 낮음 — 최댓값 1 아님이 정상)
  let bmax = 0, ok01 = true;
  for (let i = 0; i < n; i++) { const v = f.risk.field[i]; if (v > 1.0001 || v < -1e-9) ok01 = false; if (v > bmax) bmax = v; }
  check(ok01, `${L.id} 위험도 0~1 벗어남`);

  // 5) 절대 스케일: 가연 설계안은 뚜렷이 위험(>0.45), 내화 설계안은 낮음(<0.4).
  const COMB = ["L02", "L04", "L06", "L08", "L10", "L12", "L14"];
  if (COMB.includes(L.id)) check(bmax > 0.45, `${L.id} 가연 설계안인데 위험도 낮음 ${bmax.toFixed(2)}`);
  else check(bmax < 0.4, `${L.id} 내화 설계안인데 위험도 높음 ${bmax.toFixed(2)}`);

  // 방 안 그라데이션(상대) — 전체에서 강한 사례가 존재하는지 누적(균일 건물엔 요구 안 함)
  const per = {};
  for (let i = 0; i < n; i++) { if (g.room[i] < 0) continue; (per[g.room[i]] = per[g.room[i]] || []).push(f.risk.field[i]); }
  let intra = 0;
  for (const k in per) { const a = per[k]; intra = Math.max(intra, Math.max(...a) - Math.min(...a)); }
  maxIntraRel = Math.max(maxIntraRel, bmax > 0 ? intra / bmax : 0);

  // 6) 유독가스가 화염보다 넓게 퍼짐: gas>0.5 셀 수 ≥ fire>0.5 셀 수
  let fc = 0, gc = 0;
  for (let i = 0; i < n; i++) { if (g.room[i] < 0) continue; if (f.fire.field[i] > 0.5) fc++; if (f.gas.field[i] > 0.5) gc++; }
  check(gc >= fc, `${L.id} 가스 확산폭 < 화염 (모델 오류)`);

  danger[L.id] = f.raw.fireMax + f.raw.gasMax;
  console.log(
    `${L.id} | ${(g.cols + "x" + g.rows).padStart(6)} | ${intra.toFixed(2).padStart(15)} | ` +
    `${f.raw.fireMax.toFixed(1).padStart(6)} | ${f.raw.gasMax.toFixed(1).padStart(6)} | ${danger[L.id].toFixed(1).padStart(6)}`
  );
}

// 7) 건축자재 논지: 가연 설계안 > 내화 설계안 위험지수
const pairs = [["L02", "L03"], ["L04", "L05"], ["L08", "L09"], ["L12", "L11"], ["L14", "L15"]];
console.log("\n건축자재 논지 (가연 vs 내화 위험지수):");
for (const [comb, res] of pairs) {
  const ok = danger[comb] > danger[res] * 1.1;
  console.log(`  ${comb} ${danger[comb].toFixed(1)} > ${res} ${danger[res].toFixed(1)}  ${ok ? "OK" : "✗"}`);
  check(ok, `${comb}(가연) 위험이 ${res}(내화)보다 크지 않음`);
}

// 경도(파괴 난이도) + 2중 접합 MAX 규칙
for (const [k, m] of Object.entries(MATERIALS))
  check(typeof m.hard === "number" && m.hard >= 0 && m.hard <= 1, `${k} hard 값 이상`);
check(D.breachTier(0.1).short === "쉬움" && D.breachTier(0.95).short === "불가", "경도 tier 분류 오류");
check(D.wallBreach("drywall", "rc_concrete").short === "불가", "2중 접합 MAX 규칙 오류(드라이월+RC=불가여야)");
check(D.wallBreach("drywall", "eps_panel").short === "쉬움", "2중 접합 판정 오류(둘 다 약함=쉬움)");

// 벽 자재(resist) + 방화벽 완화 + 안전 경로
for (const [k, m] of Object.entries(MATERIALS))
  check(typeof m.resist === "number" && m.resist >= 0 && m.resist <= 1, `${k} resist 값 이상`);
{
  const L = JSON.parse(JSON.stringify(LAYOUTS.find(l => l.id === "L02")));
  const g = R.buildGrid(L), at = (x, y) => Math.floor(y / g.cs) * g.cols + Math.floor(x / g.cs);
  const src = at(10, 20), probe = at(30, 20);
  const before = R.scenarioField(L, [src]).field[probe];
  L.wallMat = { "WSTOR_A__STOR_B": "firewall_rated" };
  const after = R.scenarioField(L, [src]).field[probe];
  console.log(`\n방화벽 완화: 인접 노출 ${before.toFixed(3)} → ${after.toFixed(3)}`);
  check(after < before * 0.9, `방화벽이 확산을 완화하지 못함 (${before.toFixed(2)}→${after.toFixed(2)})`);
  const f = R.scenarioField(L, [src]);
  const sp = R.safestPath(g, f.field, at(50, 16));
  check(sp && sp.path.length >= 2, "안전경로 계산 실패");
  const e = sp.entry, perim = e % g.cols === 0 || (e / g.cols | 0) === 0 || e % g.cols === g.cols - 1 || (e / g.cols | 0) === g.rows - 1;
  check(perim, "안전 진입점이 외곽이 아님");
}

console.log(`\n방내 그라데이션 최대(상대): ${maxIntraRel.toFixed(2)}`);
check(maxIntraRel > 0.4, `방 안 그라데이션 강한 사례 없음 ${maxIntraRel.toFixed(2)} (방 단위 균일?)`);

console.log(`최대 computeField 시간: ${maxMs.toFixed(0)}ms`);
check(maxMs < 800, `computeField ${maxMs.toFixed(0)}ms > 800ms`);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAIL`);
process.exit(fail ? 1 : 0);
