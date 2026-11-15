/* =========================================================
   Saccade · frontend logic (D)
   ========================================================= */

/* ---------- CONFIG: change these at integration ---------- */
// Fake data by default. Add ?live to the address to use C's real API:
//   index.html?live                                  -> http://localhost:8000/analyse
//   index.html?live&api=http://192.168.1.20:8000     -> another laptop on the same wifi
const params   = new URLSearchParams(location.search);
const USE_FAKE = !params.has("live");
const API_URL  = (params.get("api") || "http://localhost:8000") + "/analyse";

// Max points per check. Must match the backend (see README).
const MAX = { focal_match: 25, focal_point: 15, legibility: 15, contrast: 15, clutter: 15, balance: 15 };
const NAMES = {
  focal_match: "Eye reaches your message", focal_point: "Clear focal point", legibility: "Readable on a phone",
  contrast: "Contrast", clutter: "Breathing space", balance: "Balance and alignment"
};
const SHORT = { focal_match: "Eye path", focal_point: "Focal point", legibility: "Phone", contrast: "Contrast", clutter: "Space", balance: "Balance" };
const HEX_ORDER = ["focal_match", "focal_point", "legibility", "contrast", "clutter", "balance"];

// Grades always use a shape + a word, not colour alone (colour-blind friendly)
const GRADES = [
  { min: 0.85, sym: "✓", word: "Ready to launch", col: "var(--good)", cls: "" },
  { min: 0.65, sym: "◆", word: "Almost there",    col: "var(--ok)",   cls: "" },
  { min: 0.40, sym: "▲", word: "Needs work",      col: "var(--warn)", cls: "" },
  { min: 0,    sym: "✕", word: "Will be ignored", col: "var(--bad)",  cls: "bad" }
];
const gradeOf = (ratio) => GRADES.find(g => ratio >= g.min);
// per-check grades are a little stricter than the overall band
const checkGrade = (ratio) => ratio >= 0.75 ? GRADES[0] : ratio >= 0.5 ? GRADES[1] : ratio >= 0.35 ? GRADES[2] : GRADES[3];

/* ---------- FAKE RESULT (same format C returns) ---------- */
function fakeResult(objective) {
  return {
    objective: objective || "50% off",
    elements: [
      { label: "logo",     box: [6, 4, 88, 10] },
      { label: "photo",    box: [6, 19, 88, 45] },
      { label: "headline", box: [6, 67, 55, 10] },
      { label: "offer",    box: [66, 92, 31, 4] }
    ],
    eye_path: [
      { label: "logo", x: 50, y: 9 }, { label: "photo", x: 50, y: 46 },
      { label: "headline", x: 30, y: 71 }, { label: "offer", x: 81, y: 94 }
    ],
    target: "offer",
    subscores: { focal_match: 5, focal_point: 8, legibility: 6, contrast: 12, clutter: 7, balance: 11 },
    explanations: {
      focal_match: "Your offer comes 4th. Most people scroll past first.",
      focal_point: "The logo and photo fight for attention.",
      legibility: "\"50% off\" is too small at phone size.",
      contrast: "Most text stands out. The offer is a bit faint.",
      clutter: "The bottom of the poster feels crowded.",
      balance: "Neat left edge. Nicely organised."
    },
    potential: { focal_match: 25, focal_point: 13, legibility: 12, contrast: 14, clutter: 12, balance: 13 },
    problems: [
      "Your offer is seen 4th. Make it 3× bigger and move it to the top.",
      "The logo is the 1st thing people see. Make it half the size.",
      "Nice headline, but a little small to read on a phone."
    ],
    fixes: [],
    reading_level: { age: 9, words: 9, seconds: 2, hard_words: 0 },
    colour_blind: { protan: "check", deutan: "pass", tritan: "pass" }
  };
}

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const matches = (a, b) => { a = (a || "").toLowerCase(); b = (b || "").toLowerCase(); return !!a && !!b && (a.includes(b) || b.includes(a)); };
let imageFile = null, imageURL = null, lastResult = null, gazeTimer = null;
let isExample = false, targetPt = null, showingFixed = false, originalURL = null;

/* ---------- 2 · upload ---------- */
const dz = $("dropzone");
$("chooseBtn").onclick = () => $("fileInput").click();
$("cameraBtn").onclick = () => $("cameraInput").click();
$("fileInput").onchange = (e) => setFile(e.target.files[0]);
$("cameraInput").onchange = (e) => setFile(e.target.files[0]);
["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
dz.addEventListener("drop", e => setFile(e.dataTransfer.files[0]));

function setFile(file, example = false) {
  if (!file || !file.type.startsWith("image/")) { alert("Please choose an image (PNG or JPG)."); return; }
  imageFile = file; isExample = example; targetPt = null; showingFixed = false;
  if (imageURL) URL.revokeObjectURL(imageURL);
  imageURL = URL.createObjectURL(file); originalURL = imageURL;
  $("dropPreview").src = imageURL;
  $("tapWrap").hidden = false; $("tapHint").hidden = example; $("tapStar").hidden = true;
  $("dropIcon").hidden = true;
  $("dropTitle").textContent = file.name || "Your poster";
  updateButton();
}
// tap where your message is (gives the score an exact target)
$("dropPreview").addEventListener("click", (e) => {
  const r = e.target.getBoundingClientRect();
  targetPt = { x: (e.clientX - r.left) / r.width * 100, y: (e.clientY - r.top) / r.height * 100 };
  const s = $("tapStar"); s.hidden = false; s.style.left = targetPt.x + "%"; s.style.top = targetPt.y + "%";
  $("tapHint").textContent = "★ Got it. That's your message. Tap again to move it.";
});
document.querySelectorAll(".chip").forEach(chip => chip.onclick = () => {
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("on"));
  chip.classList.add("on");
  $("goal").value = chip.textContent.replace(/^(the|our)\s+/i, "");
  updateButton();
});
$("goal").oninput = updateButton;
// coming back from the "Not sure what to say?" page: fill in the message for them
if (params.get("notice")) { $("goal").value = params.get("notice"); }
function updateButton() { $("checkBtn").disabled = !(imageFile && $("goal").value.trim()); }

// "See an example" / "Try our example": loads the sample poster
document.querySelectorAll(".js-example").forEach(b => b.onclick = async () => {
  const blob = await (await fetch("sample-poster.png")).blob();
  setFile(new File([blob], "bloom-cafe-sample.png", { type: "image/png" }), true);
  $("goal").value = "50% off";
  updateButton();
  analyse();
});

/* ---------- analyse ---------- */
$("checkBtn").onclick = analyse;
const STEPS_TEXT = ["Reading your poster…", "Predicting where eyes go…", "Scoring the composition…", "Writing your fixes…"];
const BACKEND_TIMEOUT_MS = 25000;   // after this, use the quick in-browser check so the demo never dies

async function analyse() {
  const objective = $("goal").value.trim();
  $("resultsBox").classList.remove("show");
  $("loading").classList.add("show");
  let s = 0; $("loadingText").textContent = STEPS_TEXT[0];
  const ticker = setInterval(() => { s = Math.min(s + 1, STEPS_TEXT.length - 1); $("loadingText").textContent = STEPS_TEXT[s]; }, 1600);
  $("results").scrollIntoView({ behavior: "smooth" });
  try {
    let r;
    if (USE_FAKE) {
      await wait(1800);
      r = isExample ? fakeResult(objective) : await SACCADE_LOCAL.analyse(imageURL, objective, targetPt);
    } else {
      try {
        const form = new FormData();
        form.append("image", imageFile);
        form.append("objective", objective);
        if (targetPt) { form.append("target_x", targetPt.x.toFixed(1)); form.append("target_y", targetPt.y.toFixed(1)); }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), BACKEND_TIMEOUT_MS);
        const res = await fetch(API_URL, { method: "POST", body: form, signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error("API error " + res.status);
        r = await res.json();
      } catch (apiErr) {
        console.warn("Backend unavailable, using the in-browser check:", apiErr);
        r = await SACCADE_LOCAL.analyse(imageURL, objective, targetPt);
        r.fallback = true;
      }
    }
    lastResult = r;
    clearInterval(ticker);
    $("loading").classList.remove("show");
    $("resultsBox").classList.add("show");
    render(r, objective);
  } catch (err) {
    clearInterval(ticker);
    console.error(err);
    $("loadingText").textContent = "Something went wrong reading that poster. Please try another image.";
  }
}

/* ---------- composition tools: music, thirds grid, before/after ---------- */
$("gridBtn").onclick = () => {
  const g = $("thirds"), on = g.hasAttribute("hidden");
  if (on) g.removeAttribute("hidden"); else g.setAttribute("hidden", "");
  $("gridBtn").setAttribute("aria-pressed", on ? "true" : "false");
  $("gridBtn").textContent = on ? "▦ Hide grid" : "▦ Thirds grid";
};
$("hearBtn").onclick = () => {
  if (!lastResult) return;
  const r = lastResult, path = r.eye_path || [];
  const targetLabel = r.target || (r.elements || []).find(e => e.is_target)?.label || (r.elements || []).find(e => matches(e.label, $("goal").value))?.label;
  const ti = path.findIndex(p => matches(p.label, targetLabel));
  const markers = [...document.querySelectorAll(".marker")];
  const box = $("musicBox"); box.hidden = false;
  box.innerHTML = `<div class="fix-tag" style="color: var(--accent)">🎵 Playing your poster…</div><p>Each note is a place the eye stops. Higher on the poster = higher note.</p>`;
  SACCADE_SOUND.play(path, ti, (i, resolved) => {
    markers.forEach(m => m.classList.remove("ping"));
    if (i >= 0 && markers[i]) markers[i].classList.add("ping");
    if (i === -1) box.innerHTML = resolved
      ? `<div class="fix-tag" style="color: var(--good)">✓ It resolves</div><p>The eye reaches your message early, so the music lands on a warm, finished chord. That's good composition.</p>`
      : `<div class="fix-tag" style="color: var(--warn)">▲ It doesn't resolve</div><p>The eye reaches your message too late (or never), so the music hangs unfinished. Fix the composition and hear it resolve.</p>`;
  });
};
$("fixedBtn").onclick = async () => {
  showingFixed = !showingFixed;
  imageURL = showingFixed ? "sample-poster-fixed.png" : originalURL;
  const r = showingFixed ? fixedResult() : fakeResult("50% off");
  lastResult = r;
  render(r, "50% off");
  $("fixedBtn").textContent = showingFixed ? "↺ Show the original" : "✨ Show the fixed poster";
};
function fixedResult() {
  return {
    objective: "50% off", target: "offer",
    elements: [{ label: "offer", box: [6, 4, 88, 21] }, { label: "photo", box: [6, 28, 88, 39] }, { label: "headline", box: [6, 71, 55, 10] }, { label: "logo", box: [70, 91, 25, 4] }],
    eye_path: [{ label: "offer", x: 50, y: 13 }, { label: "photo", x: 50, y: 48 }, { label: "headline", x: 30, y: 75 }, { label: "logo", x: 82, y: 93 }],
    subscores: { focal_match: 25, focal_point: 13, legibility: 12, contrast: 13, clutter: 11, balance: 12 },
    explanations: {
      focal_match: "The offer is now the 1st thing people see.", focal_point: "One clear winner: the big offer block.",
      legibility: "\"50% OFF\" is readable even at phone size.", contrast: "Cream on cherry red stands out strongly.",
      clutter: "Calm layout with room to breathe.", balance: "Heavy top, calm bottom. It feels intentional."
    },
    problems: ["Looks great. Optional: make the date a little bigger."], fixes: [],
    reading_level: { age: 8, words: 11, seconds: 2, hard_words: 0 },
    colour_blind: { protan: "pass", deutan: "pass", tritan: "pass" }
  };
}

/* ---------- 3 · results ---------- */
function render(r, objective) {
  const subs = r.subscores || {};
  const total = r.total ?? Object.values(subs).reduce((a, b) => a + b, 0);
  const g = gradeOf(total / 100);

  // header
  $("resGoal").textContent = objective || r.objective;
  const worst = Object.keys(subs).filter(k => subs[k] / (MAX[k] || 15) < 0.5).length;
  $("resTitle").innerHTML = total >= 85
    ? `Ready to go. <span class="serif">People will notice.</span>`
    : `Fix ${Math.max(1, Math.min(worst, 3))} thing${worst === 1 ? "" : "s"} and you'll <span class="serif">get noticed.</span>`;
  const ring = $("ring");
  ring.style.setProperty("--col", g.col);
  countUp($("total"), total, v => ring.style.setProperty("--pct", v));
  const badge = $("bandBadge");
  badge.textContent = `${g.sym} ${g.word}`; badge.style.background = g.col; badge.className = "badge " + g.cls;
  if (r.potential) {
    const pt = Object.values(r.potential).reduce((a, b) => a + b, 0);
    const pg = gradeOf(pt / 100);
    $("potential").innerHTML = `After the fixes: about <b style="color: ${pg.col}">${pg.sym} ${pt}</b>`;
  } else $("potential").textContent = "";

  renderAnnotations(r, objective);
  renderBreakdown(r);
  saveForGlanceTest(r, objective);
  $("fixedBtn").hidden = !isExample;
  $("musicBox").hidden = true;
  const ln = $("localNote");
  ln.hidden = !r.local;
  if (r.local) ln.innerHTML = `<div class="fix-tag" style="color: var(--label)">⚡ Quick in-browser check</div><p>${r.fallback ? "Our AI server was busy, so this" : "This"} result comes from the quick check in your browser (contrast, colour, edges and the "people look at the middle first" effect).${targetPt ? "" : " Tap your message on the poster before checking for a more accurate score."}</p>`;
  renderHexagon(r);
  renderAccessibility(r);
}

function countUp(el, target, onStep) {
  let n = 0; const step = Math.max(1, Math.round(target / 30));
  const t = setInterval(() => { n = Math.min(target, n + step); el.textContent = n; onStep && onStep(n); if (n >= target) clearInterval(t); }, 30);
}

/* keep a small copy of the poster + result so glance.html can test it on real eyes */
function saveForGlanceTest(r, objective) {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 900 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    try { sessionStorage.setItem("saccade:last", JSON.stringify({ image: c.toDataURL("image/jpeg", 0.85), objective, result: r })); } catch (e) {}
  };
  img.src = imageURL;
}

/* annotated poster: eye path boxes, "fix here" pins, moving gaze dot */
function renderAnnotations(r, objective) {
  $("annotImg").src = imageURL;
  const path = r.eye_path || [];
  const targetLabel = r.target || (r.elements || []).find(e => e.is_target)?.label || (r.elements || []).find(e => matches(e.label, objective))?.label;
  const isTarget = (label) => matches(label, targetLabel);

  $("pathLine").setAttribute("points", path.map(p => `${p.x},${p.y}`).join(" "));
  const box = $("markers"); box.innerHTML = "";
  path.forEach((p, i) => {
    const m = document.createElement("div");
    m.className = "marker" + (isTarget(p.label) ? " target" : "");
    m.style.left = p.x + "%"; m.style.top = p.y + "%";
    m.innerHTML = `0${i + 1}<i></i><i></i><i></i><i></i>`;
    box.appendChild(m);
    const l = document.createElement("div");
    l.className = "marker-label";
    const right = p.x < 70;
    l.style.top = p.y + "%";
    l.style[right ? "left" : "right"] = right ? `calc(${p.x}% + 24px)` : `calc(${100 - p.x}% + 24px)`;
    l.textContent = (isTarget(p.label) ? "★ " : "") + (p.label || "");
    box.appendChild(l);
    setTimeout(() => m.classList.add("show"), 400 + i * 350);
  });

  // "fix here" pins: on your message (if it's not seen early) and on whatever is stealing attention
  const pins = [];
  const tIdx = path.findIndex(p => isTarget(p.label));
  if (tIdx === -1 || tIdx > 1) {
    const t = tIdx >= 0 ? path[tIdx] : null;
    if (t) pins.push({ x: t.x, y: t.y });
    if (path[0] && !isTarget(path[0].label)) pins.push({ x: path[0].x, y: path[0].y });
  }
  pins.forEach((p, i) => {
    const pin = document.createElement("div");
    pin.className = "pin"; pin.textContent = i + 1;
    pin.style.left = `calc(${p.x}% + 22px)`; pin.style.top = `calc(${p.y}% - 22px)`;
    pin.setAttribute("aria-label", `Fix ${i + 1}`);
    box.appendChild(pin);
  });

  // fix list
  const problems = (r.problems || []).concat(r.fixes || []);
  const colours = ["var(--bad)", "var(--warn)", "var(--ok)"];
  const syms = ["①", "②", "③", "④", "⑤"];
  const great = Object.values(r.subscores || {}).reduce((x, y) => x + y, 0) >= 85;
  $("fixList").innerHTML = problems.slice(0, 4).map((t, i) => `
    <div class="fix glass">
      <div class="fix-tag" style="color: ${great ? "var(--good)" : colours[Math.min(i, 2)]}">${great ? "✓ Optional" : `${syms[i]} ${i < pins.length ? "Fix here" : "Also try"}`}</div>
      <p>${esc(t)}</p>
    </div>`).join("") || `<div class="fix glass"><div class="fix-tag" style="color: var(--good)">✓ Looks great</div><p>No big problems found.</p></div>`;

  startGaze(path);
}

function startGaze(path) {
  clearInterval(gazeTimer);
  const g = $("gaze");
  if (!path.length) { g.hidden = true; return; }
  g.hidden = false;
  let i = 0;
  const move = () => { const p = path[i % path.length]; g.style.left = p.x + "%"; g.style.top = p.y + "%"; i++; };
  move();
  gazeTimer = setInterval(move, 1100);
}
$("replayPath").onclick = () => lastResult && renderAnnotations(lastResult, $("goal").value.trim());

/* score breakdown: worst first, with a short explanation */
function renderBreakdown(r) {
  const subs = r.subscores || {};
  const why = r.explanations || {};
  const rows = Object.keys(subs).map(k => ({ k, v: subs[k], mx: MAX[k] || 15, ratio: subs[k] / (MAX[k] || 15) }))
    .sort((a, b) => a.ratio - b.ratio);
  $("bdRows").innerHTML = rows.map(({ k, v, mx, ratio }) => {
    const g = checkGrade(ratio);
    return `<div class="bd-row">
      <div class="bd-name"><span class="sym ${g.cls}" style="background: ${g.col}" aria-label="${g.word}">${g.sym}</span>${NAMES[k] || k}</div>
      <div class="bd-bar"><div class="track"><div class="fill" data-w="${Math.round(ratio * 100)}" style="background: ${g.col}; box-shadow: 0 0 14px ${g.col}"></div></div><b style="width: 52px; text-align: right">${v}/${mx}</b></div>
      <div class="bd-why">${esc(why[k] || "")}</div>
    </div>`;
  }).join("");
  requestAnimationFrame(() => setTimeout(() => document.querySelectorAll(".fill").forEach(f => f.style.width = f.dataset.w + "%"), 60));
}

/* hexagon "character stats" */
function renderHexagon(r) {
  const cx = 180, cy = 180, R = 120;
  const pt = (i, v) => { const a = (-90 + i * 60) * Math.PI / 180; return [cx + R * v * Math.cos(a), cy + R * v * Math.sin(a)]; };
  const vals = (s) => HEX_ORDER.map(k => (s[k] || 0) / (MAX[k] || 15));
  const poly = (v) => v.map((x, i) => pt(i, x).map(n => n.toFixed(1)).join(",")).join(" ");
  const now = vals(r.subscores || {});
  let svg = "";
  [0.25, 0.5, 0.75, 1].forEach(s => svg += `<polygon points="${poly(Array(6).fill(s))}" fill="none" stroke="rgba(255,255,255,0.16)"/>`);
  for (let i = 0; i < 6; i++) { const [x, y] = pt(i, 1); svg += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(255,255,255,0.14)"/>`; }
  if (r.potential) {
    const after = vals(r.potential);
    svg += `<polygon points="${poly(after)}" fill="rgba(48,209,88,0.16)" stroke="#30D158" stroke-width="2"/>`;
    after.forEach((v, i) => { const [x, y] = pt(i, v); svg += `<circle cx="${x}" cy="${y}" r="4.5" fill="#30D158"/>`; });
  }
  svg += `<polygon points="${poly(now)}" fill="rgba(255,159,10,0.28)" stroke="#FF9F0A" stroke-width="2.5" stroke-dasharray="6 4"/>`;
  now.forEach((v, i) => { const [x, y] = pt(i, v); svg += `<polygon points="${x},${y - 6} ${x + 6},${y + 5} ${x - 6},${y + 5}" fill="#FF9F0A"/>`; });
  HEX_ORDER.forEach((k, i) => {
    const [x, y] = pt(i, 1.24);
    const anchor = i === 0 || i === 3 ? "middle" : (i < 3 ? "start" : "end");
    svg += `<text x="${x}" y="${y + 4}" text-anchor="${anchor}" fill="#F7EEDC" font-size="13" font-weight="600" font-family="Inter, sans-serif">${SHORT[k]}</text>`;
  });
  const total = Object.values(r.subscores || {}).reduce((a, b) => a + b, 0);
  $("hex").innerHTML = `<svg viewBox="0 0 360 360" role="img" aria-label="Score shape for your poster. Bigger is better.">${svg}</svg>`;
  $("hexLegend").innerHTML = `<span><span style="color: #FF9F0A">▲</span> - - Now (${total})</span>` +
    (r.potential ? `<span><span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #30D158"></span> ── After fixes (${Object.values(r.potential).reduce((a, b) => a + b, 0)})</span>` : "");
}

/* accessibility: colour-blind views + reading level */
function renderAccessibility(r) {
  const cb = r.colour_blind || {};
  const views = [
    { name: "Normal vision", filter: "", key: null },
    { name: "Red-blind", filter: "url(#cbP)", key: "protan" },
    { name: "Green-blind", filter: "url(#cbD)", key: "deutan" },
    { name: "Blue-blind", filter: "url(#cbT)", key: "tritan" }
  ];
  $("cbGrid").innerHTML = views.map(v => {
    const st = v.key ? cb[v.key] : "pass";
    const chip = st === "check" ? `<span class="badge" style="background: var(--ok); font-size: 12px">◆ Check</span>`
               : st === "pass" ? `<span class="badge" style="background: var(--good); font-size: 12px">✓ Pass</span>` : "";
    return `<div class="cb-item"><img src="${imageURL}" alt="Your poster as seen with ${v.name.toLowerCase()}" style="filter: ${v.filter || "none"}">${v.name}${chip}</div>`;
  }).join("");
  const keys = ["protan", "deutan", "tritan"].filter(k => cb[k]);
  if (keys.length) {
    const passes = 1 + keys.filter(k => cb[k] === "pass").length;
    const b = $("cbBadge"); b.hidden = false;
    b.textContent = passes === 4 ? "✓ Safe · 4 of 4" : `◆ Mostly safe · ${passes} of 4`;
    b.style.background = passes === 4 ? "var(--good)" : "var(--ok)";
  }

  const rl = r.reading_level;
  if (rl) {
    const pos = Math.max(2, Math.min(98, (rl.age - 7) / (22 - 7) * 100));
    $("readMarker").style.left = pos + "%"; $("readTag").style.left = pos + "%";
    $("readTag").textContent = rl.age >= 18 ? "University" : "Age " + rl.age;
    const g = rl.age <= 10 ? GRADES[0] : rl.age <= 13 ? GRADES[1] : rl.age <= 16 ? GRADES[2] : GRADES[3];
    const rb = $("readBadge");
    rb.textContent = g.sym + " " + (g === GRADES[0] ? "Easy" : g === GRADES[1] ? "OK" : g === GRADES[2] ? "Hard" : "Too hard");
    rb.style.background = g.col; rb.className = "badge " + g.cls;
    $("rWords").textContent = rl.words; $("rSecs").textContent = rl.seconds + " s"; $("rHard").textContent = rl.hard_words;
    $("readTip").innerHTML = `<b style="color: var(--label)">Tip:</b> ` + (rl.words <= 12 ? "Great. Posters work best under 12 words." : `Try cutting it to under 12 words (you have ${rl.words}).`);
  } else {
    $("readBadge").textContent = "Coming soon";
    $("readTip").textContent = "The AI will read the words on your poster and fill this in.";
  }
}
