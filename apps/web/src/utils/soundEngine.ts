export type SoundType = 'click' | 'chip' | 'deal' | 'check' | 'fold' | 'allin' | 'win' | 'lose' | 'tick';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function makeNoise(ac: AudioContext, samples: number): AudioBufferSourceNode {
  const buf = ac.createBuffer(1, samples, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

function cleanup(...nodes: AudioNode[]): () => void {
  return () => nodes.forEach(n => { try { n.disconnect(); } catch {} });
}

const SYNTHS: Record<SoundType, (ac: AudioContext) => void> = {
  click(ac) {
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1200;
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.onended = cleanup(osc, gain);
    osc.start(t);
    osc.stop(t + 0.04);
  },

  chip(ac) {
    const t = ac.currentTime;
    const noise = makeNoise(ac, 512);
    const filter = ac.createBiquadFilter();
    const noiseGain = ac.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    filter.Q.value = 2;
    noiseGain.gain.setValueAtTime(0.18, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ac.destination);
    noise.onended = cleanup(noise, filter, noiseGain);
    noise.start(t);
    noise.stop(t + 0.15);

    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 180;
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.onended = cleanup(osc, gain);
    osc.start(t);
    osc.stop(t + 0.08);
  },

  deal(ac) {
    const t = ac.currentTime;
    const noise = makeNoise(ac, 2048);
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(3000, t);
    filter.frequency.linearRampToValueAtTime(800, t + 0.18);
    filter.Q.value = 1.5;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);
    noise.onended = cleanup(noise, filter, gain);
    noise.start(t);
    noise.stop(t + 0.2);
  },

  check(ac) {
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.08);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.onended = cleanup(osc, gain);
    osc.start(t);
    osc.stop(t + 0.1);
  },

  fold(ac) {
    const t = ac.currentTime;
    const noise = makeNoise(ac, 2048);
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2000, t);
    filter.frequency.linearRampToValueAtTime(400, t + 0.3);
    filter.Q.value = 1;
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.linearRampToValueAtTime(0.001, t + 0.32);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);
    noise.onended = cleanup(noise, filter, gain);
    noise.start(t);
    noise.stop(t + 0.32);
  },

  allin(ac) {
    const t = ac.currentTime;
    ([440, 554, 659] as const).forEach((freq, i) => {
      const start = t + i * 0.18;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.22, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.onended = cleanup(osc, gain);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  },

  win(ac) {
    const t = ac.currentTime;
    ([523, 659, 784, 1047] as const).forEach((freq, i) => {
      const start = t + i * 0.12;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.onended = cleanup(osc, gain);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  },

  lose(ac) {
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.linearRampToValueAtTime(220, t + 0.5);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.onended = cleanup(osc, gain);
    osc.start(t);
    osc.stop(t + 0.6);
  },

  tick(ac) {
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.onended = cleanup(osc, gain);
    osc.start(t);
    osc.stop(t + 0.03);
  },
};

export function playSound(enabled: boolean, type: SoundType): void {
  if (!enabled) return;
  try {
    const ac = getCtx();
    SYNTHS[type](ac);
  } catch {
    // Silently ignore if AudioContext is unavailable or blocked
  }
}
