/* =========================================================
   Saccade · Hear your poster
   Turns the predicted eye path into a short piece of music:
     - each eye stop is a note
     - higher on the poster = higher note
     - bigger / stronger spot = louder
     - if the eye reaches your message early, the piece RESOLVES
       on a warm major chord; if it arrives late or never, it ends
       unresolved. Good visual composition = good musical composition.
   Web Audio only, no files needed.
   ========================================================= */

const SACCADE_SOUND = (() => {
  // C major pentatonic across two octaves: always sounds pleasant
  const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];
  let ctx = null;

  function note(freq, start, dur, vol, type = "triangle") {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, start + dur);
    o.connect(g).connect(ctx.destination);
    o.start(start); o.stop(start + dur + 0.05);
  }
  function chord(freqs, start, dur, vol) { freqs.forEach(f => note(f, start, dur, vol / freqs.length, "sine")); }

  /* path: [{x, y, label}], targetIndex: where the message is (-1 = never), onStep(i) for the visual */
  function play(path, targetIndex, onStep) {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    const t0 = ctx.currentTime + 0.1, step = 0.42;
    path.forEach((p, i) => {
      const idx = Math.round((1 - p.y / 100) * (SCALE.length - 1));          // top of poster = high note
      const isMsg = i === targetIndex;
      note(SCALE[idx], t0 + i * step, isMsg ? 0.9 : 0.5, isMsg ? 0.35 : 0.22, isMsg ? "sine" : "triangle");
      if (isMsg) note(SCALE[idx] * 2, t0 + i * step, 0.9, 0.08, "sine");       // a little shimmer on your message
      if (onStep) setTimeout(() => onStep(i), (0.1 + i * step) * 1000);
    });
    const end = t0 + path.length * step + 0.1;
    const resolved = targetIndex === 0 || targetIndex === 1;
    if (resolved) chord([261.63, 329.63, 392.0, 523.25], end, 1.8, 0.5);           // C major: resolved, happy
    else chord([261.63, 349.23, 392.0, 466.16], end, 1.8, 0.45);                    // C7sus4: unresolved, waiting
    if (onStep) setTimeout(() => onStep(-1, resolved), (end - ctx.currentTime) * 1000);
    return resolved;
  }
  return { play };
})();
