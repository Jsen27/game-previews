// Sandglass — 순수 시뮬레이션 (Phaser 의존 0). game.js 와 Node 솔버/봇이 공유.
// -----------------------------------------------------------------------------
// 그릇 안 N×N 격자의 낙하 모래 셀룰러 오토마타. 회전은 중력 벡터만 바꾼다(격자는 그릇 좌표계 고정).
//  * 고정 틱(1/TPS s) 누적기 — 프레임 속도와 무관하게 같은 입력 = 같은 결과.
//  * 대각선 미끄러짐의 좌/우 선택은 시드 PRNG → 재현 가능. 갱신 순서는 중력 먼 쪽 줄부터(한 틱에 두 번 이동 없음).
//  * 규칙 설명은 ../DESIGN.md §1.
// -----------------------------------------------------------------------------

export const SIM = {
  N: 40,               // 격자 한 변
  TPS: 60,             // 틱/초 (모래 낙하 속도 = 1셀/틱). 1.1b: 40→60(1.5배 빠른 흐름 — 틱 단위 규칙이라 퍼즐 결과는 동일)
  SETTLE_TICKS: 12,    // 이동 0 이 이만큼 지속되면 '정지'
  MAX_TIME: 60,        // 1.1: 한 번의 흐름(회전 후 정지까지)이 이 시간을 넘으면 실패 — 누적이 아니라 회전마다(모래는 반드시 멈추므로 사실상 안전장치)
  MAX_ROT: 9999,       // 1.1: 사실상 무제한(정지 후에만 돌 수 있어 무한 회전 위험 없음 — 40회에서 탭이 조용히 무시되던 문제)
};
export const CELL = { EMPTY: 0, WALL: 1, SAND1: 2, SAND2: 3, SAND3: 4, DRAIN: 5 };
// 1.2c: 체(sieve) — 한 색만 통과시키는 격자 막. 격자(grid)에는 빈칸으로 두고 별도 마스크(sieve[idx] = 통과 색 1..3)로 판정.
export function buildSieve(level) {
  const N = SIM.N; const m = new Uint8Array(N * N);
  for (const r of level.sieves || []) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (x > 0 && y > 0 && x < N - 1 && y < N - 1) m[y * N + x] = r.color || 1;
  return m;
}
// 중력(그릇 좌표계에서 '화면 아래'를 가리키는 방향). k = 시계방향 90° 회전 횟수.
export const GRAV = [[0, 1], [1, 0], [0, -1], [-1, 0]];

// PRNG 상태를 객체로 둬서 cloneSim 이 복제할 수 있게(솔버 분기마다 독립 난수열 → 해답이 그대로 재생됨)
function nextRand(s) {
  let a = s._rngA | 0; a = (a + 0x6D2B79F5) | 0; s._rngA = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const isSand = (c) => c >= CELL.SAND1 && c <= CELL.SAND3;
export const sandCell = (color) => CELL.SAND1 + color - 1; // color 1..3

// 레벨 프리미티브 → 격자. 테두리 1셀은 항상 벽.
export function buildGrid(level) {
  const N = SIM.N; const g = new Uint8Array(N * N);
  const fill = (r, v) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (x >= 0 && y >= 0 && x < N && y < N) g[y * N + x] = v; };
  fill({ x: 0, y: 0, w: N, h: 1 }, CELL.WALL); fill({ x: 0, y: N - 1, w: N, h: 1 }, CELL.WALL); fill({ x: 0, y: 0, w: 1, h: N }, CELL.WALL); fill({ x: N - 1, y: 0, w: 1, h: N }, CELL.WALL);
  for (const w of level.walls || []) fill(w, CELL.WALL);
  // 사선 벽(깔때기 등): 브레젠험 선을 2셀 두께(아래 셀 포함)로 → 대각선 틈 없음
  for (const l of level.lines || []) {
    let x = l.x1, y = l.y1; const dx = Math.abs(l.x2 - l.x1), dy = Math.abs(l.y2 - l.y1), sx = l.x1 < l.x2 ? 1 : -1, sy = l.y1 < l.y2 ? 1 : -1; let err = dx - dy;
    for (let k = 0; k < 400; k++) {
      fill({ x, y, w: 1, h: 1 }, CELL.WALL); fill({ x, y: y + 1, w: 1, h: 1 }, CELL.WALL);
      if (x === l.x2 && y === l.y2) break;
      const e2 = 2 * err; if (e2 > -dy) { err -= dy; x += sx; } if (e2 < dx) { err += dx; y += sy; }
    }
  }
  for (const d of level.drains || []) fill(d, CELL.DRAIN);
  for (const s of level.sand || []) fill(s, sandCell(s.color || 1));
  return g;
}

export function createSim(level, opts = {}) {
  const seed = opts.seed == null ? 1 : opts.seed;
  const grid = buildGrid(level); const sieve = buildSieve(level);
  const initial = [0, 0, 0, 0, 0];
  for (let i = 0; i < grid.length; i++) if (isSand(grid[i])) initial[grid[i]]++;
  const s = {
    level, seed, grid, sieve, g: 0, t: 0, acc: 0, tick: 0, rot: 0,
    moved: 0, settledTicks: 0, settled: true, status: 'playing', reason: '', events: [],
    initial, lost: [0, 0, 0, 0, 0], _rngA: (seed >>> 0) || 1, _flip: 0,
    noWin: !!opts.noWin, // 탐색용: 목표 충족해도 '승리'로 끝내지 않음(생성기가 모래를 계속 세기 위해)
  };
  // 시작 상태는 정지로 간주(모래 덩어리는 바닥에 놓인 채 시작하도록 설계)
  return s;
}

// 회전: dir +1 = 시계방향(오른쪽 탭), -1 = 반시계. 상태가 바뀌면 true.
export function rotate(s, dir) {
  if (s.status !== 'playing') return false;
  if (s.rot >= SIM.MAX_ROT) return false;
  s.g = (s.g + (dir > 0 ? 1 : 3)) % 4;
  s.rot++; s.settledTicks = 0; s.settled = false; s.flowStart = s.t;
  s.events.push({ type: 'rotate', dir: dir > 0 ? 1 : -1, g: s.g, t: s.t });
  return true;
}

// 1.1: 정지 상태에선 틱을 돌리지 않는다 — ① 생각하는 동안 시간(MAX_TIME)이 흐르지 않음 ② PRNG 가 대기 시간에 따라
//      소모되지 않아 "같은 수 = 같은 결과"(결정적). 회전(rotate)이 settled 를 풀면 다시 흐른다.
export function step(s, dt) {
  if (s.status !== 'playing') return;
  //      정지한 그 틱에서 바로 멈춘다(한 프레임에 여러 틱이 돌아도 정지 후 추가 틱 없음 = Node 솔버와 같은 궤적)
  if (s.settled) { s.acc = 0; return; }
  s.acc += Math.min(dt, 0.25);
  const T = 1 / SIM.TPS;
  while (s.acc >= T - 1e-9 && s.status === 'playing') { s.acc -= T; tickOnce(s); if (s.settled) { s.acc = 0; break; } }
}

function tickOnce(s) {
  const N = SIM.N, grid = s.grid, sv = s.sieve;
  const [gx, gy] = GRAV[s.g];
  const px = -gy, py = gx; // 수직 방향(대각선용)
  s.tick++; s.t = s.tick / SIM.TPS; s._flip ^= 1;
  let moved = 0, drained = 0;
  // 중력 먼 쪽 줄부터. 중력이 y축이면 y 를 바깥 루프로, x축이면 x 를 바깥 루프로.
  const alongY = gy !== 0;
  const outerStart = (alongY ? gy : gx) > 0 ? N - 2 : 1, outerEnd = (alongY ? gy : gx) > 0 ? 0 : N - 1, outerStep = (alongY ? gy : gx) > 0 ? -1 : 1;
  for (let o = outerStart; o !== outerEnd; o += outerStep) {
    // 안쪽 루프 방향은 틱마다 뒤집어 편향 제거
    const iStart = s._flip ? 1 : N - 2, iEnd = s._flip ? N - 1 : 0, iStep = s._flip ? 1 : -1;
    for (let i = iStart; i !== iEnd; i += iStep) {
      const x = alongY ? i : o, y = alongY ? o : i;
      const idx = y * N + x; const c = grid[idx];
      if (!isSand(c)) continue;
      // 1) 중력 방향 (체: 통과 색이 아니면 벽처럼)
      let nx = x + gx, ny = y + gy, nidx = ny * N + nx, nc = grid[nidx];
      if (nc === CELL.EMPTY && sv[nidx] && sv[nidx] !== c - 1) nc = CELL.WALL;
      if (nc === CELL.EMPTY) { grid[nidx] = c; grid[idx] = 0; moved++; continue; }
      if (nc === CELL.DRAIN) { grid[idx] = 0; s.lost[c]++; drained++; moved++; continue; }
      // 2) 대각선(무작위 우선순위)
      const first = nextRand(s) < 0.5 ? 1 : -1;
      let done = false;
      for (const sgn of [first, -first]) {
        const dx = gx + px * sgn, dy = gy + py * sgn;
        nx = x + dx; ny = y + dy; nidx = ny * N + nx; nc = grid[nidx];
        if (nc === CELL.EMPTY && sv[nidx] && sv[nidx] !== c - 1) nc = CELL.WALL;
        if (nc === CELL.EMPTY) { grid[nidx] = c; grid[idx] = 0; moved++; done = true; break; }
        if (nc === CELL.DRAIN) { grid[idx] = 0; s.lost[c]++; drained++; moved++; done = true; break; }
      }
      if (done) continue;
    }
  }
  s.moved = moved;
  if (drained) s.events.push({ type: 'drain', n: drained, t: s.t });
  // 정지 판정
  if (moved === 0) { s.settledTicks++; if (s.settledTicks === SIM.SETTLE_TICKS) { s.settled = true; s.events.push({ type: 'settled', t: s.t }); } }
  else { s.settledTicks = 0; s.settled = false; }
  // 실패: 섞임(strict) / 모래 부족 / 시간
  // 1.1: 섞임은 "정지한 순간" 목표 방에 다른 색이 남아 있을 때만(지나가는 건 허용 — 방이 곧 통로인 미로 구조)
  const lv = s.level;
  const justSettled = s.settled && s.settledTicks === SIM.SETTLE_TICKS;
  for (const tg of lv.targets || []) {
    if (!justSettled) break;
    if (!tg.strict && !lv.strict) continue;
    const want = sandCell(tg.color);
    for (let y = tg.y; y < tg.y + tg.h; y++) for (let x = tg.x; x < tg.x + tg.w; x++) { const c = grid[y * N + x]; if (isSand(c) && c !== want) return fail(s, 'mixed'); }
  }
  const need = [0, 0, 0, 0, 0];
  for (const tg of lv.targets || []) need[sandCell(tg.color)] += tg.min;
  for (let c = CELL.SAND1; c <= CELL.SAND3; c++) if (need[c] > 0 && s.initial[c] - s.lost[c] < need[c]) return fail(s, 'lost');
  if (s.t - (s.flowStart || 0) > SIM.MAX_TIME) return fail(s, 'timeout');
  // 승리: 정지 + 모든 목표 충족
  if (!s.noWin && s.settled && targetsMet(s)) { s.status = 'won'; s.events.push({ type: 'win', t: s.t }); }
}

function fail(s, reason) { s.status = 'lost'; s.reason = reason; s.events.push({ type: 'fail', reason, t: s.t }); }

export function countIn(s, tg, color) {
  const N = SIM.N; const want = sandCell(color); let n = 0;
  for (let y = tg.y; y < tg.y + tg.h; y++) for (let x = tg.x; x < tg.x + tg.w; x++) if (s.grid[y * N + x] === want) n++;
  return n;
}
export function targetsMet(s) {
  for (const tg of s.level.targets || []) if (countIn(s, tg, tg.color) < tg.min) return false;
  return true;
}
export function remaining(s, color) { const c = sandCell(color); return s.initial[c] - s.lost[c]; }

// 격자 해시(솔버 중복 제거용) — FNV-1a 32bit
export function hashState(s) {
  let h = 2166136261 ^ s.g;
  const g = s.grid;
  for (let i = 0; i < g.length; i++) { h ^= g[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0) + ':' + (s.settled ? 1 : 0);
}

export function cloneSim(s) {
  return { ...s, grid: new Uint8Array(s.grid), lost: s.lost.slice(), events: [] };
}

export function validateLevel(level) {
  const out = []; const N = SIM.N;
  const inB = (r) => r.x >= 1 && r.y >= 1 && r.x + r.w <= N - 1 && r.y + r.h <= N - 1;
  if (!(level.targets || []).length) out.push('목표 없음');
  for (const r of [...(level.walls || []), ...(level.drains || []), ...(level.sand || []), ...(level.targets || []), ...(level.sieves || [])]) if (!inB(r)) out.push(`범위 밖 ${JSON.stringify(r)}`);
  for (const l of level.lines || []) if (Math.abs(l.x2 - l.x1) !== Math.abs(l.y2 - l.y1)) out.push(`선은 45° 만(완만하면 모래가 걸림) ${JSON.stringify(l)}`);
  for (const l of level.lines || []) if (l.x1 < 1 || l.x2 < 1 || l.y1 < 1 || l.y2 < 1 || l.x1 > N - 2 || l.x2 > N - 2 || l.y1 > N - 3 || l.y2 > N - 3) out.push(`선 범위 밖 ${JSON.stringify(l)}`);
  const g = buildGrid(level);
  const have = [0, 0, 0, 0, 0]; for (const c of g) if (isSand(c)) have[c]++;
  const need = [0, 0, 0, 0, 0]; for (const tg of level.targets || []) need[sandCell(tg.color)] += tg.min;
  for (let c = 2; c <= 4; c++) if (need[c] > have[c]) out.push(`색${c - 1} 모래 부족 ${have[c]}<${need[c]}`);
  return out;
}

// ASCII 덤프(디버그): '#' 벽 '.' 빈칸 'a/b/c' 모래 'X' 배수구, 목표 방은 빈칸을 ':' 로
export function dump(s) {
  const N = SIM.N; const rows = [];
  const tgIdx = new Set();
  for (const tg of s.level.targets || []) for (let y = tg.y; y < tg.y + tg.h; y++) for (let x = tg.x; x < tg.x + tg.w; x++) tgIdx.add(y * N + x);
  for (let y = 0; y < N; y++) {
    let r = '';
    for (let x = 0; x < N; x++) { const c = s.grid[y * N + x]; r += c === 1 ? '#' : c === 5 ? 'X' : isSand(c) ? 'abc'[c - 2] : (s.sieve && s.sieve[y * N + x]) ? '%' : (tgIdx.has(y * N + x) ? ':' : '.'); }
    rows.push(r);
  }
  return rows.join('\n');
}
