// Engine hum synthesised with Web Audio; a CC0 lofi track fades in after a minute of driving.
export const BGM = { src: 'chill-lofi.mp3', title: 'Chill Lofi Inspired', artist: 'omfgdude' };
const BGM_AFTER = 60, BGM_LEVEL = 0.3;
let ac, nodes, driven = 0, bgm = null;

function build() {
  ac = new AudioContext();
  const out = new GainNode(ac);
  out.connect(ac.destination);
  const engine = new GainNode(ac, { gain: 0 });
  const tone = new BiquadFilterNode(ac, { type: 'lowpass', frequency: 200 });
  const oscs = [0, 9].map((detune) => {
    const o = new OscillatorNode(ac, { type: 'sawtooth', frequency: 40, detune });
    o.connect(tone);
    o.start();
    return o;
  });
  tone.connect(engine).connect(out);
  nodes = { out, engine, oscs, music: new GainNode(ac, { gain: 0 }) };
  nodes.music.connect(out);
}

// Decoded into memory (~40 MB for 2 min) rather than an <audio> element: it shares the mute / graph,
// loops gaplessly, and avoids Range-request trouble with the service-worker cache on Safari.
async function startBgm(onStart) {
  bgm = true;
  let buffer;
  try {
    buffer = await ac.decodeAudioData(await (await fetch(BGM.src)).arrayBuffer());
  } catch {
    bgm = null; // offline before it was cached, or decode failed: try again after another minute
    driven = 0;
    return;
  }
  const src = new AudioBufferSourceNode(ac, { buffer, loop: true });
  src.connect(nodes.music);
  src.start();
  const g = nodes.music.gain, t = ac.currentTime;
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(BGM_LEVEL, t + 8);
  onStart();
}

/** The first `sound(true)` must run inside a click / key handler: mobile browsers only start audio then. */
export function sound(on) {
  if (on && !ac) build();
  ac?.[on ? 'resume' : 'suspend']().catch(() => {});
}

/** Per frame: v in m/s. `onBgm` runs when the music starts. */
export function updateAudio(v, dt, onBgm) {
  if (Math.abs(v) > 1) driven += dt;
  if (ac?.state !== 'running') return;
  if (driven >= BGM_AFTER && !bgm) startBgm(onBgm);
  const { engine, oscs } = nodes, t = ac.currentTime, x = Math.min(Math.abs(v) / 30, 1);
  for (const o of oscs) o.frequency.setTargetAtTime(38 + x * 52, t, 0.3);
  engine.gain.setTargetAtTime(0.06 + x * 0.06, t, 0.3);
}

export const bgmPlaying = () => bgm === true && nodes.music.gain.value > 0;
export const audioDebug = () => ac && { state: ac.state, driven, ...nodes };
