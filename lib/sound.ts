// WebAudio 合成音效: 无资源文件, 极轻量。默认开启, 可静音(持久化)。

const MUTE_KEY = 'feltlab-muted';

let ctx: AudioContext | null = null;
let muted: boolean | null = null;

export function isMuted(): boolean {
  if (muted === null) {
    muted = typeof window !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
  }
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    // 静默
  }
}

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, dur: number, at = 0, type: OscillatorType = 'sine', gain = 0.06) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, c.currentTime + at);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + at);
  o.stop(c.currentTime + at + dur + 0.02);
}

function noise(dur: number, at = 0, gain = 0.05) {
  const c = ac();
  if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = gain;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 1800;
  src.connect(f).connect(g).connect(c.destination);
  src.start(c.currentTime + at);
}

export type SoundName = 'deal' | 'chip' | 'win' | 'fold' | 'achieve' | 'allin' | 'click';

export function play(name: SoundName) {
  if (isMuted()) return;
  switch (name) {
    case 'deal':
      noise(0.06, 0, 0.04);
      break;
    case 'chip':
      tone(2600, 0.05, 0, 'square', 0.025);
      tone(3100, 0.05, 0.04, 'square', 0.02);
      break;
    case 'fold':
      noise(0.05, 0, 0.02);
      break;
    case 'win':
      tone(523, 0.12, 0, 'triangle', 0.06);
      tone(784, 0.16, 0.1, 'triangle', 0.06);
      break;
    case 'achieve':
      tone(659, 0.1, 0, 'triangle', 0.07);
      tone(880, 0.1, 0.09, 'triangle', 0.07);
      tone(1175, 0.2, 0.18, 'triangle', 0.07);
      break;
    case 'allin':
      tone(98, 0.4, 0, 'sawtooth', 0.05);
      tone(110, 0.4, 0.12, 'sawtooth', 0.04);
      break;
    case 'click':
      tone(1800, 0.04, 0, 'square', 0.02);
      break;
  }
}
