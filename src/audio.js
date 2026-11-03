// Procedural ambience, no audio files: engine hum and wind follow the speed, crickets join at night.
let ac, nodes;

function noise() {
  const buffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const d = buffer.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = new AudioBufferSourceNode(ac, { buffer, loop: true });
  src.start();
  return src;
}

// Square LFO swinging `gain` (base 0.5) between 0 and 1 at `hz`.
function gate(gain, hz) {
  const lfo = new OscillatorNode(ac, { type: 'square', frequency: hz });
  lfo.connect(new GainNode(ac, { gain: 0.5 })).connect(gain.gain);
  lfo.start();
  return gain;
}

function build() {
  ac = new AudioContext();
  const out = new GainNode(ac);
  out.connect(ac.destination);
  const [engine, wind, bugs] = [0, 0, 0].map((gain) => new GainNode(ac, { gain }));
  const tone = new BiquadFilterNode(ac, { type: 'lowpass', frequency: 200 });
  const oscs = [0, 9].map((detune) => {
    const o = new OscillatorNode(ac, { type: 'sawtooth', frequency: 40, detune });
    o.connect(tone);
    o.start();
    return o;
  });
  tone.connect(engine).connect(out);
  noise().connect(new BiquadFilterNode(ac, { type: 'bandpass', frequency: 420, Q: 0.6 })).connect(wind).connect(out);
  // Two crickets: a 30 Hz trill chopped into chirps at slightly different rates.
  for (const [hz, rate] of [[4400, 2.6], [4900, 1.9]]) {
    const o = new OscillatorNode(ac, { frequency: hz });
    o.start();
    o.connect(gate(new GainNode(ac, { gain: 0.5 }), 30)).connect(gate(new GainNode(ac, { gain: 0.5 }), rate)).connect(bugs);
  }
  bugs.connect(out);
  nodes = { out, engine, wind, bugs, oscs };
}

/** The first `sound(true)` must run inside a click / key handler: mobile browsers only start audio then. */
export function sound(on) {
  if (on && !ac) build();
  ac?.[on ? 'resume' : 'suspend']().catch(() => {});
}

/** Per frame: v in m/s. */
export function updateAudio(v, night) {
  if (ac?.state !== 'running') return;
  const { engine, wind, bugs, oscs } = nodes, t = ac.currentTime, x = Math.min(Math.abs(v) / 30, 1);
  for (const o of oscs) o.frequency.setTargetAtTime(38 + x * 52, t, 0.3);
  engine.gain.setTargetAtTime(0.06 + x * 0.06, t, 0.3);
  wind.gain.setTargetAtTime(0.02 + x * x * 0.22, t, 0.5);
  bugs.gain.setTargetAtTime(night ? 0.018 : 0, t, 1);
}

export const audioDebug = () => ac && { state: ac.state, ...nodes };
