/* =========================================================
   Saccade · Glance Test
   Compares the AI's predicted eye path with a real person's eyes.
   Uses the poster + result from the main page (sessionStorage),
   or the Bloom Café example if nothing was analysed yet.
   ========================================================= */

const LOOK_MS = 3000;          // how long people look at the poster
const MIN_DWELL_MS = 120;      // must look this long at an element to count as "seen"
const WEBGAZER_ASSETS = "https://cdn.jsdelivr.net/npm/webgazer@3.5.3/dist/mediapipe/face_mesh";

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const show = (id) => document.querySelectorAll(".gt-screen").forEach(s => s.classList.toggle("on", s.id === id));

/* ---------- the poster + AI prediction to test ---------- */
const SAMPLE = {
  image: "sample-poster.png",
  objective: "50% off",
  result: {
    target: "offer",
    elements: [
      { label: "logo", box: [6, 4, 88, 10] }, { label: "photo", box: [6, 19, 88, 45] },
      { label: "headline", box: [6, 67, 55, 10] }, { label: "offer", box: [66, 92, 31, 4] }
    ],
    eye_path: [
      { label: "logo", x: 50, y: 9 }, { label: "photo", x: 50, y: 46 },
      { label: "headline", x: 30, y: 71 }, { label: "offer", x: 81, y: 94 }
    ]
  }
};
let data = SAMPLE;
try {
  const saved = JSON.parse(sessionStorage.getItem("saccade:last") || "null");
  if (saved && saved.image && saved.result && saved.result.eye_path && saved.result.elements) data = saved;
} catch (e) { /* storage blocked: use the sample */ }
$("posterNote").textContent = data === SAMPLE
  ? "Testing with the Bloom Café example poster. Analyse your own poster first to test that one instead."
  : "Testing with the poster you just analysed.";

/* ---------- gaze source: webcam (WebGazer) or mouse fallback ---------- */
let mode = "camera";
let samples = [];        // {x, y, t} in viewport pixels during the look
let recording = false;

function onGaze(x, y) {
  if (recording && x != null && y != null) samples.push({ x, y, t: performance.now() });
}
document.addEventListener("mousemove", e => { if (mode === "mouse") onGaze(e.clientX, e.clientY); });

$("startBtn").onclick = async () => {
  mode = "camera";
  if (!window.webgazer) { alert("The eye tracker couldn't load (check the internet connection). Using the mouse instead."); return startMouse(); }
  try {
    webgazer.params.faceMeshSolutionPath = WEBGAZER_ASSETS;
    webgazer.params.saveDataAcrossSessions = false;
    webgazer.setRegression("ridge").setGazeListener((d) => { if (d) onGaze(d.x, d.y); });
    await webgazer.begin();
    webgazer.showVideoPreview(false).showPredictionPoints(false).applyKalmanFilter(true);
  } catch (err) {
    console.error(err);
    alert("We couldn't use the camera. Using the mouse instead.");
    return startMouse();
  }
  calibrate();
};
$("mouseBtn").onclick = startMouse;
function startMouse() { mode = "mouse"; look(); }

/* ---------- step 2: calibration (9 dots) ---------- */
function calibrate() {
  const spots = [[10,12],[50,12],[90,12],[10,50],[50,50],[90,50],[10,88],[50,88],[90,88]];
  const box = $("dots"); box.innerHTML = "";
  let left = spots.length;
  $("calCount").textContent = `${left} dots left`;
  spots.forEach(([x, y]) => {
    const b = document.createElement("button");
    b.className = "cal-dot"; b.style.left = x + "%"; b.style.top = y + "%";
    b.setAttribute("aria-label", "Calibration dot");
    let clicks = 0;
    b.onclick = () => {                      // WebGazer learns from each click automatically
      clicks++;
      b.style.opacity = String(1 - clicks * 0.25);
      if (clicks >= 3) {
        b.classList.add("done"); left--;
        $("calCount").textContent = left ? `${left} dots left` : "Great! Get ready…";
        if (!left) setTimeout(() => { $("calib").classList.remove("on"); look(); }, 700);
      }
    };
    box.appendChild(b);
  });
  $("calib").classList.add("on");
}

/* ---------- step 3: the 3-second glance ---------- */
async function look() {
  const img = $("lookImg");
  img.src = data.image;
  await img.decode().catch(() => {});
  $("look").classList.add("on");
  for (const n of ["3", "2", "1"]) { $("countTxt").textContent = `Get ready… ${n}`; img.style.opacity = "0"; await wait(650); }
  $("countTxt").textContent = mode === "mouse" ? "Move your mouse where your eyes go" : "Look at the poster";
  img.style.opacity = "1";
  samples = []; recording = true;
  await wait(LOOK_MS);
  recording = false;
  const rect = img.getBoundingClientRect();
  $("look").classList.remove("on");
  if (mode === "camera" && window.webgazer) { try { webgazer.pause(); } catch (e) {} }
  analyse(rect);
}

/* ---------- step 4: compare with the AI ---------- */
function analyse(rect) {
  const r = data.result;
  // gaze points -> percent of the poster
  const pts = samples
    .map(s => ({ x: (s.x - rect.left) / rect.width * 100, y: (s.y - rect.top) / rect.height * 100, t: s.t }))
    .filter(p => p.x >= -5 && p.x <= 105 && p.y >= -5 && p.y <= 105);

  const inBox = (p, b) => p.x >= b[0] - 3 && p.x <= b[0] + b[2] + 3 && p.y >= b[1] - 3 && p.y <= b[1] + b[3] + 3;
  // which element was each point on? (smallest box wins, so the small offer beats the big photo)
  const byArea = [...r.elements].sort((a, b) => a.box[2] * a.box[3] - b.box[2] * b.box[3]);
  const hit = (p) => (byArea.find(e => inBox(p, e.box)) || {}).label || null;

  // human order: first time each element is looked at for at least MIN_DWELL_MS
  const youOrder = []; let cur = null, since = 0;
  pts.forEach(p => {
    const h = hit(p);
    if (h !== cur) { cur = h; since = p.t; }
    if (h && !youOrder.includes(h) && p.t - since >= MIN_DWELL_MS) youOrder.push(h);
  });
  const aiOrder = r.eye_path.map(p => p.label).filter((l, i, a) => l && a.indexOf(l) === i);

  // match score: same position = full point, off by one = half point
  let score = 0;
  aiOrder.forEach((l, i) => { const j = youOrder.indexOf(l); if (j === i) score += 1; else if (j !== -1 && Math.abs(j - i) === 1) score += 0.5; });
  const pct = aiOrder.length ? Math.round(score / aiOrder.length * 100) : 0;
  const target = r.target || (r.elements.find(e => e.is_target) || {}).label;
  const tYou = youOrder.indexOf(target), tAi = aiOrder.indexOf(target);

  renderResult({ pts, youOrder, aiOrder, pct, target, tYou, tAi });
  saveBoard(pct, tYou);
}

function renderResult({ pts, youOrder, aiOrder, pct, target, tYou, tAi }) {
  show("sResult");
  $("cmpImg").src = data.image;
  const r = data.result;
  $("aiLine").setAttribute("points", r.eye_path.map(p => `${p.x},${p.y}`).join(" "));

  // your path: one point per element you looked at (centre of where you looked)
  const yourPts = youOrder.map(l => {
    const e = r.elements.find(x => x.label === l);
    const mine = pts.filter(p => p.x >= e.box[0] && p.x <= e.box[0] + e.box[2] && p.y >= e.box[1] && p.y <= e.box[1] + e.box[3]);
    const avg = (k) => mine.length ? mine.reduce((s, p) => s + p[k], 0) / mine.length : (k === "x" ? e.box[0] + e.box[2] / 2 : e.box[1] + e.box[3] / 2);
    return { x: avg("x"), y: avg("y") };
  });
  $("youLine").setAttribute("points", yourPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));

  $("heatLayer").innerHTML = pts.filter((_, i) => i % 2 === 0).map(p =>
    `<div class="heat" style="left:${p.x}%;top:${p.y}%"></div>`).join("");
  $("tagLayer").innerHTML =
    r.eye_path.map((p, i) => `<div class="tag ai" style="left:${p.x}%;top:${p.y}%">0${i + 1}</div>`).join("") +
    yourPts.map((p, i) => `<div class="tag you" style="left:calc(${p.x}% + 18px);top:calc(${p.y}% + 18px)">${i + 1}</div>`).join("");

  const pill = (l, cls, match) => `<span class="pill ${cls}${match ? " match" : ""}">${l === target ? "★ " : ""}${l}</span>`;
  $("aiSeq").innerHTML = aiOrder.map((l, i) => pill(l, "ai", youOrder[i] === l)).join("→") || "—";
  $("youSeq").innerHTML = youOrder.map((l, i) => pill(l, "you", aiOrder[i] === l)).join("→") || `<span class="muted">No clear look detected</span>`;

  $("matchNum").textContent = pct + "%";
  $("matchNum").style.color = pct >= 75 ? "var(--good)" : pct >= 50 ? "var(--ok)" : "var(--warn)";
  $("matchSub").textContent = youOrder.length ? `Your eyes followed the AI's prediction on ${pct >= 75 ? "almost every step" : pct >= 50 ? "most steps" : "some steps"}.` : "We couldn't follow your eyes well. Try again with better light.";
  $("resHead").innerHTML = pct >= 50
    ? `Saccade guessed your eyes <span class="serif">${pct >= 75 ? "almost perfectly." : "pretty well."}</span>`
    : `Your eyes took <span class="serif">their own path.</span>`;

  let msg = "";
  if (target) {
    msg = tYou === -1
      ? `<b>You never looked at ★ ${target}</b>, the thing this poster wants you to notice. The AI predicted it would come ${tAi + 1}${["st","nd","rd"][tAi] || "th"}. That's exactly the problem Saccade fixes.`
      : `<b>You noticed ★ ${target} ${tYou + 1}${["st","nd","rd"][tYou] || "th"}.</b> ${tYou > 1 ? "Most people walking past would have looked away by then." : "Great, the message got through."}`;
  }
  $("msgBox").innerHTML = msg + (mode === "mouse" ? `<p class="note" style="margin: 8px 0 0">Mouse mode: this used your mouse, not your eyes.</p>` : "");
}

/* ---------- scoreboard across everyone (this laptop only) ---------- */
function readBoard() { try { return JSON.parse(localStorage.getItem("saccade:board") || "[]"); } catch (e) { return []; } }
function saveBoard(pct, tYou) {
  if (mode === "mouse") { drawBoard(readBoard()); return; }     // only count real eyes
  const b = readBoard(); b.push({ pct, early: tYou >= 0 && tYou <= 1 });
  try { localStorage.setItem("saccade:board", JSON.stringify(b)); } catch (e) {}
  drawBoard(b);
}
function drawBoard(b) {
  $("bPeople").textContent = b.length;
  $("bAvg").textContent = b.length ? Math.round(b.reduce((s, x) => s + x.pct, 0) / b.length) + "%" : "–";
  $("bTarget").textContent = b.length ? `${b.filter(x => x.early).length}/${b.length}` : "–";
}
drawBoard(readBoard());
$("resetBoard").onclick = () => { try { localStorage.removeItem("saccade:board"); } catch (e) {} drawBoard([]); };

$("againBtn").onclick = () => {
  if (mode === "camera" && window.webgazer) { try { webgazer.clearData(); webgazer.resume(); } catch (e) {} calibrate(); }
  else look();
};
window.addEventListener("beforeunload", () => { try { window.webgazer && webgazer.end(); } catch (e) {} });
