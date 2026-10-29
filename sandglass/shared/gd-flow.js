// GD 광고 '흐름' 공용 모듈 — gd-sdk-wrapper.js 위에 얹는 게임 공통 UX 레이어 (2026-09)
// -----------------------------------------------------------------------------
// GD 심사 필수 요건(Twin Catch 반려 피드백 + Design Guidelines 2.1.2) 을 한 곳에서 보장한다:
//   ① 광고 요청 즉시 "Loading ad…" 대기 화면 + 씬 일시정지 + 완전 음소거(SFX·BGM·Phaser sound)
//   ② 광고가 실제로 떴다면(SDK_GAME_PAUSE 수신) 종료 후 **"TAP TO CONTINUE"** — 사용자 입력이 있어야만 재개
//      ("they should encounter a pause screen that resumes only upon player interaction")
//   ③ 광고가 거절/실패/없음이면 대기 화면 없이 즉시 게임 진행(graceful fail)
//   ④ 어떤 경로로도 게임이 영구 잠기지 않음(중복 SDK 이벤트·워치독·타임아웃)
//   ⑤ 리사이즈/레터박스 중앙정렬 재계산(Phaser FIT 의 '한 프레임 늦은 부모 크기' 버그 우회)
//   ⑥ 세로 전용 게임: 폰을 가로로 돌리면 회전 안내(Design Guidelines 3)
//
// 오버레이는 전부 DOM 이다. 씬이 pause 되면 Phaser 입력이 죽으므로 Phaser 로 만들면 잠금 사고가 난다.
// CSS/DOM 은 이 모듈이 index.html 에 주입한다(게임 index.html 은 #game-container 만 있으면 됨).
//
// 사용:
//   import { GDFlow, commonT } from './shared/gd-flow.js';
//   GDFlow.init({ game, sceneKey: 'game', lang: () => currentLang,
//                 setAdMuted: (m) => { SFX.setAdMuted(m); MUSIC.setAdMuted(m); } });
//   const ok = await GDFlow.playAd('interstitial');   // 프리롤/미드롤
//   const ok = await GDFlow.playAd('rewarded');       // 보상형(끝까지 봤을 때만 true)
// -----------------------------------------------------------------------------
// CrazyGames 빌드: 래퍼만 교체(인터페이스 동일). 광고 전후 gameplayStop/Start 를 SDK 에 알린다.
import GDAds from './crazygames-sdk-wrapper.js';

// 공용 UI 문구(11개 언어). 게임 STRINGS 를 건드리지 않고 광고/음향/회전 안내 문구를 공유한다.
export const COMMON_STRINGS = {
  en: { loadingAd: 'Loading ad…', tapToContinue: 'TAP TO CONTINUE', gamePaused: 'The game is paused', rotate: 'Rotate your device', rotateSub: 'This game is played in portrait', music: 'Music', sound: 'Sound', on: 'ON', off: 'OFF' },
  ko: { loadingAd: '광고 로딩 중…', tapToContinue: '탭하여 계속하기', gamePaused: '게임이 일시정지되었습니다', rotate: '기기를 세워 주세요', rotateSub: '세로 화면용 게임입니다', music: '음악', sound: '효과음', on: '켜짐', off: '꺼짐' },
  ja: { loadingAd: '広告を読み込み中…', tapToContinue: 'タップして続ける', gamePaused: 'ゲームは一時停止中です', rotate: '端末を縦にしてください', rotateSub: '縦画面専用のゲームです', music: '音楽', sound: '効果音', on: 'ON', off: 'OFF' },
  zh: { loadingAd: '广告加载中…', tapToContinue: '点击继续', gamePaused: '游戏已暂停', rotate: '请竖持设备', rotateSub: '本游戏为竖屏设计', music: '音乐', sound: '音效', on: '开', off: '关' },
  es: { loadingAd: 'Cargando anuncio…', tapToContinue: 'TOCA PARA CONTINUAR', gamePaused: 'El juego está en pausa', rotate: 'Gira tu dispositivo', rotateSub: 'Este juego se juega en vertical', music: 'Música', sound: 'Sonido', on: 'SÍ', off: 'NO' },
  pt: { loadingAd: 'Carregando anúncio…', tapToContinue: 'TOQUE PARA CONTINUAR', gamePaused: 'O jogo está pausado', rotate: 'Gire seu dispositivo', rotateSub: 'Este jogo é jogado na vertical', music: 'Música', sound: 'Som', on: 'LIG', off: 'DESL' },
  fr: { loadingAd: 'Chargement de la pub…', tapToContinue: 'TOUCHEZ POUR CONTINUER', gamePaused: 'Le jeu est en pause', rotate: 'Tournez votre appareil', rotateSub: 'Ce jeu se joue en mode portrait', music: 'Musique', sound: 'Son', on: 'ON', off: 'OFF' },
  de: { loadingAd: 'Werbung wird geladen…', tapToContinue: 'TIPPEN ZUM FORTFAHREN', gamePaused: 'Das Spiel ist pausiert', rotate: 'Gerät drehen', rotateSub: 'Dieses Spiel wird im Hochformat gespielt', music: 'Musik', sound: 'Ton', on: 'AN', off: 'AUS' },
  it: { loadingAd: 'Caricamento annuncio…', tapToContinue: 'TOCCA PER CONTINUARE', gamePaused: 'Il gioco è in pausa', rotate: 'Ruota il dispositivo', rotateSub: 'Questo gioco si gioca in verticale', music: 'Musica', sound: 'Suoni', on: 'ON', off: 'OFF' },
  tr: { loadingAd: 'Reklam yükleniyor…', tapToContinue: 'DEVAM İÇİN DOKUN', gamePaused: 'Oyun duraklatıldı', rotate: 'Cihazınızı döndürün', rotateSub: 'Bu oyun dikey modda oynanır', music: 'Müzik', sound: 'Ses', on: 'AÇIK', off: 'KAPALI' },
  ru: { loadingAd: 'Загрузка рекламы…', tapToContinue: 'НАЖМИТЕ, ЧТОБЫ ПРОДОЛЖИТЬ', gamePaused: 'Игра на паузе', rotate: 'Поверните устройство', rotateSub: 'В эту игру играют в вертикальном режиме', music: 'Музыка', sound: 'Звук', on: 'ВКЛ', off: 'ВЫКЛ' },
};
export function commonT(lang, key) {
  const L = COMMON_STRINGS[lang] || COMMON_STRINGS.en;
  return L[key] || COMMON_STRINGS.en[key] || key;
}

const CSS = `
.gdf-veil{position:fixed;inset:0;z-index:50;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;box-sizing:border-box;text-align:center;background:#0b0a18;background-image:radial-gradient(120% 80% at 50% 40%,#221b3f 0%,#0b0a18 70%);color:#eef1ff;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;user-select:none;-webkit-user-select:none;touch-action:manipulation}
.gdf-veil.show{display:flex}
.gdf-veil .gdf-title{font-size:clamp(22px,6vmin,40px);font-weight:700;letter-spacing:.5px}
.gdf-veil .gdf-sub{font-size:clamp(13px,3vmin,18px);color:#8b93c4}
#gdf-continue{cursor:pointer}
#gdf-continue .gdf-title{animation:gdf-pulse 1.1s ease-in-out infinite}
@keyframes gdf-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(1.06)}}
.gdf-spinner{width:44px;height:44px;border:4px solid rgba(255,255,255,.18);border-top-color:#66e0d6;border-radius:50%;animation:gdf-spin .9s linear infinite}
@keyframes gdf-spin{to{transform:rotate(360deg)}}
#gdf-rotate{z-index:40}
.gdf-rotate-icon{width:52px;height:88px;border:4px solid #9fb0ff;border-radius:10px;box-sizing:border-box;animation:gdf-tilt 1.6s ease-in-out infinite}
@keyframes gdf-tilt{0%,100%{transform:rotate(-18deg)}50%{transform:rotate(18deg)}}
`;

const $ = (id) => document.getElementById(id);

export const GDFlow = {
  _game: null,
  _sceneKey: 'game',
  _lang: () => 'en',
  _setAdMuted: () => {},
  _portraitHint: true,
  _adWasShown: false, // 이번 호출에서 SDK_GAME_PAUSE 를 실제로 받았는가
  _inPlayAd: false, // playAd() 가 흐름을 쥐고 있는가
  _continueResolve: null,
  _stuckTimer: null,
  _inited: false,
  _relayoutQueued: false,
  _lastRelayout: null,

  // opts: { game, sceneKey, lang(), setAdMuted(bool), portraitHint=true, onGdpr }
  init(opts = {}) {
    if (this._inited) return GDAds.ready;
    this._inited = true;
    this._game = opts.game || null;
    this._sceneKey = opts.sceneKey || 'game';
    if (typeof opts.lang === 'function') this._lang = opts.lang;
    if (typeof opts.setAdMuted === 'function') this._setAdMuted = opts.setAdMuted;
    if (opts.portraitHint === false) this._portraitHint = false;

    this._injectDom();
    this._bindContinue();
    this._setupResize();

    return GDAds.init({
      onPause: () => this._adPause(),
      onResume: () => {
        // 정상 흐름에서는 playAd() 가 대기 화면까지 책임진다.
        if (this._inPlayAd) return;
        // 우리가 부르지 않은 광고(SDK 자체 동작)로 정지됐던 경우의 안전장치
        if (this._adWasShown) {
          this._adWasShown = false;
          this._waitForContinue().then(() => this._adResume());
        } else {
          this._adResume();
        }
      },
      onGdpr: typeof opts.onGdpr === 'function' ? opts.onGdpr : () => {},
    });
  },

  // ---------------------------------------------------------------------------
  // 광고 1건의 전 과정. 항상 resolve 하고, 어떤 실패에서도 게임을 잠그지 않는다.
  //   kind: 'interstitial' | 'rewarded'
  //   반환: 전면=광고가 실제로 표시됐는가 / 보상형=끝까지 시청했는가(SDK_REWARDED_WATCH_COMPLETE)
  // ---------------------------------------------------------------------------
  async playAd(kind) {
    if (this._inPlayAd) return false; // 중복 호출 차단(버튼 연타)
    this._inPlayAd = true;
    this._adWasShown = false;
    this._applyLabels();
    this._setVeil('gdf-ad', true);
    let result = false;
    try {
      // SDK 준비를 기다리되(첫 광고=프리롤), 그 '결과'로 광고를 막지는 않는다.
      // 실제로 부를 수 있는지는 gdsdk 실물 존재(또는 mock 모드)로 판단한다.
      try { GDAds.gameplayStop(); } catch (e) {} // CG: 광고 요청 전 게임플레이 정지 신호
      await GDAds.waitReady();
      if (GDAds._mock || GDAds.hasSdk()) {
        const call = kind === 'rewarded' ? GDAds.showRewarded() : GDAds.showInterstitial();
        result = await this._withTimeout(call, 60000);
      }
    } catch (e) {
      result = false;
    } finally {
      this._setVeil('gdf-ad', false);
    }
    try {
      if (this._adWasShown) await this._waitForContinue(); // 광고가 실제로 떴을 때만 대기 화면
    } finally {
      this._adWasShown = false;
      this._inPlayAd = false;
      this._setVeil('gdf-continue', false);
      this._continueResolve = null;
      this._adResume();
    }
    return !!result;
  },

  // 광고가 뜨기 직전(SDK_GAME_PAUSE): 게임 정지 + 완전 음소거 (GD 필수)
  _adPause() {
    this._adWasShown = true;
    this._setVeil('gdf-ad', false); // 실제 광고가 화면을 덮는다는 전제로 로딩 화면을 내린다.
    try { this._setAdMuted(true); } catch (e) {}
    const g = this._game;
    if (g && g.sound) { if (this._prevSoundMute == null) this._prevSoundMute = !!g.sound.mute; g.sound.mute = true; }
    // ⚠️ ScenePlugin.pause()/resume() 는 다음 프레임에 처리되는 '큐 op' 이다(Phaser 3.50+).
    //    광고 Promise 가 resolve 된 직후 게임 코드가 `scene.isActive()` 를 검사하므로 즉시 반영되는 sys.pause()/sys.resume() 를 쓴다.
    const sc = this._scene();
    if (sc && sc.sys && sc.sys.isActive()) sc.sys.pause();
    // 광고가 실제로는 안 뜨고 SDK 가 조용히 멈춘 경우 — 8초 뒤 로딩 화면을 다시 띄워 '먹통' 인상을 막는다.
    clearTimeout(this._stuckTimer);
    this._stuckTimer = setTimeout(() => {
      if (this._adWasShown && !this._continueResolve) { this._applyLabels(); this._setVeil('gdf-ad', true); }
    }, 8000);
  },

  // 사용자가 "Tap to continue" 를 누른 뒤(또는 광고가 없었을 때)에만 호출된다
  _adResume() {
    try { GDAds.gameplayStart(); } catch (e) {} // CG: 광고 후(또는 광고 없이) 게임플레이 재개 신호
    clearTimeout(this._stuckTimer);
    this._setVeil('gdf-ad', false);
    try { this._setAdMuted(false); } catch (e) {}
    const g = this._game;
    if (g && g.sound && this._prevSoundMute != null) { g.sound.mute = this._prevSoundMute; this._prevSoundMute = null; } // 사용자 음소거 상태 복원
    const sc = this._scene();
    if (sc && sc.sys && sc.sys.isPaused()) sc.sys.resume();
  },

  // 광고 종료 후 '사용자 입력이 있어야' 풀리는 일시정지 화면 (GD Guidelines 필수)
  // ⚠️ 이미 대기 중인 Promise 가 있으면 반드시 먼저 풀어준다(중복 SDK_GAME_START → 고아 resolver = 영구 잠김 방지).
  _waitForContinue() {
    if (this._continueResolve) { const prev = this._continueResolve; this._continueResolve = null; prev(); }
    this._applyLabels();
    this._setVeil('gdf-continue', true);
    return new Promise((resolve) => { this._continueResolve = resolve; });
  },

  _continue(ev) {
    const el = $('gdf-continue');
    if (!el || !el.classList.contains('show') || this._dismissing) return;
    if (ev && ev.preventDefault) ev.preventDefault();
    // ⚠️ 즉시 숨기면 같은 탭의 후속 이벤트(pointerup 뒤의 mouseup/click, touchend 뒤의 합성 마우스 이벤트)가
    //    그 자리의 캔버스로 새서 Phaser 버튼/열 탭이 눌린다(QA 재현: 재개 탭이 곧바로 타일 드롭). 160ms 뒤에 숨긴다.
    this._dismissing = true;
    setTimeout(() => {
      this._dismissing = false;
      this._setVeil('gdf-continue', false);
      const r = this._continueResolve;
      this._continueResolve = null;
      if (r) r();
    }, 160);
  },

  // 어떤 경로로도 60초 넘게 매달려 있지 않게 하는 최종 안전망
  _withTimeout(promise, ms) {
    let tid;
    return Promise.race([
      promise,
      new Promise((r) => { tid = setTimeout(() => { console.warn('[GDFlow] 광고 타임아웃 — 강제로 진행합니다.'); r(false); }, ms); }),
    ]).finally(() => clearTimeout(tid));
  },

  _scene() {
    const g = this._game;
    if (!g || !g.scene) return null;
    try { return g.scene.getScene(this._sceneKey); } catch (e) { return null; }
  },

  // ---------------------------------------------------------------------------
  // DOM 오버레이
  // ---------------------------------------------------------------------------
  _injectDom() {
    if ($('gdf-ad')) return;
    const st = document.createElement('style');
    st.id = 'gdf-style';
    st.textContent = CSS;
    document.head.appendChild(st);
    const mk = (id, inner) => {
      const d = document.createElement('div');
      d.id = id; d.className = 'gdf-veil'; d.setAttribute('aria-hidden', 'true'); d.innerHTML = inner;
      document.body.appendChild(d);
      return d;
    };
    mk('gdf-ad', '<div class="gdf-spinner"></div><div class="gdf-title" id="gdf-ad-title">Loading ad…</div>');
    mk('gdf-continue', '<div class="gdf-title" id="gdf-continue-title">TAP TO CONTINUE</div><div class="gdf-sub" id="gdf-continue-sub">The game is paused</div>');
    mk('gdf-rotate', '<div class="gdf-rotate-icon"></div><div class="gdf-title" id="gdf-rotate-title">Rotate your device</div><div class="gdf-sub" id="gdf-rotate-sub">This game is played in portrait</div>');
  },

  _applyLabels() {
    const L = this._lang() || 'en';
    const set = (id, s) => { const e = $(id); if (e) e.textContent = s; };
    set('gdf-ad-title', commonT(L, 'loadingAd'));
    set('gdf-continue-title', commonT(L, 'tapToContinue'));
    set('gdf-continue-sub', commonT(L, 'gamePaused'));
    set('gdf-rotate-title', commonT(L, 'rotate'));
    set('gdf-rotate-sub', commonT(L, 'rotateSub'));
  },

  _setVeil(id, on) {
    const e = $(id);
    if (e) { e.classList.toggle('show', !!on); e.setAttribute('aria-hidden', on ? 'false' : 'true'); }
  },

  _bindContinue() {
    const el = $('gdf-continue');
    if (!el || el._gdfBound) return;
    el._gdfBound = true;
    const go = (ev) => this._continue(ev);
    el.addEventListener('pointerup', go);
    el.addEventListener('touchend', go, { passive: false });
    el.addEventListener('click', go);
    // 베일 위의 나머지 포인터 이벤트는 여기서 소비(캔버스로 전파 금지)
    ['pointerdown', 'mousedown', 'mouseup', 'touchstart'].forEach((t) => el.addEventListener(t, (e) => { if (e.cancelable) e.preventDefault(); e.stopPropagation(); }, { passive: false }));
    // 키보드 전용 플레이어 대응. div 는 포커스를 못 받으므로 document 레벨에서 듣는다.
    document.addEventListener('keydown', (ev) => { if (ev.key === ' ' || ev.key === 'Enter' || ev.key === 'Escape') go(ev); });
  },

  // 광고/재개 오버레이가 떠 있는가(게임 쪽 입력 게이트용)
  isBlocking() {
    const a = $('gdf-ad'), c = $('gdf-continue');
    return !!((a && a.classList.contains('show')) || (c && c.classList.contains('show')));
  },

  // ---------------------------------------------------------------------------
  // ★ 리사이즈/레터박스 재계산 (GD 반려 사유 ① 센터링)
  // Phaser Scale.FIT 은 resize 이벤트와 같은 틱에 부모 크기를 읽어 '직전 프레임' 크기로 스케일하는
  // 경우가 있다(측정: Twin Catch AUDIT §5.2). → 레이아웃 확정 후(rAF 2회) 우리가 직접 측정해
  // setParentSize() 로 밀어넣고 refresh(). resize/orientationchange/visualViewport/ResizeObserver 4경로.
  // 전제: index.html 의 #game-container 가 position:fixed;inset:0;display:flex 중앙정렬,
  //       Phaser scale.autoCenter = NO_CENTER, expandParent:false, autoRound:true.
  // ---------------------------------------------------------------------------
  _setupResize() {
    const el = document.getElementById('game-container');
    const schedule = () => this.scheduleRelayout();
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', () => { schedule(); setTimeout(schedule, 250); setTimeout(schedule, 600); });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', schedule);
      window.visualViewport.addEventListener('scroll', schedule);
    }
    if (typeof ResizeObserver !== 'undefined' && el) new ResizeObserver(schedule).observe(el);
    window.addEventListener('load', schedule);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
    schedule();
    setTimeout(schedule, 300);
    setTimeout(schedule, 1200);
  },

  scheduleRelayout() {
    if (this._relayoutQueued) return;
    this._relayoutQueued = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { this._relayoutQueued = false; this.relayout(); }));
  },

  relayout() {
    const g = this._game;
    const el = document.getElementById('game-container');
    if (!g || !g.scale || !el) return;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    g.scale.setParentSize(w, h);
    g.scale.refresh();
    this._lastRelayout = { w, h };
    // 세로 전용 게임 — '폰처럼 생긴' 기기(coarse pointer)가 심하게 가로일 때만 회전 안내(GD Guidelines 3).
    // ⚠️ maxTouchPoints 로 판정하면 터치 노트북/데스크톱이 걸려 게임을 시작조차 못 한다.
    if (this._portraitHint) {
      const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
      const on = coarse && w > h && w / h >= 1.4 && Math.min(w, h) < 500;
      this._applyLabels();
      this._setVeil('gdf-rotate', on);
    }
  },
};

export default GDFlow;
