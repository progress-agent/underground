// mode-sfx.js: non-spatial procedural sound for the conveyance modes
// (sprint 23Sep26w, D-037, lane A1). Jordan: "not spatial at all, they sound
// the same wherever you are". Everything here is synthesised from noise and
// oscillators and routed straight into audio.js's MASTER bus, bypassing the
// spatial PannerNode pool, the ambient bus and its underground low-pass. The
// master gain carries mute, volume and tab-visibility, so all three are
// respected with no extra plumbing.
//
// ─── API (modes drive it from physics state) ────────────────────────────────
//
//   const sfx = createModeSfx({ getMasterBus });   // () => { ctx, input } | null
//
//   Continuous voices: call every frame with the current state; they glide.
//     sfx.footsteps(speedMps)       ground speed in m/s; 0 stops. Cadence and weight follow speed.
//     sfx.jetpack(thrust)           0..1 roar
//     sfx.droneWhine(speedMps)      rotor whine; idle hum at 0, pitch rises with speed
//     sfx.burner(on)                balloon burner roar, boolean (or 0..1)
//   One-shots: call on the event.
//     sfx.splash(intensity = 1)     entering water
//     sfx.strokes(intensity = 1)    one muffled swim stroke
//   Housekeeping:
//     sfx.silence()                 fade every continuous voice out (the registry calls it on mode switch)
//     sfx.ready                     true once the audio graph exists (first user gesture)
//
// Calls before audio has started (no user gesture yet) are cheap no-ops, so a
// mode never needs to check. Nothing allocates per frame once the graph is
// built; one-shots allocate a few short-lived nodes, which is the WebAudio
// norm.

const GLIDE = 0.06;       // seconds, setTargetAtTime constant for continuous voices
const BUS_LEVEL = 0.55;   // overall mode-SFX level into the master bus

export function createModeSfx({ getMasterBus = () => null } = {}) {
  let g = null; // built graph

  function build() {
    if (g) return g;
    const bus = getMasterBus();
    if (!bus?.ctx || !bus?.input) return null;
    const ctx = bus.ctx;
    const out = ctx.createGain();
    out.gain.value = BUS_LEVEL;
    out.connect(bus.input);

    // Two seconds of white noise shared by every voice.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    // Deterministic LCG: the texture is identical every session.
    let s = 0x9e3779b9;
    for (let i = 0; i < data.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      data[i] = (s / 4294967296) * 2 - 1;
    }
    const loopNoise = (rate = 1) => {
      const src = ctx.createBufferSource();
      src.buffer = noise; src.loop = true; src.playbackRate.value = rate;
      src.start();
      return src;
    };

    // Jetpack: low-passed noise roar plus a sub rumble.
    const jetGain = ctx.createGain(); jetGain.gain.value = 0;
    const jetLP = ctx.createBiquadFilter(); jetLP.type = 'lowpass'; jetLP.frequency.value = 300; jetLP.Q.value = 0.7;
    loopNoise(1).connect(jetLP).connect(jetGain).connect(out);
    const jetSub = ctx.createOscillator(); jetSub.type = 'sawtooth'; jetSub.frequency.value = 42;
    const jetSubLP = ctx.createBiquadFilter(); jetSubLP.type = 'lowpass'; jetSubLP.frequency.value = 140;
    const jetSubGain = ctx.createGain(); jetSubGain.gain.value = 0;
    jetSub.connect(jetSubLP).connect(jetSubGain).connect(out); jetSub.start();

    // Drone: two detuned square rotors through a band-pass, plus prop hiss.
    const droneGain = ctx.createGain(); droneGain.gain.value = 0;
    const droneBP = ctx.createBiquadFilter(); droneBP.type = 'bandpass'; droneBP.frequency.value = 900; droneBP.Q.value = 1.2;
    const rotorA = ctx.createOscillator(); rotorA.type = 'square'; rotorA.frequency.value = 180;
    const rotorB = ctx.createOscillator(); rotorB.type = 'sawtooth'; rotorB.frequency.value = 183;
    rotorA.connect(droneBP); rotorB.connect(droneBP); rotorA.start(); rotorB.start();
    droneBP.connect(droneGain).connect(out);
    const hissHP = ctx.createBiquadFilter(); hissHP.type = 'highpass'; hissHP.frequency.value = 2500;
    const hissGain = ctx.createGain(); hissGain.gain.value = 0;
    loopNoise(1.3).connect(hissHP).connect(hissGain).connect(out);

    // Burner: band-limited roar with a slow flutter.
    const burnGain = ctx.createGain(); burnGain.gain.value = 0;
    const burnLP = ctx.createBiquadFilter(); burnLP.type = 'lowpass'; burnLP.frequency.value = 700; burnLP.Q.value = 0.9;
    const burnHP = ctx.createBiquadFilter(); burnHP.type = 'highpass'; burnHP.frequency.value = 90;
    loopNoise(0.8).connect(burnHP).connect(burnLP).connect(burnGain).connect(out);
    const flutter = ctx.createOscillator(); flutter.frequency.value = 7.5;
    const flutterDepth = ctx.createGain(); flutterDepth.gain.value = 0;
    flutter.connect(flutterDepth).connect(burnGain.gain); flutter.start();

    g = { ctx, out, noise, jetGain, jetLP, jetSubGain, droneGain, droneBP, rotorA, rotorB, hissGain,
      burnGain, flutterDepth, nextStep: 0, stepFoot: 0, shot: 0 };
    return g;
  }

  const glide = (param, v, graph) => param.setTargetAtTime(v, graph.ctx.currentTime, GLIDE);

  function oneShot(graph, { dur, gain, filter = 'lowpass', f0, f1, q = 0.8, rate = 1, delay = 0 }) {
    const { ctx } = graph;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = graph.noise; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = filter; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(env).connect(graph.out);
    // Golden-ratio walk through the buffer: varied texture, no randomness.
    graph.shot = (graph.shot + 0.6180339887) % 1;
    src.start(t, graph.shot * 1.5, dur + 0.05);
    src.onended = () => { src.disconnect(); f.disconnect(); env.disconnect(); };
  }

  function thump(graph, { freq, dur, gain, delay = 0 }) {
    const { ctx } = graph;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.5);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(graph.out);
    osc.start(t); osc.stop(t + dur + 0.02);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
  }

  return {
    get ready() { return !!(g || build()); },

    footsteps(speedMps) {
      const graph = build();
      if (!graph) return;
      const v = Math.max(0, Number(speedMps) || 0);
      const now = graph.ctx.currentTime;
      if (v < 0.4) { graph.nextStep = 0; return; }
      // Walk ~1.8 steps/s at 1.4 m/s, sprint ~3.2 steps/s at 7 m/s.
      const rate = Math.min(3.4, 1.4 + v * 0.26);
      if (graph.nextStep === 0) graph.nextStep = now + 0.08;
      if (now < graph.nextStep) return;
      graph.nextStep = now + 1 / rate;
      const weight = Math.min(1, 0.35 + v / 9);
      const side = (graph.stepFoot ^= 1) ? 1 : 0.86; // alternate feet, slightly uneven
      oneShot(graph, { dur: 0.09, gain: 0.32 * weight * side, filter: 'bandpass', f0: 1400, f1: 500, q: 1.1, rate: 1.1 });
      thump(graph, { freq: 70, dur: 0.11, gain: 0.45 * weight * side });
    },

    jetpack(thrust) {
      const graph = build();
      if (!graph) return;
      const k = Math.min(1, Math.max(0, Number(thrust) || 0));
      glide(graph.jetGain.gain, 0.5 * Math.pow(k, 1.3), graph);
      glide(graph.jetLP.frequency, 260 + 1700 * k, graph);
      glide(graph.jetSubGain.gain, 0.22 * k, graph);
    },

    droneWhine(speedMps) {
      const graph = build();
      if (!graph) return;
      const v = Math.max(0, Number(speedMps) || 0);
      const k = Math.min(1, v / 40);
      const f = 170 + v * 8;
      glide(graph.rotorA.frequency, f, graph);
      glide(graph.rotorB.frequency, f * 1.017, graph);
      glide(graph.droneBP.frequency, 700 + 1400 * k, graph);
      glide(graph.droneGain.gain, 0.05 + 0.13 * k, graph);
      glide(graph.hissGain.gain, 0.015 + 0.06 * k, graph);
    },

    burner(on) {
      const graph = build();
      if (!graph) return;
      const k = on === true ? 1 : Math.min(1, Math.max(0, Number(on) || 0));
      glide(graph.burnGain.gain, 0.42 * k, graph);
      glide(graph.flutterDepth.gain, 0.08 * k, graph);
    },

    splash(intensity = 1) {
      const graph = build();
      if (!graph) return;
      const k = Math.min(1.5, Math.max(0.1, Number(intensity) || 1));
      oneShot(graph, { dur: 0.7, gain: 0.5 * k, filter: 'bandpass', f0: 2600, f1: 280, q: 0.6, rate: 0.9 });
      oneShot(graph, { dur: 0.35, gain: 0.25 * k, filter: 'highpass', f0: 3000, f1: 1200, q: 0.5, rate: 1.4, delay: 0.03 });
      thump(graph, { freq: 55, dur: 0.25, gain: 0.35 * k });
    },

    strokes(intensity = 1) {
      const graph = build();
      if (!graph) return;
      const k = Math.min(1.5, Math.max(0.1, Number(intensity) || 1));
      // Heard from inside the water: all low end, soft attack.
      oneShot(graph, { dur: 0.42, gain: 0.3 * k, filter: 'lowpass', f0: 520, f1: 160, q: 0.9, rate: 0.6 });
    },

    silence() {
      if (!g) return;
      for (const p of [g.jetGain.gain, g.jetSubGain.gain, g.droneGain.gain, g.hissGain.gain,
        g.burnGain.gain, g.flutterDepth.gain]) glide(p, 0, g);
      g.nextStep = 0;
    },

    // Test hook: current continuous-voice targets (0 when the graph is absent).
    levels() {
      if (!g) return null;
      return { jetpack: g.jetGain.gain.value, drone: g.droneGain.gain.value, burner: g.burnGain.gain.value };
    },
  };
}
