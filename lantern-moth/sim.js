// Lantern Moth — 순수 시뮬레이션 모듈 (Phaser 의존 0)
// -----------------------------------------------------------------------------
// game.js(렌더) 와 test/solver.mjs(Node 검증) 가 같은 코드를 쓴다 → 레벨 해답·par·가독성 지표를
// 브라우저 없이 계산할 수 있고, 게임 안의 나방 움직임과 100% 일치한다.
//  * 고정 스텝(1/120s) 누적기 — 프레임 속도와 무관하게 같은 입력 = 같은 결과.
//  * 흔들림(flutter)은 시드 PRNG → 같은 시드면 재현 가능(테스트), 게임은 시도마다 시드 변경.
//  * 규칙 설명은 ../DESIGN.md §1.
// -----------------------------------------------------------------------------

export const SIM = {
  DT: 1 / 120,
  // 플레이 영역(화면 540×960, HUD 0~110)
  BOUNDS: { x0: 20, y0: 130, x1: 520, y1: 920 },
  // 나방
  MOTH_SPEED: 175,     // 순항 속도(px/s)
  MOTH_FORCE: 520,     // 조향 가속도 상한(px/s²) — 바람보다 약하면 밀린다
  FLUTTER_AMP: 200,    // 좌우 흔들림 속도 진폭(px/s) — 7Hz 로 적분하면 위치 ±4.5px
  FLUTTER_HZ: 7,
  SWAY_AMP: 60, SWAY_HZ: 1.3, // 느린 너울 — 위치 ±7px
  LOST_SPEED: 45,      // 보이는 불이 없을 때 헤매는 속도
  LOST_TURN: 1.6,      // 헤맬 때 방향 변화(rad/s 진폭)
  // 목표 선택
  D0: 30,              // 체감 거리 오프셋(0 나눗셈·근접 폭주 방지)
  HYST: 0.8,           // 현재 목표의 체감 거리 가중(끈끈함) — 플레이어 등불
  HYST_CANDLE: 0.92,   // 촛불은 접근 중(맴돌이 시작 전 + RESCUE 초)엔 덜 끈끈함 → 가까운 등불로 막판 구조 가능(손맛). 처마등은 잡히면 끝.
  RESCUE: 0.35,
  HYST_HOME: 0.85,
  // 맴돌이
  ORBIT_R: 38, ORBIT_SPEED: 120, ORBIT_ENTER: 44,
  // 치명 등불(촛불·처마 등)은 맴돌수록 반지름이 줄어 PULL 초 뒤 타 죽는다
  PULL_R0: 36, PULL_R1: 12, PULL: { candle: 1.3, fixed: 3.5 }, BURN_R: 16,
  HOME_R: 24,
  WAKE: 0.8,           // 시작 후 나방이 깨어나는 시간(플레이어 계획 여유)
  TAKEOFF: 0.7,        // 1.1: 맴돌이에서 떠날 때 새 목표 방향 초속(× MOTH_SPEED)
  GATHER: 0.12,        // 1.1: 플레이어 등불을 떠날 땐 이 시간 동안 불꽃 중심을 스친 뒤 출발 → 언제 탭해도 같은 출발점(결정적)
  // 등불 종류별 밝기/도달 반경
  // 체감 거리 = (d+D0)/lumen. 집·등불은 그대로, 기름등은 밝아서 가까워 보이고, 촛불·처마등은 작아서 멀어 보인다.
  LUMEN: { lamp: 1.0, oil: 1.3, fixed: 0.7, candle: 0.6, home: 1.0 },
  REACH: { lamp: 460, oil: 500, fixed: 420, candle: 320, home: 1200 }, // 집 등불은 마당 어디서나 보인다
  TAP_R: 46,           // 탭 판정 반경
  MAX_TIME: 40,        // 이 시간 넘기면 실패(timeout) — 무한 맴돌이 방지
};

// mulberry32 — 작은 시드 PRNG
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isPlayerLamp(kind) { return kind === 'lamp' || kind === 'oil'; }
export function defaultOn(kind) { return kind === 'fixed' || kind === 'candle' || kind === 'home'; }

// 레벨 정의 → 실행 상태. level 은 변경하지 않는다.
export function createSim(level, opts = {}) {
  const seed = opts.seed == null ? 1 : opts.seed;
  const rand = rng(seed);
  const lamps = level.lamps.map((l, i) => ({
    i, kind: l.kind, x: l.x, y: l.y,
    on: l.on != null ? !!l.on : defaultOn(l.kind),
    spent: false,
    oil: l.kind === 'oil' ? (l.oil || 3) : 0,
    timer: 0,
    lumen: SIM.LUMEN[l.kind], reach: SIM.REACH[l.kind] * (isPlayerLamp(l.kind) ? (level.reachScale || 1) : 1), // 1.1: 레벨별 '어두운 등불'(reachScale)
  }));
  const s = {
    level, seed, t: 0, acc: 0,
    moth: { x: level.start.x, y: level.start.y, vx: 0, vy: 0, heading: -Math.PI / 2, state: 'wake', orbitDir: 1, orbitT: 0, ox: 0, oy: 0, gT: 0, gx: 0, gy: 0 },
    lamps, webs: (level.webs || []).map((w) => ({ ...w })), winds: (level.winds || []).map((w) => ({ ...w })),
    target: -1, taps: 0, status: 'playing', reason: '', events: [], flyT: 0,
    flutterPhase: rand() * Math.PI * 2, swayPhase: rand() * Math.PI * 2, lostPhase: rand() * Math.PI * 2,
    _rand: rand,
  };
  pickTarget(s, true);
  return s;
}

// 플레이어 탭: 등불 i 토글. "불꽃은 하나" 규칙 — 다른 플레이어 등불이 켜져 있으면 그건 꺼진다.
// 반환: 상태가 바뀌었으면 true (탭 카운트는 바뀐 경우만)
export function tapLamp(s, i) {
  if (s.status !== 'playing') return false;
  const l = s.lamps[i];
  if (!l || !isPlayerLamp(l.kind) || l.spent) return false;
  if (l.on) {
    if (l.kind === 'oil') return false; // 기름등은 끌 수 없다(저절로 꺼짐)
    l.on = false;
    s.events.push({ type: 'off', lamp: i, t: s.t });
  } else {
    for (const o of s.lamps) if (o !== l && isPlayerLamp(o.kind) && o.on) { o.on = false; if (o.kind === 'oil') o.spent = true; s.events.push({ type: 'off', lamp: o.i, t: s.t, auto: true }); }
    l.on = true;
    if (l.kind === 'oil') l.timer = l.oil;
    s.events.push({ type: 'on', lamp: i, t: s.t });
  }
  s.taps++;
  pickTarget(s, false);
  return true;
}

// 화면 좌표 탭 → 가장 가까운 플레이어 등불(TAP_R 안) 인덱스, 없으면 -1
export function lampAt(s, x, y) {
  let best = -1, bd = SIM.TAP_R;
  for (const l of s.lamps) {
    if (!isPlayerLamp(l.kind)) continue;
    const d = Math.hypot(l.x - x, l.y - y);
    if (d < bd) { bd = d; best = l.i; }
  }
  return best;
}

export function effDist(s, l) {
  const d = Math.hypot(l.x - s.moth.x, l.y - s.moth.y);
  return (d + SIM.D0) / l.lumen;
}

// 목표 선택: 켜진·도달 범위 안의 불 중 체감 거리 최소. 현재 목표는 ×HYST.
// 반환: 1·2위 체감거리 비(가독성 지표, 1에 가까울수록 모호). 목표 없으면 Infinity.
export function pickTarget(s, initial) {
  const m = s.moth;
  let best = -1, be = Infinity, second = Infinity;
  // 1.1: 안전한 등불을 맴돌거나(불꽃 스치기 중 포함) 있을 땐 그 등불 중심에서 잰다 → 맴돌이 위상과 무관한 결정
  let rx = m.x, ry = m.y;
  const cur = s.target >= 0 ? s.lamps[s.target] : null;
  if (m.state === 'gather') { rx = m.gx; ry = m.gy; }
  else if (m.state === 'orbit' && cur && !SIM.PULL[cur.kind]) { rx = cur.x; ry = cur.y; }
  for (const l of s.lamps) {
    if (!l.on || l.spent) continue;
    const d = Math.hypot(l.x - rx, l.y - ry);
    if (d > l.reach) continue;
    let e = (d + SIM.D0) / l.lumen;
    if (l.i === s.target) e *= (l.kind === 'candle' && (m.state !== 'orbit' || m.orbitT < SIM.RESCUE)) ? SIM.HYST_CANDLE : l.kind === 'home' ? SIM.HYST_HOME : SIM.HYST;
    if (e < be) { second = be; be = e; best = l.i; } else if (e < second) second = e;
  }
  if (best !== s.target) {
    s.events.push({ type: 'target', from: s.target, to: best, t: s.t, ratio: second / be, x: m.x | 0, y: m.y | 0 });
    // 1.1: 맴돌던 불을 떠날 때 — 플레이어 등불(안전)이면 불꽃 중심을 스친 뒤(gather) 출발 = 탭 시점과 무관한 출발점.
    //      촛불·처마등(치명)에서 구출될 땐 그 자리에서 새 목표 쪽으로 곧장 이륙.
    const prev = s.target >= 0 ? s.lamps[s.target] : null;
    if (m.state === 'orbit' && best >= 0 && prev && !SIM.PULL[prev.kind]) { m.state = 'gather'; m.gT = 0; m.gx = prev.x; m.gy = prev.y; }
    else if (m.state === 'orbit' && best >= 0) { const nl = s.lamps[best]; const dx = nl.x - m.x, dy = nl.y - m.y, dd = Math.hypot(dx, dy) || 1; const sp = SIM.MOTH_SPEED * SIM.TAKEOFF; m.vx = dx / dd * sp; m.vy = dy / dd * sp; }
    s.target = best;
    if (m.state === 'orbit' || m.state === 'lost') { m.state = 'fly'; }
    if (m.state !== 'wake') m.orbitT = 0;
  }
  s.lastRatio = best < 0 ? Infinity : second / be;
  return s.lastRatio;
}

// dt(초)만큼 진행. 고정 서브스텝.
export function step(s, dt) {
  if (s.status !== 'playing') return;
  s.acc += Math.min(dt, 0.25); // 1.2e: 느린 프레임(≤4fps)에서도 실시간 유지 — 0.1 이면 가로 큰 캔버스·소프트웨어 GL 에서 슬로모션
  while (s.acc >= SIM.DT - 1e-9 && s.status === 'playing') {
    s.acc -= SIM.DT;
    substep(s, SIM.DT);
  }
}

function substep(s, dt) {
  const m = s.moth;
  s.t += dt;
  // 깨어나기: 제자리에서 목표만 고른다(의도선은 보임)
  if (m.state === 'wake') {
    for (const l of s.lamps) if (l.kind === 'oil' && l.on) { l.timer -= dt; if (l.timer <= 0) { l.on = false; l.spent = true; s.events.push({ type: 'oilOut', lamp: l.i, t: s.t }); } }
    pickTarget(s, false);
    if (s.t >= (s.level.wake || SIM.WAKE)) { m.state = 'fly'; s.events.push({ type: 'wake', t: s.t }); } // 레벨별 wake(1번 밤은 길게 — 처음 하는 사람이 반응할 시간)
    return;
  }

  // 기름등 타이머
  for (const l of s.lamps) {
    if (l.kind === 'oil' && l.on) {
      l.timer -= dt;
      if (l.timer <= 0) { l.on = false; l.spent = true; s.events.push({ type: 'oilOut', lamp: l.i, t: s.t }); pickTarget(s, false); }
    }
  }
  // 목표 재평가(매 스텝 — 싸다: 등불 ≤ 8)
  pickTarget(s, false);
  // 1.1: 불꽃 스치기(gather) — 떠나는 등불 중심으로 빨려 들었다가 새 목표 방향으로 출발
  if (m.state === 'gather' && s.target >= 0 && s.lamps[s.target].x === m.gx && s.lamps[s.target].y === m.gy) {
    // 떠나려던 등불이 다시 목표 → 맴돌이 반경으로 되돌려 놓고 맴돌기
    const ang = Math.atan2(m.y - m.gy, m.x - m.gx) || 0; m.x = m.gx + Math.cos(ang) * SIM.ORBIT_R; m.y = m.gy + Math.sin(ang) * SIM.ORBIT_R;
    m.state = 'orbit'; m.orbitT = 0; m.vx = -Math.sin(ang) * SIM.ORBIT_SPEED * m.orbitDir; m.vy = Math.cos(ang) * SIM.ORBIT_SPEED * m.orbitDir;
  }
  if (m.state === 'gather') {
    m.gT += dt; const k = Math.min(1, dt / Math.max(dt, SIM.GATHER - m.gT + dt));
    m.x += (m.gx - m.x) * k; m.y += (m.gy - m.y) * k; m.vx = 0; m.vy = 0;
    if (m.gT >= SIM.GATHER - 1e-9) {
      m.x = m.gx; m.y = m.gy; m.state = 'fly';
      const tg = s.target >= 0 ? s.lamps[s.target] : null;
      if (tg) { const dx = tg.x - m.x, dy = tg.y - m.y, dd = Math.hypot(dx, dy) || 1; m.vx = dx / dd * SIM.MOTH_SPEED * SIM.TAKEOFF; m.vy = dy / dd * SIM.MOTH_SPEED * SIM.TAKEOFF; m.heading = Math.atan2(dy, dx); }
    }
    visualFlutter(s, m);
    return;
  }

  const tgt = s.target >= 0 ? s.lamps[s.target] : null;
  let dvx, dvy; // 원하는 속도
  if (!tgt) {
    // 헤매기: 느린 속도로 완만히 방향 변화
    if (m.state !== 'lost') { m.state = 'lost'; s.events.push({ type: 'lost', t: s.t }); }
    const ang = m.heading + Math.sin(s.t * 0.9 + s.lostPhase) * SIM.LOST_TURN * dt;
    m.heading = ang;
    dvx = Math.cos(ang) * SIM.LOST_SPEED; dvy = Math.sin(ang) * SIM.LOST_SPEED;
  } else {
    const dx = tgt.x - m.x, dy = tgt.y - m.y, d = Math.hypot(dx, dy) || 1e-6;
    const ux = dx / d, uy = dy / d;
    const pull = SIM.PULL[tgt.kind] || 0;
    let orbitR = SIM.ORBIT_R;
    if (pull) orbitR = SIM.PULL_R0 + (SIM.PULL_R1 - SIM.PULL_R0) * Math.min(1, m.orbitT / pull);
    if (tgt.kind === 'home') {
      // 집 등불은 맴돌지 않고 곧장 내려앉는다
      dvx = ux * SIM.MOTH_SPEED; dvy = uy * SIM.MOTH_SPEED;
    } else if (m.state !== 'orbit' && d <= SIM.ORBIT_ENTER) {
      m.state = 'orbit'; m.orbitT = 0;
      // 접선 방향은 현재 진행 방향에 가까운 쪽
      const cross = ux * m.vy - uy * m.vx;
      m.orbitDir = cross >= 0 ? 1 : -1;
      s.events.push({ type: 'arrive', lamp: tgt.i, t: s.t, x: m.x | 0, y: m.y | 0 });
      if (!SIM.PULL[tgt.kind]) s.flyT = 0; // 시간 제한은 '한 번의 비행'마다
    }
    if (tgt.kind === 'home') {
      // (위에서 처리)
    } else if (m.state === 'orbit') {
      m.orbitT += dt;
      // 접선 속도 + 반지름 유지 보정
      const tx = -uy * m.orbitDir, ty = ux * m.orbitDir;
      const radial = (d - orbitR) * 3.2; // 안쪽(+)으로 당기는 정도
      dvx = tx * SIM.ORBIT_SPEED + ux * radial;
      dvy = ty * SIM.ORBIT_SPEED + uy * radial;
    } else {
      dvx = ux * SIM.MOTH_SPEED; dvy = uy * SIM.MOTH_SPEED;
    }
  }

  // 조향(가속도 상한)
  let ax = (dvx - m.vx) * 6, ay = (dvy - m.vy) * 6;
  const al = Math.hypot(ax, ay);
  if (al > SIM.MOTH_FORCE) { ax *= SIM.MOTH_FORCE / al; ay *= SIM.MOTH_FORCE / al; }
  m.vx += ax * dt; m.vy += ay * dt;
  // 바람 = 위치 표류(px/s). 나방은 가벼워서 조향과 무관하게 떠밀린다 → 경로가 휜다
  for (const w of s.winds) {
    if (m.x >= w.x && m.x <= w.x + w.w && m.y >= w.y && m.y <= w.y + w.h) { m.x += w.fx * dt; m.y += w.fy * dt; }
  }

  // 이동. 1.1: 흔들림(날갯짓·너울)은 물리 위치에 넣지 않고 시각 오프셋(m.ox, m.oy)만 — 같은 수 = 같은 궤적
  const sp = Math.hypot(m.vx, m.vy);
  m.x += m.vx * dt; m.y += m.vy * dt;
  if (sp > 1) m.heading = Math.atan2(m.vy, m.vx);
  visualFlutter(s, m);

  // 경계(부드럽게 밀어 넣기)
  const B = SIM.BOUNDS;
  if (m.x < B.x0) { m.x = B.x0; m.vx = Math.abs(m.vx) * 0.5; }
  if (m.x > B.x1) { m.x = B.x1; m.vx = -Math.abs(m.vx) * 0.5; }
  if (m.y < B.y0) { m.y = B.y0; m.vy = Math.abs(m.vy) * 0.5; }
  if (m.y > B.y1) { m.y = B.y1; m.vy = -Math.abs(m.vy) * 0.5; }

  // 판정
  for (const w of s.webs) {
    if (Math.hypot(w.x - m.x, w.y - m.y) < w.r + 4) { return fail(s, 'web'); }
  }
  for (const l of s.lamps) {
    const d = Math.hypot(l.x - m.x, l.y - m.y);
    if (SIM.PULL[l.kind] && (d < SIM.BURN_R || (s.target === l.i && m.state === 'orbit' && m.orbitT >= SIM.PULL[l.kind]))) return fail(s, 'burn');
    if (l.kind === 'home' && d < SIM.HOME_R) { s.status = 'won'; s.events.push({ type: 'home', t: s.t }); return; }
  }
  // 1.1: 시간 제한은 '날고 있는 시간'만 — 안전한 등불을 맴도는 동안(플레이어가 생각하는 동안)은 세지 않는다
  const tg = s.target >= 0 ? s.lamps[s.target] : null;
  if (!(m.state === 'orbit' && tg && !SIM.PULL[tg.kind])) s.flyT = (s.flyT || 0) + dt;
  if (s.flyT > SIM.MAX_TIME) return fail(s, 'timeout');
}

// 시각용 흔들림: 진행 방향에 수직, 날갯짓 ±4.5px(7Hz) + 너울 ±7px(1.3Hz). 맴돌 땐 작게
function visualFlutter(s, m) {
  const hx = Math.cos(m.heading), hy = Math.sin(m.heading);
  const k = m.state === 'orbit' ? 0.35 : m.state === 'gather' ? 0.2 : 1;
  const f = Math.sin(s.t * SIM.FLUTTER_HZ * Math.PI * 2 + s.flutterPhase) * (SIM.FLUTTER_AMP / (SIM.FLUTTER_HZ * Math.PI * 2)) + Math.sin(s.t * SIM.SWAY_HZ * Math.PI * 2 + s.swayPhase) * (SIM.SWAY_AMP / (SIM.SWAY_HZ * Math.PI * 2));
  m.ox = -hy * f * k; m.oy = hx * f * k;
}

function fail(s, reason) { s.status = 'lost'; s.reason = reason; s.events.push({ type: 'fail', reason, t: s.t, x: s.moth.x | 0, y: s.moth.y | 0 }); }

// 레벨 기본 검증(좌표 범위·필수 요소). 문제 목록 반환(비어 있으면 OK)
export function validateLevel(level) {
  const out = [];
  const B = SIM.BOUNDS;
  const inB = (x, y) => x >= B.x0 && x <= B.x1 && y >= B.y0 && y <= B.y1;
  if (!level.start || !inB(level.start.x, level.start.y)) out.push('start 범위 밖');
  const homes = level.lamps.filter((l) => l.kind === 'home');
  if (homes.length !== 1) out.push('home 은 정확히 1개');
  level.lamps.forEach((l, i) => { if (!SIM.LUMEN[l.kind]) out.push(`lamp[${i}] kind 불명 ${l.kind}`); if (!inB(l.x, l.y)) out.push(`lamp[${i}] 범위 밖`); });
  // 등불끼리 너무 가까우면 탭이 겹친다
  for (let a = 0; a < level.lamps.length; a++) for (let b = a + 1; b < level.lamps.length; b++) {
    const A = level.lamps[a], Bb = level.lamps[b];
    if (isPlayerLamp(A.kind) && isPlayerLamp(Bb.kind) && Math.hypot(A.x - Bb.x, A.y - Bb.y) < SIM.TAP_R * 2) out.push(`lamp[${a}]·[${b}] 탭 반경 겹침`);
  }
  (level.webs || []).forEach((w, i) => { if (!inB(w.x, w.y)) out.push(`web[${i}] 범위 밖`); });
  return out;
}
