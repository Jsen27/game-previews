// 절차적 BGM 엔진(공용) — Web Audio 실시간 합성 루프 (외부 파일/CDN/저작권 음원 0)
// -----------------------------------------------------------------------------
// GD Guidelines 1.2: "Your game must include sound elements such as background music (BGM),
// sound effects (SFX)" — 필수. Twin Catch 반려 피드백(②): 선율 없는 저음량 드론은 '음악'으로
// 인식되지 않았다 → 코드 진행 + 베이스 + 아르페지오 + 멜로디 + 리듬이 있는 '곡'을 게임별로 합성한다.
//
//  * lookahead 스케줄러(25ms 틱마다 100ms 앞을 예약) → setTimeout 지터에 박자가 흔들리지 않음.
//  * SFX 와 AudioContext 를 공유하되(getCtx) 게인 체인은 분리 → 음악/효과음 토글이 서로 독립.
//  * 광고 음소거(setAdMuted)는 즉시(0.01s), 사용자 토글(setMute)은 부드럽게(0.12s).
//  * assets/sounds/bgm.mp3 등 파일을 attachFile(phaserSound) 로 붙이면 합성 대신 그 파일을 루프.
//
// 사용:
//   const MUSIC = createMusic({ getCtx: () => SFX._ensureCtx(), song: SONGS.gemdoku });
//   MUSIC.start();  // 첫 사용자 제스처에서(멱등)
//   MUSIC.setMute(bool); MUSIC.setAdMuted(bool);
//
// song 포맷(반음 오프셋은 root 기준, 12=한 옥타브 위):
//   { bpm, root(Hz), vol, lowpass,
//     chords: [[semi...] × 4마디]           // 패드(마디 시작에 들어와 마디 내내 유지)
//     bass:   [semi × 4마디], bassSteps:[..] // 베이스 음(root−12 기준) + 울릴 16분 스텝
//     arp:    { offset, every, octave, type, vol, dur } | null   // 코드톤 아르페지오
//     melody: [64 × (semi|null)], lead:{ type, vol, dur }        // 멜로디(16분 64스텝)
//     hat:    { steps:[..], vol } | null,  kick: { steps:[..], vol } | null,
//     gong:   { step, vol } | null,        pad: { type, vol } }
// -----------------------------------------------------------------------------

const STEPS = 64; // 4마디 × 16분음표 16

export function createMusic(opts = {}) {
  const song = opts.song;
  const getCtx = opts.getCtx || (() => null);

  const M = {
    ctx: null,
    out: null, // 음악 전용 게인(SFX 와 분리)
    _started: false,
    _mute: false,
    _adMute: false,
    _timer: null,
    _nextTime: 0,
    _step: 0,
    _file: null,
    _vol: song && song.vol != null ? song.vol : 0.3,
    STEP_DUR: 60 / ((song && song.bpm) || 100) / 4,
    LOOKAHEAD: 0.1,
    TICK: 25,

    attachFile(sound) { this._file = sound; }, // Phaser sound. 있으면 합성 대신 이 파일을 루프

    // 첫 사용자 제스처에서 호출. 멱등.
    start() {
      if (this._started) return;
      if (this._file) { // 1) 파일 우선
        this._started = true;
        try { this._file.play({ loop: true, volume: 0.5 }); } catch (e) {}
        this._apply();
        return;
      }
      if (!song) return;
      const ctx = getCtx();
      if (!ctx) return;
      this.ctx = ctx;
      this._started = true;

      // 음악 전용 체인: out -> lowpass(부드럽게) -> compressor -> destination
      const out = ctx.createGain();
      out.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = song.lowpass || 5200;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 8; comp.attack.value = 0.004; comp.release.value = 0.15;
      out.connect(lp); lp.connect(comp); comp.connect(ctx.destination);
      this.out = out;

      this._nextTime = ctx.currentTime + 0.08;
      this._step = 0;
      this._timer = setInterval(() => this._scheduler(), this.TICK);
      this._apply();
    },

    _scheduler() {
      const ctx = this.ctx;
      if (!ctx) return;
      // 탭 전환 등으로 컨텍스트가 멈췄다 돌아오면 시간축을 다시 붙인다(밀린 음표 폭발 방지)
      if (this._nextTime < ctx.currentTime - 0.5) this._nextTime = ctx.currentTime + 0.05;
      while (this._nextTime < ctx.currentTime + this.LOOKAHEAD) {
        if (this._audible()) this._scheduleStep(this._step, this._nextTime);
        this._nextTime += this.STEP_DUR;
        this._step = (this._step + 1) % STEPS;
      }
    },

    _audible() { return !this._mute && !this._adMute; },
    _f(semi) { return song.root * Math.pow(2, semi / 12); },

    // 한 스텝(16분음표)에 울릴 것들을 예약
    _scheduleStep(step, at) {
      const bar = Math.floor(step / 16) % 4;
      const b = step % 16;
      const chord = song.chords[bar] || song.chords[0];
      const barDur = this.STEP_DUR * 16;

      // 코드 패드
      if (b === 0 && song.pad) {
        chord.forEach((semi, i) => this._pad(this._f(semi), at, barDur, Math.max(0.01, song.pad.vol - i * 0.006), song.pad.type));
      }
      // 베이스
      if (song.bass && song.bassSteps && song.bassSteps.indexOf(b) >= 0) {
        this._pluck(this._f(song.bass[bar] - 12), at, song.bassDur || 0.26, song.bassVol || 0.2, song.bassType || 'triangle');
      }
      // 아르페지오: 코드 구성음을 위로 훑는다
      const a = song.arp;
      if (a && (b - (a.offset || 0)) % (a.every || 2) === 0 && b >= (a.offset || 0)) {
        const idx = Math.floor((b - (a.offset || 0)) / (a.every || 2)) % chord.length;
        this._pluck(this._f(chord[idx] + 12 * (a.octave == null ? 1 : a.octave)), at, a.dur || 0.13, a.vol || 0.055, a.type || 'square');
      }
      // 멜로디
      const m = song.melody ? song.melody[step] : null;
      if (m != null && m !== false) {
        const L = song.lead || {};
        this._pluck(this._f(m), at, L.dur || 0.34, L.vol || 0.115, L.type || 'triangle', L.detune || 0);
      }
      // 리듬
      if (song.hat && song.hat.steps.indexOf(b) >= 0) this._hat(at, song.hat.vol || 0.035);
      if (song.kick && song.kick.steps.indexOf(b) >= 0) this._kick(at, song.kick.vol || 0.2);
      if (song.gong && step === (song.gong.step || 0)) this._gong(at, song.gong.vol || 0.12);
    },

    _pluck(freq, at, dur, vol, type, detune) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'triangle';
      osc.frequency.setValueAtTime(freq, at);
      if (detune) osc.detune.setValueAtTime(detune, at);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g); g.connect(this.out);
      osc.start(at); osc.stop(at + dur + 0.02);
    },

    _pad(freq, at, dur, vol, type) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, at);
      osc.detune.setValueAtTime(-4, at);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.25);
      g.gain.setValueAtTime(vol, at + dur - 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g); g.connect(this.out);
      osc.start(at); osc.stop(at + dur + 0.02);
    },

    _hat(at, vol) {
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * 0.03);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const g = ctx.createGain(); g.gain.value = vol;
      src.connect(hp); hp.connect(g); g.connect(this.out);
      src.start(at);
    },

    // 킥/북: 사인 피치 드롭(150→45Hz) — 타이코/킥 공용
    _kick(at, vol) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, at);
      osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      osc.connect(g); g.connect(this.out);
      osc.start(at); osc.stop(at + 0.25);
    },

    // 징(gong): 비조화 배음 3개의 긴 감쇠
    _gong(at, vol) {
      const ctx = this.ctx;
      const base = song.root / 2;
      [1, 1.47, 2.09].forEach((r, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(base * r, at);
        const v = vol / (i + 1);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(v, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 2.4 - i * 0.4);
        osc.connect(g); g.connect(this.out);
        osc.start(at); osc.stop(at + 2.6);
      });
    },

    setMute(m) { this._mute = !!m; this._apply(); },
    setAdMuted(m) { this._adMute = !!m; this._apply(); },
    isMuted() { return this._mute; },

    _apply() {
      const on = this._audible();
      if (this._file) { try { this._file.setMute(!on); } catch (e) {} return; }
      if (!this.out || !this.ctx) return;
      const t = this.ctx.currentTime;
      const target = on ? this._vol : 0;
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(this.out.gain.value, t);
      // 광고 음소거는 즉시(GD 필수), 사용자 토글은 살짝 부드럽게
      this.out.gain.setTargetAtTime(target, t, this._adMute ? 0.01 : 0.12);
    },
  };
  return M;
}

// 음이름 → 주파수(4옥타브 기준) 헬퍼
export const HZ = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88, A3: 220.0, E3: 164.81, F3: 174.61, G3: 196.0, D3: 146.83 };

// 4마디(64스텝) 멜로디를 "마디 문자열"로 적기: 각 마디 16토큰, '.'=쉼표, 숫자=반음 오프셋
function mel(barsStr) {
  const out = [];
  barsStr.forEach((bar) => bar.trim().split(/\s+/).forEach((tok) => out.push(tok === '.' ? null : parseInt(tok, 10))));
  while (out.length < STEPS) out.push(null);
  return out.slice(0, STEPS);
}

// -----------------------------------------------------------------------------
// 게임별 곡 (각자 조성·템포·음색이 다름 → 같은 엔진이라도 다른 곡으로 들린다)
// -----------------------------------------------------------------------------
export const SONGS = {
  // Gemdoku — "Facets": D장조 92BPM, 느긋한 퍼즐. Dmaj7 · A · Bm · Gmaj7 / 5음계 멜로디
  gemdoku: {
    bpm: 92, root: HZ.D4, vol: 0.3, lowpass: 4800,
    chords: [[0, 4, 7, 11], [-5, -1, 2], [-3, 0, 4], [-7, -3, 0, 4]],
    bass: [0, -5, -3, -7], bassSteps: [0, 8, 14], bassType: 'triangle', bassVol: 0.17, bassDur: 0.3,
    arp: { offset: 1, every: 2, octave: 1, type: 'triangle', vol: 0.045, dur: 0.16 },
    pad: { type: 'sine', vol: 0.045 },
    lead: { type: 'triangle', vol: 0.1, dur: 0.4 },
    melody: mel([
      '12 . . 14 . . 16 . 14 . . . 12 . . .',
      '9 . . . 7 . 9 . 12 . . . . . . .',
      '16 . . 19 . . 16 . 14 . 12 . . . . .',
      '14 . . . 11 . 9 . 7 . . . . . . .',
    ]),
    hat: { steps: [4, 12], vol: 0.02 }, kick: null, gong: null,
  },
  // Aurora Pour — "Glow": F장조 76BPM, 몽환적. Fmaj7 · Am7 · Dm7 · Bbmaj7 / 드문 사인 멜로디
  aurora: {
    bpm: 76, root: HZ.F4, vol: 0.28, lowpass: 3600,
    chords: [[0, 4, 7, 11], [4, 7, 11, 14], [-3, 0, 4, 7], [-7, -3, 0, 4]],
    bass: [0, 4, -3, -7], bassSteps: [0, 10], bassType: 'sine', bassVol: 0.2, bassDur: 0.6,
    arp: { offset: 0, every: 4, octave: 1, type: 'sine', vol: 0.06, dur: 0.5 },
    pad: { type: 'triangle', vol: 0.035 },
    lead: { type: 'sine', vol: 0.11, dur: 0.7, detune: 3 },
    melody: mel([
      '12 . . . . . 16 . . . 14 . . . . .',
      '11 . . . . . . . 9 . . . 7 . . .',
      '12 . . . . . 14 . . . 16 . . . . .',
      '19 . . . . . . . 16 . . . . . . .',
    ]),
    hat: null, kick: null, gong: null,
  },
  // Merge Rocket — "Liftoff": E단조 124BPM, 아케이드. Em · C · G · D / 스퀘어 리드 + 킥 + 하이햇
  mergeRocket: {
    bpm: 124, root: HZ.E4, vol: 0.3, lowpass: 5600,
    chords: [[0, 3, 7], [-4, 0, 3], [-5, -1, 2], [-2, 2, 5]],
    bass: [0, -4, -5, -2], bassSteps: [0, 2, 6, 8, 10, 14], bassType: 'square', bassVol: 0.11, bassDur: 0.18,
    arp: { offset: 1, every: 2, octave: 1, type: 'square', vol: 0.04, dur: 0.11 },
    pad: { type: 'sine', vol: 0.04 },
    lead: { type: 'square', vol: 0.07, dur: 0.22 },
    melody: mel([
      '12 . 12 . 15 . . . 19 . . 17 . 15 . .',
      '12 . . . 15 . 17 . 19 . . . . . . .',
      '19 . . 22 . . 19 . 17 . 15 . . . . .',
      '14 . . . 17 . 14 . 12 . . . . . . .',
    ]),
    hat: { steps: [2, 6, 10, 14], vol: 0.03 }, kick: { steps: [0, 4, 8, 12], vol: 0.16 }, gong: null,
  },
  // Overforge — "Forge Fire": A단조 5음계 100BPM, 동양 신화 대장간. 가야금풍 플럭 + 북(타이코) + 징
  overforge: {
    bpm: 100, root: HZ.A3, vol: 0.3, lowpass: 4600,
    chords: [[0, 3, 7, 10], [0, 3, 7], [-7, -4, 0], [-5, -2, 2]],
    bass: [0, 0, -7, -5], bassSteps: [0, 8], bassType: 'triangle', bassVol: 0.16, bassDur: 0.5,
    arp: { offset: 2, every: 4, octave: 1, type: 'triangle', vol: 0.05, dur: 0.3 },
    pad: { type: 'sine', vol: 0.035 },
    lead: { type: 'triangle', vol: 0.12, dur: 0.5, detune: -6 },
    melody: mel([
      '12 . . 15 . . 17 . . . 19 . . . . .',
      '15 . . 12 . . 10 . . . 12 . . . . .',
      '17 . . 19 . . 22 . . . 19 . 17 . . .',
      '15 . . . 12 . . . . . . . . . . .',
    ]),
    hat: null, kick: { steps: [0, 6, 8, 12], vol: 0.2 }, gong: { step: 0, vol: 0.1 },
  },
};
