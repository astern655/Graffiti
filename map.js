/* 실도면 위험도 뷰어
   ① 자재 편집: 실 클릭 → 기자재 변경 → 디폴트 위험도 실시간 갱신
   ② 회사 가중치: 디폴트 위험도에 가산해 회사 맞춤 커스터마이징 (발화점 시뮬 아님)
   실도면 배경 + 초세분 히트맵 + pan/zoom + 저장. */
(() => {
  const LAYOUT_ID = "ELDER_33_REAL";

  // ── 도면 배경 (정리 도면, 우측 온전 세대 크롭) ──
  let BG_W = 4.2, BG_H = 10.0;
  const bg = new Image(); let bgReady = false;
  bg.onload = () => { bgReady = true; BG_H = BG_W * (bg.naturalHeight / bg.naturalWidth); rebuild(); };
  bg.onerror = () => { bgReady = false; rebuild(); };
  bg.src = "floor-bg.png";

  // ── 기자재 라이브러리 (선택 가능한 마감·구조 조성). ig=발화·연소성, tox=유독가스. 0~1. ──
  const MATLIB = [
    { id:"conc_eps_gyp", name:"콘크리트+EPS단열+석고 (표준 세대)", ig:0.30, tox:0.58 },
    { id:"conc_xps_gyp", name:"콘크리트+압출법(XPS)+석고",        ig:0.28, tox:0.52 },
    { id:"masonry_tile", name:"콘크리트+조적+타일 (욕실)",         ig:0.10, tox:0.20 },
    { id:"conc_fire",    name:"콘크리트+방화문 (현관)",            ig:0.15, tox:0.30 },
    { id:"glass_rail",   name:"외기·유리난간 (발코니)",            ig:0.15, tox:0.25 },
    { id:"gypsum_only",  name:"석고보드 준불연 마감",              ig:0.20, tox:0.25 },
    { id:"conc_bare",    name:"콘크리트 노출 (불연)",              ig:0.08, tox:0.12 },
    { id:"eps_panel",    name:"샌드위치패널 EPS (가연·위험)",       ig:0.72, tox:0.80 },
    { id:"pur_panel",    name:"샌드위치패널 우레탄 PUR (고위험)",   ig:0.80, tox:0.95 },
    { id:"clt_timber",   name:"목구조 CLT",                       ig:0.55, tox:0.45 },
  ];
  const MAT = Object.fromEntries(MATLIB.map(m => [m.id, m]));

  // 실 구획 (배경 이미지 대비 비율 rect) + 기본 기자재. 정리 도면 우측 세대 판독.
  const ROOMS_F = [
    { name:"욕실",     mat:"masonry_tile", fx:0.04, fy:0.07, fw:0.38, fh:0.27 },
    { name:"현관",     mat:"conc_fire",    fx:0.44, fy:0.05, fw:0.28, fh:0.14 },
    { name:"주방",     mat:"conc_eps_gyp", fx:0.68, fy:0.18, fw:0.30, fh:0.24 },
    { name:"거실·침실", mat:"conc_eps_gyp", fx:0.03, fy:0.40, fw:0.95, fh:0.37 },
    { name:"발코니",   mat:"glass_rail",   fx:0.03, fy:0.77, fw:0.95, fh:0.20 },
  ];
  let rooms = [], selRoom = null;
  const buildRooms = () => { rooms = ROOMS_F.map(r => ({ name:r.name, mat:r.mat, x:r.fx*BG_W, y:r.fy*BG_H, w:r.fw*BG_W, d:r.fh*BG_H })); selRoom = null; };
  const roomAt = (x,y) => rooms.find(r => x>=r.x && x<=r.x+r.w && y>=r.y && y<=r.y+r.d);

  // ── 회사 가중치 (②단계, 디폴트에 가산). 시작 비어있음. ──
  let pings = [], curLevel = 3;

  // ── 격자 ──
  const CELL = 0.1, MAT_LAM_F = 0.9, MAT_LAM_G = 2.2, W_GAS = 0.5;
  const PING_LAM = 1.2, PING_GAIN = 0.14;   // 가중치: 레벨당 국소 가산량
  let COLS = 1, ROWS = 1, matN = new Float32Array(1), pingAdd = new Float32Array(1), field = new Float32Array(1);

  function boxBlur(src, cols, rows, r, passes){
    let a = Float32Array.from(src), b = new Float32Array(a.length), d = 2*r+1;
    const cl = (v,hi) => v<0?0:(v>hi?hi:v);
    for (let p=0;p<(passes||2);p++){
      for (let y=0;y<rows;y++){ const base=y*cols; let s=0;
        for (let x=-r;x<=r;x++) s+=a[base+cl(x,cols-1)];
        for (let x=0;x<cols;x++){ b[base+x]=s/d; s+=a[base+cl(x+r+1,cols-1)]-a[base+cl(x-r,cols-1)]; } }
      for (let x=0;x<cols;x++){ let s=0;
        for (let y=-r;y<=r;y++) s+=b[cl(y,rows-1)*cols+x];
        for (let y=0;y<rows;y++){ a[y*cols+x]=s/d; s+=b[cl(y+r+1,rows-1)*cols+x]-b[cl(y-r,rows-1)*cols+x]; } }
    }
    return a;
  }
  const REF = 0.72;   // 자재 위험도 고정 기준(정규화 대신 → 자재 바꾸면 절대적으로 변함)

  // ① 자재 기반 디폴트 위험도
  function computeMat(){
    COLS=Math.max(1,Math.round(BG_W/CELL)); ROWS=Math.max(1,Math.round(BG_H/CELL));
    const rawIg=new Float32Array(COLS*ROWS), rawTox=new Float32Array(COLS*ROWS);
    for (let gy=0; gy<ROWS; gy++) for (let gx=0; gx<COLS; gx++){
      const r=roomAt((gx+0.5)*CELL,(gy+0.5)*CELL);
      if (r){ const m=MAT[r.mat]; rawIg[gy*COLS+gx]=m.ig; rawTox[gy*COLS+gx]=m.tox; }
    }
    const fire=boxBlur(rawIg,COLS,ROWS,Math.max(1,Math.round(MAT_LAM_F/CELL/2)),2);
    const gas =boxBlur(rawTox,COLS,ROWS,Math.max(1,Math.round(MAT_LAM_G/CELL/2)),2);
    matN=new Float32Array(COLS*ROWS);
    for (let i=0;i<matN.length;i++) matN[i]=Math.min(1,(fire[i]+W_GAS*gas[i])/REF); // 고정 기준 → 절대 변화
  }
  // ② 회사 가중치 가산량 (정규화 X, 디폴트에 그대로 더함)
  function computePing(){
    pingAdd=new Float32Array(COLS*ROWS);
    if (!pings.length) return;
    for (let gy=0; gy<ROWS; gy++) for (let gx=0; gx<COLS; gx++){
      const px=(gx+0.5)*CELL, py=(gy+0.5)*CELL; let v=0;
      for (const q of pings){ const d=Math.hypot(px-q.x,py-q.y); v+=q.level*PING_GAIN*Math.exp(-d/PING_LAM); }
      pingAdd[gy*COLS+gx]=v;
    }
  }
  function updateField(){
    if (layer==="mat") field=matN;
    else { field=new Float32Array(COLS*ROWS); for (let i=0;i<field.length;i++) field[i]=Math.min(1, matN[i]+pingAdd[i]); }
    buildHeat();
  }
  function rebuild(){ buildRooms(); computeMat(); computePing(); updateField(); fit(); render(); fillMatSel(); }

  function ramp(t){
    t=Math.max(0,Math.min(1,t));
    const s=[[43,89,208],[18,160,160],[63,191,95],[230,192,32],[224,86,42],[192,32,32]];
    const f=t*(s.length-1), i=Math.floor(f), k=f-i, a=s[i], b=s[Math.min(i+1,s.length-1)];
    return [a[0]+(b[0]-a[0])*k, a[1]+(b[1]-a[1])*k, a[2]+(b[2]-a[2])*k];
  }
  const heat=document.createElement("canvas");
  function buildHeat(){
    heat.width=COLS; heat.height=ROWS;
    const hc=heat.getContext("2d"), img=hc.createImageData(COLS,ROWS);
    for (let i=0;i<COLS*ROWS;i++){
      const t=Math.pow(field[i],0.85), c=ramp(t);
      img.data[i*4]=c[0]; img.data[i*4+1]=c[1]; img.data[i*4+2]=c[2];
      img.data[i*4+3]=Math.round(240*Math.pow(t,1.1));
    }
    hc.putImageData(img,0,0);
  }

  // ── 뷰포트 ──
  const cv=document.getElementById("map"), ctx=cv.getContext("2d");
  let scale=100, ox=0, oy=0;
  const S=x=>x*scale, WX=px=>(px-ox)/scale, WY=py=>(py-oy)/scale;
  function fit(){
    const r=cv.getBoundingClientRect(); cv.width=r.width*devicePixelRatio; cv.height=r.height*devicePixelRatio;
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
    const pad=40, sx=(r.width-pad*2)/BG_W, sy=(r.height-pad*2)/BG_H;
    scale=Math.min(sx,sy); ox=(r.width-BG_W*scale)/2; oy=(r.height-BG_H*scale)/2;
  }

  let layer="risk", mode="mat", heatOpacity=0.7, bgOpacity=1;
  function render(){
    const r=cv.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height);
    ctx.fillStyle="#ffffff"; ctx.fillRect(ox,oy,S(BG_W),S(BG_H));
    if (bgReady){ ctx.globalAlpha=bgOpacity; ctx.imageSmoothingEnabled=true; ctx.drawImage(bg,ox,oy,S(BG_W),S(BG_H)); ctx.globalAlpha=1; }
    else { ctx.fillStyle="#8892a3"; ctx.font="13px 'Segoe UI'"; ctx.textAlign="center";
      ctx.fillText("도면 배경(floor-bg.png) 없음", ox+S(BG_W)/2, oy+S(BG_H)/2); ctx.textAlign="start"; }
    if (layer!=="plan"){ ctx.globalAlpha=heatOpacity; ctx.imageSmoothingEnabled=true; ctx.drawImage(heat,ox,oy,S(BG_W),S(BG_H)); ctx.globalAlpha=1; }
    // 자재 편집 모드: 실 경계 + 선택 강조
    if (mode==="mat"){
      for (const rm of rooms){
        ctx.strokeStyle = rm===selRoom ? "#2e78ff" : "rgba(43,52,70,.35)";
        ctx.lineWidth = rm===selRoom ? 3 : 1.2;
        ctx.strokeRect(ox+S(rm.x), oy+S(rm.y), S(rm.w), S(rm.d));
        if (rm===selRoom){ ctx.fillStyle="rgba(46,120,255,.10)"; ctx.fillRect(ox+S(rm.x),oy+S(rm.y),S(rm.w),S(rm.d)); }
      }
    }
    ctx.strokeStyle="#2b3446"; ctx.lineWidth=2; ctx.strokeRect(ox,oy,S(BG_W),S(BG_H));
    // 가중치 핑
    for (const p of pings){
      const mx=ox+S(p.x), my=oy+S(p.y), c=ramp((p.level-1)/4), rad=Math.max(9,scale*0.09);
      ctx.beginPath(); ctx.arc(mx,my,rad,0,7); ctx.fillStyle=`rgba(${c[0]|0},${c[1]|0},${c[2]|0},.92)`; ctx.fill();
      ctx.lineWidth=2; ctx.strokeStyle="#fff"; ctx.stroke();
      ctx.fillStyle="#fff"; ctx.font=`700 ${Math.max(10,scale*0.08)}px "Segoe UI"`; ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(p.level, mx, my);
    }
    ctx.textAlign="start"; ctx.textBaseline="alphabetic";
    document.getElementById("pingCount").textContent = pings.length;
  }

  const hitPing=(wx,wy)=>{ const rad=Math.max(0.15,16/scale); for (let i=pings.length-1;i>=0;i--) if (Math.hypot(pings[i].x-wx,pings[i].y-wy)<rad) return i; return -1; };

  // ── 인터랙션 ──
  cv.addEventListener("wheel", e=>{
    e.preventDefault();
    const r=cv.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
    const wx=WX(mx), wy=WY(my), f=Math.exp(-e.deltaY*0.0012);
    scale=Math.max(20,Math.min(2000,scale*f)); ox=mx-wx*scale; oy=my-wy*scale; render();
  }, {passive:false});
  let drag=null, moved=false;
  cv.addEventListener("mousedown", e=>{ if(e.button!==0) return; drag={x:e.clientX,y:e.clientY,ox,oy}; moved=false; });
  window.addEventListener("mousemove", e=>{
    if(!drag) return; const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
    if(Math.abs(dx)+Math.abs(dy)>3){ moved=true; cv.classList.add("drag"); }
    ox=drag.ox+dx; oy=drag.oy+dy; render();
  });
  window.addEventListener("mouseup", e=>{
    if(drag && !moved){
      const r=cv.getBoundingClientRect(), wx=WX(e.clientX-r.left), wy=WY(e.clientY-r.top);
      if (wx>=0&&wx<=BG_W&&wy>=0&&wy<=BG_H){
        if (mode==="mat"){ selRoom = roomAt(wx,wy) || null; fillMatSel(); render(); }
        else { // 가중치 가산
          const i=hitPing(wx,wy);
          if (i>=0) pings[i].level = pings[i].level>=5?1:pings[i].level+1;
          else pings.push({x:wx,y:wy,level:curLevel});
          computePing(); updateField(); render();
        }
      }
    }
    drag=null; cv.classList.remove("drag");
  });
  cv.addEventListener("contextmenu", e=>{
    e.preventDefault(); if (mode!=="weight") return;
    const r=cv.getBoundingClientRect(), i=hitPing(WX(e.clientX-r.left), WY(e.clientY-r.top));
    if (i>=0){ pings.splice(i,1); computePing(); updateField(); render(); }
  });

  // ── 사이드 컨트롤 ──
  function fillMatSel(){
    const sel=document.getElementById("matSel"), lbl=document.getElementById("selRoom");
    if (!selRoom){ sel.disabled=true; sel.innerHTML='<option>— 실 선택 —</option>'; lbl.textContent="실을 클릭해 선택하세요"; return; }
    sel.disabled=false; lbl.textContent=`선택: ${selRoom.name}`;
    sel.innerHTML = MATLIB.map(m=>`<option value="${m.id}" ${m.id===selRoom.mat?"selected":""}>${m.name}</option>`).join("");
  }
  document.getElementById("matSel").addEventListener("change", e=>{
    if (!selRoom) return;
    selRoom.mat = e.target.value; computeMat(); updateField(); render(); // 실시간 갱신
  });
  function buildLv(){
    const el=document.getElementById("lvSel"); el.innerHTML="";
    for (let l=1;l<=5;l++){
      const b=document.createElement("button"); b.textContent=l; const c=ramp((l-1)/4);
      b.style.background = l===curLevel ? `rgb(${c[0]|0},${c[1]|0},${c[2]|0})` : "#fff";
      b.classList.toggle("on", l===curLevel);
      b.onclick=()=>{ curLevel=l; buildLv(); }; el.appendChild(b);
    }
  }
  document.getElementById("layerSeg").addEventListener("click", e=>{
    const b=e.target.closest("button"); if(!b) return;
    layer=b.dataset.l; [...e.currentTarget.children].forEach(x=>x.classList.toggle("on",x===b)); updateField(); render();
  });
  document.getElementById("modeSeg").addEventListener("click", e=>{
    const b=e.target.closest("button"); if(!b) return;
    mode=b.dataset.m; [...e.currentTarget.children].forEach(x=>x.classList.toggle("on",x===b));
    document.getElementById("matCard").style.display = mode==="mat"?"":"none";
    document.getElementById("weightCard").style.display = mode==="weight"?"":"none";
    document.getElementById("hint").textContent = mode==="mat"
      ? "자재 편집: 실 클릭 → 기자재 변경(위험도 실시간) · 휠 확대 · 드래그 이동"
      : "회사 가중치: 도면에 클릭해 가산 · 핑 클릭=레벨 순환 · 우클릭=삭제";
    if (mode!=="mat"){ selRoom=null; fillMatSel(); }
    render();
  });
  document.getElementById("opacity").addEventListener("input", e=>{ heatOpacity=e.target.value/100; render(); });
  document.getElementById("bgOpacity").addEventListener("input", e=>{ bgOpacity=e.target.value/100; render(); });
  document.getElementById("reset").addEventListener("click", ()=>{ fit(); render(); });
  document.getElementById("clear").addEventListener("click", ()=>{ pings=[]; computePing(); updateField(); render(); });

  // ── 저장 (자재 + 가중치, configs 재사용) ──
  const SB = window.supabase ? window.supabase.createClient(
    "https://euqpicarqsulcfdoeuls.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1cXBpY2FycXN1bGNmZG9ldWxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzNDYwNDQsImV4cCI6MjEwMDkyMjA0NH0.7VbZUiFfr2vgJjGfN4iSzQCjHnibFmGzcO23VvVp8bg"
  ) : null;
  const st = m => document.getElementById("status").textContent = m;
  const snapshot = () => ({ pings, mats: rooms.map(r=>r.mat) });
  document.getElementById("save").addEventListener("click", async ()=>{
    if(!SB) return st("클라우드 연결 불가 (온라인에서 사용)");
    const name=document.getElementById("preset").value.trim(); if(!name) return st("프리셋 이름을 입력하세요");
    st("저장 중…");
    const { error } = await SB.from("configs").upsert(
      { company:name, layout:LAYOUT_ID, data:snapshot(), updated_at:new Date().toISOString() }, { onConflict:"company,layout" });
    st(error ? "저장 오류: "+error.message : `저장됨 · ${name} (핑 ${pings.length})`);
  });
  document.getElementById("load").addEventListener("click", async ()=>{
    if(!SB) return st("클라우드 연결 불가 (온라인에서 사용)");
    const name=document.getElementById("preset").value.trim(); if(!name) return st("프리셋 이름을 입력하세요");
    st("불러오는 중…");
    const { data, error } = await SB.from("configs").select("data").eq("company",name).eq("layout",LAYOUT_ID).maybeSingle();
    if(error) return st("불러오기 오류: "+error.message);
    if(!data) return st(`저장된 프리셋 없음 · ${name}`);
    const d=data.data;
    if (d.mats) rooms.forEach((r,i)=>{ if(d.mats[i] && MAT[d.mats[i]]) r.mat=d.mats[i]; });
    pings=(d.pings||[]).map(p=>({x:p.x,y:p.y,level:p.level}));
    computeMat(); computePing(); updateField(); fillMatSel(); render(); st(`불러옴 · ${name} (핑 ${pings.length})`);
  });

  addEventListener("resize", ()=>{ fit(); render(); });
  buildLv(); rebuild();
})();
