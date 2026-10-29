// game-03-overforge : Overforge
// -----------------------------------------------------------------------------
// 규칙 한 문장: "강화를 눌러 무기 레벨을 올려라 — 부서지기 전에 어디서 멈출 것인가."
//
// 코어: 무기 1자루 강화(도박) × 사냥터 자동 수급(방치). 마을 허브(로비) 진입형 UI.
//  - 로비(마을 허브): 건물 3채(강화소/사냥터/상점) 탭 → 각 방 진입, 좌상단 나가기로 복귀.
//  - 사냥터: 무기 레벨에 비례해 초당 골드. 탭 연타로 가속. 광고 부스트(배율).
//  - 강화소: 골드 소모 → 성공%로 +1. 실패는 레벨대별(유지 / −1 / 파괴→+0).
//  - 상점: 보호권(파괴 방지) 골드/광고 구매, 골드 부스트 광고.
//
// UI 텍스트는 글로벌 기준 영어(+한국어). 주석은 한국어(CLAUDE.md 규칙).
// 그래픽은 절차적(도형/이모지) — 테마 "동양 신화 × 글로시(단청 팔레트)".
//   아트 에셋(bg_*/lobby_*/coin/icon_back/…)이 assets/sprites/ 에 들어오면
//   preload 훅이 자동으로 스프라이트로 교체(없으면 절차 폴백). 코드 수정 불필요.
// 수치는 전부 상단 CONFIG. (메모리 [[game-03-direction]] 의 확정 설계 반영)
// -----------------------------------------------------------------------------

// CrazyGames 빌드(2026-10-19): gd/ 와 game.js 동일, shared/ 의 광고 래퍼만 CrazyGames SDK v3 로 교체. 광고는 shared/gd-flow.js(GDFlow.playAd) 로만 호출한다.
//   gameId 는 index.html 의 GD_OPTIONS 가 단일 소스('mock' = 개발용 mock 광고).
import { GDFlow, commonT } from './shared/gd-flow.js';
import { createMusic, SONGS } from './shared/music.js';
import { loadJSON, saveJSON, clamp, isMuted, setMuted, initCloudStorage } from './shared/utils.js';

// CrazyGames Data 모듈(진행 저장·로그인 시 클라우드 동기화) 준비 — 세이브/언어를 읽는 어떤 코드보다 먼저. 실패·4초 초과면 localStorage.
await initCloudStorage();

// 자동화 QA 전용 진단 핸들(?qa=1 일 때만 전역 노출). 제출 빌드에서는 전역이 하나도 생기지 않는다.
const QA_HOOKS = /(?:^|[?&])qa=1(?:&|$)/.test(location.search);
let _sessionStarted = false; // 프리롤(타이틀)은 세션당 1회 — 언어 전환 재시작 시 타이틀 생략

// 매직넘버/수치는 여기 모아둔다 (CLAUDE.md 코드 스타일)
const CONFIG = {
  WIDTH: 540,
  HEIGHT: 960,
  GAME_KEY: 'overforge', // 세이브 키

  // ── 강화 (경제 밸런스 v3 = weapon_economy_config_v3) ────────
  // 설계 핵심: +0 완전초기화 폐지 → 실패는 "안전구간으로만 하락"(최대 −4강) + 천장 + 진행형 천장 환생 루프.
  MAX_LEVEL: 30, // 기준 천장(진행형 천장의 base). contentTier(아트 매핑)의 분모로도 사용. 실제 상한 = ceiling() = min(30+CEILING_STEP×prestige, CEILING_CAP).
  CEILING_STEP: 4, // v3: 환생마다 천장 +N (= 새 몬스터/검 티어 = 새 콘텐츠).
  CEILING_CAP: 54, // v3: 천장 하드캡(아트 ~55). 환생6에서 도달, 이후 고정.
  ENHANCE_BASE: 10, // 강화비용 = BASE × FLAT_R^min(L,FLAT_BELOW) × COST_R^max(0,L−FLAT_BELOW)
  ENHANCE_COST_R: 1.8, // L>=FLAT_BELOW 성장비(가팔라짐)
  ENHANCE_FLAT_R: 1.6, // v3: L<FLAT_BELOW 성장비(=수급과 동일 → '다음 강화 벌 시간' 상수). 초반 무보상 대기 제거.
  ENHANCE_FLAT_BELOW: 5, // ★P2.4 회귀수정: 평탄8→5(무위험존만). 평탄8은 L>=8 전구간을 2.57배 싸게(전체 속도 폭주)만들었음. 임계=초반완화·속도·런웨이 결합노브.
  // 차징 시간(ms) = BASE + 레벨×PER_LV (최대 MAX). 고강화일수록 길어져 긴장감↑
  CHARGE_BASE: 400,
  CHARGE_PER_LV: 80,
  CHARGE_MAX: 2400,
  NEAR_MISS_MARGIN: 4, // 실패 굴림이 성공선에 이만큼 이내면 "아깝다!" 연출
  // 실패 패널티: 현재 레벨 이하 '가장 가까운 안전구간'(=5의 배수)으로 하락(최대 −4). 자기 자신이 안전구간이면 유지(바닥).
  //   v3: 안전구간은 배열 고정이 아니라 5의 배수로 동적 산출(진행형 천장까지 자동 확장) → nearestSafe().
  NO_RISK_BELOW: 5, // 이 레벨 미만은 실패해도 유지(온램프)
  // ── 난이도 프리셋(P2.4): DIFFICULTY 로 선택(로드 시 1회 해석). balanced=기본·무회귀. hard=급확률 배열, casual=하락확률 0.5. ──
  DIFFICULTY: 'balanced', // 'hard' | 'balanced' | 'casual'
  ENHANCE_RATE: [100, 100, 95, 90, 85, 80, 78, 75, 72, 70, 67, 64, 61, 58, 55, 53, 51, 49, 47, 46, 45, 44, 43, 42, 41, 40, 40, 40, 40, 40], // balanced 성공률(바닥 40%). index=현재레벨 0~29
  HARD_RATES:   [100, 100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 52, 49, 46, 43, 40, 38, 36, 34, 32, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21], // hard 프리셋(바닥 21%)
  DROP_PROBABILITY: 1.0, // 기본 하락확률(balanced/hard=1.0). casual=0.5(프리셋에서 적용). 성공굴림 실패 후에만 2단 판정.
  PITY_THRESHOLD: 8, // 같은 레벨 연속 실패 N회 → 다음 시도 강제 성공(행운 게이지 N칸)

  // ── 사냥터(전투/수급) ───────────────────────
  // 무기가 자동으로 몬스터를 공격 → 처치 시 골드 우르르. 사냥터 탭에서만 진행.
  GOLD_BASE: 1, // 평균 초당골드 기준 = BASE * GOLD_R^레벨 (처치보상으로 환산)
  GOLD_R: 1.6,
  ATK_PER_SEC: 2, // 자동 공격 횟수/초
  KILL_TIME: 3, // 순수 자동공격으로 1마리 잡는 목표 시간(초) → 처치보상 = 평균초당골드 × 이 값
  DMG_BASE: 10, // 표시용 공격력 = BASE * DMG_R^레벨
  DMG_R: 1.6,
  TAP_MAX_PER_SEC: 10, // 탭(추가타) 상한/초 — 오토클릭(automouse) 골드 어뷰징 방지 하드캡(슬라이딩 윈도우)
  AD_BOOST_MULT: 2, // 광고 부스트 배율(처치보상)
  AD_BOOST_SEC: 120,
  OFFLINE_CAP_SEC: 7200, // 오프라인 수급 최대치(2시간)
  OFFLINE_RATE: 0.1, // 오프라인은 사냥터 실시간의 일부만(매우 조금) — 기능만 넣어두고 추후 튜닝
  OFFLINE_AD_MULT: 2,

  // ── 보호권 (v3: 소비 시점 과금 = 차익거래 제거) ──────────────
  //   ⛔ 골드 구매/비축 폐지(미리 사는 골드-보호권 없음 = 차익거래 벡터 제거).
  //   charges 는 광고로만 획득. 자동방어는 charges 먼저 소모, 부족하면 골드.
  //   자동방어 골드비용 = PROTECT_NEED(L) × PROTECT_S × goldPerSec(L, 1.7^prestige)  ← 소비 시점·방어 레벨·prestige 반영.
  //     = 수급시간 등가 PROTECT_NEED(L)×PROTECT_S초(레벨/환생/비축 무관 고정) → buy-low·환생리셋·multiplier 차익 소멸 + AFK 골드 싱크 부활.
  PROTECT_S: 750, // 방어 1 point = 750초 수급어치. ↓=골드방어 저렴(광고유인↓) / ↑=광고의존↑. 권장 500~900.
  PROTECT_MAX: 99999, // charges 보유 상한(사실상 무제한 — 옵션F라 무제한이어도 −1완화→안전).
  // 방어 1회에 필요한 protection point 수: index = floor(레벨/TIER_EVERY). t>=6 은 round(12×1.7^(t-5)).
  //   idx0(<5 무위험,미사용)/5~9=1/10~14=2/15~19=4/20~24=7/25~29=12/30~34=20/35~39=35/40~44=59/45~49=100/50~54=170
  PROTECT_NEED: [0, 1, 2, 4, 7, 12, 20, 35, 59, 100, 170],
  PROTECT_LOCK_ABOVE: 999, // v3: 방어 레벨 제한 없음(PROTECT_NEED 가 고강 비용 담당). 낮추면 그 이상 무방비.
  AD_PROTECT_QTY: 5, // 무료 보호권(charges) 광고 1회 지급량
  AD_BUNDLE_COOLDOWN_SEC: 60, // 무료 보호권 광고 최소 간격(초, 연타 방지). ★일일 한도 없음(광고 수익 우선). 0=쿨다운 없음.
  AD_BUNDLE_SOFT_CAP_DAY: 100, // ★IVT(무효트래픽) 방어용 내부 소프트 상한(무료번들, 일당). 정상 유저는 절대 안 닿음 — 극단 파밍/봇만 차단. 유저에게 '한도 소진' 메시지 노출 안 함.
  UNDO_COOLDOWN_SEC: 60, // 하락취소(리액티브) 광고 팝업 최소 간격(초). 1광고=−1 완화(개수 무시). 0=항상.

  // ── 환생(프레스티지) ────────────────────────
  PRESTIGE_GOLD_BASE: 1.7, // v3: 1.5→1.7. 환생 시 영구 골드배수 = 이 값^환생수. 진행형 천장(+4/환생) 감당 → 매 환생 총도달 ~11~12h 유지.
  // v3 Phase2 마일스톤 언락(key → 언락 prestige 임계). 값/내용 조정 가능(스펙 §2-2/§2-3).
  //   p1 자동강화 / p2 오프3h / p3 pity7 / p4 자동강화 전뷰+오프4h / p5 pity6. (p6 초월=별도 라운드, 아트 필요)
  MILESTONES: { autoEnhance: 1, offline3h: 2, pity7: 3, autoEnhanceAllViews: 4, offline4h: 4, pity6: 5 },
  OFFLINE_CAP_SEC_P2: 10800, // p2: 오프라인 상한 2h→3h
  OFFLINE_CAP_SEC_P4: 14400, // p4: 3h→4h
  PITY_THRESHOLD_P3: 7, // p3: 천장 8→7
  PITY_THRESHOLD_P5: 6, // p5: 7→6 (40% 바닥에선 거의 미발동, 심리적 보험)

  TIER_EVERY: 5, // N레벨마다 등급색/버스트/안전구간 변화
  // 콘텐츠(사냥감+검) 등급 수. tier = floor(레벨 × CONTENT_TIERS / (MAX_LEVEL+1)) → 0..11 을 레벨 0~30에 고루 배분.
  //   몬스터·검 공용 → 같은 레벨에서 동시 교체(둘 다 약→강 순 파일). 각자 존재하는 최고 tier 로 walk-down 클램프.
  //   순서: 도깨비불→애기도깨비→불여우→허수아비→물귀신→구렁이→멧돼지→장승→이무기→도깨비대장→구미호→저승사자.
  CONTENT_TIERS: 12,

  // 색 (앱 크롬 = 딥 인디고 유지)
  C_GOLD: '#ffd54a',
  C_OK: '#5ef0b0',
  C_BAD: '#ff6b6b',
  C_TEXT: '#eef0ff',
  C_DIM: '#9aa0c0',
  C_PANEL: 0x1b1736,
  C_PANEL2: 0x262048,

  // 단청 팔레트(테마: 동양 신화 × 글로시). 소재=한국 민속, 마감=글로시.
  C_CREAM: '#f0e6d2', // 한지
  C_RED: 0xc23b2f, // 주작(파괴/경고 전용 — 주버튼 색 아님)
  C_JADE: 0x2f7a5e, // 옥(광고/보상 버튼 = 초록)
  C_BUY: 0x3a2f6b, // 골드구매(인디고)
  // 색 언어(2026-07: 리뷰 반영) — 금=주력 실행(강화·환생·구매) / 초록(C_JADE)=광고·무료 / 빨강(C_RED)=파괴·경고 전용
  C_PRIMARY: 0xe0a52e, // 주력 실행 버튼 = 황토 골드
  C_PLAQUE: 0x2a2018, // 상단 현판 = 웜 다크 우드(구 남보라 C_PANEL 대체, 단청 톤·글씨 대비 유지)
  ACCENT_FORGE: 0xe0483d, // 강화소 = 주작 red
  ACCENT_HUNT: 0x2fb89a, // 사냥터 = 청록 teal
  ACCENT_SHOP: 0xc98a3a, // 상점 = 황토 ochre

  // 로비 건물(마을에 직접 배치 — 카드 X). x,y=중심, w=표시 폭(비율 유지). hunt=앞-중앙이라 살짝 크게.
  LOBBY_BUILDINGS: [
    // 지도식 배치: 뒤(위)일수록 작게, 앞(아래)일수록 크게 → 원근감. 좌우 어긋나게(비대칭).
    { key: 'forge', icon: '⚒️', accent: 0xe0483d, x: 138, y: 486, w: 168 }, // 신단 대장간(뒤-좌, 작게)
    { key: 'shop', icon: '🏮', accent: 0xc98a3a, x: 404, y: 560, w: 182 }, // 주막(우, 중간)
    { key: 'hunt', icon: '⛩️', accent: 0x2fb89a, x: 252, y: 770, w: 214 }, // 요괴 숲 관문(앞-중앙, 크게)
  ],
  // 통짜 씬(of_lobby_scene) 방식의 투명 핫스팟. 좌표는 W/H 대비 비율(0~1) — 기기 무관.
  // x,y/w,h = 건물 클릭영역 중심/크기(넉넉히 — 손가락 타겟). signX,signY = 씬에 baked 된 팻말 "글씨" 중심.
  // signW,signH = 팻말 클릭영역 크기(팻말도 눌러서 입장). 전부 씬 이미지 실제 위치에 맞춰 튜닝.
  LOBBY_HOTSPOTS: [
    { key: 'forge', accent: 0xe0483d, x: 0.22, y: 0.31, w: 0.42, h: 0.34, signX: 0.201, signY: 0.508, signW: 0.32, signH: 0.09 }, // 대장간(좌-상단)
    { key: 'shop', accent: 0xc98a3a, x: 0.76, y: 0.33, w: 0.42, h: 0.34, signX: 0.781, signY: 0.520, signW: 0.32, signH: 0.09 }, // 주막(우-상단)
    { key: 'hunt', accent: 0x2fb89a, x: 0.48, y: 0.70, w: 0.52, h: 0.30, signX: 0.497, signY: 0.860, signW: 0.36, signH: 0.10 }, // 관문(하단-중앙)
  ],
};

const W = CONFIG.WIDTH;
const H = CONFIG.HEIGHT;
const CX = W / 2;
const HUNT_MON_Y = 440; // 사냥터 몬스터 중심 Y(화면 중앙 쪽). 타격 FX(코인/데미지/연기)도 이 값 기준.
const FORGE_CY = 390; // 강화소 무기/글로우/연출(FX) 중심 Y. 사냥터처럼 아래쪽에 배치(상단 여백 확보). 무기 기준 FX 전부 이 값.
const FONT = 'system-ui, sans-serif';
const SIGN_FONT = 'Georgia, "Nanum Myeongjo", "Times New Roman", serif'; // 팻말/타이틀 — 각인/전통 느낌

// ── 수치 헬퍼 ────────────────────────────────────
// 골드 수급엔 환생 배수(mult)를 곱한다(기본 1). 환생수 n → mult = 1.7^n (v3).
const goldPerSec = (lv, mult = 1) => CONFIG.GOLD_BASE * Math.pow(CONFIG.GOLD_R, lv) * mult;
// 진행형 천장(v3): 환생마다 +CEILING_STEP, 아트캡(CEILING_CAP)에서 고정.
const ceilingFor = (prestige) => Math.min(CONFIG.MAX_LEVEL + CONFIG.CEILING_STEP * prestige, CONFIG.CEILING_CAP);
const dps = (lv) => CONFIG.DMG_BASE * Math.pow(CONFIG.DMG_R, lv); // 표시용 초당 공격력
const hitDmg = (lv) => dps(lv) / CONFIG.ATK_PER_SEC; // 1타 데미지
const monsterMaxHp = (lv) => dps(lv) * CONFIG.KILL_TIME; // 처치까지 ~KILL_TIME초
const goldPerKill = (lv, mult = 1) => goldPerSec(lv, mult) * CONFIG.KILL_TIME; // 처치보상(평균수급 유지)
// v3 초반 평탄화: L<FLAT_BELOW 은 성장비 1.6(수급과 동일 → 다음 강화 벌 시간 상수), 그 이상 1.8.
const enhanceCost = (lv) => Math.floor(CONFIG.ENHANCE_BASE * Math.pow(CONFIG.ENHANCE_FLAT_R, Math.min(lv, CONFIG.ENHANCE_FLAT_BELOW)) * Math.pow(CONFIG.ENHANCE_COST_R, Math.max(0, lv - CONFIG.ENHANCE_FLAT_BELOW)));
// P2.4 난이도 프리셋 적용(로드 시 1회 해석; 런타임 스위치 UI 없음). 기본 balanced=무회귀.
const ACTIVE_RATES = CONFIG.DIFFICULTY === 'hard' ? CONFIG.HARD_RATES : CONFIG.ENHANCE_RATE;
const ACTIVE_DROP_PROB = CONFIG.DIFFICULTY === 'casual' ? 0.5 : CONFIG.DROP_PROBABILITY;
const enhanceRate = (lv) => ACTIVE_RATES[Math.min(lv, ACTIVE_RATES.length - 1)];
const chargeMs = (lv) => Math.min(CONFIG.CHARGE_BASE + lv * CONFIG.CHARGE_PER_LV, CONFIG.CHARGE_MAX);
// 실패 하락 목적지: 현재 레벨 이하 '가장 가까운 안전구간'(=5의 배수). v3: 배열 대신 동적 산출(진행형 천장까지 자동).
const nearestSafe = (lv) => Math.floor(lv / CONFIG.TIER_EVERY) * CONFIG.TIER_EVERY;
// 하락 1회 방어에 필요한 protection point 수 — 레벨 오를수록 급증. index=floor(레벨/TIER_EVERY).
const protectsNeeded = (lv) => CONFIG.PROTECT_NEED[Math.min(Math.floor(lv / CONFIG.TIER_EVERY), CONFIG.PROTECT_NEED.length - 1)];
// v3: 자동방어 골드비용(소비 시점·방어 레벨·prestige 반영) = PROTECT_NEED(L) × PROTECT_S초 × goldPerSec(L, mult).
const autoDefenseGoldCost = (lv, mult = 1) => Math.floor(protectsNeeded(lv) * CONFIG.PROTECT_S * goldPerSec(lv, mult));

// 큰 수 축약 표기 (1.2K, 3.4M, …)
const UNITS = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag'];
function fmt(n) {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  const mag = Math.floor(Math.log10(n) / 3);
  if (mag >= UNITS.length) return n.toExponential(2);
  const s = n / Math.pow(1000, mag);
  return (s >= 100 ? s.toFixed(0) : s.toFixed(2)) + UNITS[mag];
}

// 정수 색 → '#rrggbb' 문자열 (텍스트 색 지정용)
function hex(intColor) {
  return '#' + (intColor & 0xffffff).toString(16).padStart(6, '0');
}

// ── i18n (en/ko, 추후 확장) ──────────────────────
const STRINGS = {
  en: { pityCounter: "Guaranteed success in {n}", pityReady: "Next enhance guaranteed!",
    hunt: 'HUNT', forge: 'FORGE', shop: 'SHOP', back: 'Back', later: 'Later',
    perSec: '/sec', perAtk: '/s', perKill: '/kill', on: 'ON', off: 'OFF', tapHint: 'Tap the monster for extra gold!',
    enhance: 'ENHANCE', cost: 'Cost', successRate: 'Success', onFail: 'On fail',
    keep: 'kept', down: '−1 level', destroy: 'DESTROY → +0',
    protectLabel: 'Protect', buyProtect: 'Buy Protect', adProtect: 'Free Protect',
    shopProtectHint: 'Protection softens a drop to just −1.\nEarn tickets free by ad — auto-defense uses tickets first, then gold.',
    adBoost: '2× Gold 120s', watchAd: '(Ad)',
    notEnough: 'Not enough gold', protectedMsg: 'PROTECTED!', destroyedMsg: 'DESTROYED → +0', softenedMsg: 'SOFTENED!',
    failKept: 'Failed — kept', failDown: 'Failed — dropped!', enhanced: 'ENHANCED!', soClose: 'SO CLOSE!', downKeep: '−1 or kept', tierUp: 'TIER UP!',
    welcomeBack: 'While you were away', collect: 'COLLECT', collect2x: 'COLLECT ×2',
    boostOn: '2× GOLD', maxLv: 'Best',
    adUnavailable: 'Ad not available',
    pityHit: 'LUCKY!', safeReached: 'SAFE ZONE!', maxReached: 'MAX +{lv}!',
    prestige: 'PRESTIGE', prestigeTitle: 'Reborn?',
    prestigeBody: 'Reset your weapon to +0 for a permanent ×{m} gold bonus.',
    prestigeCta: 'Reborn', prestigeTag: 'Reborn ×{n}',
    undoTitle: 'Dropped to +{n}', undoBody: 'Watch an ad to soften this drop to just −1?',
    undoAd: 'Soften to −1 (Ad)', keepDrop: 'Keep',
    firstDropTitle: 'Your weapon dropped!',
    firstDropBody: "A Protection Ticket softens a big drop to just −1 — here's one free! Keep it for next time.",
    autoProtectLabel: 'Auto-Protect', autoEnhanceLabel: 'Auto-Enhance', autoPaused: 'Auto-enhance paused — out of Protects', milestoneUnlocked: 'Milestone unlocked!', ok: 'OK',
    adCooldown: 'Wait',
    goldDefendTitle: 'Defend with gold?', goldDefendBody: 'Out of Protection Tickets. Spend {g} gold to soften this drop to just −1?', goldDefendCta: 'Defend  🪙{g}',
    owned: 'Have', defendAt: 'Defend +{lv}: ×{n}',
  },
  ko: { pityCounter: "강제 성공까지 {n}회", pityReady: "다음 강화 성공 확정!",
    hunt: '사냥터', forge: '강화소', shop: '상점', back: '나가기', later: '나중에',
    perSec: '/초', perAtk: '/초', perKill: '/마리', on: '켜짐', off: '꺼짐', tapHint: '몬스터를 연타하면 골드 추가!',
    enhance: '강화', cost: '비용', successRate: '성공률', onFail: '실패 시',
    keep: '유지', down: '−1 하락', destroy: '파괴 → +0',
    protectLabel: '보호권', buyProtect: '보호권 구매', adProtect: '무료 보호권',
    shopProtectHint: '보호권은 하락을 −1로 완화해요.\n광고로 무료 획득 — 자동방어는 보호권 먼저, 부족하면 골드를 씁니다.',
    adBoost: '2× 골드 120초', watchAd: '(광고)',
    notEnough: '골드 부족', protectedMsg: '보호됨!', destroyedMsg: '파괴 → +0', softenedMsg: '완화!',
    failKept: '실패 — 유지', failDown: '실패 — 하락!', enhanced: '강화 성공!', soClose: '아깝다!', downKeep: '−1 또는 유지', tierUp: '등급 상승!',
    welcomeBack: '자리 비운 동안', collect: '받기', collect2x: '2배 받기',
    boostOn: '2× 골드', maxLv: '최고',
    adUnavailable: '광고를 불러올 수 없어요',
    pityHit: '행운!', safeReached: '안전 구간!', maxReached: '만렙 +{lv}!',
    prestige: '환생', prestigeTitle: '환생할까요?',
    prestigeBody: '무기를 +0으로 초기화하고 영구 골드 ×{m} 를 얻습니다.',
    prestigeCta: '환생', prestigeTag: '환생 ×{n}',
    undoTitle: '+{n} 로 하락', undoBody: '광고 보고 이번 하락을 −1로 완화할까요?',
    undoAd: '−1로 완화 (광고)', keepDrop: '유지',
    firstDropTitle: '무기가 하락했어요!',
    firstDropBody: '보호권은 큰 하락을 −1로 완화해줍니다. 무료로 하나 드려요 — 다음을 위해 챙겨두세요.',
    autoProtectLabel: '자동방어', autoEnhanceLabel: '자동강화', autoPaused: '자동강화 정지 — 보호권 부족', milestoneUnlocked: '마일스톤 해금!', ok: '확인',
    adCooldown: '잠시 후',
    goldDefendTitle: '골드로 방어할까요?', goldDefendBody: '보호권이 없습니다. 골드 {g} 를 써서 이번 하락을 −1로 완화할까요?', goldDefendCta: '방어  🪙{g}',
    owned: '보유', defendAt: '+{lv} 방어: ×{n}개',
  },
  fr: { pityCounter: "Succès garanti dans {n}", pityReady: "Prochaine amélioration garantie !", hunt: "CHASSE", forge: "FORGE", shop: "BOUTIQUE", back: "Retour", later: "Plus tard", perSec: "/sec", perAtk: "/s", perKill: "/tué", on: "ON", off: "OFF", tapHint: "Touchez le monstre pour de l'or bonus !", enhance: "AMÉLIORER", cost: "Coût", successRate: "Réussite", onFail: "Si échec", keep: "conservé", down: "−1 niveau", destroy: "DÉTRUIRE → +0", protectLabel: "Protection", buyProtect: "Acheter Protection", adProtect: "Protection gratuite", shopProtectHint: "La Protection réduit une chute à seulement −1.\nGagnez des tickets gratuits par pub — l'auto-défense utilise les tickets d'abord, puis l'or.", adBoost: "2× Or 120s", watchAd: "(Pub)", notEnough: "Or insuffisant", protectedMsg: "PROTÉGÉ !", destroyedMsg: "DÉTRUIT → +0", softenedMsg: "ATTÉNUÉ !", failKept: "Échec — conservé", failDown: "Échec — chute !", enhanced: "AMÉLIORÉ !", soClose: "PRESQUE !", downKeep: "−1 ou conservé", tierUp: "PALIER SUPÉRIEUR !", welcomeBack: "Pendant votre absence", collect: "RÉCUPÉRER", collect2x: "RÉCUPÉRER ×2", boostOn: "2× OR", maxLv: "Record", adUnavailable: "Pub indisponible", pityHit: "CHANCE !", safeReached: "ZONE SÛRE !", maxReached: "MAX +{lv} !", prestige: "RENAISSANCE", prestigeTitle: "Renaître ?", prestigeBody: "Réinitialisez l'arme à +0 pour un bonus d'or permanent ×{m}.", prestigeCta: "Renaître", prestigeTag: "Renaissance ×{n}", undoTitle: "Chute à +{n}", undoBody: "Regarder une pub pour réduire cette chute à seulement −1 ?", undoAd: "Réduire à −1 (Pub)", keepDrop: "Garder", firstDropTitle: "Votre arme a chuté !", firstDropBody: "Un ticket de Protection réduit une grosse chute à seulement −1 — en voici un gratuit ! Gardez-le pour la prochaine fois.", autoProtectLabel: "Auto-Protection", autoEnhanceLabel: "Auto-Amélioration", autoPaused: "Auto-amélioration en pause — plus de Protections", milestoneUnlocked: "Palier débloqué !", ok: "OK", adCooldown: "Attendez", goldDefendTitle: "Défendre avec de l'or ?", goldDefendBody: "Plus de tickets de Protection. Dépenser {g} or pour réduire cette chute à seulement −1 ?", goldDefendCta: "Défendre  🪙{g}", owned: "Possédés", defendAt: "Défense +{lv} : ×{n}" },
  it: { pityCounter: "Successo garantito tra {n}", pityReady: "Prossimo potenziamento garantito!", hunt: "CACCIA", forge: "FUCINA", shop: "NEGOZIO", back: "Indietro", later: "Dopo", perSec: "/sec", perAtk: "/s", perKill: "/uccisione", on: "ON", off: "OFF", tapHint: "Tocca il mostro per oro extra!", enhance: "POTENZIA", cost: "Costo", successRate: "Successo", onFail: "Se fallisci", keep: "mantenuto", down: "−1 livello", destroy: "DISTRUGGI → +0", protectLabel: "Protezione", buyProtect: "Compra Protezione", adProtect: "Protezione Gratis", shopProtectHint: "La Protezione attenua un calo a solo −1.\nOttieni biglietti gratis con le pubblicità — l'auto-difesa usa prima i biglietti, poi l'oro.", adBoost: "Oro 2× 120s", watchAd: "(Pub)", notEnough: "Oro insufficiente", protectedMsg: "PROTETTO!", destroyedMsg: "DISTRUTTO → +0", softenedMsg: "ATTENUATO!", failKept: "Fallito — mantenuto", failDown: "Fallito — sceso!", enhanced: "POTENZIATO!", soClose: "PER POCO!", downKeep: "−1 o mantenuto", tierUp: "NUOVO GRADO!", welcomeBack: "Mentre eri via", collect: "RISCUOTI", collect2x: "RISCUOTI ×2", boostOn: "ORO 2×", maxLv: "Record", adUnavailable: "Pubblicità non disponibile", pityHit: "FORTUNA!", safeReached: "ZONA SICURA!", maxReached: "MAX +{lv}!", prestige: "RINASCITA", prestigeTitle: "Rinascere?", prestigeBody: "Azzera la tua arma a +0 per un bonus oro permanente ×{m}.", prestigeCta: "Rinasci", prestigeTag: "Rinascita ×{n}", undoTitle: "Sceso a +{n}", undoBody: "Guarda una pubblicità per attenuare il calo a solo −1?", undoAd: "Attenua a −1 (Pub)", keepDrop: "Tieni", firstDropTitle: "La tua arma è calata!", firstDropBody: "Un Biglietto Protezione attenua un grande calo a solo −1 — eccotene uno gratis! Tienilo per la prossima volta.", autoProtectLabel: "Auto-Protezione", autoEnhanceLabel: "Auto-Potenziamento", autoPaused: "Auto-potenziamento in pausa — Protezioni finite", milestoneUnlocked: "Traguardo sbloccato!", ok: "OK", adCooldown: "Attendi", goldDefendTitle: "Difendere con l'oro?", goldDefendBody: "Biglietti Protezione finiti. Spendere {g} oro per attenuare il calo a solo −1?", goldDefendCta: "Difendi  🪙{g}", owned: "Hai", defendAt: "Difesa +{lv}: ×{n}" },
  de: { pityCounter: "Garantierter Erfolg in {n}", pityReady: "Nächste Verstärkung garantiert!", hunt: "JAGD", forge: "SCHMIEDE", shop: "LADEN", back: "Zurück", later: "Später", perSec: "/Sek", perAtk: "/s", perKill: "/Kill", on: "AN", off: "AUS", tapHint: "Tippe das Monster für extra Gold!", enhance: "VERSTÄRKEN", cost: "Kosten", successRate: "Erfolg", onFail: "Bei Fehlschlag", keep: "behalten", down: "−1 Stufe", destroy: "ZERSTÖREN → +0", protectLabel: "Schutz", buyProtect: "Schutz kaufen", adProtect: "Gratis-Schutz", shopProtectHint: "Schutz mildert einen Abfall auf nur −1.\nHol dir Tickets gratis per Werbung — Auto-Abwehr nutzt erst Tickets, dann Gold.", adBoost: "2× Gold 120s", watchAd: "(Werbung)", notEnough: "Nicht genug Gold", protectedMsg: "GESCHÜTZT!", destroyedMsg: "ZERSTÖRT → +0", softenedMsg: "GEMILDERT!", failKept: "Fehlschlag — behalten", failDown: "Fehlschlag — gefallen!", enhanced: "VERSTÄRKT!", soClose: "SO KNAPP!", downKeep: "−1 oder behalten", tierUp: "RANG HOCH!", welcomeBack: "Während du weg warst", collect: "ABHOLEN", collect2x: "ABHOLEN ×2", boostOn: "2× GOLD", maxLv: "Rekord", adUnavailable: "Werbung nicht verfügbar", pityHit: "GLÜCK!", safeReached: "SICHERE ZONE!", maxReached: "MAX +{lv}!", prestige: "WIEDERGEBURT", prestigeTitle: "Wiedergeboren?", prestigeBody: "Setze deine Waffe auf +0 zurück für einen dauerhaften ×{m} Gold-Bonus.", prestigeCta: "Wiedergeburt", prestigeTag: "Wiedergeburt ×{n}", undoTitle: "Gefallen auf +{n}", undoBody: "Werbung ansehen, um diesen Abfall auf nur −1 zu mildern?", undoAd: "Auf −1 mildern (Werbung)", keepDrop: "Behalten", firstDropTitle: "Deine Waffe ist gefallen!", firstDropBody: "Ein Schutz-Ticket mildert einen großen Abfall auf nur −1 — hier ist eins gratis! Heb es für das nächste Mal auf.", autoProtectLabel: "Auto-Schutz", autoEnhanceLabel: "Auto-Verstärken", autoPaused: "Auto-Verstärken pausiert — kein Schutz mehr", milestoneUnlocked: "Meilenstein freigeschaltet!", ok: "OK", adCooldown: "Warten", goldDefendTitle: "Mit Gold abwehren?", goldDefendBody: "Keine Schutz-Tickets mehr. {g} Gold ausgeben, um diesen Abfall auf nur −1 zu mildern?", goldDefendCta: "Abwehren  🪙{g}", owned: "Vorrat", defendAt: "Abwehr +{lv}: ×{n}" },
  es: { pityCounter: "Éxito garantizado en {n}", pityReady: "¡Próxima mejora garantizada!", hunt: "CAZA", forge: "FORJA", shop: "TIENDA", back: "Volver", later: "Más tarde", perSec: "/seg", perAtk: "/s", perKill: "/baja", on: "ON", off: "OFF", tapHint: "¡Toca al monstruo para más oro!", enhance: "MEJORAR", cost: "Costo", successRate: "Éxito", onFail: "Al fallar", keep: "conservado", down: "−1 nivel", destroy: "DESTRUIR → +0", protectLabel: "Protección", buyProtect: "Comprar Protección", adProtect: "Protección gratis", shopProtectHint: "La Protección reduce una caída a solo −1.\nGana tickets gratis con anuncios: la autodefensa usa tickets primero y luego oro.", adBoost: "2× Oro 120s", watchAd: "(Anuncio)", notEnough: "Oro insuficiente", protectedMsg: "¡PROTEGIDO!", destroyedMsg: "DESTRUIDO → +0", softenedMsg: "¡AMORTIGUADO!", failKept: "Fallo — conservado", failDown: "Fallo — ¡cayó!", enhanced: "¡MEJORADO!", soClose: "¡CASI!", downKeep: "−1 o conservado", tierUp: "¡SUBIÓ DE RANGO!", welcomeBack: "Mientras no estabas", collect: "RECOGER", collect2x: "RECOGER ×2", boostOn: "2× ORO", maxLv: "Mejor", adUnavailable: "Anuncio no disponible", pityHit: "¡SUERTE!", safeReached: "¡ZONA SEGURA!", maxReached: "¡MÁX +{lv}!", prestige: "RENACER", prestigeTitle: "¿Renacer?", prestigeBody: "Reinicia tu arma a +0 para un bono de oro permanente de ×{m}.", prestigeCta: "Renacer", prestigeTag: "Renacer ×{n}", undoTitle: "Caída a +{n}", undoBody: "¿Ver un anuncio para reducir esta caída a solo −1?", undoAd: "Reducir a −1 (Anuncio)", keepDrop: "Mantener", firstDropTitle: "¡Tu arma cayó de nivel!", firstDropBody: "Un Ticket de Protección reduce una gran caída a solo −1 — ¡aquí tienes uno gratis! Guárdalo para la próxima.", autoProtectLabel: "Auto-Protección", autoEnhanceLabel: "Auto-Mejora", autoPaused: "Auto-mejora en pausa — sin Protecciones", milestoneUnlocked: "¡Hito desbloqueado!", ok: "OK", adCooldown: "Espera", goldDefendTitle: "¿Defender con oro?", goldDefendBody: "Sin Tickets de Protección. ¿Gastar {g} de oro para reducir esta caída a solo −1?", goldDefendCta: "Defender  🪙{g}", owned: "Tienes", defendAt: "Defender +{lv}: ×{n}" },
  pt: { pityCounter: "Sucesso garantido em {n}", pityReady: "Próximo aprimoramento garantido!", hunt: "CAÇA", forge: "FORJA", shop: "LOJA", back: "Voltar", later: "Depois", perSec: "/seg", perAtk: "/s", perKill: "/abate", on: "LIG", off: "DESL", tapHint: "Toque no monstro para mais ouro!", enhance: "APRIMORAR", cost: "Custo", successRate: "Sucesso", onFail: "Se falhar", keep: "mantém", down: "−1 nível", destroy: "DESTRUIR → +0", protectLabel: "Proteção", buyProtect: "Comprar Proteção", adProtect: "Proteção Grátis", shopProtectHint: "A Proteção reduz a queda para apenas −1.\nGanhe tíquetes grátis por anúncio — a autodefesa usa tíquetes primeiro, depois ouro.", adBoost: "2× Ouro 120s", watchAd: "(Anúncio)", notEnough: "Ouro insuficiente", protectedMsg: "PROTEGIDO!", destroyedMsg: "DESTRUÍDO → +0", softenedMsg: "SUAVIZADO!", failKept: "Falhou — mantido", failDown: "Falhou — caiu!", enhanced: "APRIMORADO!", soClose: "QUASE!", downKeep: "−1 ou mantém", tierUp: "NOVO GRAU!", welcomeBack: "Enquanto você esteve fora", collect: "COLETAR", collect2x: "COLETAR ×2", boostOn: "2× OURO", maxLv: "Recorde", adUnavailable: "Anúncio indisponível", pityHit: "SORTE!", safeReached: "ZONA SEGURA!", maxReached: "MÁX +{lv}!", prestige: "RENASCER", prestigeTitle: "Renascer?", prestigeBody: "Reinicie sua arma para +0 e ganhe um bônus permanente de ×{m} em ouro.", prestigeCta: "Renascer", prestigeTag: "Renascer ×{n}", undoTitle: "Caiu para +{n}", undoBody: "Assistir a um anúncio para reduzir esta queda para apenas −1?", undoAd: "Reduzir para −1 (Anúncio)", keepDrop: "Manter", firstDropTitle: "Sua arma caiu!", firstDropBody: "Um Tíquete de Proteção reduz uma grande queda para apenas −1 — aqui está um grátis! Guarde para a próxima vez.", autoProtectLabel: "Auto-Proteção", autoEnhanceLabel: "Auto-Aprimorar", autoPaused: "Auto-aprimorar pausado — sem Proteções", milestoneUnlocked: "Marco desbloqueado!", ok: "OK", adCooldown: "Aguarde", goldDefendTitle: "Defender com ouro?", goldDefendBody: "Sem Tíquetes de Proteção. Gastar {g} de ouro para reduzir esta queda para apenas −1?", goldDefendCta: "Defender  🪙{g}", owned: "Tem", defendAt: "Defender +{lv}: ×{n}" },
  tr: { pityCounter: "{n} denemede kesin başarı", pityReady: "Sonraki yükseltme kesin başarı!", hunt: "AVLAN", forge: "DEMİRHANE", shop: "MAĞAZA", back: "Geri", later: "Sonra", perSec: "/sn", perAtk: "/s", perKill: "/öldürme", on: "AÇIK", off: "KAPALI", tapHint: "Ekstra altın için canavara dokun!", enhance: "YÜKSELT", cost: "Maliyet", successRate: "Başarı", onFail: "Başarısızlıkta", keep: "korundu", down: "−1 seviye", destroy: "YOK OL → +0", protectLabel: "Koruma", buyProtect: "Koruma Al", adProtect: "Ücretsiz Koruma", shopProtectHint: "Koruma, düşüşü yalnızca −1'e indirir.\nBiletleri reklamla ücretsiz kazan — oto-savunma önce bileti, sonra altını kullanır.", adBoost: "2× Altın 120s", watchAd: "(Reklam)", notEnough: "Yetersiz altın", protectedMsg: "KORUNDU!", destroyedMsg: "YOK OLDU → +0", softenedMsg: "HAFİFLEDİ!", failKept: "Başarısız — korundu", failDown: "Başarısız — düştü!", enhanced: "YÜKSELDİ!", soClose: "ÇOK YAKINDI!", downKeep: "−1 veya korundu", tierUp: "KADEME ATLADI!", welcomeBack: "Sen yokken", collect: "TOPLA", collect2x: "TOPLA ×2", boostOn: "2× ALTIN", maxLv: "En İyi", adUnavailable: "Reklam yok", pityHit: "ŞANSLI!", safeReached: "GÜVENLİ BÖLGE!", maxReached: "MAKS +{lv}!", prestige: "YENİDEN DOĞUŞ", prestigeTitle: "Yeniden Doğ?", prestigeBody: "Silahını +0'a sıfırla, kalıcı ×{m} altın bonusu kazan.", prestigeCta: "Yeniden Doğ", prestigeTag: "Yeniden Doğuş ×{n}", undoTitle: "+{n}'e düştü", undoBody: "Bu düşüşü yalnızca −1'e indirmek için reklam izle?", undoAd: "−1'e indir (Reklam)", keepDrop: "Kalsın", firstDropTitle: "Silahın düştü!", firstDropBody: "Koruma Bileti büyük bir düşüşü yalnızca −1'e indirir — işte ücretsiz bir tane! Bir sonraki sefer için sakla.", autoProtectLabel: "Oto-Koruma", autoEnhanceLabel: "Oto-Yükselt", autoPaused: "Oto-yükseltme durdu — Koruma bitti", milestoneUnlocked: "Kilometre taşı açıldı!", ok: "TAMAM", adCooldown: "Bekle", goldDefendTitle: "Altınla savun?", goldDefendBody: "Koruma Bileti bitti. Bu düşüşü yalnızca −1'e indirmek için {g} altın harca?", goldDefendCta: "Savun  🪙{g}", owned: "Var", defendAt: "Savun +{lv}: ×{n}" },
  ja: { pityCounter: "あと{n}回で確定成功", pityReady: "次の強化は成功確定！", hunt: "狩場", forge: "鍛冶場", shop: "ショップ", back: "戻る", later: "後で", perSec: "/秒", perAtk: "/秒", perKill: "/体", on: "ON", off: "OFF", tapHint: "モンスターをタップで追加ゴールド！", enhance: "強化", cost: "費用", successRate: "成功率", onFail: "失敗時", keep: "維持", down: "−1レベル", destroy: "破壊 → +0", protectLabel: "お守り", buyProtect: "お守り購入", adProtect: "無料お守り", shopProtectHint: "お守りは下落を−1に抑えます。\n広告で無料入手 — 自動防御はお守り優先、次にゴールド。", adBoost: "ゴールド2× 120秒", watchAd: "（広告）", notEnough: "ゴールド不足", protectedMsg: "防御成功！", destroyedMsg: "破壊 → +0", softenedMsg: "軽減！", failKept: "失敗 — 維持", failDown: "失敗 — 下落！", enhanced: "強化成功！", soClose: "惜しい！", downKeep: "−1か維持", tierUp: "ランクアップ！", welcomeBack: "留守の間に", collect: "受け取る", collect2x: "受け取る ×2", boostOn: "ゴールド2×", maxLv: "最高", adUnavailable: "広告を利用できません", pityHit: "ラッキー！", safeReached: "安全圏！", maxReached: "最大 +{lv}！", prestige: "転生", prestigeTitle: "転生しますか？", prestigeBody: "武器を+0にリセットして、永久にゴールド×{m}ボーナス。", prestigeCta: "転生", prestigeTag: "転生 ×{n}", undoTitle: "+{n}まで下落", undoBody: "広告を見て下落を−1に抑えますか？", undoAd: "−1に軽減（広告）", keepDrop: "そのまま", firstDropTitle: "武器が下落しました！", firstDropBody: "お守りは大きな下落を−1に抑えます — 1枚プレゼント！次回に取っておきましょう。", autoProtectLabel: "自動防御", autoEnhanceLabel: "自動強化", autoPaused: "自動強化停止 — お守り切れ", milestoneUnlocked: "マイルストーン解放！", ok: "OK", adCooldown: "待機", goldDefendTitle: "ゴールドで防御？", goldDefendBody: "お守りが不足。{g}ゴールドで下落を−1に抑えますか？", goldDefendCta: "防御  🪙{g}", owned: "所持", defendAt: "+{lv}で防御: ×{n}" },
  zh: { pityCounter: "再{n}次必成功", pityReady: "下次强化必定成功！", hunt: "狩猎", forge: "锻造", shop: "商店", back: "返回", later: "稍后", perSec: "/秒", perAtk: "/秒", perKill: "/击杀", on: "开", off: "关", tapHint: "点击怪物获取额外金币！", enhance: "强化", cost: "费用", successRate: "成功率", onFail: "失败时", keep: "保持", down: "−1级", destroy: "摧毁 → +0", protectLabel: "护符", buyProtect: "购买护符", adProtect: "免费护符", shopProtectHint: "护符可将掉级减轻至仅 −1。\n看广告免费获得护符——自动防御优先用护符，其次用金币。", adBoost: "金币×2 120秒", watchAd: "（广告）", notEnough: "金币不足", protectedMsg: "已保护！", destroyedMsg: "已摧毁 → +0", softenedMsg: "已减轻！", failKept: "失败——保持", failDown: "失败——掉级！", enhanced: "强化成功！", soClose: "就差一点！", downKeep: "−1 或保持", tierUp: "品级提升！", welcomeBack: "离线期间", collect: "领取", collect2x: "领取 ×2", boostOn: "金币×2", maxLv: "最高", adUnavailable: "广告不可用", pityHit: "幸运！", safeReached: "安全区！", maxReached: "满级 +{lv}！", prestige: "转生", prestigeTitle: "要转生吗？", prestigeBody: "将武器重置为 +0，永久获得 ×{m} 金币加成。", prestigeCta: "转生", prestigeTag: "转生 ×{n}", undoTitle: "掉落至 +{n}", undoBody: "观看广告，将本次掉级减轻至仅 −1？", undoAd: "减轻至 −1（广告）", keepDrop: "保持", firstDropTitle: "武器掉级了！", firstDropBody: "护符能将大幅掉级减轻至仅 −1——这里免费送你一张！留着下次用吧。", autoProtectLabel: "自动防御", autoEnhanceLabel: "自动强化", autoPaused: "自动强化已暂停——护符用尽", milestoneUnlocked: "里程碑已解锁！", ok: "确定", adCooldown: "等待", goldDefendTitle: "用金币防御？", goldDefendBody: "护符已用尽。花费 {g} 金币，将本次掉级减轻至仅 −1？", goldDefendCta: "防御 🪙{g}", owned: "拥有", defendAt: "+{lv} 防御：×{n}" },
  ru: { pityCounter: "Гарантия успеха через {n}", pityReady: "Следующее улучшение гарантировано!", hunt: "ОХОТА", forge: "КУЗНИЦА", shop: "МАГАЗИН", back: "Назад", later: "Позже", perSec: "/сек", perAtk: "/с", perKill: "/убий.", on: "ВКЛ", off: "ВЫКЛ", tapHint: "Бей монстра — больше золота!", enhance: "УЛУЧШИТЬ", cost: "Цена", successRate: "Успех", onFail: "При неудаче", keep: "остаётся", down: "−1 уровень", destroy: "СБРОС → +0", protectLabel: "Защита", buyProtect: "Купить защиту", adProtect: "Защита даром", shopProtectHint: "Защита смягчает падение всего до −1.\nПолучай билеты бесплатно за рекламу — автозащита тратит сначала билеты, потом золото.", adBoost: "2× золото 120с", watchAd: "(Реклама)", notEnough: "Мало золота", protectedMsg: "ЗАЩИЩЕНО!", destroyedMsg: "СБРОС → +0", softenedMsg: "СМЯГЧЕНО!", failKept: "Неудача — цел", failDown: "Неудача — падение!", enhanced: "УЛУЧШЕНО!", soClose: "ТАК БЛИЗКО!", downKeep: "−1 или цел", tierUp: "НОВЫЙ РАНГ!", welcomeBack: "Пока вас не было", collect: "ЗАБРАТЬ", collect2x: "ЗАБРАТЬ ×2", boostOn: "2× ЗОЛОТО", maxLv: "Рекорд", adUnavailable: "Реклама недоступна", pityHit: "УДАЧА!", safeReached: "БЕЗОПАСНАЯ ЗОНА!", maxReached: "МАКС +{lv}!", prestige: "ПЕРЕРОЖДЕНИЕ", prestigeTitle: "Переродиться?", prestigeBody: "Сбросить оружие до +0 ради постоянного бонуса золота ×{m}.", prestigeCta: "Переродиться", prestigeTag: "Перерождение ×{n}", undoTitle: "Падение до +{n}", undoBody: "Посмотреть рекламу и смягчить падение всего до −1?", undoAd: "Смягчить до −1 (Реклама)", keepDrop: "Оставить", firstDropTitle: "Оружие потеряло уровень!", firstDropBody: "Билет защиты смягчает большое падение всего до −1 — вот бесплатный! Прибереги на потом.", autoProtectLabel: "Автозащита", autoEnhanceLabel: "Автоулучшение", autoPaused: "Автоулучшение на паузе — нет защит", milestoneUnlocked: "Веха открыта!", ok: "ОК", adCooldown: "Ждите", goldDefendTitle: "Защита за золото?", goldDefendBody: "Билеты защиты кончились. Потратить {g} золота и смягчить падение всего до −1?", goldDefendCta: "Защита  🪙{g}", owned: "Есть", defendAt: "Защита +{lv}: ×{n}" },
};
// 첫 진입 온보딩 문구(길잡이 도깨비불) — 기존 STRINGS 를 건드리지 않고 병합.
const ONB_STRINGS = {
  en: { onbHunt: 'Fight for gold →', onbForge: 'Enhance your weapon →', onbEnhance: 'Tap to enhance +1', onbBackForge: 'Tap Back →', onbEarned: 'Enough gold — time to forge! →', onbShopTip: 'Tip: watch ads in the Shop for free boosts', onbEarnHint: 'Your blade earns gold on its own!', onbLowGold: 'Low on gold — go hunt! →', onbShopMore: ' Get more free in the Shop (ad).' },
  ko: { onbHunt: '골드 벌러 가기 →', onbForge: '무기 강화하러 →', onbEnhance: '눌러서 +1 강화', onbBackForge: '나가기 →', onbEarned: '골드 충분 — 강화하러 가요! →', onbShopTip: '팁: 상점에서 광고 보고 무료 부스트', onbEarnHint: '무기가 알아서 골드를 벌어요!', onbLowGold: '골드 부족 — 사냥하러! →', onbShopMore: ' 상점에서 광고로 더 받을 수 있어요.' },
  ja: { onbHunt: 'ゴールドを稼ぎに →', onbForge: '武器を強化しよう →', onbEnhance: 'タップで+1強化', onbBackForge: '戻る →', onbEarned: 'ゴールド十分 — 強化しよう！ →', onbShopTip: 'ヒント: ショップで広告を見て無料ブースト', onbEarnHint: '武器が自動でゴールドを稼ぎます！', onbLowGold: 'ゴールド不足 — 狩りへ！ →', onbShopMore: ' ショップで広告を見てさらに無料入手。' },
  zh: { onbHunt: '去赚金币 →', onbForge: '去强化武器 →', onbEnhance: '点击强化 +1', onbBackForge: '返回 →', onbEarned: '金币够了 — 去强化吧！ →', onbShopTip: '提示：在商店看广告获取免费加成', onbEarnHint: '武器会自动赚金币！', onbLowGold: '金币不足 — 去狩猎！ →', onbShopMore: ' 在商店看广告可免费获得更多。' },
  es: { onbHunt: 'Consigue oro →', onbForge: 'Mejora tu arma →', onbEnhance: 'Toca para mejorar +1', onbBackForge: 'Volver →', onbEarned: '¡Oro suficiente — a la forja! →', onbShopTip: 'Consejo: mira anuncios en la Tienda para mejoras gratis', onbEarnHint: '¡Tu arma gana oro sola!', onbLowGold: 'Poco oro — ¡a cazar! →', onbShopMore: ' Consigue más gratis en la Tienda (anuncio).' },
  pt: { onbHunt: 'Ganhe ouro →', onbForge: 'Aprimore sua arma →', onbEnhance: 'Toque para aprimorar +1', onbBackForge: 'Voltar →', onbEarned: 'Ouro suficiente — hora de forjar! →', onbShopTip: 'Dica: veja anúncios na Loja para bônus grátis', onbEarnHint: 'Sua arma ganha ouro sozinha!', onbLowGold: 'Pouco ouro — vá caçar! →', onbShopMore: ' Ganhe mais de graça na Loja (anúncio).' },
  fr: { onbHunt: "Gagne de l'or →", onbForge: 'Améliore ton arme →', onbEnhance: 'Touche pour améliorer +1', onbBackForge: 'Retour →', onbEarned: "Assez d'or — à la forge ! →", onbShopTip: 'Astuce : regarde des pubs à la Boutique pour des bonus gratuits', onbEarnHint: "Ton arme gagne de l'or toute seule !", onbLowGold: "Peu d'or — va chasser ! →", onbShopMore: " Obtiens-en plus gratuitement à la Boutique (pub)." },
  de: { onbHunt: 'Gold verdienen →', onbForge: 'Waffe verstärken →', onbEnhance: 'Tippen für +1', onbBackForge: 'Zurück →', onbEarned: 'Genug Gold — ab zur Schmiede! →', onbShopTip: 'Tipp: Werbung im Laden ansehen für Gratis-Boosts', onbEarnHint: 'Deine Waffe verdient von allein Gold!', onbLowGold: 'Wenig Gold — auf die Jagd! →', onbShopMore: ' Hol dir mehr gratis im Laden (Werbung).' },
  it: { onbHunt: 'Guadagna oro →', onbForge: "Potenzia l'arma →", onbEnhance: 'Tocca per potenziare +1', onbBackForge: 'Indietro →', onbEarned: 'Oro sufficiente — alla fucina! →', onbShopTip: 'Consiglio: guarda le pub nel Negozio per bonus gratis', onbEarnHint: 'La tua arma guadagna oro da sola!', onbLowGold: 'Poco oro — vai a caccia! →', onbShopMore: " Ottienine altri gratis nel Negozio (pub)." },
  tr: { onbHunt: 'Altın kazan →', onbForge: 'Silahını yükselt →', onbEnhance: 'Yükseltmek için dokun +1', onbBackForge: 'Geri →', onbEarned: 'Altın yeterli — demirhaneye! →', onbShopTip: "İpucu: Mağaza'da reklam izleyip ücretsiz güçlendirme al", onbEarnHint: 'Silahın kendi kendine altın kazanır!', onbLowGold: 'Altın az — avlanmaya git! →', onbShopMore: " Mağaza'dan reklamla ücretsiz daha fazlası." },
  ru: { onbHunt: 'Заработать золото →', onbForge: 'Улучшить оружие →', onbEnhance: 'Нажми для +1', onbBackForge: 'Назад →', onbEarned: 'Золота хватает — в кузницу! →', onbShopTip: 'Совет: смотри рекламу в Магазине ради бесплатных бонусов', onbEarnHint: 'Оружие само зарабатывает золото!', onbLowGold: 'Мало золота — на охоту! →', onbShopMore: ' Получи ещё бесплатно в Магазине (реклама).' },
};
for (const _lg in ONB_STRINGS) if (STRINGS[_lg]) Object.assign(STRINGS[_lg], ONB_STRINGS[_lg]);
// 타이틀(시작 화면) 문구 — GD 프리롤 요건: 명시적 PLAY 버튼 → 광고 → 게임.
const TITLE_STRINGS = {
  en: { play: 'PLAY', tagline: 'Push your luck. Forge it higher.', howTo: 'Hunt monsters for gold, enhance your blade, and decide when to stop before it drops.', continueGame: 'CONTINUE' },
  ko: { play: '시작', tagline: '운을 시험하라. 더 높이 강화하라.', howTo: '요괴를 사냥해 골드를 모으고 검을 강화하세요 — 떨어지기 전에 언제 멈출지는 당신의 선택.', continueGame: '이어하기' },
  ja: { play: 'プレイ', tagline: '運試し。もっと高く鍛えろ。', howTo: '妖怪を狩ってゴールドを集め、剣を強化。落ちる前にどこで止めるかはあなた次第。', continueGame: '続きから' },
  zh: { play: '开始', tagline: '赌一把运气，锻得更高。', howTo: '狩猎妖怪赚金币，强化你的剑——在掉级之前决定何时收手。', continueGame: '继续' },
  es: { play: 'JUGAR', tagline: 'Tienta la suerte. Forja más alto.', howTo: 'Caza monstruos por oro, mejora tu espada y decide cuándo parar antes de que caiga.', continueGame: 'CONTINUAR' },
  pt: { play: 'JOGAR', tagline: 'Tente a sorte. Forje mais alto.', howTo: 'Cace monstros por ouro, aprimore sua espada e decida quando parar antes que ela caia.', continueGame: 'CONTINUAR' },
  fr: { play: 'JOUER', tagline: 'Tentez votre chance. Forgez plus haut.', howTo: "Chassez des monstres pour l'or, améliorez votre lame et décidez quand vous arrêter avant qu'elle ne chute.", continueGame: 'CONTINUER' },
  de: { play: 'SPIELEN', tagline: 'Fordere dein Glück. Schmiede höher.', howTo: 'Jage Monster für Gold, verstärke deine Klinge und entscheide, wann du aufhörst, bevor sie fällt.', continueGame: 'WEITER' },
  it: { play: 'GIOCA', tagline: 'Sfida la fortuna. Forgia più in alto.', howTo: "Caccia mostri per l'oro, potenzia la tua lama e decidi quando fermarti prima che cada.", continueGame: 'CONTINUA' },
  tr: { play: 'OYNA', tagline: 'Şansını dene. Daha yükseğe dövdür.', howTo: 'Altın için canavar avla, kılıcını yükselt ve düşmeden önce ne zaman duracağına karar ver.', continueGame: 'DEVAM' },
  ru: { play: 'ИГРАТЬ', tagline: 'Испытай удачу. Кова выше.', howTo: 'Охоться на монстров ради золота, улучшай клинок и решай, когда остановиться, пока он не упал.', continueGame: 'ПРОДОЛЖИТЬ' },
};
for (const _lg in TITLE_STRINGS) if (STRINGS[_lg]) Object.assign(STRINGS[_lg], TITLE_STRINGS[_lg]);

// 지원 언어(전환 토글 순서) + 표시 이름. Twin Catch 와 동일한 11개 세트.
const LANGS = ['en', 'ko', 'ja', 'zh', 'es', 'pt', 'fr', 'de', 'it', 'tr', 'ru'];
const LANG_NAMES = { en: 'English', ko: '한국어', ja: '日本語', zh: '中文', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', it: 'Italiano', tr: 'Türkçe', ru: 'Русский' };
let currentLang = (() => {
  const saved = loadJSON('overforge-lang', null);
  if (saved && STRINGS[saved]) return saved;
  const nav = (navigator.language || 'en').slice(0, 2);
  return STRINGS[nav] ? nav : 'en';
})();
// 모듈 전역 번역 함수. ⚠️ 메서드 안에서 const t 로 가리지 말 것(TDZ 함정)
function t(key) {
  return (STRINGS[currentLang] && STRINGS[currentLang][key]) || STRINGS.en[key] || key;
}

// ── 절차적 사운드(Web Audio) ─────────────────────
// 테마: 동양 신화 대장간. 강화 도박의 손맛(성공/실패/하락/등급업)을 살린다.
const SFX = {
  ctx: null,
  _mute: false,
  _adMute: false, // 광고 중 강제 음소거(사용자 토글과 독립)
  _scene: null,
  _master: null, _comp: null, _reverb: null, _revGain: null,
  _ac() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    return this.ctx;
  },
  unlock() { const c = this._ac(); if (c && c.state === 'suspended') c.resume(); },
  setMute(m) { this._mute = !!m; },
  setAdMuted(m) { this._adMute = !!m; },
  _off() { return this._mute || this._adMute; },
  attach(scene) { this._scene = scene; }, // 개별 효과음 파일 재생용 씬(사운드 매니저) 부착
  // 개별 효과음 파일 오버라이드: assets/sounds/sfx/<name>.mp3 있으면 그걸 재생, 없으면 아래 절차적.
  _file(key, vol = 0.5) {
    if (this._off()) return true;
    const s = this._scene; if (!s || !s.cache || !s.cache.audio.exists('sfx_' + key)) return false;
    try { s.sound.play('sfx_' + key, { volume: vol }); return true; } catch (e) { return false; }
  },
  // ── 마스터 버스: 모든 보이스 → 리버브 센드 + 드라이 → 컴프레서(리미팅) → 출력. ──
  // 리버브·컴프레서·엔벨로프·배음 = 생 오실레이터의 '삑' 을 공간감 있는 '연출된' 소리로.
  _ensureBus() {
    const c = this._ac(); if (!c || this._master) return;
    this._master = c.createGain(); this._master.gain.value = 1.0;
    this._comp = c.createDynamicsCompressor();
    this._comp.threshold.value = -10; this._comp.knee.value = 24; this._comp.ratio.value = 6;
    this._comp.attack.value = 0.003; this._comp.release.value = 0.25;
    this._master.connect(this._comp); this._comp.connect(c.destination);
    this._reverb = c.createConvolver(); this._reverb.buffer = this._makeIR(c, 1.1, 2.4);
    this._revGain = c.createGain(); this._revGain.gain.value = 0.9;
    this._reverb.connect(this._revGain); this._revGain.connect(this._master);
  },
  _makeIR(c, dur, decay) {
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return buf;
  },
  // 코어 보이스: (디튠 가능) 오실레이터 → ADSR 게인 → (선택 로우패스) → 드라이 마스터 + 웻 리버브.
  _voice(o) {
    if (this._off()) return; const c = this._ac(); if (!c) return; this._ensureBus();
    const freq = o.freq, type = o.type || 'sine', dur = o.dur || 0.3, attack = o.attack || 0.008,
      vol = o.vol != null ? o.vol : 0.2, when = o.when || 0, glide = o.glide || 0, detune = o.detune || 0,
      cutoff = o.cutoff || 0, wet = o.wet != null ? o.wet : 0.2;
    const t0 = c.currentTime + when;
    const g = c.createGain(); let out = g;
    if (cutoff) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; g.connect(lp); out = lp; }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const mk = (dt) => { const osc = c.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(freq * (1 + dt), t0); if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t0 + dur); osc.connect(g); osc.start(t0); osc.stop(t0 + dur + 0.03); };
    mk(0); if (detune) { mk(detune); mk(-detune); }
    out.connect(this._master);
    if (wet > 0 && this._reverb) { const s = c.createGain(); s.gain.value = wet; out.connect(s); s.connect(this._reverb); }
  },
  // 필터드 노이즈 보이스(타격/파쇄/흡수의 '바디').
  _noiseVoice(o) {
    if (this._off()) return; const c = this._ac(); if (!c) return; this._ensureBus();
    const dur = o.dur || 0.2, vol = o.vol != null ? o.vol : 0.15, hp = o.hp || 0, lp = o.lp || 0, when = o.when || 0, wet = o.wet != null ? o.wet : 0.15;
    const t0 = c.currentTime + when;
    const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = c.createBufferSource(); src.buffer = buf;
    let node = src;
    if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g); g.connect(this._master);
    if (wet > 0 && this._reverb) { const s = c.createGain(); s.gain.value = wet; g.connect(s); s.connect(this._reverb); }
    src.start(t0);
  },
  // 종/차임: 기본음 + 약간 비조화 배음(2.01·3.0) → 금속 벨 느낌, 리버브 테일.
  _bell(freq, dur, vol, when = 0) {
    this._voice({ freq, type: 'sine', dur, vol, when, attack: 0.004, wet: 0.28 });
    this._voice({ freq: freq * 2.01, type: 'sine', dur: dur * 0.7, vol: vol * 0.45, when, attack: 0.004, wet: 0.28 });
    this._voice({ freq: freq * 3.0, type: 'sine', dur: dur * 0.5, vol: vol * 0.2, when, attack: 0.004, wet: 0.28 });
  },
  // 징: 저음 바디 + 비조화 배음 + 금속 노이즈 어택 + 긴 리버브.
  _gong(freq) {
    this._voice({ freq, type: 'sine', dur: 1.2, vol: 0.34, wet: 0.4 });
    this._voice({ freq: freq * 1.48, type: 'sine', dur: 1.0, vol: 0.16, wet: 0.4 });
    this._voice({ freq: freq * 2.1, type: 'triangle', dur: 0.7, vol: 0.1, wet: 0.4 });
    this._noiseVoice({ dur: 0.22, vol: 0.12, hp: 2200, wet: 0.25 });
  },
  tap() { if (this._file('tap', 0.35)) return; this._voice({ freq: 1100, type: 'triangle', dur: 0.05, vol: 0.13, wet: 0.06 }); },
  button() { if (this._file('button', 0.4)) return; this._voice({ freq: 480, type: 'triangle', dur: 0.07, vol: 0.18, cutoff: 3200, wet: 0.1 }); },
  coin() {
    if (this._file('coin', 0.5)) return;
    this._voice({ freq: 1046, type: 'triangle', dur: 0.1, vol: 0.24, wet: 0.16 });
    this._voice({ freq: 1568, type: 'triangle', dur: 0.14, vol: 0.2, when: 0.05, wet: 0.2 });
  },
  // 강화 성공: 상승 벨 아르페지오(E5·B5·E6) + 은은한 리버브.
  success() {
    if (this._file('success', 0.6)) return;
    this._bell(659.25, 0.5, 0.34, 0);
    this._bell(987.77, 0.6, 0.27, 0.09);
    this._bell(1318.5, 0.75, 0.2, 0.19);
  },
  // 등급 상승 / 환생: 웅장한 징 + 상승 벨 차임.
  tierUp() {
    if (this._file('tierup', 0.6)) return;
    this._gong(146.83);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this._bell(f, 0.7, 0.2, 0.16 + i * 0.1));
  },
  // 실패(유지): 부드러운 하강 2음(과하지 않게).
  fail() {
    if (this._file('fail', 0.5)) return;
    this._voice({ freq: 300, type: 'sine', dur: 0.18, vol: 0.3, glide: 200, wet: 0.16 });
    this._voice({ freq: 225, type: 'sine', dur: 0.24, vol: 0.22, when: 0.07, glide: 150, wet: 0.18 });
  },
  // 방어 완화: 보호막 흡수(부드러운 노이즈 whoosh + 낮은 벨).
  soften() {
    if (this._file('soften', 0.5)) return;
    this._noiseVoice({ dur: 0.3, vol: 0.14, hp: 500, lp: 2600, wet: 0.24 });
    this._bell(523.25, 0.45, 0.22, 0.03);
  },
  // 차징: 로우패스가 열리며 차오르는 긴장(sawtooth 를 필터로 순화 → 덜 거슬림). ms 에 맞춰 늘어남.
  charge(ms = 480) {
    if (this._off()) return; const c = this._ac(); if (!c) return; this._ensureBus();
    const dur = ms / 1000, now = c.currentTime;
    const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = 'sawtooth'; lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, now); lp.frequency.exponentialRampToValueAtTime(2600, now + dur * 0.92);
    o.connect(lp); lp.connect(g); g.connect(this._master);
    o.frequency.setValueAtTime(140, now); o.frequency.exponentialRampToValueAtTime(760, now + dur * 0.92);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.17, now + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.start(now); o.stop(now + dur + 0.02);
  },
  // 하락/파괴: 저음 붐(하강) + 금속 파쇄 노이즈 + 중역 쨍.
  destroy() {
    if (this._file('destroy', 0.6)) return;
    this._voice({ freq: 110, type: 'sine', dur: 0.5, vol: 0.55, glide: 52, wet: 0.18 });
    this._noiseVoice({ dur: 0.4, vol: 0.34, hp: 700, lp: 5500, wet: 0.2 });
    this._voice({ freq: 330, type: 'triangle', dur: 0.28, vol: 0.2, when: 0.02, glide: 180, wet: 0.22 });
  },
};

// (배경음악 제거됨 — SFX 만 사용. 필요 시 git 이력에서 MUSIC 모듈 복원)

// 레벨 → 무기 글로우 색 (등급 상승감)
function tierColor(lv) {
  const tier = Math.floor(lv / CONFIG.TIER_EVERY);
  const palette = [0x9aa0c0, 0x5ef0b0, 0x4ab6ff, 0xb072ff, 0xff8a3d, 0xffd54a, 0xff5d8f];
  return palette[Math.min(tier, palette.length - 1)];
}
// 레벨 → 콘텐츠 등급(0..CONTENT_TIERS-1). 사냥감·검 공용. 레벨 0~MAX_LEVEL 에 등급을 고루 분배.
function contentTier(lv) {
  return Math.min(Math.floor((lv * CONFIG.CONTENT_TIERS) / (CONFIG.MAX_LEVEL + 1)), CONFIG.CONTENT_TIERS - 1);
}
// 레벨 → 사냥감 이모지 (스프라이트 없을 때 폴백)
function monsterEmoji(lv) {
  const list = ['🐛', '🦗', '🐀', '🦂', '🐍', '🐺', '🐗', '🐉', '👾', '👹', '🦖', '👑'];
  return list[Math.min(contentTier(lv), list.length - 1)];
}


// ── 배경음악(BGM) — 공용 절차적 엔진(shared/music.js) + Overforge 곡("Forge Fire", A단조 5음계 100BPM) ──
//   GD 필수: 음악 + 켜고 끌 수 있는 토글(효과음 토글과 분리). 광고 중엔 setAdMuted 로 즉시 음소거.
//   SFX 와 AudioContext 공유(SFX._ac). 첫 사용자 제스처(unlock)에서 start().
const MUSIC = createMusic({ getCtx: () => SFX._ac(), song: SONGS.overforge });
// 음악/효과음 토글 상태 저장 키(효과음은 기존 utils isMuted 유지, 음악은 별도 저장)
const AUDIO_PREF_KEY = 'overforge-audio';
function isMusicMuted() { const a = loadJSON(AUDIO_PREF_KEY, null); return !!(a && a.musicMuted); }
function setMusicMuted(m) { saveJSON(AUDIO_PREF_KEY, { musicMuted: !!m }); }

class GameScene extends Phaser.Scene {
  constructor() { super('game'); }

  // 아트 에셋 로드(있으면 사용, 없으면 절차적 폴백). 누락 파일은 loaderror 로 무시.
  // ART_PROMPTS.md 의 계획 에셋을 전부 예약 로드 → 파일이 폴더에 들어오는 즉시 자동 적용.
  preload() {
    this.load.on('loaderror', () => {});
    const P = 'assets/sprites/';
    // 강화 연출(이미 존재)
    this.load.image('of_weapon', P + 'weapon.png');
    this.load.image('of_weapon_kr', P + 'weapon_kr.png'); // (선택) 동양풍 무기 교체(폴백)
    // 티어드 검(약→강, 몬스터와 같은 등급에서 교체): 있으면 등급별로 교체(무틴트 원색). 없으면 위 폴백 검을 등급색 틴트.
    for (let i = 0; i <= 11; i++) this.load.image('of_weapon_t' + i, P + 'weapon_t' + i + '.png');
    this.load.image('of_glow', P + 'glow.png');
    this.load.image('of_spark', P + 'spark.png');
    this.load.image('of_shard', P + 'shard.png');
    this.load.image('of_smoke', P + 'smoke.png');
    this.load.image('of_shockwave', P + 'shockwave.png');
    for (let i = 0; i <= 6; i++) this.load.image('fx_burst_t' + i, P + 'fx_burst_t' + i + '.png');
    // ── UI 오버홀 계획 에셋(들어오면 자동 사용) ──
    // 배경(뷰별)
    this.load.image('of_bg_lobby', P + 'bg_lobby.jpg'); // 배경은 불투명 → JPG(용량↓)
    this.load.image('of_bg_forge', P + 'bg_forge.jpg');
    this.load.image('of_bg_hunt', P + 'bg_hunt.jpg');
    this.load.image('of_bg_shop', P + 'bg_shop.jpg');
    // 로비 통짜 씬(배경+건물+길+그림자 한 장). 있으면 이걸 로비 배경으로 쓰고 위에 투명 핫스팟만 얹음(방향 A).
    this.load.image('of_lobby_scene', P + 'lobby_scene.jpg');
    // 로비 건물(개별) — of_lobby_scene 없을 때의 폴백용
    this.load.image('of_lobby_forge', P + 'lobby_forge.png');
    this.load.image('of_lobby_hunt', P + 'lobby_hunt.png');
    this.load.image('of_lobby_shop', P + 'lobby_shop.png');
    // UI 키트/아이콘
    this.load.image('of_coin', P + 'coin.png');
    this.load.image('of_iconback', P + 'icon_back.png');
    this.load.image('of_popup', P + 'popup_scroll.png');
    this.load.image('of_banner', P + 'banner_ribbon.png'); // '등급 상승!' 배너 리본(있으면 텍스트 뒤에)
    this.load.image('of_iconprotect', P + 'icon_protect.png');
    this.load.image('of_iconad', P + 'icon_ad.png');
    // (of_sign = sign_plaque.png 는 미제작·미사용 → 404 콘솔 에러 방지를 위해 로드하지 않음. 팻말은 통짜 씬에 baked.)
    // 사냥감(요괴) 12종 — 있는 것만 사용, 없으면 이모지 폴백
    for (let i = 0; i <= 11; i++) this.load.image('of_monster_t' + i, P + 'monster_t' + i + '.png');
    // 개별 효과음(선택): assets/sounds/sfx/<name>.mp3 넣으면 해당 효과음만 그 파일로 교체(없으면 절차적).
    ['tap', 'button', 'coin', 'success', 'tierup', 'fail', 'soften', 'destroy'].forEach((k) => this.load.audio('sfx_' + k, ['assets/sounds/sfx/' + k + '.mp3', 'assets/sounds/sfx/' + k + '.ogg']));
  }

  // 무기 틴트: t0은 강철 풀브라이트(흰=무틴트), t1+부터 등급색 (폴백 검 전용 — 티어드 검은 무틴트 원색)
  _weaponTint() {
    return Math.floor(this.level / CONFIG.TIER_EVERY) === 0 ? 0xffffff : tierColor(this.level);
  }

  // 현재 레벨의 사냥감 텍스처 키. 콘텐츠 등급(contentTier) → 파일이 약→강 순 정렬, 없으면 walk-down 클램프.
  _monsterTexKey() {
    let dt = contentTier(this.level);
    while (dt > 0 && !this.textures.exists('of_monster_t' + dt)) dt--;
    const key = 'of_monster_t' + dt;
    return this.textures.exists(key) ? key : null;
  }

  // 현재 레벨의 검 텍스처. 티어드 검(weapon_t0..) 우선(몬스터와 같은 등급에서 교체, 점점 화려) → 없으면 weapon_kr → weapon.
  // 반환 {key, tiered}. tiered=true 면 원색 그대로(무틴트), false(폴백)면 등급색 틴트.
  _weaponTexKey() {
    let dt = contentTier(this.level);
    for (let i = dt; i >= 0; i--) if (this.textures.exists('of_weapon_t' + i)) return { key: 'of_weapon_t' + i, tiered: true };
    if (this.textures.exists('of_weapon_kr')) return { key: 'of_weapon_kr', tiered: false };
    if (this.textures.exists('of_weapon')) return { key: 'of_weapon', tiered: false };
    return null;
  }

  // 검 스프라이트 세팅(레벨 변경 시 텍스처 교체 + 비율 스케일 + 틴트). 티어드=원색(무틴트), 폴백=등급 틴트.
  _setWeaponVisual() {
    if (!this.weaponSprite) return;
    const wk = this._weaponTexKey();
    if (!wk) return;
    if (this.weaponSprite.texture.key !== wk.key) this.weaponSprite.setTexture(wk.key);
    this.weaponSprite.setScale(300 / Math.max(this.weaponSprite.width, this.weaponSprite.height));
    this.weaponSprite.setTint(wk.tiered ? 0xffffff : this._weaponTint());
  }

  create() {
    // ── 세이브 로드 ──
    const s = loadJSON(CONFIG.GAME_KEY, {}) || {};
    const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; }; // ★ 손상된 세이브(문자열/NaN) 방어 — 파생 계산 오염 차단
    // 경제 상태(prestige 먼저 → 진행형 천장 계산에 필요)
    this.prestige = clamp(num(s.prestige, 0), 0, 99); // 환생 횟수(상한 클램프 — 변조 세이브의 goldMultiplier=Infinity 방어. 99=사실상 도달불가)
    this.goldMultiplier = Math.pow(CONFIG.PRESTIGE_GOLD_BASE, this.prestige); // 영구 골드배수 1.7^n (v3)
    this.level = clamp(num(s.level, 0), 0, ceilingFor(this.prestige)); // 진행형 천장까지 클램프
    this.gold = Math.max(0, num(s.gold, 0));
    this.protect = clamp(num(s.protect, 0), 0, CONFIG.PROTECT_MAX); // 보호권 charges(광고로만 획득)
    this.maxLevel = clamp(num(s.maxLevel, 0), 0, CONFIG.CEILING_CAP);
    this._boostUntil = num(s.boostUntil, 0); // 광고 부스트 종료 시각(ms, 절대시각) — 리로드 후에도 남은 시간 유지
    this.failCounter = (s.failCounter && typeof s.failCounter === 'object') ? s.failCounter : {}; // {레벨: 연속실패수} — 천장
    this.autoProtect = s.autoProtect !== false; // 하락 시 보호권 자동소모(기본 ON)
    this.autoEnhance = !!s.autoEnhance; // v3 Phase2 p1: 자동강화 토글(prestige>=1 언락, 기본 OFF)
    this._sawFirstDrop = !!s.sawFirstDrop; // 첫 하락 온보딩 1회
    // 첫 진입 온보딩(길잡이 도깨비불): 'hunt'→'forge'→'done'. 기존 진행이 있으면(베테랑) 바로 'done' 으로 마이그레이션.
    this._onb = (typeof s.onb === 'string') ? s.onb : ((s.maxLevel || s.level || s.gold || s.sawFirstDrop) ? 'done' : 'hunt');
    this._coachEls = []; // 코치마크(도깨비불) 오브젝트 핸들
    this._adBundleCdUntil = num(s.adBundleCdUntil, 0); // ★ 무료 보호권 광고 쿨다운 — 지속(리로드로 우회 방지)
    this._boostAdCdUntil = num(s.boostAdCdUntil, 0); // 부스트 광고 쿨다운(지속)
    // IVT 방어용 내부 소프트 상한(보상형 전체, 일당). 유저에겐 안 보임 — 극단 파밍/봇만 조용히 차단.
    this._adBundleDay = Number.isInteger(s.adBundleDay) ? s.adBundleDay : -1;
    this._adBundleCount = Math.max(0, num(s.adBundleCount, 0));
    this._taps = []; // 탭(추가타) 상한용 타임스탬프
    this._atkAcc = 0; // 자동공격 누적 시간(ms)
    this.monHp = null; // 현재 몬스터 HP (생성 시 채움)
    this.monMaxHp = monsterMaxHp(this.level);
    this._saveAcc = 0;
    this.view = 'lobby'; // 현재 뷰: 'lobby' | 'hunt' | 'forge' | 'shop'
    this.busy = false; // 광고 등 비동기 중복 방지

    SFX.setMute(isMuted());
    MUSIC.setMute(isMusicMuted());
    SFX.attach(this); // 개별 효과음 파일 오버라이드를 위해 씬(사운드 매니저) 부착

    // ── 뷰 그룹(뷰 전환 시 표시/입력 토글). 각 뷰의 배경도 자기 그룹에 담긴다. ──
    this.lobbyEls = [];
    this.huntEls = [];
    this.forgeEls = [];
    this.shopEls = [];
    this.backEls = []; // 나가기 버튼(방에서만 표시)
    this.lobbyCards = []; // 로비 건물 컨테이너(폴백 방식, 탭 튕김용)
    this.lobbyGlows = []; // 통짜 씬 방식: 핫스팟 호버 헤일로(뷰 전환 시 alpha 0)
    this.lobbyNames = []; // 로비 팻말 이름 텍스트(호버 강조/리셋용)

    this._buildBackgrounds(); // 뷰별 배경(이미지 or 절차 그라디언트+장식)

    // ── 파티클 텍스처 + 이미터 (강화/처치 연출용, 전역) ──
    // 이미지(spark/shard/smoke.png) 있으면 원색 그대로 사용, 없으면 절차 텍스처 생성 후 틴트.
    const hasSpark = this.textures.exists('of_spark');
    if (!hasSpark) { const gsp = this.make.graphics({ add: false }); gsp.fillStyle(0xffffff, 1); gsp.fillCircle(6, 6, 6); gsp.generateTexture('of_spark', 12, 12); gsp.destroy(); }
    const hasShard = this.textures.exists('of_shard');
    if (!hasShard) { const gsh = this.make.graphics({ add: false }); gsh.fillStyle(0xffffff, 1); gsh.fillTriangle(0, 11, 6, 0, 12, 11); gsh.generateTexture('of_shard', 12, 12); gsh.destroy(); }
    const hasSmoke = this.textures.exists('of_smoke');
    if (!hasSmoke) { const gsm = this.make.graphics({ add: false }); gsm.fillStyle(0xffffff, 1); gsm.fillCircle(10, 10, 10); gsm.generateTexture('of_smoke', 20, 20); gsm.destroy(); }

    this.sparkEmitter = this.add.particles(0, 0, 'of_spark', {
      lifespan: 600, speed: { min: 120, max: 340 },
      scale: hasSpark ? { start: 0.28, end: 0 } : { start: 1.6, end: 0 },
      alpha: { start: 1, end: 0 }, tint: hasSpark ? 0xffffff : 0xffe08a, emitting: false,
    }).setDepth(12);
    this.shardEmitter = this.add.particles(0, 0, 'of_shard', {
      lifespan: 850, speed: { min: 140, max: 380 }, gravityY: 700, rotate: { min: 0, max: 360 },
      scale: hasShard ? { start: 0.3, end: 0.06 } : { start: 1.8, end: 0.3 },
      alpha: { start: 1, end: 0 }, tint: hasShard ? 0xffffff : 0xff6b6b, emitting: false,
    }).setDepth(12);
    this.smokeEmitter = this.add.particles(0, 0, 'of_smoke', {
      lifespan: 700, speed: { min: 20, max: 90 }, gravityY: -120,
      scale: hasSmoke ? { start: 0.18, end: 0.6 } : { start: 0.8, end: 2.4 },
      alpha: { start: 0.5, end: 0 }, tint: hasSmoke ? 0xffffff : 0x9aa0b5, emitting: false,
    }).setDepth(11);

    this._buildTopBar();
    this._buildBackButton();
    // 방 제목(방에서만 표시, 전환 시 텍스트 세팅)
    this.roomTitle = this.add.text(CX, 132, '', { fontFamily: FONT, fontSize: '30px', color: CONFIG.C_CREAM, fontStyle: 'bold' }).setOrigin(0.5).setDepth(23);
    this.roomTitle.setStroke('#000000', 5);

    this._buildLobby();
    this._buildForge();
    this._buildHunt();
    this._buildShop();
    this._pendingOffline = s.lastSeen || 0; // 오프라인 수급 팝업은 타이틀(프리롤) 뒤, 로비 진입 시 표시

    this._syncMonster();
    this._refreshTop();

    // 첫 화면 = 타이틀(PLAY → 프리롤 광고 → 마을 허브). GD 필수: Play 클릭 즉시 showAd().
    // 언어 전환(scene.restart) 등 세션 중 재생성 시에는 타이틀을 다시 거치지 않는다(프리롤은 세션 1회).
    this._buildTitle();
    if (_sessionStarted) { this.titleEls.forEach((o) => o.setVisible(false)); this._enterGame(); }
    else this.setView('title');

    // 자동 저장 + 탭 이탈 처리. 핸들러를 변수로 잡아 shutdown 에서 제거(리스너 누수 방지).
    const onVis = () => { if (document.hidden) this.saveState(); };
    document.addEventListener('visibilitychange', onVis);
    this.events.on('shutdown', () => { this.saveState(); document.removeEventListener('visibilitychange', onVis); });
  }

  // ── 타이틀(시작 화면): 로고 + 태그라인 + PLAY + 음악/효과음/언어 토글 ──
  //   GD 필수 ③ 프리롤: PLAY(pointerup) → GDFlow.playAd('interstitial') → 로비. 광고가 없어도 반드시 시작.
  _buildTitle() {
    this.titleEls = [];
    const g = this.titleEls;
    // 배경: 로비 씬 이미지가 있으면 어둡게 깔고, 없으면 절차 그라디언트
    const bgKey = this.textures.exists('of_lobby_scene') ? 'of_lobby_scene' : (this.textures.exists('of_bg_lobby') ? 'of_bg_lobby' : null);
    if (bgKey) { const bg = this.add.image(CX, H / 2, bgKey).setDepth(50); bg.setScale(Math.max(W / bg.width, H / bg.height)); g.push(bg); }
    else { this._makeGradientTexture('of_grad_title', '#2a1e3c', '#0d0d1a'); g.push(this.add.image(CX, H / 2, 'of_grad_title').setDepth(50)); }
    g.push(this.add.rectangle(CX, H / 2, W, H, 0x0b0814, 0.62).setDepth(51));

    const logo = this.add.text(CX, 250, 'OVERFORGE', { fontFamily: SIGN_FONT, fontSize: '64px', color: CONFIG.C_GOLD, fontStyle: 'bold' }).setOrigin(0.5).setDepth(52);
    logo.setStroke('#3a1e10', 10); logo.setShadow(0, 4, '#000000', 8, false, true);
    if (logo.width > W - 40) logo.setScale((W - 40) / logo.width);
    this.tweens.add({ targets: logo, scale: { from: logo.scaleX, to: logo.scaleX * 1.03 }, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    const tag = this.add.text(CX, 318, t('tagline'), { fontFamily: FONT, fontSize: '22px', color: CONFIG.C_CREAM, align: 'center', wordWrap: { width: W - 80 } }).setOrigin(0.5).setDepth(52);
    tag.setStroke('#000000', 4);
    g.push(logo, tag);
    // 통짜 씬에는 글씨 없는 팻말 3개가 baked → 타이틀에서도 로비와 같은 자리에 이름을 얹는다(빈 팻말=미완성 인상 방지).
    if (bgKey === 'of_lobby_scene') {
      CONFIG.LOBBY_HOTSPOTS.forEach((cfg) => {
        const sx = (cfg.signX != null ? cfg.signX : cfg.x) * W, sy = (cfg.signY != null ? cfg.signY : cfg.y) * H;
        const nameT = this._villageSign(sx, sy, cfg.accent, t(cfg.key), true).setDepth(52).setAlpha(0.9);
        // _villageSign 은 lobbyEls 에도 넣는다 → 타이틀 뷰가 로비 그룹을 숨기며 같이 꺼지므로 로비 그룹에서 빼고 타이틀 전용으로.
        const li = this.lobbyEls.indexOf(nameT); if (li >= 0) this.lobbyEls.splice(li, 1);
        g.push(nameT);
      });
    }

    // 검 아트가 있으면 타이틀 히어로로
    const wk = this._weaponTexKey();
    if (wk) { const hero = this.add.image(CX, 470, wk.key).setDepth(52); hero.setScale(220 / Math.max(hero.width, hero.height)); if (!wk.tiered) hero.setTint(this._weaponTint()); this.tweens.add({ targets: hero, y: 458, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.InOut' }); g.push(hero); }

    const best = this.add.text(CX, 606, t('maxLv') + ' +' + this.maxLevel + (this.prestige > 0 ? '   ·   ' + t('prestigeTag').replace('{n}', this.prestige) : ''), { fontFamily: FONT, fontSize: '22px', color: CONFIG.C_GOLD, fontStyle: 'bold' }).setOrigin(0.5).setDepth(52);
    best.setStroke('#000000', 4); g.push(best);

    const hasSave = (this.maxLevel > 0 || this.gold > 0 || this.level > 0);
    const play = this._makeButton(CX, 690, 320, 92, hasSave ? t('continueGame') : t('play'), () => this._playFromTitle(), { fill: CONFIG.C_PRIMARY, textColor: '#2a1608', big: true });
    play.all.forEach((o) => o.setDepth(53));
    this.titlePlayBtn = play;
    g.push(...play.all);

    const how = this.add.text(CX, 766, t('howTo'), { fontFamily: FONT, fontSize: '18px', color: CONFIG.C_CREAM, align: 'center', wordWrap: { width: W - 90 } }).setOrigin(0.5).setDepth(52);
    how.setStroke('#000000', 4); g.push(how);

    // 하단: 언어 / 음악 / 효과음 토글(라벨 포함 — GD: 음악·효과음 개별 토글)
    const ly = 880;
    const langBtn = this._makeButton(96, ly, 150, 52, '🌐 ' + LANG_NAMES[currentLang], () => this._cycleLang(), { fill: CONFIG.C_PANEL2 });
    langBtn.all.forEach((o) => o.setDepth(53)); g.push(...langBtn.all);
    this.titleMusicBtn = this._audioToggle(CX + 40, ly, 'music'); this.titleMusicBtn.all.forEach((o) => o.setDepth(53)); g.push(...this.titleMusicBtn.all);
    this.titleSfxBtn = this._audioToggle(CX + 170, ly, 'sfx'); this.titleSfxBtn.all.forEach((o) => o.setDepth(53)); g.push(...this.titleSfxBtn.all);
    // 타이틀은 뒤(로비 등)의 입력을 막아야 함 → 전면 차단 존(맨 아래 depth 50 위, 버튼 아래)
    const block = this.add.zone(CX, H / 2, W, H).setInteractive().setDepth(50.5);
    g.push(block);
  }

  // 음악/효과음 토글 버튼(아이콘+라벨+ON/OFF). kind='music'|'sfx'. 상태는 각각 별도 저장.
  _audioToggle(x, y, kind) {
    const isOff = () => kind === 'music' ? MUSIC.isMuted() : isMuted();
    const label = () => (kind === 'music' ? '🎵 ' : '🔊 ') + commonT(currentLang, kind === 'music' ? 'music' : 'sound') + ' ' + commonT(currentLang, isOff() ? 'off' : 'on');
    const btn = this._makeButton(x, y, 118, 52, label(), () => {
      const off = !isOff();
      if (kind === 'music') { MUSIC.setMute(off); setMusicMuted(off); if (!off) MUSIC.start(); }
      else { setMuted(off); SFX.setMute(off); SFX.unlock(); if (!off) SFX.button(); }
      this._refreshAudioToggles();
    }, { fill: isOff() ? 0x3a3550 : CONFIG.C_JADE });
    btn.kind = kind;
    btn.refresh = () => { btn.txt.setText(label()); btn.txt.setScale(1); const availW = 118 - 20; if (btn.txt.width > availW) btn.txt.setScale(availW / btn.txt.width); btn.setFill(isOff() ? 0x3a3550 : CONFIG.C_JADE); };
    return btn;
  }
  _refreshAudioToggles() {
    // 파괴된(씬 재시작 전) 오브젝트 참조는 건너뜀(.scene 없음)
    const live = (b) => b && b.refresh && ((b.txt && b.txt.scene) || (b.icon && b.icon.scene));
    [this.titleMusicBtn, this.titleSfxBtn, this.hudMusicBtn, this.hudSfxBtn].forEach((b) => { if (live(b)) b.refresh(); });
  }

  // PLAY(타이틀) → 프리롤 → 게임 진입. 광고 실패/없음이어도 반드시 진입(graceful fail).
  async _playFromTitle() {
    if (this.busy) return;
    this.busy = true;
    SFX.unlock(); MUSIC.start();
    try { await GDFlow.playAd('interstitial'); } catch (e) {}
    this.busy = false;
    if (!this.scene.isActive()) return;
    _sessionStarted = true;
    this.titleEls.forEach((o) => o.setVisible(false));
    this._enterGame();
  }

  // 로비 진입(타이틀 이후 또는 언어 재시작 이후) + 오프라인 수급 팝업
  _enterGame() {
    this.setView('lobby');
    if (this._pendingOffline) { this._buildOfflinePopup(this._pendingOffline); this._pendingOffline = 0; }
  }

  // ── 뷰별 배경 ──────────────────────────────────
  // 실 이미지(of_bg_*)가 있으면 커버-핏, 없으면 절차 그라디언트 + 소품 장식.
  _buildBackgrounds() {
    // 로비: 통짜 씬(of_lobby_scene) 우선 → 없으면 of_bg_lobby → 없으면 절차.
    const lobbyKey = this.textures.exists('of_lobby_scene') ? 'of_lobby_scene' : 'of_bg_lobby';
    this._addViewBg('lobby', this.lobbyEls, lobbyKey, '#f4b877', '#231f45', (grp) => {
      grp.push(this.add.circle(CX + 120, 150, 96, 0xffe6ad, 0.5).setDepth(-9)); // 해/달
      grp.push(this.add.ellipse(120, 600, 420, 300, 0x2b2b52, 0.9).setDepth(-9)); // 언덕L
      grp.push(this.add.ellipse(470, 640, 460, 320, 0x22203f, 0.9).setDepth(-9)); // 언덕R
      grp.push(this.add.ellipse(CX, 800, 520, 220, 0x3a346a, 0.45).setDepth(-9)); // 광장 글로우
    });
    this._addViewBg('forge', this.forgeEls, 'of_bg_forge', '#2a1e3c', '#54281c', (grp) => {
      grp.push(this.add.circle(CX, H - 110, 230, 0xff7a3a, 0.14).setDepth(-9)); // 화로 불빛
      grp.push(this.add.circle(CX, H - 110, 130, 0xffb060, 0.13).setDepth(-9));
    });
    this._addViewBg('hunt', this.huntEls, 'of_bg_hunt', '#241f47', '#0f1c36', (grp) => {
      grp.push(this.add.circle(CX + 150, 150, 74, 0xe2e8ff, 0.45).setDepth(-9)); // 달
      grp.push(this.add.rectangle(38, 620, 58, 460, 0x2a2340, 0.85).setDepth(-9)); // 장승L
      grp.push(this.add.rectangle(W - 38, 620, 58, 460, 0x2a2340, 0.85).setDepth(-9)); // 장승R
    });
    this._addViewBg('shop', this.shopEls, 'of_bg_shop', '#3a2b20', '#221a30', (grp) => {
      [120, CX, 420].forEach((lx) => grp.push(this.add.circle(lx, 150, 26, 0xffb84a, 0.5).setDepth(-9))); // 청사초롱
    });
  }

  _addViewBg(view, grp, texKey, topHex, botHex, decorate) {
    if (this.textures.exists(texKey)) {
      const bg = this.add.image(CX, H / 2, texKey).setDepth(-10);
      const sc = Math.max(W / bg.width, H / bg.height); // 커버-핏
      bg.setScale(sc);
      grp.push(bg);
    } else {
      const gk = 'of_grad_' + view;
      this._makeGradientTexture(gk, topHex, botHex);
      grp.push(this.add.image(CX, H / 2, gk).setDepth(-10));
      if (decorate) decorate(grp);
    }
  }

  // 세로 선형 그라디언트 텍스처(절차 배경) — "단색 네모" 탈출의 핵심
  _makeGradientTexture(key, topHex, botHex) {
    if (this.textures.exists(key)) return;
    const tex = this.textures.createCanvas(key, W, H);
    const ctx = tex.getContext();
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, topHex);
    grd.addColorStop(1, botHex);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
    tex.refresh();
  }

  // 소프트 방사형 헤일로 텍스처(무기 뒤 글로우용). 흰색 중심→투명. 과채도 원판 대체.
  _makeRadialGlow(key) {
    if (this.textures.exists(key)) return;
    const S = 256, tex = this.textures.createCanvas(key, S, S), ctx = tex.getContext();
    const grd = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.6)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, S, S);
    tex.refresh();
  }

  // ── 상단 바(현판) — 모든 뷰 공통 ────────────────
  _buildTopBar() {
    const g = this.add.graphics().setDepth(20);
    g.fillStyle(0x000000, 0.28); g.fillRoundedRect(8, 10, W - 16, 80, 22);
    g.fillStyle(CONFIG.C_PLAQUE, 0.96); g.fillRoundedRect(8, 8, W - 16, 80, 22); // 웜 다크 우드 현판(단청 톤)
    g.lineStyle(2, 0xffd54a, 0.32); g.strokeRoundedRect(8, 8, W - 16, 80, 22); // 금테 강조(현판 느낌)

    // 골드: 엽전 아이콘(있으면) + 숫자. 없으면 🪙 이모지 폴백.
    let goldTx = 28;
    if (this.textures.exists('of_coin')) {
      const ih = 42, src = this.textures.get('of_coin').getSourceImage();
      const iw = ih * (src.width / src.height);
      const ix = 30 + iw / 2;
      this.add.image(ix, 40, 'of_coin').setDisplaySize(iw, ih).setDepth(21);
      goldTx = ix + iw / 2 + 8;
      this._goldPrefix = '';
    } else {
      this._goldPrefix = '🪙 ';
    }
    // HUD 골드는 강화 버튼(주력 금색)보다 한 단계 낮은 채도 — 강화소에서 시선 1순위=강화 버튼 유지(색 언어).
    this.goldText = this.add.text(goldTx, 34, this._goldPrefix + '0', { fontFamily: FONT, fontSize: '32px', color: '#e3c257', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(21);
    this.perSecText = this.add.text(goldTx, 66, '+0/sec', { fontFamily: FONT, fontSize: '17px', color: CONFIG.C_DIM }).setOrigin(0, 0.5).setDepth(21);

    // 보호권: 부적 아이콘(있으면) + 개수. 없으면 🛡 이모지 폴백.
    if (this.textures.exists('of_iconprotect')) {
      const ih = 46, src = this.textures.get('of_iconprotect').getSourceImage();
      const iw = ih * (src.width / src.height);
      const ix = W - 226;
      this.add.image(ix, 36, 'of_iconprotect').setDisplaySize(iw, ih).setDepth(21);
      this.add.text(ix, 68, t('protectLabel'), { fontFamily: FONT, fontSize: '13px', color: CONFIG.C_TEXT, fontStyle: 'bold' }).setOrigin(0.5).setDepth(21); // 부적=보호권 인지성 라벨
      this.protectText = this.add.text(ix + iw / 2 + 6, 34, '0', { fontFamily: FONT, fontSize: '22px', color: CONFIG.C_TEXT, fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(21);
      this._protectPrefix = '';
    } else {
      this.protectText = this.add.text(W - 200, 34, '🛡 0', { fontFamily: FONT, fontSize: '22px', color: CONFIG.C_TEXT }).setOrigin(0, 0.5).setDepth(21);
      this._protectPrefix = '🛡 ';
    }
    // #4: 부스트 타이머 — 보호권 라벨과 겹치지 않게 상단바 가운데 줄로 이동(좌 perSec ↔ 우 보호권 사이 공백).
    this.boostText = this.add.text(CX, 66, '', { fontFamily: FONT, fontSize: '16px', color: CONFIG.C_OK, fontStyle: 'bold' }).setOrigin(0.5, 0.5).setDepth(21);

    // 음악 / 효과음 토글(개별) — 모든 뷰 공통(상단바 우측)
    this.hudMusicBtn = this._hudAudioIcon(W - 88, 48, 'music');
    this.hudSfxBtn = this._hudAudioIcon(W - 36, 48, 'sfx');
  }

  // 상단바용 컴팩트 음악/효과음 아이콘 토글(44px 히트영역, 꺼지면 사선). 상태는 타이틀 토글과 공유.
  _hudAudioIcon(x, y, kind) {
    const isOff = () => kind === 'music' ? MUSIC.isMuted() : isMuted();
    const icon = this.add.text(x, y, kind === 'music' ? '🎵' : '🔊', { fontSize: '24px' }).setOrigin(0.5).setDepth(21);
    const slash = this.add.graphics().setDepth(22);
    const refresh = () => {
      slash.clear();
      icon.setAlpha(isOff() ? 0.45 : 1);
      if (isOff()) { slash.lineStyle(3, 0xff6b6b, 0.95); slash.beginPath(); slash.moveTo(x - 12, y - 12); slash.lineTo(x + 12, y + 12); slash.strokePath(); }
    };
    refresh();
    const z = this.add.zone(x, y, 46, 46).setInteractive({ useHandCursor: true }).setDepth(22);
    z.on('pointerup', () => {
      const off = !isOff();
      if (kind === 'music') { MUSIC.setMute(off); setMusicMuted(off); if (!off) MUSIC.start(); }
      else { setMuted(off); SFX.setMute(off); SFX.unlock(); if (!off) SFX.button(); }
      this._refreshAudioToggles();
    });
    return { icon, slash, zone: z, refresh, all: [icon, slash, z] };
  }

  // ── 나가기 버튼(방 좌상단 → 로비 복귀) ──────────
  _buildBackButton() {
    const hasIcon = this.textures.exists('of_iconback');
    const y = 128, h = 52, r = 26;
    const x = 66, w = hasIcon ? 134 : 116;
    const g = this.add.graphics().setDepth(22);
    g.fillStyle(0x000000, 0.3); g.fillRoundedRect(x - w / 2, y - h / 2 + 3, w, h, r);
    g.fillStyle(0x3a2a20, 1); g.fillRoundedRect(x - w / 2, y - h / 2, w, h, r);
    g.lineStyle(2, 0xffd54a, 0.4); g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, r);
    let txt, iconImg = null;
    if (hasIcon) {
      const ih = 48, src = this.textures.get('of_iconback').getSourceImage();
      const iw = ih * (src.width / src.height);
      const ix = x - w / 2 + iw / 2 + 6;
      iconImg = this.add.image(ix, y, 'of_iconback').setDisplaySize(iw, ih).setDepth(23);
      txt = this.add.text((ix + iw / 2 + (x + w / 2 - 10)) / 2, y, t('back'), { fontFamily: FONT, fontSize: '22px', color: CONFIG.C_CREAM, fontStyle: 'bold' }).setOrigin(0.5).setDepth(23);
    } else {
      txt = this.add.text(x, y, '‹ ' + t('back'), { fontFamily: FONT, fontSize: '23px', color: CONFIG.C_CREAM, fontStyle: 'bold' }).setOrigin(0.5).setDepth(23);
    }
    const z = this.add.zone(x, y, w + 8, h + 8).setInteractive({ useHandCursor: true }).setDepth(23);
    z.on('pointerup', () => this._backToLobby());
    this.backEls.push(g, txt, z);
    if (iconImg) this.backEls.push(iconImg);
  }

  // ── 로비(마을 허브) ────────────────────────────
  _buildLobby() {
    const title = this.add.text(CX, 118, 'OVERFORGE', { fontFamily: SIGN_FONT, fontSize: '48px', color: CONFIG.C_GOLD, fontStyle: 'bold' }).setOrigin(0.5).setDepth(5);
    title.setStroke('#3a1e10', 8); title.setShadow(0, 3, '#000000', 5, false, true);
    this.lobbySubtitle = this.add.text(CX, 166, '', { fontFamily: SIGN_FONT, fontSize: '20px', color: CONFIG.C_CREAM, fontStyle: 'bold' }).setOrigin(0.5).setDepth(5);
    this.lobbySubtitle.setStroke('#000000', 4);
    this.lobbyEls.push(title, this.lobbySubtitle);

    // 언어 토글(로비 전용, 좌하단): 다음 언어로 순환 → 씬 재시작(세이브 기반이라 진행 유지).
    { const lt = this.add.text(0, 0, '🌐 ' + LANG_NAMES[currentLang], { fontFamily: FONT, fontSize: '18px', color: CONFIG.C_CREAM, fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(6);
      const pad = 14, lh = 40, lx = 14, ly = H - 30, lw = Math.ceil(lt.width) + pad * 2;
      lt.setPosition(lx + pad, ly);
      const lg = this.add.graphics().setDepth(5);
      lg.fillStyle(0x000000, 0.35); lg.fillRoundedRect(lx, ly - lh / 2 + 2, lw, lh, 20);
      lg.fillStyle(CONFIG.C_PANEL2, 0.92); lg.fillRoundedRect(lx, ly - lh / 2, lw, lh, 20);
      lg.lineStyle(2, 0xffd54a, 0.3); lg.strokeRoundedRect(lx, ly - lh / 2, lw, lh, 20);
      const lz = this.add.zone(lx + lw / 2, ly, lw, lh).setInteractive({ useHandCursor: true }).setDepth(6);
      lz.on('pointerup', () => this._cycleLang());
      this.lobbyEls.push(lg, lt, lz); }

    if (this.textures.exists('of_lobby_scene')) {
      // 방향 A: 통짜 씬(배경+건물 baked) 위에 투명 핫스팟만. 붙인 티 없음.
      this._buildLobbyHotspots();
    } else {
      // 폴백: 통짜 씬 아직 없을 때 — 개별 건물 스프라이트를 마을에 배치.
      CONFIG.LOBBY_BUILDINGS.forEach((cfg) => this._buildVillageBuilding(cfg));
    }
  }

  // 방 → 로비 복귀 = 미드롤 지점(GD 필수 ④ — Back/Menu 류 비게임플레이 버튼). 빈도는 SDK 가 조절(거절은 즉시 진행).
  async _backToLobby() {
    if (this.busy) return; // 강화 차징/광고 중엔 이동 금지
    SFX.button();
    this.busy = true;
    this.saveState();
    // 튜토리얼(사냥→강화소→첫 강화→로비 복귀)까지는 미드롤 생략 — 신규 유저가 첫 1분에 광고 3번(프리롤+Back×2)을 보면 이탈.
    // _onbShopReveal = 첫 강화 직후~로비 도착 전(튜토리얼 마지막 Back). 그 이후 Back 부터는 정상 미드롤(GD 필수 ④).
    const inTutorial = this._onb !== 'done' || this._onbShopReveal;
    if (!inTutorial) { try { await GDFlow.playAd('interstitial'); } catch (e) {} }
    this.busy = false;
    if (!this.scene.isActive()) return;
    this._viewTransition();
    this.setView('lobby');
  }

  // 언어 순환(로비 토글) → 세이브 후 씬 재시작으로 모든 텍스트를 새 언어로 재빌드.
  _cycleLang() {
    SFX.button();
    currentLang = LANGS[(LANGS.indexOf(currentLang) + 1) % LANGS.length];
    saveJSON('overforge-lang', currentLang);
    this.saveState();     // 인메모리 진행 저장(재시작이 세이브에서 로드)
    this.scene.restart(); // create() 재실행 → 뷰=로비로 복귀, 전 UI 새 언어
  }

  // 방향 A: 통짜 씬 위 투명 핫스팟(입장) + 팻말 글씨(코드) + 호버 시 이름이 금색으로 커짐.
  _buildLobbyHotspots() {
    CONFIG.LOBBY_HOTSPOTS.forEach((cfg) => {
      const cx = cfg.x * W, cy = cfg.y * H, hw = cfg.w * W, hh = cfg.h * H;
      // 이름 = 씬에 baked 된 팻말 위 "글씨만"(다국어). 좌표 signX/Y(%).
      const sx = (cfg.signX != null ? cfg.signX : cfg.x) * W;
      const sy = (cfg.signY != null ? cfg.signY : cfg.y + cfg.h / 2 + 0.04) * H;
      const nameT = this._villageSign(sx, sy, cfg.accent, t(cfg.key), true);
      const base = nameT.scaleX; nameT._baseScale = base; // maxW 축소 반영
      this.lobbyNames.push(nameT);
      // 호버 헤일로: 글씨 뒤 은은한 금빛(작고 부드럽게). 기본 alpha 0.
      let halo = null;
      if (this.textures.exists('of_glow')) {
        halo = this.add.image(sx, sy, 'of_glow').setTint(0xffdf8a).setBlendMode(Phaser.BlendModes.ADD).setDepth(9).setAlpha(0);
        halo.setDisplaySize(Math.max(nameT.width * base + 90, 180), 100);
        this.lobbyGlows.push(halo);
      }
      // 호버 = 이름이 살짝 커지고 금색으로 + 뒤 은은한 헤일로 (촌스러운 폭발 X)
      // 건물/팻말 두 존이 같은 핫스팟을 공유 → hoverCount 로 겹칠 때 깜빡임 방지.
      let hoverCount = 0;
      const applyHover = (on) => {
        this.tweens.killTweensOf(nameT); if (halo) this.tweens.killTweensOf(halo);
        this.tweens.add({ targets: nameT, scaleX: base * (on ? 1.14 : 1), scaleY: base * (on ? 1.14 : 1), duration: 150, ease: 'Back.out' });
        nameT.setColor(on ? '#ffe98a' : '#f4e4c1');
        if (halo) this.tweens.add({ targets: halo, alpha: on ? 0.5 : 0, duration: 150 });
      };
      const enter = () => {
        if (this.busy) return;
        applyHover(true);
        this.tweens.add({ targets: nameT, scaleX: base * 1.26, scaleY: base * 1.26, duration: 110, yoyo: true, ease: 'Quad.out' }); // 선택 팝
        SFX.button();
        this._viewTransition();
        this.setView(cfg.key);
      };
      // 건물 존(넉넉) + 팻말 존(글씨/판 영역) — 둘 다 입장 + 동일 호버.
      const wire = (zone) => {
        zone.on('pointerover', () => { if (hoverCount++ === 0) applyHover(true); });
        zone.on('pointerout', () => { if (--hoverCount <= 0) { hoverCount = 0; applyHover(false); } });
        zone.on('pointerdown', enter);
        this.lobbyEls.push(zone);
      };
      wire(this.add.zone(cx, cy, hw, hh).setInteractive({ useHandCursor: true }).setDepth(8));
      const sw = (cfg.signW != null ? cfg.signW : 0.30) * W, sh = (cfg.signH != null ? cfg.signH : 0.08) * H;
      wire(this.add.zone(sx, sy, sw, sh).setInteractive({ useHandCursor: true }).setDepth(8));
    });
  }

  // 마을에 놓인 건물: 스프라이트(탭 시 튕김) + 독립 Zone(히트) + 표지판(이름/스탯). 카드 없음 — 야채부락리식.
  _buildVillageBuilding(cfg) {
    const front = cfg.key === 'hunt';
    const cont = this.add.container(cfg.x, cfg.y).setDepth(front ? 7 : 6);
    cont._homeY = cfg.y;

    const imgKey = 'of_lobby_' + cfg.key;
    let bw, bh;
    if (this.textures.exists(imgKey)) {
      const img = this.add.image(0, 0, imgKey);
      img.setScale(Math.min(cfg.w / img.width, 230 / img.height)); // 폭 맞추되 높이 230 상한
      bw = img.displayWidth; bh = img.displayHeight;
      // 접지 그림자(붕 뜸 방지) — 건물 바닥에 부드러운 타원(웜 다크). 컨테이너 안(건물 뒤).
      const sh = this.add.graphics();
      sh.fillStyle(0x241608, 0.26); sh.fillEllipse(0, bh / 2 - 8, bw * 0.88, bw * 0.20);
      sh.fillStyle(0x241608, 0.26); sh.fillEllipse(0, bh / 2 - 8, bw * 0.58, bw * 0.13);
      cont.add(sh);
      cont.add(img);
    } else {
      const em = this.add.text(0, 0, cfg.icon, { fontSize: Math.round(cfg.w * 0.6) + 'px' }).setOrigin(0.5);
      bw = bh = cfg.w * 0.7;
      cont.add(em);
    }

    // 표지판(건물 앞, 땅에 박힌 나무 팻말) — 이름만
    const signCy = cfg.y + bh / 2 + 4;
    const signT = this._villageSign(cfg.x, signCy, cfg.accent, t(cfg.key));
    const nBase = signT.scaleX;

    // 호버 = 이름 살짝 확대·금색 + 건물 살짝 팝. 건물존/팻말존 공유(겹침 깜빡임 방지).
    let hoverCount = 0;
    const applyHover = (on) => {
      this.tweens.killTweensOf(signT);
      this.tweens.add({ targets: signT, scaleX: nBase * (on ? 1.14 : 1), scaleY: nBase * (on ? 1.14 : 1), duration: 150, ease: 'Back.out' });
      signT.setColor(on ? '#ffe98a' : '#f4e4c1');
    };
    const wire = (zone) => {
      zone.on('pointerover', () => { if (hoverCount++ === 0) applyHover(true); });
      zone.on('pointerout', () => { if (--hoverCount <= 0) { hoverCount = 0; applyHover(false); } });
      zone.on('pointerdown', () => this._enterBuilding(cfg.key, cont));
      this.lobbyEls.push(zone);
    };
    // 건물 존(넉넉히 +35%) + 팻말 존 — 둘 다 진입 + 동일 호버. Scale.FIT 안정 위해 독립 Zone.
    wire(this.add.zone(cfg.x, cfg.y, bw * 1.35, bh * 1.3).setInteractive({ useHandCursor: true }).setDepth(9));
    const signW = Math.max(signT.width * nBase + 60, 140);
    wire(this.add.zone(cfg.x, signCy, signW, 74).setInteractive({ useHandCursor: true }).setDepth(9));

    this.lobbyEls.push(cont);
    this.lobbyCards.push(cont);
  }

  // 표지판: 땅에 기둥으로 박힌 나무 팻말(야채부락리식). 밝은 카툰 우드 + 두꺼운 아웃라인 + 각인 글씨.
  // textOnly=true: 통짜 씬(lobby_scene)에 팻말이 이미 그려져 있음 → 판/기둥 안 그리고 "글씨만" 얹음.
  // of_sign(sign_plaque.png) 있으면 이미지로 교체(글씨는 코드가 얹음, 다국어). cy = 판(글씨) 중심.
  _villageSign(x, cy, accent, name, textOnly = false) {
    // 이름만(스탯 없음). serif 각인 글씨 — 밝은 한지색 + 짙은 외곽 + 그림자.
    const nameT = this.add.text(x, cy, name, { fontFamily: SIGN_FONT, fontSize: textOnly ? '27px' : '22px', color: '#f4e4c1', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    nameT.setStroke('#3a2410', 6); nameT.setShadow(0, 2, '#00000088', 3, false, true);
    const pw = Math.max(nameT.width + 34, 98), ph = 38, r = 8;
    const left = x - pw / 2, top = cy - ph / 2, postTop = cy + ph / 2 - 3, postH = 26;
    if (textOnly) {
      // 씬에 baked 된 팻말 위 → 글씨만. 다국어로 길어지면 폭 제한(자동 축소).
      const maxW = 210; if (nameT.width > maxW) nameT.setScale(maxW / nameT.width);
    } else if (this.textures.exists('of_sign')) {
      const img = this.add.image(x, cy - 4, 'of_sign').setDepth(9);
      img.setDisplaySize(pw + 30, ph + postH + 26); // 이미지엔 기둥 포함 가정
      this.lobbyEls.push(img);
    } else {
      const g = this.add.graphics().setDepth(9);
      // 기둥 2개(땅에 박힘)
      g.fillStyle(0x6b4526, 1);
      g.fillRect(left + 18, postTop, 9, postH); g.fillRect(left + pw - 27, postTop, 9, postH);
      g.lineStyle(3, 0x3d2410, 1);
      g.strokeRect(left + 18, postTop, 9, postH); g.strokeRect(left + pw - 27, postTop, 9, postH);
      g.fillStyle(0x241608, 0.25); g.fillEllipse(x, postTop + postH + 2, pw * 0.5, 9); // 접지 그림자
      g.fillStyle(0xb98550, 1); g.fillRoundedRect(left, top, pw, ph, r); // 판(밝은 카툰 우드)
      g.fillStyle(0xcb9a63, 1); g.fillRoundedRect(left + 4, top + 4, pw - 8, ph * 0.4, 5); // 상단 밝은 결
      g.lineStyle(4, 0x3d2410, 1); g.strokeRoundedRect(left, top, pw, ph, r); // 두꺼운 카툰 아웃라인
      g.fillStyle(accent, 1); g.fillCircle(left + 11, cy, 3); g.fillCircle(left + pw - 11, cy, 3); // 단청 못
      this.lobbyEls.push(g);
    }
    this.lobbyEls.push(nameT);
    return nameT;
  }

  // 건물 탭 → 튕김 + 뷰 전환
  _enterBuilding(key, cont) {
    if (this.busy) return;
    SFX.button();
    this.tweens.killTweensOf(cont);
    if (cont._homeY != null) cont.y = cont._homeY; // idle 바운스 위치 초기화
    this.tweens.add({ targets: cont, scale: { from: 1, to: 1.08 }, yoyo: true, duration: 120, ease: 'Quad.out', onComplete: () => cont.setScale(1) });
    this.time.delayedCall(160, () => {
      if (!this.scene.isActive()) return;
      this._viewTransition();
      this.setView(key);
    });
  }

  _refreshLobby() {
    if (this.lobbySubtitle) this.lobbySubtitle.setText(t('maxLv') + ' +' + this.maxLevel + (this.prestige > 0 ? '   ·   ' + t('prestigeTag').replace('{n}', this.prestige) : ''));
    // 팻말은 이름만(스탯 제거). 로비 재진입 시 이름 호버 상태 초기화.
    if (this.lobbyNames) this.lobbyNames.forEach((n) => { this.tweens.killTweensOf(n); n.setScale(n._baseScale != null ? n._baseScale : 1); n.setColor('#f4e4c1'); });
  }

  // 로비 건물: 상시 부유 애니 제거(붕 뜸 방지). 로비 진입마다 살짝 '자리잡기' 팝만.
  _startLobbyIdle() {
    this.lobbyCards.forEach((c, i) => {
      this.tweens.killTweensOf(c);
      if (c._homeY != null) c.y = c._homeY;
      c.setScale(0.94);
      this.tweens.add({ targets: c, scale: 1, duration: 260, delay: i * 60, ease: 'Back.out' });
    });
  }

  // ── 강화소 방 ──────────────────────────────────
  _buildForge() {
    const g = this.forgeEls;
    // 무기 뒤 소프트 헤일로 — 구 '색깔 원판/글로우'(과채도라 촌스러움) 교체. 부드러운 방사형 그라디언트(웜 화이트).
    this._makeRadialGlow('of_glow_soft');
    this.weaponGlow = this.add.image(CX, FORGE_CY, 'of_glow_soft').setDepth(3).setAlpha(0.42).setScale(1.9).setTint(0xffe6b0);
    // 무기: 티어드 검(weapon_t*) 우선 → weapon_kr → weapon. 컨테이너 안 스프라이트(비율 유지) → 기존 트윈 호환.
    const wk = this._weaponTexKey();
    this._weaponIsImg = !!wk;
    if (this._weaponIsImg) {
      this.weaponSprite = this.add.image(0, 0, wk.key);
      this.weaponIcon = this.add.container(CX, FORGE_CY, [this.weaponSprite]).setDepth(4);
      this._setWeaponVisual(); // 텍스처/스케일/틴트(티어드=원색, 폴백=등급틴트)
    } else {
      this.weaponSprite = null;
      this.weaponIcon = this.add.text(CX, FORGE_CY, '⚔️', { fontSize: '200px' }).setOrigin(0.5).setDepth(4);
    }
    this.levelText = this.add.text(CX, 576, '+0', { fontFamily: FONT, fontSize: '64px', color: CONFIG.C_TEXT, fontStyle: 'bold' }).setOrigin(0.5).setDepth(4);
    this.levelText.setStroke('#000000', 6);
    g.push(this.weaponGlow, this.weaponIcon, this.levelText);

    // 의사결정 텍스트(성공률·실패·비용·행운) 뒤 반투명 스크림 — 배경이 뭐든 가독성 보장(#4).
    this._forgeScrim = this.add.graphics().setDepth(2);
    this._forgeScrim.fillStyle(0x120d1e, 0.4); this._forgeScrim.fillRoundedRect(CX - 235, 602, 470, 128, 22); // 성공률·실패·비용·행운을 한 '정보 패널'로 묶고 버튼 앞에서 끊음
    g.push(this._forgeScrim);

    this.rateText = this.add.text(CX, 622, '', { fontFamily: FONT, fontSize: '24px', color: CONFIG.C_OK, fontStyle: 'bold' }).setOrigin(0.5).setDepth(4);
    this.failText = this.add.text(CX, 660, '', { fontFamily: FONT, fontSize: '22px', color: CONFIG.C_DIM, fontStyle: 'bold' }).setOrigin(0.5).setDepth(4);
    this.costText = this.add.text(CX, 696, '', { fontFamily: FONT, fontSize: '24px', color: CONFIG.C_GOLD }).setOrigin(0.5).setDepth(4);
    g.push(this.rateText, this.failText, this.costText);

    // 행운 게이지(천장): 연속 실패가 '적립'되는 진행바 + 카운트다운(리텐션 코어 — "이번만 실패하면 다음은 확정!").
    this.pityBar = this.add.graphics().setDepth(4);
    this.pityLabel = this.add.text(CX, 716, '', { fontFamily: FONT, fontSize: '17px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(5);
    this.pityLabel.setStroke('#000000', 3);
    g.push(this.pityBar, this.pityLabel);

    // 주력 실행 버튼 = 금(황토 골드) + 짙은 각인 글씨(대비). 빨강은 파괴/경고 전용으로 뺌(색 언어 통일).
    this.enhanceBtn = this._makeButton(CX, 790, 300, 84, t('enhance'), () => this.tryEnhance(), { fill: CONFIG.C_PRIMARY, textColor: '#3a2410', big: true });
    g.push(...this.enhanceBtn.all);

    // 보호권 자동방어 ON/OFF 토글 (강화 버튼 아래)
    const ty = 842, tw = 230;
    this.autoBg = this.add.graphics().setDepth(6);
    this.autoTxt = this.add.text(CX, ty, '', { fontFamily: FONT, fontSize: '18px', color: CONFIG.C_TEXT, fontStyle: 'bold' }).setOrigin(0.5).setDepth(7);
    this._drawAuto = () => {
      const on = this.autoProtect;
      this.autoBg.clear();
      this.autoBg.fillStyle(on ? 0x2f7a5e : 0x2a2440, 1); this.autoBg.fillRoundedRect(CX - tw / 2, ty - 18, tw, 36, 18);
      this.autoBg.lineStyle(2, on ? 0x5ef0b0 : 0x6a6a8a, 0.6); this.autoBg.strokeRoundedRect(CX - tw / 2, ty - 18, tw, 36, 18);
      this.autoTxt.setText(t('autoProtectLabel') + '  ' + (on ? t('on') : t('off'))).setColor(on ? CONFIG.C_OK : CONFIG.C_DIM);
    };
    this.autoZone = this.add.zone(CX, ty, tw, 40).setInteractive({ useHandCursor: true }).setDepth(7);
    this.autoZone.on('pointerdown', () => { this.autoProtect = !this.autoProtect; SFX.button(); this._drawAuto(); this._refreshForge(); this.saveState(); });
    this._drawAuto();
    g.push(this.autoBg, this.autoTxt, this.autoZone);

    // p1 자동강화 토글 (prestige>=1 마일스톤 언락 시에만 노출 — _refreshForge 가 visible 제어). 강화소 뷰에서 강화 자동 반복.
    const ey = 890, ew = 230;
    this.autoEnhBg = this.add.graphics().setDepth(6);
    this.autoEnhTxt = this.add.text(CX, ey, '', { fontFamily: FONT, fontSize: '18px', color: CONFIG.C_TEXT, fontStyle: 'bold' }).setOrigin(0.5).setDepth(7);
    this._drawAutoEnh = () => {
      const on = this.autoEnhance;
      this.autoEnhBg.clear();
      this.autoEnhBg.fillStyle(on ? 0x9a5a2a : 0x2a2440, 1); this.autoEnhBg.fillRoundedRect(CX - ew / 2, ey - 18, ew, 36, 18);
      this.autoEnhBg.lineStyle(2, on ? 0xffb367 : 0x6a6a8a, 0.6); this.autoEnhBg.strokeRoundedRect(CX - ew / 2, ey - 18, ew, 36, 18);
      this.autoEnhTxt.setText(t('autoEnhanceLabel') + '  ' + (on ? t('on') : t('off'))).setColor(on ? CONFIG.C_GOLD : CONFIG.C_DIM);
    };
    this.autoEnhZone = this.add.zone(CX, ey, ew, 40).setInteractive({ useHandCursor: true }).setDepth(7);
    this.autoEnhZone.on('pointerdown', () => { this.autoEnhance = !this.autoEnhance; SFX.button(); this._drawAutoEnh(); this.saveState(); });
    this._drawAutoEnh();
    g.push(this.autoEnhBg, this.autoEnhTxt, this.autoEnhZone);

    this.resultText = this.add.text(CX, 210, '', { fontFamily: FONT, fontSize: '30px', color: CONFIG.C_OK, fontStyle: 'bold' }).setOrigin(0.5).setDepth(5);
    g.push(this.resultText);
  }

  // ── 사냥터 방 ──────────────────────────────────
  _buildHunt() {
    const g = this.huntEls;
    this.huntHint = this.add.text(CX, 200, t('tapHint'), { fontFamily: FONT, fontSize: '20px', color: CONFIG.C_CREAM, fontStyle: 'bold' }).setOrigin(0.5).setDepth(4);
    this.huntHint.setStroke('#000000', 4);
    // 사냥감: 요괴 스프라이트(있으면) or 이모지. 컨테이너로 감싸 기존 스쿼시 트윈 호환. 화면 중앙 쪽(HUNT_MON_Y).
    const mtex = this._monsterTexKey();
    if (mtex) {
      this.monsterSprite = this.add.image(0, 0, mtex);
      this._fitMonster(); // 비율 유지(정사각 강제 X → 안 찌그러짐)
      this.monsterIcon = this.add.container(CX, HUNT_MON_Y, [this.monsterSprite]).setDepth(4);
    } else {
      this.monsterSprite = null;
      this.monsterIcon = this.add.text(CX, HUNT_MON_Y, monsterEmoji(this.level), { fontSize: '260px' }).setOrigin(0.5).setDepth(4);
    }

    // 몬스터 HP 바 (몬스터 아래)
    this.hpBarBg = this.add.rectangle(CX, HUNT_MON_Y + 200, 320, 26, 0x000000, 0.45).setStrokeStyle(2, 0xffffff, 0.2).setDepth(4);
    this.hpBarFill = this.add.rectangle(CX - 158, HUNT_MON_Y + 200, 316, 20, 0xff5d8f).setOrigin(0, 0.5).setDepth(4);
    this.hpText = this.add.text(CX, HUNT_MON_Y + 200, '', { fontFamily: FONT, fontSize: '15px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(5);
    this.huntInfo = this.add.text(CX, HUNT_MON_Y + 245, '', { fontFamily: FONT, fontSize: '20px', color: CONFIG.C_TEXT }).setOrigin(0.5).setDepth(4);
    g.push(this.huntHint, this.monsterIcon, this.hpBarBg, this.hpBarFill, this.hpText, this.huntInfo);

    // 탭 영역(몬스터) — 추가타. 클릭영역 크게(모바일 타격감), 몬스터 중심.
    const tapZone = this.add.zone(CX, HUNT_MON_Y, 440, 480).setInteractive({ useHandCursor: true }).setDepth(4);
    tapZone.on('pointerdown', (p) => this.onHuntTap(p));
    g.push(tapZone);

    // 골드 부스트 광고 버튼 — 화면 맨 아래
    const btn = this._makeButton(CX, 880, 340, 76, t('adBoost') + ' ' + t('watchAd'), () => this.watchBoost(), { fill: CONFIG.C_JADE, icon: 'of_iconad' });
    g.push(...btn.all);
  }

  // 사냥감 외형 세팅(레벨/등급 반영) — 스프라이트면 텍스처 교체, 이모지면 텍스트 교체
  _setMonsterVisual() {
    const mtex = this._monsterTexKey();
    if (this.monsterSprite && mtex) {
      this.monsterSprite.setTexture(mtex);
      this._fitMonster();
    } else if (!this.monsterSprite && this.monsterIcon) {
      this.monsterIcon.setText(monsterEmoji(this.level));
    }
  }

  // 사냥감 스프라이트 비율 유지 스케일(긴 변 = MONSTER_DISPLAY). 정사각 강제(setDisplaySize) 대체 → 왜곡 방지.
  _fitMonster() {
    if (!this.monsterSprite) return;
    const s = 340 / Math.max(this.monsterSprite.width, this.monsterSprite.height); // 긴 변 340(크게)
    this.monsterSprite.setScale(s);
  }

  // 몬스터 HP/외형을 현재 레벨에 맞게 새로 세팅(레벨 변경·탭 진입 시)
  _syncMonster() {
    this.monMaxHp = monsterMaxHp(this.level);
    this.monHp = this.monMaxHp;
    if (this.monsterIcon) this._setMonsterVisual();
    if (this.huntInfo) this.huntInfo.setText('⚔ ' + fmt(dps(this.level)) + t('perAtk') + '   🪙 ' + fmt(goldPerKill(this.level, this.goldMultiplier)) + t('perKill'));
    this._refreshHpBar();
  }

  _refreshHpBar() {
    if (!this.hpBarFill) return;
    const ratio = clamp(this.monHp / this.monMaxHp, 0, 1);
    this.hpBarFill.setDisplaySize(316 * ratio, 20);
    this.hpText.setText(fmt(Math.max(0, this.monHp)) + ' / ' + fmt(this.monMaxHp));
  }

  // 몬스터 타격(자동 또는 탭). 처치 시 보상 + 리젠.
  _hitMonster(dmg, isTap) {
    this.monHp -= dmg;
    // 피격 리액션(스쿼시) — 자동타/탭 모두 반응
    this.tweens.add({ targets: this.monsterIcon, scaleX: 1.08, scaleY: 0.92, yoyo: true, duration: 70 });
    if (isTap) {
      this._dmgPopup(dmg);
      this.sparkEmitter.explode(6, CX + Phaser.Math.Between(-30, 30), HUNT_MON_Y);
    }
    if (this.monHp <= 0) this._killMonster();
    else this._refreshHpBar();
  }

  _killMonster() {
    const reward = Math.floor(goldPerKill(this.level, this.goldMultiplier) * this._boostMult());
    this.gold += reward;
    SFX.coin();
    this._goldBurst(reward);
    this._coinsToCounter();
    this.smokeEmitter.explode(6, CX, HUNT_MON_Y);
    this.sparkEmitter.explode(12, CX, HUNT_MON_Y);
    // 새 몬스터 등장
    this.monMaxHp = monsterMaxHp(this.level);
    this.monHp = this.monMaxHp;
    this._setMonsterVisual();
    this._refreshHpBar();
    this.tweens.killTweensOf(this.monsterIcon);
    this.monsterIcon.setScale(1);
    this.tweens.add({ targets: this.monsterIcon, scale: { from: 0.4, to: 1 }, duration: 240, ease: 'Back.out' });
    this.tweens.add({ targets: this.goldText, scale: { from: 1.12, to: 1 }, duration: 140 }); // 골드 카운터 톡
  }

  // 처치 보상 코인이 상단 골드 카운터로 날아가는 연출
  _coinsToCounter() {
    const useImg = this.textures.exists('of_coin');
    // ★ 코인 표시 크기: setDisplaySize 는 아래 scale 트윈(from)에 덮여 무효였음(그래서 native ~512px로 거대) → scale 로 직접 지정.
    const cs = useImg ? 26 / this.textures.get('of_coin').getSourceImage().width : 1;
    for (let i = 0; i < 5; i++) {
      const x0 = CX + Phaser.Math.Between(-50, 50);
      let c;
      if (useImg) c = this.add.image(x0, HUNT_MON_Y, 'of_coin').setScale(cs).setDepth(13);
      else c = this.add.text(x0, HUNT_MON_Y, '🪙', { fontSize: '26px' }).setOrigin(0.5).setDepth(13);
      this.tweens.add({ targets: c, x: 60, y: 40, scale: { from: useImg ? cs : 1, to: useImg ? cs * 0.5 : 0.5 }, duration: 420, delay: i * 45, ease: 'Cubic.in', onComplete: () => c.destroy() });
    }
  }

  _goldBurst(reward) {
    const fx = this.add.text(CX, HUNT_MON_Y - 20, '+' + fmt(reward), { fontFamily: FONT, fontSize: '40px', color: CONFIG.C_GOLD, fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    fx.setStroke('#000000', 4);
    this.tweens.add({ targets: fx, y: HUNT_MON_Y - 120, alpha: { from: 1, to: 0 }, scale: { from: 1.2, to: 1 }, duration: 800, ease: 'Cubic.out', onComplete: () => fx.destroy() });
  }

  _dmgPopup(dmg) {
    const x = CX + Phaser.Math.Between(-60, 60);
    const fx = this.add.text(x, HUNT_MON_Y - 20, fmt(dmg), { fontFamily: FONT, fontSize: '24px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(9);
    this.tweens.add({ targets: fx, y: HUNT_MON_Y - 70, alpha: 0, duration: 450, ease: 'Cubic.out', onComplete: () => fx.destroy() });
  }

  // ── 상점 방 ────────────────────────────────────
  _buildShop() {
    const g = this.shopEls;
    // v3: 보호권 골드 구매/비축 폐지 → 광고로만 획득. 자동방어는 charges 먼저, 부족하면 골드(소비 시점 과금).
    const hint = this.add.text(CX, 258, t('shopProtectHint'), { fontFamily: FONT, fontSize: '18px', color: CONFIG.C_CREAM, align: 'center', wordWrap: { width: 400 }, lineSpacing: 5 }).setOrigin(0.5).setDepth(4);
    // #4: 안내문 뒤 반투명 스크림 — 주막 실내 배경이 밝아 글씨가 묻히던 문제 해결(텍스트 실측 바운즈에 맞춤).
    const hb = hint.getBounds();
    const hintScrim = this.add.graphics().setDepth(3);
    // 밝은 창살 배경에 묻히던 문제 → 확실한 어두운 패널(불투명도↑ + 은은한 테두리).
    hintScrim.fillStyle(0x0d0a16, 0.72); hintScrim.fillRoundedRect(hb.x - 22, hb.y - 14, hb.width + 44, hb.height + 28, 16);
    hintScrim.lineStyle(1, 0xffffff, 0.12); hintScrim.strokeRoundedRect(hb.x - 22, hb.y - 14, hb.width + 44, hb.height + 28, 16);
    const b2 = this._makeButton(CX, 352, 388, 74, t('adProtect') + ' +' + CONFIG.AD_PROTECT_QTY + ' ' + t('watchAd'), () => this.watchProtect(), { fill: CONFIG.C_JADE, icon: 'of_iconad' });
    // #5: 보유량 + 현재 레벨 방어 필요량 표시 → 광고로 미리 모을 동기 부여(v3는 광고로만 획득).
    this.shopProtectStat = this.add.text(CX, 408, '', { fontFamily: FONT, fontSize: '19px', color: CONFIG.C_GOLD, fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(4);
    const b3 = this._makeButton(CX, 476, 388, 74, t('adBoost') + ' ' + t('watchAd'), () => this.watchBoost(), { fill: CONFIG.C_JADE, icon: 'of_iconad' });
    g.push(hintScrim, hint, ...b2.all, this.shopProtectStat, ...b3.all);

    // 하단 '내 검' 카드 — 상점 아래 절반이 비어 보이던 문제(GD '빈 공간' 지적 유형). 현재 티어 검 아트 + 레벨·기록 + 12티어 진행 핍.
    // 글자는 기존 키(maxLv)만 사용해 11개 언어 추가 없음. _refreshShop 이 갱신.
    const cardY = 720;
    const card = this.add.graphics().setDepth(3);
    card.fillStyle(0x0d0a16, 0.72); card.fillRoundedRect(CX - 210, cardY - 150, 420, 300, 18);
    card.lineStyle(1, 0xffffff, 0.12); card.strokeRoundedRect(CX - 210, cardY - 150, 420, 300, 18);
    this._makeRadialGlow('of_glow_soft');
    const halo = this.add.image(CX, cardY - 20, 'of_glow_soft').setDepth(3).setAlpha(0.35).setScale(1.1).setTint(0xffe6b0);
    const wk = this._weaponTexKey();
    this.shopWeapon = wk ? this.add.image(CX, cardY - 20, wk.key).setDepth(4) : this.add.text(CX, cardY - 20, '⚔️', { fontSize: '120px' }).setOrigin(0.5).setDepth(4);
    this.shopLevelText = this.add.text(CX, cardY + 84, '', { fontFamily: FONT, fontSize: '22px', color: CONFIG.C_CREAM, fontStyle: 'bold' }).setOrigin(0.5).setDepth(4);
    this.shopLevelText.setStroke('#000000', 4);
    this.shopTierPips = this.add.graphics().setDepth(4);
    this._shopCardY = cardY;
    g.push(card, halo, this.shopWeapon, this.shopLevelText, this.shopTierPips);
  }

  // ── 뷰 전환: 그룹 표시/입력 토글 (안 보이는 Zone 은 입력도 안 받음) ──
  setView(key) {
    this.view = key;
    if (this.titleEls) this.titleEls.forEach((o) => o.setVisible(key === 'title'));
    if (key === 'title') { // 타이틀: 게임 뷰 전부 숨김(타이틀 배경이 덮지만 입력도 확실히 차단)
      [this.lobbyEls, this.huntEls, this.forgeEls, this.shopEls, this.backEls].forEach((grp) => grp.forEach((o) => o.setVisible(false)));
      this.roomTitle.setVisible(false);
      this._clearCoach();
      return;
    }
    const isRoom = key !== 'lobby';
    this.lobbyEls.forEach((o) => o.setVisible(key === 'lobby'));
    this.huntEls.forEach((o) => o.setVisible(key === 'hunt'));
    this.forgeEls.forEach((o) => o.setVisible(key === 'forge'));
    this.shopEls.forEach((o) => o.setVisible(key === 'shop'));
    this.backEls.forEach((o) => o.setVisible(isRoom));
    this.roomTitle.setVisible(isRoom);
    if (isRoom) this.roomTitle.setText(t(key));

    // 로비 이탈 시 카드 튕김 트윈 정리(스케일 잔상 방지)
    if (key !== 'lobby') this.lobbyCards.forEach((c) => { this.tweens.killTweensOf(c); c.setScale(1); if (c._homeY != null) c.y = c._homeY; });
    // 핫스팟 글로우는 호버로만 켜짐 → 뷰 전환 시 항상 숨김(+펄스 트윈 정리, lobbyEls 토글이 켜버리는 것 방지)
    this.lobbyGlows.forEach((g) => { this.tweens.killTweensOf(g); g.setAlpha(0); }); // 헤일로는 alpha 로 숨김(호버로만 켜짐)

    if (key === 'lobby') { this._refreshLobby(); this._startLobbyIdle(); }
    if (key === 'forge') this._refreshForge();
    if (key === 'hunt') { this._atkAcc = 0; this._syncMonster(); }
    if (key === 'shop') this._refreshShop();

    // ★B: 온보딩 코치마크 재평가(뷰전환·언어재시작마다). + 첫 강화 후 로비 복귀 시 상점 등장 연출(1회).
    this._updateCoach(key);
    if (key === 'lobby' && this._onbShopReveal) {
      this._onbShopReveal = false;
      const sh = CONFIG.LOBBY_HOTSPOTS.find((c) => c.key === 'shop');
      if (sh) { this.sparkEmitter.explode(28, sh.x * W, sh.y * H); this.time.delayedCall(220, () => { if (this.scene.isActive() && this.view === 'lobby') this._toast(t('onbShopTip'), CONFIG.C_GOLD); }); }
    }
  }

  // 뷰 전환 시 짧은 암전 커튼(방 진입 느낌)
  _viewTransition() {
    const c = this.add.rectangle(CX, H / 2, W, H, 0x0d0b1e, 0.5).setDepth(30);
    this.tweens.add({ targets: c, alpha: 0, duration: 240, ease: 'Quad.out', onComplete: () => c.destroy() });
  }

  // 버튼 헬퍼: 라운드 글로시 판(그래픽) + 라벨 + Zone. 반환 all = [g,txt,z] (그룹 토글/파괴용)
  _makeButton(x, y, w, h, label, cb, opts = {}) {
    let fill = opts.fill != null ? opts.fill : CONFIG.C_BUY;
    let bright = Phaser.Display.Color.IntegerToColor(fill).brighten(14).color;
    const r = 20;
    const g = this.add.graphics().setDepth(6);
    const draw = (c, pressed) => {
      const oy = pressed ? 2 : 0;
      g.clear();
      g.fillStyle(0x000000, 0.28); g.fillRoundedRect(x - w / 2, y - h / 2 + 4, w, h, r); // 그림자
      g.fillStyle(c, 1); g.fillRoundedRect(x - w / 2, y - h / 2 + oy, w, h, r); // 본체
      g.fillStyle(0xffffff, 0.14); g.fillRoundedRect(x - w / 2 + 6, y - h / 2 + 6 + oy, w - 12, h * 0.38, r * 0.7); // 상단 글로스
      g.lineStyle(2, 0xffffff, 0.22); g.strokeRoundedRect(x - w / 2, y - h / 2 + oy, w, h, r); // 테두리
    };
    draw(fill, false);
    // (선택) 왼쪽 아이콘 — 있으면 그리고 라벨은 남은 공간 중앙에 배치
    let icon = null, txtX = x, iconW = 0;
    if (opts.icon && this.textures.exists(opts.icon)) {
      const ih = opts.iconH || (h - 20);
      const src = this.textures.get(opts.icon).getSourceImage();
      const iw = ih * (src.width / src.height);
      iconW = iw;
      const ix = x - w / 2 + iw / 2 + 12;
      icon = this.add.image(ix, y, opts.icon).setDisplaySize(iw, ih).setDepth(7);
      txtX = (ix + iw / 2 + (x + w / 2 - 12)) / 2; // 아이콘 오른쪽~버튼 오른쪽 사이 중앙
    }
    const txt = this.add.text(txtX, y, label, { fontFamily: FONT, fontSize: opts.big ? '34px' : '22px', color: opts.textColor || CONFIG.C_TEXT, fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(7);
    // ★F: 긴 로케일 라벨이 버튼 밖으로 넘치면 자동 축소(오프라인 COLLECT×2·골드방어 CTA·광고 버튼 de/ru/pt/ja 오버플로 방지)
    { const availW = w - 20 - (icon ? iconW + 12 : 0); if (txt.width > availW) txt.setScale(availW / txt.width); }
    const z = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true }).setDepth(7);
    const shift = (dy) => { txt.setY(y + dy); if (icon) icon.setY(y + dy); };
    // ⚠️ 실행(cb)은 pointerup 에서 — GD 위키: "showAd() call should be behind a touchUp/mouseUp event".
    //    pointerdown 은 눌림 연출만. 누른 채 밖으로 나가면(pointerout) 실행되지 않는다.
    let pressed = false;
    z.on('pointerover', () => draw(bright, false));
    z.on('pointerout', () => { pressed = false; draw(fill, false); shift(0); });
    z.on('pointerdown', () => { if (this.busy) return; pressed = true; draw(bright, true); shift(2); });
    z.on('pointerup', () => { draw(bright, false); shift(0); if (!pressed) return; pressed = false; if (this.busy) return; cb(); });
    const all = [g, txt, z]; if (icon) all.push(icon);
    const setFill = (c) => { fill = c; bright = Phaser.Display.Color.IntegerToColor(fill).brighten(14).color; draw(fill, false); };
    return { bg: g, txt, zone: z, icon, all, setFill };
  }

  // ── 강화 시도: 골드 차감 → 차징 연출 → 결과 ────
  tryEnhance() {
    if (this.busy) return; // 차징 중 재입력 방지
    SFX.unlock();
    if (this.level >= this.ceiling()) { this._offerPrestige(); return; } // 천장 → 환생만
    const cost = enhanceCost(this.level);
    if (this.gold < cost) {
      this._flashResult(t('notEnough'), CONFIG.C_BAD);
      SFX.fail();
      this.cameras.main.shake(120, 0.004);
      if (this._onb !== 'done') this._toast(t('onbLowGold'), CONFIG.C_BAD); // ★B 안전망: 온보딩 중 골드 부족하게 연타 시 사냥 유도
      return;
    }
    // ★B 온보딩: 첫 강화 실행 → 완료 처리(레벨0=100%·무위험 → 첫 도박이 반드시 성공 = 강렬한 첫 기억). 상점 등장 연출 예약.
    if (this._onb === 'forge') { this._onb = 'done'; this._clearCoach(); this._onbShopReveal = true; this.saveState(); }
    // ★ 비용 차감은 tryEnhance 가 아니라 _resolveEnhance 에서(결과와 원자적). 차징 중 리로드 시 '골드만 빠지고 레벨 그대로' 유실 방지.
    const L = this.level;
    const rate = enhanceRate(L);
    const roll = Math.random() * 100; // <rate 면 성공
    // 천장: 현재 레벨 연속 실패가 임계 도달 → 이번 시도 강제 성공
    const forced = (this.failCounter[L] || 0) >= this._pityThreshold();
    const success = forced || roll < rate;
    const byPity = forced && !(roll < rate); // 천장으로 건진 성공(연출 구분)
    this.busy = true;
    this._chargeAnim(() => {
      this.busy = false;
      this._resolveEnhance(success, roll, rate, byPity);
    });
  }

  // 차징: 수렴 링 3겹 + 무기 진동 + 글로우 강화 + 차오르는 사운드(레벨 높을수록 길게)
  _chargeAnim(cb) {
    const ms = chargeMs(this.level);
    SFX.charge(ms);
    // 무기 진동(긴장)
    this.tweens.add({ targets: this.weaponIcon, angle: { from: -3, to: 3 }, duration: 60, yoyo: true, repeat: Math.max(2, Math.floor(ms / 120)) });
    // 수렴 링 3겹(stagger)
    for (let i = 0; i < 3; i++) {
      this.time.delayedCall(i * (ms / 3), () => {
        if (!this.scene.isActive()) return;
        const ring = this.add.circle(CX, FORGE_CY, 150, tierColor(this.level), 0).setStrokeStyle(4, 0xffffff, 0.8).setDepth(7);
        this.tweens.add({ targets: ring, scale: { from: 1.7, to: 0.5 }, alpha: { from: 0.85, to: 0 }, duration: ms / 2, ease: 'Cubic.in', onComplete: () => ring.destroy() });
      });
    }
    // 글로우 점점 강해짐
    this.tweens.add({ targets: this.weaponGlow, alpha: 0.6, duration: ms, ease: 'Sine.in' });
    this.time.delayedCall(ms, () => { this.weaponIcon.setAngle(0); cb(); });
  }

  // 등급별 성공 버스트 이미지(fx_burst_t0~t6). ADD 블렌드로 글로우. 없으면 no-op(충격파/스파크가 폴백).
  _successBurst(tier) {
    const key = 'fx_burst_t' + Math.min(Math.max(tier, 0), 6);
    if (!this.textures.exists(key)) return;
    const img = this.add.image(CX, FORGE_CY, key).setDepth(10).setBlendMode(Phaser.BlendModes.ADD).setScale(0.2).setAngle(-8);
    this.tweens.add({ targets: img, scale: { from: 0.2, to: 0.95 }, duration: 260, ease: 'Cubic.out' });
    this.tweens.add({ targets: img, angle: 8, duration: 600, ease: 'Sine.out' });
    // ★L: destroy 를 가장 긴 트윈(angle 600ms)에 맞춰 실행하고, 남은 트윈을 먼저 정리(죽은 객체에 트윈 쓰기 방지).
    this.tweens.add({ targets: img, alpha: { from: 1, to: 0 }, delay: 260, duration: 340, ease: 'Cubic.in', onComplete: () => { this.tweens.killTweensOf(img); img.destroy(); } });
  }

  // 충격파 링(성공/파괴 임팩트)
  _shockwave(x, y, color) {
    if (this.textures.exists('of_shockwave')) {
      const img = this.add.image(x, y, 'of_shockwave').setTint(color).setDepth(11).setScale(0.12);
      this.tweens.add({ targets: img, scale: { from: 0.12, to: 0.62 }, alpha: { from: 0.9, to: 0 }, duration: 480, ease: 'Cubic.out', onComplete: () => img.destroy() });
      return;
    }
    const ring = this.add.circle(x, y, 60, color, 0).setStrokeStyle(6, color, 0.9).setDepth(11);
    this.tweens.add({ targets: ring, scale: { from: 0.3, to: 2.6 }, alpha: { from: 0.9, to: 0 }, duration: 480, ease: 'Cubic.out', onComplete: () => ring.destroy() });
  }

  // 흰색 섬광 원
  _flashCircle(x, y) {
    const f = this.add.circle(x, y, 110, 0xffffff, 0.9).setDepth(11);
    this.tweens.add({ targets: f, scale: { from: 0.6, to: 1.7 }, alpha: { from: 0.9, to: 0 }, duration: 300, ease: 'Cubic.out', onComplete: () => f.destroy() });
  }

  // 결과 처리 + 연출 (경제 v2: 안전구간 하락 / 천장 / 환생 — +0 완전초기화 폐지)
  _resolveEnhance(success, roll, rate, byPity) {
    const L = this.level; // 이번 시도의 시작 레벨(= 천장 카운터 키)
    // ★C: 자동강화 전뷰(환생4+)로 사냥터/상점에서 백그라운드 강화가 resolve될 때는 연출/모달을 억제
    //   (강화소 UI·팬텀 인터랙티브 존·화면 플래시가 다른 뷰를 침범하지 않게). 레벨/골드 등 상태 변경은 그대로.
    const inForge = this.view === 'forge';
    this.gold -= enhanceCost(L); // ★ 비용을 결과와 원자적으로 차감(차징 중 리로드 골드 유실 방지)
    if (success) {
      this.level = L + 1;
      this.failCounter[L] = 0; // ★ 방금 떠난 레벨의 천장 카운터만 리셋
      this.maxLevel = Math.max(this.maxLevel, this.level);
      if (this._onb !== 'done' && this.maxLevel >= 3) { this._onb = 'done'; this._clearCoach(); } // ★B 안전망: 경로 안 따라도 +3 도달 시 온보딩 종료
      if (inForge) {
        const tier = Math.floor(this.level / CONFIG.TIER_EVERY);
        SFX.success();
        this._flashCircle(CX, FORGE_CY);
        this._successBurst(tier); // 등급별 버스트 이미지(있으면)
        const rings = 1 + Math.min(tier, 4); // 등급 높을수록 충격파 여러 겹
        for (let r = 0; r < rings; r++) {
          this.time.delayedCall(r * 80, () => { if (this.scene.isActive() && this.view === 'forge') this._shockwave(CX, FORGE_CY, tierColor(this.level)); });
        }
        this.sparkEmitter.explode(Math.min(26 + tier * 10, 80), CX, FORGE_CY);
        const pop = 1.3 + Math.min(this.level * 0.02, 0.5); // 고레벨일수록 더 큰 팝
        this.tweens.add({ targets: [this.weaponIcon, this.levelText], scale: { from: pop, to: 1 }, duration: 300, ease: 'Back.out' });
        this._flashResult('+' + this.level + '  ' + (byPity ? t('pityHit') : t('enhanced')), CONFIG.C_OK);
        this.tweens.add({ targets: this.resultText, scale: { from: 1.4, to: 1 }, duration: 260, ease: 'Back.out' });
        this.cameras.main.flash(180, 120, 255, 200);
        if (this.level >= this.ceiling()) this._onMaxLevel(); // 천장 도달
        else if (this.level % CONFIG.TIER_EVERY === 0) this._safeReached(); // 5배수 = 안전구간(성취/세션 종료점)
      }
    } else {
      this.failCounter[L] = (this.failCounter[L] || 0) + 1; // ★ 실패 시 먼저 +1 (하락해도 리셋 안 함 → 재등반 천장 유지)
      const nearMiss = roll - rate < CONFIG.NEAR_MISS_MARGIN;
      const dropTo = nearestSafe(L);
      // 하락 조건: 위험 레벨 + 자기 자신이 바닥이 아님 + 강등 굴림 통과. (아니면 유지)
      const willDrop = L >= CONFIG.NO_RISK_BELOW && dropTo !== L && Math.random() < ACTIVE_DROP_PROB;
      const need = protectsNeeded(L);
      // 옵션 F: 방어(보호권/광고)는 하락을 완전취소가 아니라 −1로 완화. −1 결과가 자연하락(dropTo)보다 높을 때만 이득.
      const defenseHelps = L - 1 > dropTo;
      // P2.1: 자동강화 ON(모드)이면 자동방어는 charges 전용(골드 경로 차단 → 리액티브 광고 잠식 방지). 수동 모드만 골드 허용.
      const autoMode = this.autoEnhance && this._hasMilestone('autoEnhance');
      const canDefend = defenseHelps && this.autoProtect && L < CONFIG.PROTECT_LOCK_ABOVE;
      if (!willDrop) {
        // 유지(무위험 / 강등 판정 미통과 / 안전구간 바닥) — 보호권 소모 안 함
        if (inForge) { this._flashResult(t('failKept'), CONFIG.C_DIM); SFX.fail(); this.smokeEmitter.explode(8, CX, FORGE_CY); this.cameras.main.shake(140, 0.005); }
      } else if (canDefend && this.protect >= need) {
        // 오토디펜스(옵션 F) — charges: 광고로 번 무료 자원이라 자동 소모(조용히). 하락을 −1로 완화.
        this.protect -= need;
        this.level = L - 1;
        if (inForge) { this._flashResult(t('softenedMsg') + ' −1' + (need > 1 ? ' ' + t('protectLabel') + '×' + need : ''), CONFIG.C_OK); this._softenFx(); }
      } else if (canDefend && !autoMode && this._sawFirstDrop && this.gold >= autoDefenseGoldCost(L, this.goldMultiplier)) {
        // ★#1: 골드 방어는 수급 수시간치를 조용히 차감하면 안 됨 → '골드로 −1 되돌리기' 모달로 명시적 선택.
        //   ★리로드 회피 차단(#2): 하락을 먼저 확정·저장(아래 공통 tail)한 뒤 되돌리기 제안 → 리액티브 광고와 동일 패턴.
        //   (charges 방어는 위에서 무료라 자동. 첫 하락은 온보딩 우선이라 아래 else 로.)
        this.level = dropTo;
        this._dropFx();
        this._confirmGoldDefense(L, dropTo);
      } else {
        // 미방어 하락: 가장 가까운 안전구간으로(최대 −4강). 이후 리액티브 광고(−1 완화) 제안.
        this.level = dropTo;
        if (inForge) this._dropFx();
        // P2.1: 자동강화 모드에서 deep 하락을 charges 로 못 막음 → 자동강화 정지(광고로 charges 보충 유도).
        if (autoMode && defenseHelps) { this.autoEnhance = false; if (this._drawAutoEnh) this._drawAutoEnh(); this._toast(t('autoPaused'), CONFIG.C_BAD); }
        this._onDrop(L, dropTo, defenseHelps); // 첫 하락 온보딩 / 이후 리액티브 광고(−1). 강화소 뷰에서만(가드는 _onDrop 내부).
      }
      if (inForge && nearMiss) this._nearMiss();
    }
    this._refreshForge();
    this._refreshTop();
    this._syncMonster(); // 레벨 변경 → 몬스터 HP/보상 재산정
    // ★H: per-resolve 즉시 저장 제거 — 자동강화가 초당 2~3회 JSON+localStorage 동기저장을 유발했음.
    //   상태는 update() 의 3초 주기 저장 + 탭이탈(visibilitychange)/shutdown 저장이 커버(최악 <3초 손실, AFK 라 무해).
  }

  // 방어 완화(−1) 연출 — charges/골드 방어 공용
  _softenFx() {
    SFX.soften();
    this._shockwave(CX, FORGE_CY, 0x5ef0b0);
    this.cameras.main.shake(170, 0.006);
    this.tweens.add({ targets: this.weaponIcon, y: '+=10', yoyo: true, duration: 120 });
  }

  // 미방어 하락 연출 — this.level 은 이미 dropTo 로 세팅된 상태에서 호출
  _dropFx() {
    this._flashResult(t('failDown') + ' +' + this.level, CONFIG.C_BAD);
    SFX.destroy();
    this._shockwave(CX, FORGE_CY, 0xff5d5d);
    this.shardEmitter.explode(20, CX, FORGE_CY);
    this.smokeEmitter.explode(14, CX, FORGE_CY);
    this.cameras.main.shake(300, 0.012);
    this.cameras.main.flash(160, 255, 90, 90);
    this.tweens.add({ targets: this.weaponIcon, y: '+=20', yoyo: true, duration: 150 });
  }

  // ★#1: 골드 '되돌리기' 모달. charges 부족 + 수동 모드 + 첫 하락 이후에만 도달.
  //   호출 시점에 하락은 이미 dropTo 로 확정·저장됨(#2 리로드 회피 차단). 여기선 골드로 −1(=L-1)까지 되돌리기만 제안.
  //   [유지]=이미 확정된 dropTo 유지(아무 것도 안 함) / [방어]=골드 차감 후 L-1 로 완화.
  //   ⚠️ busy 를 세우지 말 것(#5): _makeButton pointerdown 이 `if (this.busy) return` 이라 busy=true 면 모달 버튼이 죽어 소프트락.
  //      모달 dim(depth45)이 이미 뒤 UI 입력을 흡수하므로 busy 없이 안전.
  _confirmGoldDefense(L, dropTo) {
    const cost = autoDefenseGoldCost(L, this.goldMultiplier);
    this._modal({
      title: t('goldDefendTitle'),
      body: t('goldDefendBody').replace('{g}', fmt(cost)),
      buttons: [
        { label: t('keepDrop'), fill: CONFIG.C_PANEL2, cb: (close) => { SFX.button(); close(); } },
        { label: t('goldDefendCta').replace('{g}', fmt(cost)), fill: CONFIG.C_JADE, cb: (close) => {
            close();
            if (this.gold < cost) { this._toast(t('notEnough'), CONFIG.C_BAD); SFX.fail(); return; } // 대기 중 골드는 증가만 → 사실상 불발
            this.gold -= cost; this.level = L - 1;
            this._flashResult(t('softenedMsg') + ' −1  🪙' + fmt(cost), CONFIG.C_OK);
            this._softenFx();
            this._refreshForge(); this._refreshTop(); this._syncMonster(); this.saveState();
          } },
      ],
    });
  }

  // 5강 단위 돌파 등급 상승 연출(임시 절차적 — 추후 등급별 이미지 이펙트로 교체)
  _tierUpFlair() {
    SFX.tierUp();
    const c = tierColor(this.level);
    this._shockwave(CX, FORGE_CY, c);
    this._shockwave(CX, FORGE_CY, 0xffffff);
    this.sparkEmitter.explode(50, CX, FORGE_CY);
    this.cameras.main.flash(260, 255, 255, 255);
    // 배너: of_banner 리본(있으면) 위에 '등급 상승!' 글씨. 컨테이너로 묶어 팝/페이드(리본 setDisplaySize 보존).
    const cont = this.add.container(CX, 150).setDepth(12);
    if (this.textures.exists('of_banner')) {
      const rib = this.add.image(0, 4, 'of_banner');
      const src = this.textures.get('of_banner').getSourceImage();
      rib.setDisplaySize(400, 400 * src.height / src.width);
      cont.add(rib);
    }
    const banner = this.add.text(0, 0, t('tierUp'), { fontFamily: FONT, fontSize: '36px', color: '#fff2c8', fontStyle: 'bold' }).setOrigin(0.5);
    banner.setStroke('#5a1e10', 6);
    cont.add(banner);
    this.tweens.add({ targets: cont, scale: { from: 1.7, to: 1 }, duration: 300, ease: 'Back.out' });
    this.tweens.add({ targets: cont, alpha: 0, delay: 1000, duration: 600, onComplete: () => cont.destroy() });
  }

  _nearMiss() {
    const txt = this.add.text(CX, 180, t('soClose'), { fontFamily: FONT, fontSize: '34px', color: '#ffcf5a', fontStyle: 'bold' }).setOrigin(0.5).setDepth(11);
    txt.setStroke('#000000', 5);
    this.tweens.add({ targets: txt, scale: { from: 1.4, to: 1 }, duration: 200, ease: 'Back.out' });
    this.tweens.add({ targets: txt, alpha: 0, delay: 700, duration: 500, onComplete: () => txt.destroy() });
    this.cameras.main.shake(120, 0.004);
  }

  _flashResult(msg, color) {
    this.resultText.setText(msg).setColor(color).setAlpha(1);
    this.tweens.killTweensOf(this.resultText);
    this.tweens.add({ targets: this.resultText, alpha: 0, delay: 900, duration: 600 });
  }

  // 버튼 구매가능 여부 시각화(불가 시 흐리게) — 탭하면 여전히 거부 플래시가 뜨는 폴백은 유지.
  _setBtnAfford(btn, afford) {
    if (!btn) return;
    btn.bg.setAlpha(afford ? 1 : 0.5);
    btn.txt.setAlpha(afford ? 1 : 0.6);
  }

  // 어느 뷰에서든 뜨는 짧은 토스트(상점/사냥터엔 resultText 가 없어 공용). 광고 실패 등 피드백용.
  _toast(msg, color = CONFIG.C_TEXT) {
    // depth 60: 모달 dim(45)/패널(46)/버튼(48) 위 — 하락취소 팝업 등 모달 열린 상태에서 광고실패 피드백이 가려지지 않게.
    const fx = this.add.text(CX, 210, msg, { fontFamily: FONT, fontSize: '22px', color, fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(60);
    fx.setStroke('#000000', 5);
    this.tweens.add({ targets: fx, y: 178, alpha: { from: 1, to: 0 }, duration: 1400, ease: 'Cubic.out', onComplete: () => fx.destroy() });
  }

  // ── 첫 진입 온보딩: 길잡이 도깨비불(코치마크) ──────
  // 비강제·비차단: 한 번에 한 타깃만 가리키는 발광 오브 + 까딱 화살표 + 한 줄 문구. 무시하면 그게 스킵.
  _clearCoach() {
    if (this._coachEls) this._coachEls.forEach((o) => { this.tweens.killTweensOf(o); o.destroy(); });
    this._coachEls = [];
  }
  // (tx,ty)=가리킬 타깃. dir 'down'=타깃 위에서 아래로 / 'up'=타깃 아래에서 위로.
  _coachmark(tx, ty, caption, dir = 'down') {
    this._clearCoach();
    const up = dir === 'up';
    const orbY = ty + (up ? 62 : -62), arrY = ty + (up ? 30 : -30), capY = ty + (up ? 108 : -104);
    let orb;
    if (this.textures.exists('of_glow')) {
      orb = this.add.image(tx, orbY, 'of_glow').setTint(0xffd54a).setBlendMode(Phaser.BlendModes.ADD).setScale(0.9).setDepth(24);
    } else {
      orb = this.add.circle(tx, orbY, 22, 0xffd54a, 0.45).setStrokeStyle(3, 0xfff2c8, 0.9).setDepth(24);
    }
    this.tweens.add({ targets: orb, scale: { from: orb.scale * 0.85, to: orb.scale * 1.18 }, alpha: { from: 0.55, to: 0.95 }, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    const s = 15, arr = this.add.graphics().setDepth(25).setPosition(tx, arrY);
    arr.fillStyle(0xffd54a, 1); arr.lineStyle(3, 0x5a1e10, 1);
    if (up) { arr.fillTriangle(-s, s, s, s, 0, -s); arr.strokeTriangle(-s, s, s, s, 0, -s); }
    else { arr.fillTriangle(-s, -s, s, -s, 0, s); arr.strokeTriangle(-s, -s, s, -s, 0, s); }
    this.tweens.add({ targets: arr, y: arrY + (up ? -9 : 9), duration: 460, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    const cap = this.add.text(tx, capY, caption, { fontFamily: FONT, fontSize: '20px', color: CONFIG.C_CREAM, fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(25);
    cap.setStroke('#3a1e10', 5);
    cap.x = clamp(tx, cap.width / 2 + 8, W - cap.width / 2 - 8); // 화면 밖 클램프
    this._coachEls.push(orb, arr, cap);
  }
  // 현재 온보딩 단계 + 뷰에 맞는 코치마크 표시(setView 끝에서 호출 → 뷰전환/언어재시작에 자동 재평가).
  _updateCoach(view) {
    this._clearCoach();
    if (this._onb === 'hunt') {
      if (view === 'lobby') { const h = CONFIG.LOBBY_HOTSPOTS.find((c) => c.key === 'hunt'); if (h) this._coachmark(h.x * W, h.y * H, t('onbHunt'), 'down'); }
      else if (view === 'hunt') this._coachmark(120, 44, t('onbEarnHint'), 'up'); // 골드 카운터 강조(자동 수급 인지)
    } else if (this._onb === 'forge') {
      if (view === 'lobby') { const f = CONFIG.LOBBY_HOTSPOTS.find((c) => c.key === 'forge'); if (f) this._coachmark(f.x * W, f.y * H, t('onbForge'), 'down'); }
      else if (view === 'forge') this._coachmark(CX, 826, t('onbEnhance'), 'up'); // ENHANCE 버튼(y790,h84) 아래에서 위로 — 위에서 내리면 오브·문구가 실패/비용 줄(660~716)과 겹침. 온보딩 구간(+0~+2)엔 아래 Auto-Protect 토글이 숨겨져 있어 공간이 빔
      else if (view === 'hunt') this._coachmark(66, 128, t('onbBackForge'), 'up'); // 나가기 핀
    }
    // 'done' → 아무 것도 안 함
  }

  // 안전구간(+5/10/15/20/25) 도달 축하 — 성취 + 자연스러운 세션 종료점
  _safeReached() {
    this._shockwave(CX, FORGE_CY, tierColor(this.level));
    this.sparkEmitter.explode(40, CX, FORGE_CY);
    this.cameras.main.flash(220, 150, 255, 200);
    const banner = this.add.text(CX, 150, t('safeReached'), { fontFamily: FONT, fontSize: '38px', color: '#8effc0', fontStyle: 'bold' }).setOrigin(0.5).setDepth(12);
    banner.setStroke('#0a3a22', 6);
    this.tweens.add({ targets: banner, scale: { from: 1.7, to: 1 }, duration: 300, ease: 'Back.out' });
    this.tweens.add({ targets: banner, alpha: 0, delay: 1100, duration: 600, onComplete: () => banner.destroy() });
  }

  // 만렙(천장 = ceiling(), 환생 따라 +30~+54) 도달 — 화려한 연출(강화 버튼은 _refreshForge 가 환생으로 전환)
  _onMaxLevel() {
    this._tierUpFlair();
    const banner = this.add.text(CX, 200, t('maxReached').replace('{lv}', this.ceiling()), { fontFamily: SIGN_FONT, fontSize: '46px', color: CONFIG.C_GOLD, fontStyle: 'bold' }).setOrigin(0.5).setDepth(13);
    banner.setStroke('#3a1e10', 7); banner.setShadow(0, 3, '#000000', 6, false, true);
    this.tweens.add({ targets: banner, scale: { from: 2, to: 1 }, duration: 360, ease: 'Back.out' });
    this.tweens.add({ targets: banner, alpha: 0, delay: 1500, duration: 700, onComplete: () => banner.destroy() });
  }

  // 공용 모달(암전 + 판 + 제목/본문 + 버튼 1~2개). buttons=[{label, fill, cb(close)}]. 반환 {close}.
  _modal({ title, body, buttons }) {
    const cyc = H / 2;
    const dim = this.add.rectangle(CX, cyc, W, H, 0x000000, 0.72).setDepth(45).setInteractive();
    const g = this.add.graphics().setDepth(46);
    g.fillStyle(0x000000, 0.35); g.fillRoundedRect(CX - 213, cyc - 147, 426, 300, 24);
    g.fillStyle(CONFIG.C_PANEL, 1); g.fillRoundedRect(CX - 210, cyc - 150, 420, 300, 24);
    g.lineStyle(2, 0xffd54a, 0.3); g.strokeRoundedRect(CX - 210, cyc - 150, 420, 300, 24);
    const els = [dim, g];
    els.push(this.add.text(CX, cyc - 98, title, { fontFamily: SIGN_FONT, fontSize: '30px', color: CONFIG.C_GOLD, fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(47).setStroke('#3a1e10', 5));
    if (body) els.push(this.add.text(CX, cyc - 24, body, { fontFamily: FONT, fontSize: '20px', color: CONFIG.C_TEXT, align: 'center', wordWrap: { width: 372 }, lineSpacing: 4 }).setOrigin(0.5).setDepth(47));
    const close = () => els.forEach((o) => o.destroy());
    const n = buttons.length;
    buttons.forEach((b, i) => {
      const bx = n === 1 ? CX : (i === 0 ? CX - 105 : CX + 105);
      const btn = this._makeButton(bx, cyc + 96, n === 1 ? 250 : 190, 66, b.label, () => b.cb(close), { fill: b.fill != null ? b.fill : CONFIG.C_BUY });
      btn.all.forEach((o) => o.setDepth(48));
      els.push(...btn.all);
    });
    return { close };
  }

  // 만렙 → 환생 제안
  _offerPrestige() {
    SFX.button();
    const nextMult = Math.pow(CONFIG.PRESTIGE_GOLD_BASE, this.prestige + 1);
    const mstr = nextMult.toFixed(2).replace(/\.?0+$/, '');
    this._modal({
      title: t('prestigeTitle'),
      body: t('prestigeBody').replace('{m}', mstr),
      buttons: [
        { label: t('later'), fill: CONFIG.C_PANEL2, cb: (close) => { SFX.button(); close(); } },
        { label: t('prestigeCta'), fill: CONFIG.C_JADE, cb: (close) => { close(); this._doPrestige(); } },
      ],
    });
  }

  _doPrestige() {
    this.prestige += 1;
    this.goldMultiplier = Math.pow(CONFIG.PRESTIGE_GOLD_BASE, this.prestige);
    // 이번 환생으로 새로 언락된 마일스톤 알림('한 번 더' 유인)
    if (Object.values(CONFIG.MILESTONES).includes(this.prestige)) this.time.delayedCall(1000, () => { if (this.scene.isActive()) this._toast('✦ ' + t('milestoneUnlocked'), CONFIG.C_GOLD); });
    this.level = 0;
    this.failCounter = {};
    SFX.tierUp();
    this._flashCircle(CX, FORGE_CY);
    this.sparkEmitter.explode(70, CX, FORGE_CY);
    this._shockwave(CX, FORGE_CY, 0xffd54a);
    this.cameras.main.flash(320, 255, 240, 180);
    const banner = this.add.text(CX, 200, t('prestigeTag').replace('{n}', this.prestige), { fontFamily: SIGN_FONT, fontSize: '40px', color: CONFIG.C_GOLD, fontStyle: 'bold' }).setOrigin(0.5).setDepth(13);
    banner.setStroke('#3a1e10', 7);
    this.tweens.add({ targets: banner, scale: { from: 2, to: 1 }, duration: 360, ease: 'Back.out' });
    this.tweens.add({ targets: banner, alpha: 0, delay: 1400, duration: 700, onComplete: () => banner.destroy() });
    this._refreshForge();
    this._refreshTop();
    this._syncMonster();
    this.saveState();
  }

  // 하락 발생 후: 첫 하락은 온보딩(무료 보호권), 이후는 리액티브 광고 팝업(1광고=하락 −1 완화, 손실회피 = 최고 전환).
  // 팝업 뜨는 동안/직전 gap 에 추가 입력이 상태를 바꾸지 않도록 busy 로 잠갔다가 모달이 뜨면 해제(모달 dim 이 입력 차단).
  _onDrop(fromLv, toLv, defenseHelps) {
    // ★C: 강화소 뷰가 아니면(백그라운드 자동강화 하락) 온보딩/되돌리기 모달을 띄우지 않음 — 하락은 이미 확정·저장됨.
    if (this.view !== 'forge') return;
    if (!this._sawFirstDrop) {
      this._sawFirstDrop = true;
      this.protect = Math.min(this.protect + 1, CONFIG.PROTECT_MAX);
      this._refreshTop();
      this.saveState();
      this.busy = true;
      this.time.delayedCall(520, () => { if (!this.scene.isActive()) return; this.busy = false; this._firstDropTooltip(); });
      return;
    }
    if (!defenseHelps) return; // −1 완화가 자연하락과 같은 얕은 구간 → 광고 제안 무의미
    // 쿨다운: 매 하락마다 팝업 → 스팸. 최근에 떴으면 이번엔 조용히 하락.
    if (Date.now() - (this._lastUndoAt || 0) < CONFIG.UNDO_COOLDOWN_SEC * 1000) return;
    this._lastUndoAt = Date.now();
    this.busy = true;
    this.time.delayedCall(420, () => { if (!this.scene.isActive()) return; this.busy = false; this._dropUndoPopup(fromLv, toLv); });
  }

  _firstDropTooltip() {
    this._modal({
      title: t('firstDropTitle'),
      body: t('firstDropBody') + t('onbShopMore'), // ★B: 손실회피 순간에 상점=광고로 보호권 더 얻는 법 안내
      buttons: [{ label: t('ok'), fill: CONFIG.C_JADE, cb: (close) => { SFX.button(); close(); } }],
    });
  }

  _dropUndoPopup(fromLv, toLv) {
    this._modal({
      title: t('undoTitle').replace('{n}', toLv),
      body: t('undoBody'),
      buttons: [
        { label: t('keepDrop'), fill: CONFIG.C_PANEL2, cb: (close) => { SFX.button(); close(); } },
        { label: t('undoAd'), fill: CONFIG.C_JADE, cb: async (close) => {
            if (this.busy) return;
            // ★D: 보상형 IVT 소프트 상한(watchProtect/watchBoost 와 동일 방어). 없으면 +7↔+5 반복으로 캡 우회 가능.
            if (this._rewardedCapped(Date.now())) { this._toast(t('adUnavailable'), CONFIG.C_BAD); SFX.fail(); return; }
            this.busy = true;
            let ok = false;
            try { ok = await GDFlow.playAd('rewarded'); } finally { this.busy = false; } // ★ 소프트락 방지
            if (ok) {
              this._adBundleCount += 1; // 성공한 보상형만 카운트(일일 소프트 상한 공유)
              this.level = fromLv - 1; // 옵션 F: 완전취소 아님 — 하락을 −1로 완화(실패 직전 레벨 −1)
              SFX.success();
              this._shockwave(CX, FORGE_CY, 0x5ef0b0);
              this._refreshForge(); this._refreshTop(); this._syncMonster(); this.saveState();
              close();
            } else { this._toast(t('adUnavailable'), CONFIG.C_BAD); SFX.fail(); }
          } },
      ],
    });
  }

  // ── 사냥터 입력: 탭 = 추가타 ───────────────────
  onHuntTap(p) {
    SFX.unlock();
    const now = this.time.now;
    this._taps = this._taps.filter((tm) => now - tm < 1000);
    if (this._taps.length >= CONFIG.TAP_MAX_PER_SEC) return; // 추가타 상한
    this._taps.push(now);
    SFX.tap();
    this._hitMonster(hitDmg(this.level), true);
    this.tweens.add({ targets: this.monsterIcon, scale: { from: 0.9, to: 1 }, duration: 110 });
  }

  // ── 상점 동작 (v3: 골드 보호권 구매 폐지 — 보호권은 watchProtect 광고로만 획득) ──

  // 일일 IVT 소프트 상한(보상형 광고 전체 공유). 날짜 바뀌면 리셋. 초과 시 조용히 미표시(유저엔 '광고 없음'과 동일).
  _rewardedCapped(now) {
    const day = Math.floor(now / 86400000);
    if (day !== this._adBundleDay) { this._adBundleDay = day; this._adBundleCount = 0; }
    return this._adBundleCount >= CONFIG.AD_BUNDLE_SOFT_CAP_DAY;
  }

  async watchProtect() {
    if (this.busy) return;
    const now = Date.now();
    // 유저 체감 일일 한도 없음(광고 수익 우선). 연타 방지 쿨다운 + IVT 소프트 상한만.
    if (now < this._adBundleCdUntil) { this._toast(t('adCooldown') + ' ' + Math.ceil((this._adBundleCdUntil - now) / 1000) + 's', CONFIG.C_DIM); SFX.fail(); return; }
    if (this._rewardedCapped(now)) { this._toast(t('adUnavailable'), CONFIG.C_BAD); SFX.fail(); return; }
    this.busy = true;
    let ok = false;
    try { ok = await GDFlow.playAd('rewarded'); } finally { this.busy = false; } // ★ SDK 행 시에도 busy 반드시 해제(소프트락 방지)
    if (ok) {
      this.protect += CONFIG.AD_PROTECT_QTY;
      this._adBundleCount += 1; // 소프트 상한 카운트(성공한 광고만)
      this._adBundleCdUntil = Date.now() + CONFIG.AD_BUNDLE_COOLDOWN_SEC * 1000;
      SFX.success(); this._toast(t('protectLabel') + ' +' + CONFIG.AD_PROTECT_QTY, CONFIG.C_OK);
      this._refreshTop(); this._refreshShop(); this.saveState();
    } else { this._toast(t('adUnavailable'), CONFIG.C_BAD); SFX.fail(); }
  }

  async watchBoost() {
    if (this.busy) return;
    const now = Date.now();
    if (this._boostUntil - now > 10000) { this._toast(t('boostOn'), CONFIG.C_OK); return; } // 이미 넉넉히 활성 → 광고 낭비 방지
    // ★ watchProtect 와 동일한 쿨다운 + IVT 소프트 상한(무캡 보상형 = 계정 플래그 리스크). 부스트 전용 쿨다운.
    if (now < this._boostAdCdUntil) { this._toast(t('adCooldown') + ' ' + Math.ceil((this._boostAdCdUntil - now) / 1000) + 's', CONFIG.C_DIM); SFX.fail(); return; }
    if (this._rewardedCapped(now)) { this._toast(t('adUnavailable'), CONFIG.C_BAD); SFX.fail(); return; }
    this.busy = true;
    let ok = false;
    try { ok = await GDFlow.playAd('rewarded'); } finally { this.busy = false; }
    if (ok) {
      this._boostUntil = Date.now() + CONFIG.AD_BOOST_SEC * 1000;
      this._adBundleCount += 1;
      this._boostAdCdUntil = Date.now() + CONFIG.AD_BUNDLE_COOLDOWN_SEC * 1000;
      SFX.success();
      this._refreshTop();
      this.saveState();
    } else { this._toast(t('adUnavailable'), CONFIG.C_BAD); SFX.fail(); }
  }

  // ── 갱신 ───────────────────────────────────────
  _refreshTop() {
    this.goldText.setText(this._goldPrefix + fmt(this.gold));
    const mult = this._boostMult();
    this.perSecText.setText('+' + fmt(goldPerSec(this.level, this.goldMultiplier) * mult) + t('perSec'));
    this.protectText.setText(this._protectPrefix + this.protect);
  }

  _refreshForge() {
    // ★C: 강화소 뷰가 아니면(백그라운드 자동강화 resolve 등) 강화소 위젯을 건드리지 않음
    //   — 안 그러면 토글/게이지가 다른 뷰 위로 노출돼 오탭(팬텀 인터랙티브 존) 발생. 진입 시 setView 가 다시 갱신.
    if (this.view !== 'forge') return;
    this.levelText.setText('+' + this.level);
    // 소프트 헤일로: 레벨 따라 아주 살짝만 커짐(색 변화 없음 — 채도 노이즈 제거).
    this.weaponGlow.setScale(1.9 + this.level * 0.012);
    if (this._weaponIsImg) this._setWeaponVisual();

    // 행운 게이지(천장): 실패가 '적립'되는 진행바 — 채울수록 강제 성공 근접("이번만 실패하면 다음 확정").
    const pth = this._pityThreshold();
    const fc = this.failCounter[this.level] || 0;
    { const bw = 250, bh = 16, bx = CX - bw / 2, by = 708, frac = pth > 0 ? Math.min(1, fc / pth) : 0, ready = fc >= pth;
      this.pityBar.clear();
      this.pityBar.fillStyle(0x000000, 0.4); this.pityBar.fillRoundedRect(bx, by, bw, bh, bh / 2); // 트랙
      if (frac > 0) { this.pityBar.fillStyle(ready ? 0x5ef0b0 : 0xffd54a, 1); this.pityBar.fillRoundedRect(bx, by, Math.max(bh, bw * frac), bh, bh / 2); } // 적립
      this.pityBar.lineStyle(2, ready ? 0x5ef0b0 : 0xffffff, ready ? 0.95 : 0.22); this.pityBar.strokeRoundedRect(bx, by, bw, bh, bh / 2);
      const rem = Math.max(0, pth - fc);
      this.pityLabel.setText('🍀 ' + (ready ? t('pityReady') : t('pityCounter').replace('{n}', rem)));
      this.pityBar.setVisible(true); this.pityLabel.setVisible(true); }
    // p1 자동강화 토글: 마일스톤 언락 시에만 노출
    if (this.autoEnhBg) {
      const aeOn = this._hasMilestone('autoEnhance');
      this.autoEnhBg.setVisible(aeOn); this.autoEnhTxt.setVisible(aeOn); this.autoEnhZone.setVisible(aeOn);
      if (aeOn) this._drawAutoEnh();
    }
    // #3: 자동방어 토글은 하락 위험 구간(+NO_RISK_BELOW 이상, 천장 미만)에서만 노출 — 저레벨 무의미 노출 제거.
    { const showAP = this.level >= CONFIG.NO_RISK_BELOW && this.level < this.ceiling();
      if (this.autoBg) this.autoBg.setVisible(showAP);
      if (this.autoTxt) this.autoTxt.setVisible(showAP);
      if (this.autoZone) this.autoZone.setVisible(showAP); }

    if (this.level >= this.ceiling()) {
      // 천장 → 강화 버튼을 '환생'으로 전환
      this.rateText.setText(t('maxReached').replace('{lv}', this.ceiling())).setColor(CONFIG.C_GOLD);
      this.failText.setText('');
      this.costText.setText('');
      if (this.pityBar) { this.pityBar.setVisible(false); this.pityLabel.setVisible(false); } // 천장=행운게이지 무의미
      if (this.enhanceBtn) { this.enhanceBtn.txt.setText(t('prestige')); this._setBtnAfford(this.enhanceBtn, true); }
      return;
    }
    if (this.enhanceBtn) this.enhanceBtn.txt.setText(t('enhance'));
    this.rateText.setText(t('successRate') + ' ' + enhanceRate(this.level) + '%').setColor(CONFIG.C_OK);
    // 실패 시: 유지 / 자동방어(−1 완화, charges 🛡 또는 골드 🪙) / 미방어 하락(▼ +N)
    const dropTo = nearestSafe(this.level);
    const need = protectsNeeded(this.level);
    const canProtect = this.autoProtect && this.level < CONFIG.PROTECT_LOCK_ABOVE;
    let failMsg, bad = false;
    const defenseHelps = this.level - 1 > dropTo; // −1 완화가 자연하락보다 이득일 때만 방어
    const autoMode = this.autoEnhance && this._hasMilestone('autoEnhance'); // 자동강화 모드=charges 전용
    const goldDef = autoDefenseGoldCost(this.level, this.goldMultiplier);
    // 골드 방어 프리뷰는 실제 _resolveEnhance 와 동일하게 _sawFirstDrop 이후에만(첫 하락은 온보딩 경로라 골드방어 안 함).
    const canDefend = canProtect && defenseHelps && (this.protect >= need || (!autoMode && this._sawFirstDrop && this.gold >= goldDef));
    if (this.level < CONFIG.NO_RISK_BELOW || dropTo === this.level) failMsg = t('keep');
    else if (canDefend) failMsg = (this.protect >= need ? t('protectLabel') + '×' + need : '🪙' + fmt(goldDef)) + ' → −1'; // 방어: 비용→−1강만(옵션 F). 순서 명확화(#4)
    else { failMsg = '▼ +' + dropTo + (defenseHelps && canProtect ? '  ' + t('protectLabel') + ' ' + this.protect + '/' + need : ''); bad = true; }
    this.failText.setText(t('onFail') + ': ' + failMsg).setColor(bad ? CONFIG.C_BAD : CONFIG.C_OK);
    const cost = enhanceCost(this.level);
    this.costText.setText(t('cost') + ' 🪙 ' + fmt(cost)).setColor(this.gold >= cost ? CONFIG.C_GOLD : CONFIG.C_BAD);
    this._setBtnAfford(this.enhanceBtn, this.gold >= cost);
  }

  _refreshShop() {
    // #5: 보호권 보유량 + 현재 레벨 방어 필요량(광고 유인). 저강/방어 무의미 구간은 필요량 생략.
    if (!this.shopProtectStat) return;
    let s = t('owned') + ' ' + t('protectLabel') + ' ×' + this.protect;
    const dropTo = nearestSafe(this.level);
    const defenseHelps = this.level - 1 > dropTo;
    if (this.level >= CONFIG.NO_RISK_BELOW && defenseHelps) s += '   ·   ' + t('defendAt').replace('{lv}', this.level).replace('{n}', protectsNeeded(this.level));
    this.shopProtectStat.setText(s);
    // '내 검' 카드 갱신: 티어 검 텍스처·스케일, 레벨/기록, 티어 핍(12칸 중 현재 콘텐츠 티어까지 금색)
    if (this.shopWeapon && this.shopWeapon.scene) {
      const wk = this._weaponTexKey();
      if (wk && this.shopWeapon.setTexture) {
        if (this.shopWeapon.texture.key !== wk.key) this.shopWeapon.setTexture(wk.key);
        this.shopWeapon.setScale(190 / Math.max(this.shopWeapon.width, this.shopWeapon.height));
        if (!wk.tiered) this.shopWeapon.setTint(this._weaponTint()); else this.shopWeapon.clearTint();
      }
      this.shopLevelText.setText('+' + this.level + '   ·   ' + t('maxLv') + ' +' + this.maxLevel + (this.prestige > 0 ? '   ·   ' + t('prestigeTag').replace('{n}', this.prestige) : ''));
      const n = CONFIG.CONTENT_TIERS, tier = contentTier(this.level), pw = 22, gap = 8, x0 = CX - (n * pw + (n - 1) * gap) / 2, y = this._shopCardY + 122;
      this.shopTierPips.clear();
      for (let i = 0; i < n; i++) {
        const x = x0 + i * (pw + gap);
        this.shopTierPips.fillStyle(i <= tier ? 0xf5c542 : 0xffffff, i <= tier ? 1 : 0.18);
        this.shopTierPips.fillRoundedRect(x, y - 5, pw, 10, 5);
      }
    }
  }

  _boostMult() { return Date.now() < this._boostUntil ? CONFIG.AD_BOOST_MULT : 1; }
  ceiling() { return ceilingFor(this.prestige); } // 진행형 천장(현재 환생수 기준)
  _hasMilestone(key) { return this.prestige >= (CONFIG.MILESTONES[key] || Infinity); } // v3 Phase2 마일스톤 언락 여부
  _pityThreshold() { return this._hasMilestone('pity6') ? CONFIG.PITY_THRESHOLD_P5 : (this._hasMilestone('pity7') ? CONFIG.PITY_THRESHOLD_P3 : CONFIG.PITY_THRESHOLD); }
  _offlineCapSec() { return this._hasMilestone('offline4h') ? CONFIG.OFFLINE_CAP_SEC_P4 : (this._hasMilestone('offline3h') ? CONFIG.OFFLINE_CAP_SEC_P2 : CONFIG.OFFLINE_CAP_SEC); }

  // ── 오프라인 수급 팝업 ─────────────────────────
  _buildOfflinePopup(lastSeen) {
    if (!lastSeen) return;
    const elapsed = clamp((Date.now() - lastSeen) / 1000, 0, this._offlineCapSec());
    const earned = Math.floor(goldPerSec(this.level, this.goldMultiplier) * elapsed * CONFIG.OFFLINE_RATE);
    if (earned <= 0) return;

    const dim = this.add.rectangle(CX, H / 2, W, H, 0x000000, 0.7).setDepth(40).setInteractive();
    // 팝업 판: 족자 이미지(있으면) or 라운드 그래픽
    let panel;
    if (this.textures.exists('of_popup')) {
      panel = this.add.image(CX, H / 2, 'of_popup').setDepth(41);
      panel.setScale(Math.min(300 / panel.width, 470 / panel.height)); // 세로 족자 → 세로로 크게, 콘텐츠 세로 배치
    } else {
      panel = this.add.graphics().setDepth(41);
      panel.fillStyle(0x000000, 0.35); panel.fillRoundedRect(CX - 213, H / 2 - 157, 426, 320, 24);
      panel.fillStyle(CONFIG.C_PANEL, 1); panel.fillRoundedRect(CX - 210, H / 2 - 160, 420, 320, 24);
      panel.lineStyle(2, 0xffd54a, 0.3); panel.strokeRoundedRect(CX - 210, H / 2 - 160, 420, 320, 24);
    }
    const onPaper = this.textures.exists('of_popup'); // 족자(크림 종이) 위면 어두운 글씨로
    const title = this.add.text(CX, H / 2 - 150, t('welcomeBack'), { fontFamily: FONT, fontSize: '20px', color: onPaper ? '#4a2f18' : CONFIG.C_TEXT, fontStyle: 'bold' }).setOrigin(0.5).setDepth(42);
    const amt = this.add.text(CX, H / 2 - 88, '🪙 ' + fmt(earned), { fontFamily: FONT, fontSize: '36px', color: CONFIG.C_GOLD, fontStyle: 'bold' }).setOrigin(0.5).setDepth(42);
    amt.setStroke('#5a3a10', 5); // 크림 종이 위 가독성
    const els = [dim, panel, title, amt];

    const close = (mult) => {
      this.gold += earned * mult;
      els.forEach((o) => o.destroy());
      b1.all.forEach((o) => o.destroy());
      b2.all.forEach((o) => o.destroy());
      this._refreshTop();
      this.saveState();
    };
    const b1 = this._makeButton(CX, H / 2 + 22, 300, 62, t('collect'), () => close(1), { fill: CONFIG.C_BUY });
    const b2 = this._makeButton(CX, H / 2 + 100, 300, 62, t('collect2x') + ' ' + t('watchAd'), async () => {
      if (this.busy) return; this.busy = true;
      let ok = false;
      try { ok = await GDFlow.playAd('rewarded'); } finally { this.busy = false; } // ★ 소프트락 방지
      if (ok) this._adBundleCount += 1; // ★D: 보상형 일일 카운트에 포함(일관성)
      close(ok ? CONFIG.OFFLINE_AD_MULT : 1);
    }, { fill: CONFIG.C_JADE });
    [b1, b2].forEach((b) => b.all.forEach((o) => o.setDepth(42)));
  }

  saveState() {
    saveJSON(CONFIG.GAME_KEY, {
      level: this.level, gold: this.gold, protect: this.protect,
      maxLevel: this.maxLevel, lastSeen: Date.now(),
      boostUntil: this._boostUntil, // 광고로 산 2× 부스트 — 리로드/앱복귀 시 남은 시간 복원
      prestige: this.prestige, failCounter: this.failCounter,
      autoProtect: this.autoProtect, autoEnhance: this.autoEnhance, sawFirstDrop: this._sawFirstDrop, onb: this._onb,
      adBundleDay: this._adBundleDay, adBundleCount: this._adBundleCount, // IVT 소프트 상한 일일 카운터
      adBundleCdUntil: this._adBundleCdUntil, boostAdCdUntil: this._boostAdCdUntil, // 광고 쿨다운 지속(리로드 우회 방지)
    });
  }

  // ── 메인 루프: 사냥터=몬스터 자동전투(연출) / 그 외 뷰=골드 백그라운드 수급(v3 뷰무관 수급) ───
  update(time, delta) {
    if (this.view === 'hunt') {
      this._atkAcc += delta;
      const interval = 1000 / CONFIG.ATK_PER_SEC;
      let guard = 0;
      while (this._atkAcc >= interval && guard < 10) {
        this._atkAcc -= interval;
        this._hitMonster(hitDmg(this.level), false);
        guard++;
      }
    } else {
      // v3: 사냥터 밖에서도 수급 지속(왕복 마찰 제거). 평균 초당골드를 직접 적립(소수 누적 OK, 표시는 fmt 가 floor).
      this.gold += goldPerSec(this.level, this.goldMultiplier) * this._boostMult() * (delta / 1000);
    }

    // ★B 온보딩: 첫 강화비용을 벌면 hunt→forge 로 진행(도깨비불이 강화소로 안내). 1회성.
    if (this._onb === 'hunt' && this.gold >= enhanceCost(0)) {
      this._onb = 'forge';
      this._toast(t('onbEarned'), CONFIG.C_GOLD);
      this._updateCoach(this.view);
      this.saveState();
    }

    // 상단 골드/부스트 표시 — ★G: 표시 문자열이 바뀔 때만 setText(매 프레임 fmt/렌더 churn 제거, 저사양폰 부담↓)
    const gStr = this._goldPrefix + fmt(this.gold);
    if (gStr !== this._lastGoldStr) { this.goldText.setText(gStr); this._lastGoldStr = gStr; }
    const remain = this._boostUntil - Date.now();
    // 컴팩트 표기(⚡2× 118s) — 우측 음소거 아이콘과 겹치지 않게 폭 축소(로케일 무관)
    const bStr = remain > 0 ? '⚡2× ' + Math.ceil(remain / 1000) + 's' : '';
    if (bStr !== this._lastBoostStr) { this.boostText.setText(bStr); this._lastBoostStr = bStr; }

    if (this.view === 'forge' && this.level < this.ceiling()) {
      const cost = enhanceCost(this.level);
      this.costText.setColor(this.gold >= cost ? CONFIG.C_GOLD : CONFIG.C_BAD);
      this._setBtnAfford(this.enhanceBtn, this.gold >= cost);
    } else if (this.view === 'forge') {
      this._setBtnAfford(this.enhanceBtn, true); // 천장 → 환생은 항상 가능(골드 무관)
    }
    // p1 자동강화: 언락 + 토글 ON + idle + 감당가능 + 천장미만 → 자동 트리거.
    //   기본은 강화소 뷰에서만. p4(autoEnhanceAllViews) 언락 시 모든 뷰에서 백그라운드 진행.
    if (this.autoEnhance && this._hasMilestone('autoEnhance') && !this.busy && this.level < this.ceiling()
        && (this.view === 'forge' || this._hasMilestone('autoEnhanceAllViews'))
        && this.gold >= enhanceCost(this.level)) this.tryEnhance();

    // 주기적 저장(3s)
    this._saveAcc += delta;
    if (this._saveAcc > 3000) { this._saveAcc = 0; this.saveState(); }
  }
}

const phaserConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#0d0d1a',
  scale: {
    mode: Phaser.Scale.FIT, // 종횡비 유지 레터박스
    // ⚠️ 중앙 정렬은 CSS(#game-container flex)에만 맡긴다. Phaser autoCenter 와 동시에 쓰면 한쪽으로 쏠린다(GD 반려 ①).
    autoCenter: Phaser.Scale.NO_CENTER,
    expandParent: false, // 부모 스타일은 CSS 가 제어
    autoRound: true, // 서브픽셀 캔버스 크기 방지(가장자리 1px 잘림/블러 방지)
    width: W,
    height: H,
  },
  scene: [GameScene],
};

const game = new Phaser.Game(phaserConfig);

// GD 광고 흐름 초기화(index.html 이 이미 SDK 를 로드/큐잉함) —
//   SDK_GAME_PAUSE → 씬 정지 + SFX·BGM 완전 음소거 / 광고 후 "TAP TO CONTINUE" 를 거쳐 사용자 입력으로만 재개.
//   리사이즈/레터박스 재계산 + 세로 전용 회전 안내도 이 모듈이 담당.
GDFlow.init({
  game,
  sceneKey: 'game',
  lang: () => currentLang,
  setAdMuted: (m) => { SFX.setAdMuted(m); MUSIC.setAdMuted(m); },
});

// iOS 등: 첫 제스처에서 오디오 unlock + BGM 시작(autoplay 정책)
const _unlock = () => { SFX.unlock(); MUSIC.start(); };
['pointerdown', 'pointerup', 'touchend', 'mousedown', 'keydown'].forEach((ev) => window.addEventListener(ev, _unlock));

if (QA_HOOKS) {
  window.__game = game;
  window.__SFX = SFX;
  window.__MUSIC = MUSIC;
  window.__GDFlow = GDFlow;
}
