// CrazyGames SDK 공통 래퍼
// -----------------------------------------------------------------------------
// 다른 포털용 래퍼와 "동일한 인터페이스"를 제공한다(플랫폼 무관하게 게임 코어가
// 그대로 동작하도록). 빌드 시 import 경로만 스왑하면 GD↔CrazyGames 가 교체된다.
//   - init({ gameId?, mock?, onPause, onResume })  : 초기화 Promise
//   - showInterstitial()                           : 전면(=CrazyGames midgame). Promise<bool>
//   - showRewarded()                               : 보상형(=CrazyGames rewarded). Promise<bool>(완주 여부)
//   - gameplayStart() / gameplayStop()             : 게임플레이 시작/정지 이벤트(CrazyGames 권장)
//   - loadingStop()                                : 로딩 완료 이벤트
//
// 규칙(CLAUDE.md):
//  - 실제 광고 호출은 반드시 이 모듈을 통해서만.
//  - 광고 타이밍: preroll 금지. 리트라이(전면=midgame)/이어하기(보상형=rewarded).
//  - 광고가 뜨면 onPause(), 끝나면 onResume() 콜백으로 게임 일시정지/음소거→복귀.
//  - SDK 가 없으면(애드블록·로컬·미주입) mock 모드로 동작 → 광고만 안 뜨고 게임은 계속.
//
// ⚠️ CrazyGames 정책: 자사 SDK 광고만 허용 → 이 빌드엔 다른 포털 SDK 가 들어가면 안 된다.
//
// SDK 문서: https://docs.crazygames.com/sdk/  (v3)
//  - 스크립트: https://sdk.crazygames.com/crazygames-sdk-v3.js (index.html 에서 동기 로드)
//  - 초기화 : await window.CrazyGames.SDK.init()
//  - 광고   : window.CrazyGames.SDK.ad.requestAd('midgame'|'rewarded', { adStarted, adFinished, adError })
//  - 환경   : await window.CrazyGames.SDK.getEnvironment() -> 'local' | 'crazygames' | 'disabled'
//  - 라이프 : window.CrazyGames.SDK.game.gameplayStart()/gameplayStop()/loadingStop()
// -----------------------------------------------------------------------------

// mock 광고가 화면에 표시되는 시간(ms)
const MOCK_AD_DURATION = 1500;

// 광고 시작 워치독(ms): requestAd 후 이 시간 안에 어떤 콜백도 안 오면 SDK 가 먹통이라 보고
// 건너뛴다(게임이 'Loading ad…' 에서 영구 정지하는 것 방지). adStarted 가 오면 해제 → 실제
// 재생 중인 광고는 절대 끊지 않는다(보상형은 길 수 있음).
const AD_START_TIMEOUT = 8000;

const CrazyAds = {
  _ready: false,        // 광고 호출 가능 상태
  _mock: false,         // mock 모드 여부(실제 광고 호출 안 함)
  _devOverlay: false,   // mock 시 가짜 광고 오버레이 표시 여부. 명시적 dev mock 일 때만 true.
                        // (실서비스에서 애드블록/비허용으로 SDK 가 없을 땐 가짜 광고를 보이지 않고 조용히 건너뜀)
  _adInProgress: false, // 광고 표시 중 중복 호출 방지
  _onPause: () => {},   // 광고 시작 시 호출(게임 일시정지/음소거)
  _onResume: () => {},  // 광고 종료 시 호출(게임 복귀)
  _env: null,           // 'local' | 'crazygames' | 'disabled'
  ready: Promise.resolve(false), // init() 이 덮어씀 — gd-flow.js 호환(항상 resolve)

  // SDK 객체 접근 헬퍼(없으면 null)
  _sdk() {
    return (typeof window !== 'undefined' && window.CrazyGames && window.CrazyGames.SDK) || null;
  },

  // 초기화
  // opts.gameId  : 인터페이스 호환용(CrazyGames 는 도메인으로 식별하므로 사용 안 함). 'mock'이면 mock.
  // opts.mock    : true면 강제로 mock 모드.
  // opts.onPause : 광고 시작 시 콜백.
  // opts.onResume: 광고 종료 시 콜백.
  // 반환: 초기화 완료 Promise
  init(opts = {}) {
    // gd-flow.js 는 init() 반환값과 .ready 를 모두 쓴다 → 같은 Promise 로 맞춘다. 절대 reject 하지 않는다.
    this.ready = this._init(opts).then(() => !this._mock).catch(() => false);
    return this.ready;
  },

  async _init(opts = {}) {
    const { gameId, mock, onPause, onResume } = opts;
    this._onPause = typeof onPause === 'function' ? onPause : () => {};
    this._onResume = typeof onResume === 'function' ? onResume : () => {};

    // mock 강제 또는 gameId==='mock' → dev mock(가짜 광고 오버레이 표시 — 개발 중 광고 타이밍 확인용)
    if (mock === true || gameId === 'mock' || window.__cgMock === true) {
      this._enableMock('명시적 dev mock 모드', true);
      return;
    }

    const sdk = this._sdk();
    if (!sdk) {
      // SDK 스크립트가 없음(로컬 소스 미리보기) 또는 애드블록이 스크립트 자체를 차단.
      // 실서비스에서 가짜 광고를 보여주면 안 되므로 '조용히 건너뜀'(오버레이 없음). 게임은 계속.
      this._enableMock('CrazyGames SDK 없음(로컬/애드블록) — 조용히 건너뜀', false);
      return;
    }

    try {
      // init Promise 공유(utils.js initCloudStorage 가 게임 부팅 전에 먼저 호출할 수 있음) — 중복 init 방지
      await (window.__cgInitP || (window.__cgInitP = sdk.init()));
      // 환경 감지: 'local'(localhost) 에선 SDK 가 광고를 시뮬레이션, 'disabled' 면 호출이 throw.
      // v3 는 동기 프로퍼티 sdk.environment, (구버전) getEnvironment() 도 폴백 지원.
      this._env = await this._detectEnv(sdk);
      // 로딩 완료 신호(있으면). 게임 부팅 직후 호출되는 init 시점이 로딩 종료에 해당.
      this.loadingStop();

      if (this._env === 'disabled') {
        // 허용되지 않은 도메인 → 광고 호출이 throw. 조용히 건너뜀(가짜 광고 표시 안 함).
        this._enableMock("환경 'disabled' — 조용히 건너뜀", false);
        return;
      }
      this._ready = true;
      this._mock = false;
      console.info('[CrazyAds] CrazyGames SDK 준비 완료. env=', this._env);
    } catch (e) {
      console.warn('[CrazyAds] SDK init 실패 → 조용히 건너뜀:', e);
      this._enableMock('SDK init 실패', false);
    }
  },

  // 환경 문자열 감지: v3 동기 프로퍼티 우선, 구버전 getEnvironment() 폴백. 실패 시 null.
  async _detectEnv(sdk) {
    try {
      if (typeof sdk.environment === 'string') return sdk.environment;
      if (typeof sdk.getEnvironment === 'function') return await sdk.getEnvironment();
    } catch (e) {}
    return null;
  },

  _enableMock(reason, devOverlay) {
    this._mock = true;
    this._devOverlay = devOverlay === true;
    this._ready = true;
    console.info('[CrazyAds] 실제 광고 비활성(' + reason + ').');
  },

  // gd-flow.js 호환: SDK 준비 대기(반환 = 실제 광고 호출 가능 여부) / 실 SDK 존재 여부
  async waitReady() { try { return await this.ready; } catch (e) { return false; } },
  hasSdk() { return this._ready && !this._mock; },

  // 전면(인터스티셜) = CrazyGames midgame. 리트라이/레벨 전환 시점에서 호출.
  // 항상 Promise 를 반환하며, 실패하더라도 reject 하지 않고 게임이 계속되게 한다.
  showInterstitial() {
    return this._showAd('midgame');
  },

  // 보상형 = CrazyGames rewarded. 끝까지 시청 여부(완주)를 boolean 으로 반환.
  showRewarded() {
    return this._showAd('rewarded');
  },

  // 광고 표시 공통 로직
  async _showAd(type) {
    if (!this._ready) {
      console.warn('[CrazyAds] 아직 초기화되지 않았습니다. init()을 먼저 호출하세요.');
      return false;
    }
    if (this._adInProgress) return false;
    this._adInProgress = true;

    try {
      if (this._mock) {
        return await this._showMockAd(type);
      }
      return await this._showRealAd(type);
    } catch (e) {
      // 광고 실패는 치명적이지 않다. 게임은 계속 진행시킨다.
      console.warn('[CrazyAds] 광고 표시 실패(무시하고 진행):', e);
      this._onResume();
      return false;
    } finally {
      this._adInProgress = false;
    }
  },

  // 실제 CrazyGames 광고: requestAd 콜백을 Promise 로 감싼다.
  //  - adStarted  → 게임 일시정지/음소거(onPause)
  //  - adFinished → 정상 종료(보상형이면 완주=보상 지급). 게임 복귀(onResume), resolve(true)
  //  - adError    → 미충족/애드블록/쿨다운 등. 게임 복귀(onResume), resolve(false)
  _showRealAd(type) {
    return new Promise((resolve) => {
      const sdk = this._sdk();
      if (!sdk || !sdk.ad || typeof sdk.ad.requestAd !== 'function') {
        this._onResume();
        resolve(false);
        return;
      }
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        this._onResume();
        resolve(ok);
      };
      // 어떤 콜백도 안 오는 먹통 상황 대비. adStarted 가 오면(광고 재생 시작) 해제한다.
      const watchdog = setTimeout(() => {
        if (!settled) {
          console.warn('[CrazyAds] 광고 콜백 무응답(' + type + ') — 건너뜀');
          finish(false);
        }
      }, AD_START_TIMEOUT);
      const callbacks = {
        adStarted: () => {
          clearTimeout(watchdog); // 재생 시작 — 이후엔 길이에 상관없이 adFinished/adError 를 기다린다.
          this._onPause();
        },
        adFinished: () => finish(true),
        adError: (err) => {
          // 'unfilled'(광고 없음) / 'adblock' / 'adCooldown' 등 — 게임은 계속.
          console.info('[CrazyAds] adError(' + type + '):', err);
          finish(false);
        },
      };
      try {
        sdk.ad.requestAd(type, callbacks);
      } catch (e) {
        console.warn('[CrazyAds] requestAd throw:', e);
        finish(false);
      }
    });
  },

  // 게임플레이 시작/재개(라운드 시작, 일시정지 해제, 이어하기 등). SDK 없으면 무시.
  gameplayStart() {
    const sdk = this._sdk();
    try {
      if (!this._mock && sdk && sdk.game && typeof sdk.game.gameplayStart === 'function') {
        sdk.game.gameplayStart();
      }
    } catch (e) {}
  },

  // 게임플레이 정지(게임오버, 일시정지, 메뉴 진입 등). SDK 없으면 무시.
  gameplayStop() {
    const sdk = this._sdk();
    try {
      if (!this._mock && sdk && sdk.game && typeof sdk.game.gameplayStop === 'function') {
        sdk.game.gameplayStop();
      }
    } catch (e) {}
  },

  // 로딩 완료 신호. SDK 없으면 무시.
  loadingStop() {
    const sdk = this._sdk();
    try {
      if (!this._mock && sdk && sdk.game && typeof sdk.game.loadingStop === 'function') {
        sdk.game.loadingStop();
      }
    } catch (e) {}
  },

  // 실제 광고를 호출하지 않는 경우의 처리.
  //  - dev mock(_devOverlay=true): 가짜 광고 오버레이를 띄워 광고 타이밍을 시각화(개발용). resolve(true).
  //  - 그 외(SDK 부재/애드블록/비허용 도메인): 가짜 광고를 보이지 않고 즉시 건너뜀. resolve(false)로
  //    보상형은 보상 미지급(시청 안 했으므로)이 되고, 전면은 그냥 통과 — 어느 쪽이든 게임은 계속.
  _showMockAd(type) {
    if (!this._devOverlay) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      this._onPause();
      const overlay = this._createMockOverlay(type);
      document.body.appendChild(overlay);
      setTimeout(() => {
        overlay.remove();
        this._onResume();
        resolve(true);
      }, MOCK_AD_DURATION);
    });
  },

  // mock 광고 오버레이 DOM 생성 (화면 표시는 영어 — 글로벌 기준)
  _createMockOverlay(type) {
    const el = document.createElement('div');
    const label = type === 'rewarded' ? 'Rewarded Ad (mock)' : 'Midgame Ad (mock)';
    el.setAttribute('data-cg-mock-ad', '1');
    el.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:99999',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'gap:12px',
      'background:rgba(0,0,0,0.88)',
      'color:#fff',
      'font-family:system-ui,-apple-system,sans-serif',
      'font-size:22px',
      'text-align:center',
      'user-select:none',
    ].join(';');
    el.innerHTML =
      '<div style="font-size:14px;letter-spacing:2px;opacity:0.6">ADVERTISEMENT</div>' +
      '<div>' + label + '</div>' +
      '<div style="font-size:13px;opacity:0.6">Returning to the game…</div>';
    return el;
  },
};

export default CrazyAds;
