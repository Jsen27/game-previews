// 공통 유틸 모듈
// -----------------------------------------------------------------------------
// 여러 게임에서 공통으로 쓰는 작은 헬퍼들. 외부 의존성 없음.
//  - 점수(localStorage) 저장/조회
//  - 음소거 상태 저장
//  - 간단한 수학/입력 헬퍼
// -----------------------------------------------------------------------------

// localStorage 키 충돌을 막기 위한 공통 접두사
const STORAGE_PREFIX = 'webgames:';

// ---------------------------------------------------------------------------
// localStorage 안전 래퍼 (시크릿 모드 등에서 예외가 나도 게임이 안 죽게)
// ---------------------------------------------------------------------------
// CrazyGames 빌드 전용: SDK v3 Data 모듈(localStorage 와 같은 API, 로그인 시 클라우드 동기화)을 우선 사용.
// 게임 부팅 전에 initCloudStorage() 를 await 해야 한다(Data 모듈은 SDK init 완료 후에만 사용 가능).
// SDK 부재·init 실패·타임아웃·'disabled' 환경이면 localStorage 그대로.
let _cgData = null;

export async function initCloudStorage(timeoutMs = 4000) {
  try {
    const sdk = window.CrazyGames && window.CrazyGames.SDK;
    if (!sdk || typeof sdk.init !== 'function') return false;
    // init Promise 는 광고 래퍼(crazygames-sdk-wrapper.js)와 공유 — SDK init 중복 호출 방지
    const p = window.__cgInitP || (window.__cgInitP = sdk.init());
    const ok = await Promise.race([
      p.then(() => true, () => false),
      new Promise((r) => setTimeout(() => r(false), timeoutMs)),
    ]);
    if (!ok || sdk.environment === 'disabled') return false;
    if (sdk.data && typeof sdk.data.getItem === 'function' && typeof sdk.data.setItem === 'function') {
      _cgData = sdk.data;
      return true;
    }
  } catch (e) {}
  return false;
}

function safeGet(key) {
  if (_cgData) {
    try { return _cgData.getItem(key); } catch (e) {}
  }
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeSet(key, value) {
  if (_cgData) {
    try { _cgData.setItem(key, value); return true; } catch (e) {}
  }
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 점수 (게임별 최고 점수)
// ---------------------------------------------------------------------------

// 게임별 최고 점수 조회. 없으면 0.
export function getHighScore(gameKey) {
  const raw = safeGet(STORAGE_PREFIX + gameKey + ':highscore');
  return Number(raw) || 0;
}

// 최고 점수보다 높을 때만 저장. 항상 최신 최고 점수를 반환.
export function saveHighScore(gameKey, score) {
  const prev = getHighScore(gameKey);
  if (score > prev) {
    safeSet(STORAGE_PREFIX + gameKey + ':highscore', String(score));
    return score;
  }
  return prev;
}

// ---------------------------------------------------------------------------
// 사운드 음소거 상태 (게임 공통)
// ---------------------------------------------------------------------------

export function isMuted() {
  return safeGet(STORAGE_PREFIX + 'muted') === '1';
}

export function setMuted(muted) {
  safeSet(STORAGE_PREFIX + 'muted', muted ? '1' : '0');
  return muted;
}

// ---------------------------------------------------------------------------
// 임의의 JSON 값 저장/조회 (세이브 데이터 등)
// ---------------------------------------------------------------------------

export function loadJSON(key, fallback = null) {
  const raw = safeGet(STORAGE_PREFIX + key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export function saveJSON(key, value) {
  return safeSet(STORAGE_PREFIX + key, JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// 수학 / 입력 헬퍼
// ---------------------------------------------------------------------------

// min~max 사이 정수 (양끝 포함)
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 값을 min~max 범위로 제한
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// 터치 디바이스 여부 (모바일/데스크탑 분기용)
export function isTouchDevice() {
  return (
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );
}
