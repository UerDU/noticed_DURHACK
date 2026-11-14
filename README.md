# 👁️ Noticed: Composition Critic

> You tell us what you want to communicate. We help make sure your audience understands it.

## Who owns what (only edit YOUR files, so nobody's work clashes)

| Person | Files | Job |
|---|---|---|
| **A** Attention | `backend/attention.py` | Saliency model → eye path → `focal_match`, `focal_point` |
| **B** Design metrics | `backend/metrics.py` | `contrast`, `clutter`, `legibility`, `balance` |
| **C** Backend + AI | `backend/server.py`, `backend/llm.py` | API, LLM labels + explanations, total + band |
| **D** Frontend | `frontend/index.html` | Upload, objective input, eye path animation, score UI |

Every function already exists as a **stub returning fake data**, so the whole app runs from minute one.
Replace the inside of your functions, but **never change the function names or return formats**.

## How it fits together

```
frontend (D) --image + objective--> POST /analyse (C)
   C calls: llm.label_elements      -> elements
            attention.get_eye_path  -> eye path   (A)
            attention.focal_scores  -> focal_match, focal_point   (A)
            metrics.design_scores   -> contrast, clutter, legibility, balance   (B)
            llm.explain             -> 3 problems + 3 fixes
   C returns one JSON --> frontend draws everything (D)
```

## The JSON (this is law: don't change it without telling everyone)

```json
{
  "objective": "50% discount",
  "elements": [{"label": "discount", "box": [60, 84, 32, 10]}],
  "eye_path": [{"label": "logo", "x": 30, "y": 14}],
  "subscores": {"focal_match": 5, "focal_point": 8, "legibility": 8, "contrast": 10, "clutter": 5, "balance": 9},
  "total": 45,
  "band": "Needs work",
  "problems": ["...", "...", "..."],
  "fixes": ["...", "...", "..."]
}
```
All positions are **percent** of image width/height (0–100), so they work at any screen size.

## Max points (adds up to 100)
| focal_match | focal_point | legibility | contrast | clutter | balance |
|---|---|---|---|---|---|
| 25 | 15 | 15 | 15 | 15 | 15 |

**Bands:** 85+ Ready to launch · 65+ Almost there · 40+ Needs work · below 40 Will be ignored

## Run it

**Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

**Frontend:** open `frontend/index.html` in a browser.
- Works with fake data by default (`USE_FAKE = true` at the top of the script).
- At integration, set `USE_FAKE = false` to call the backend.

## Git rules
1. `git pull` before you start working, every time.
2. Only edit your own files.
3. Commit small and often: `git add . && git commit -m "eye path working" && git pull && git push`
4. Never commit API keys (put them in `.env`, which is git-ignored).
5. Put shared test images in `test_images/`.
