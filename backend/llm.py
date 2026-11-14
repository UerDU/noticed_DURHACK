# ===== C owns this file =====
# 1) label_elements: find the parts of the poster (logo, headline, offer...).
#    - With ANTHROPIC_API_KEY set: a vision AI labels them and reads the text.
#    - Without a key: uses the eye-path areas + the spot the user tapped.
# 2) explain: problems + fixes. Fixes come from Ivy's recommendations.py.
# Keep API keys in an environment variable, never commit them to GitHub.

import base64, json, os, re
import numpy as np
from PIL import Image

import attention
import metrics
from recommendations import recommend

MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5-5")
clean = lambda s: re.sub(r"^(the|our|my|your|a|an)\s+", "", (s or "your message").strip(), flags=re.I).lower()[:24]
LAST_TEXT = {"words": None}          # poster text found by the AI (for the reading level)

PROMPT = """You are a graphic design expert. Look at this poster.
The owner wants people to notice: "{objective}".
Return ONLY JSON, no other text:
{{"elements": [{{"label": "short name like logo, headline, photo, date, offer", "box": [x, y, width, height], "is_target": true/false}}],
  "text": "all the words on the poster"}}
Rules: box values are PERCENT of the image (0-100). List the 3 to 7 main parts.
Exactly one element has is_target true: the one that best matches "{objective}"."""


def _ask_vision_ai(image_path, objective):
    import anthropic                                   # pip install anthropic
    img = Image.open(image_path).convert("RGB")
    img.thumbnail((1200, 1200))
    tmp = image_path + ".jpg"
    img.save(tmp, "JPEG", quality=85)
    data = base64.b64encode(open(tmp, "rb").read()).decode()
    os.remove(tmp)
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=MODEL, max_tokens=1200, temperature=0,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
            {"type": "text", "text": PROMPT.format(objective=objective)},
        ]}],
    )
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    j = json.loads(re.search(r"\{.*\}", text, re.S).group(0))
    els = [{"label": str(e["label"]).lower()[:24], "box": [float(v) for v in e["box"]], "is_target": bool(e.get("is_target"))}
           for e in j.get("elements", []) if len(e.get("box", [])) == 4]
    LAST_TEXT["words"] = j.get("text"); LAST_TEXT["ai"] = True
    return els


def _from_saliency(image_path, objective, target_pt):
    """No AI key: name areas by where they are, and use the user's tap as the message."""
    path = attention.get_eye_path(image_path)
    labelled = attention.label_path(path, [])
    els = [{"label": p["label"], "box": [max(0, p["x"] - 10), max(0, p["y"] - 7), 20, 14], "is_target": False} for p in labelled]
    if target_pt:
        name = clean(objective)
        hit = next((e for e in els if abs(e["box"][0] + 10 - target_pt[0]) < 12 and abs(e["box"][1] + 7 - target_pt[1]) < 10), None)
        if hit:
            hit["label"], hit["is_target"] = name, True
        else:
            els.append({"label": name, "box": [max(0, target_pt[0] - 10), max(0, target_pt[1] - 7), 20, 14], "is_target": True})
    LAST_TEXT["words"] = None; LAST_TEXT["ai"] = False
    return els


def label_elements(image_path, objective, target_pt=None):
    """Return: [{"label": "logo", "box": [x, y, w, h], "is_target": bool}, ...] (percent)."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            els = _ask_vision_ai(image_path, objective)
            if els:
                if target_pt:                          # the user's tap beats the AI's guess
                    for e in els:
                        x, y, w, h = e["box"]
                        e["is_target"] = x <= target_pt[0] <= x + w and y <= target_pt[1] <= y + h
                    if not any(e["is_target"] for e in els):
                        els.append({"label": clean(objective),
                                    "box": [target_pt[0] - 10, target_pt[1] - 7, 20, 14], "is_target": True})
                return els
        except Exception as e:
            print("Vision AI failed, using saliency labels:", e)
    return _from_saliency(image_path, objective, target_pt)


def reading_level():
    """Rough reading age from the poster text (needs the vision AI to have read it)."""
    words = re.findall(r"[A-Za-z']+", LAST_TEXT["words"] or "")
    if not words:
        return None
    syll = sum(max(1, len(re.findall(r"[aeiouy]+", w.lower()))) for w in words)
    sentences = max(1, len(re.findall(r"[.!?\n]", LAST_TEXT["words"] or "")))
    grade = 0.39 * len(words) / sentences + 11.8 * syll / len(words) - 15.59     # Flesch-Kincaid grade
    hard = sum(1 for w in words if len(re.findall(r"[aeiouy]+", w.lower())) >= 3)
    return {"age": int(min(22, max(7, round(grade + 5)))), "words": len(words),
            "seconds": max(1, round(len(words) / 4)), "hard_words": hard}


def explain(image_path, objective, eye_path, subscores, elements=None, details=None):
    """Return (problems, fixes, explanations). The AI/rules explain; they do NOT invent the numbers."""
    elements = elements or []
    target = attention.target_label(elements, objective) or (eye_path[0]["label"] if eye_path else "message")
    order = [p["label"] for p in eye_path]
    rank = order.index(target) if target in order else None
    ord_ = lambda n: f"{n}{['st', 'nd', 'rd'][n - 1] if n <= 3 else 'th'}"

    explanations = {
        "focal_match": (f"Your {target} is seen {ord_(rank + 1)}." + (" Great." if rank <= 1 else " Most people move on before that.")) if rank is not None else f"Your {target} isn't in the first 4 places people look.",
        "focal_point": "One area clearly wins attention." if subscores.get("focal_point", 0) >= 11 else "A few areas compete for attention.",
        "legibility": "Reads well even at phone size." if subscores.get("legibility", 0) >= 10 else "Detail gets lost at phone size. Make key text bigger.",
        "contrast": f"Contrast ratio {details.get('contrast_ratio', '?')}:1 " + ("(passes the 4.5:1 rule)." if details.get("contrast_ratio", 0) >= 4.5 else "(below the 4.5:1 rule for readable text).") if details else "Contrast between text and background.",
        "clutter": "Good breathing space." if subscores.get("clutter", 0) >= 10 else "Busy. Too much detail competing.",
        "balance": "Visual weight is nicely spread." if subscores.get("balance", 0) >= 10 else "One side feels heavier than the other.",
    }

    problems = []
    if rank is None or rank > 1:
        problems.append(f"Your {target} is seen {ord_(rank + 1) if rank is not None else 'late (not in the first 4 looks)'}. Make it bigger, bolder, or move it up.")
    if order and order[0] != target:
        problems.append(f"The {order[0]} grabs eyes first. Make it smaller or calmer.")

    # Ivy's recommendations, fed in her format
    boxes = []
    for e in elements:
        x, y, w, h = e["box"]
        boxes.append({"label": e["label"], "area_percent": round(w * h / 100, 1),
                      "contrast_ratio": round(metrics.contrast_ratio(metrics.crop(metrics._load(image_path, 300), e["box"])), 2)})
    if boxes and target in [b["label"] for b in boxes]:
        ranking = order + [b["label"] for b in boxes if b["label"] not in order]
        ivy_scores = {"Target contrast": subscores.get("contrast", 0) / 15 * 100, "Text legibility": subscores.get("legibility", 0) / 15 * 100,
                      "Clutter": subscores.get("clutter", 0) / 15 * 100, "Balance": subscores.get("balance", 0) / 15 * 100}
        try:
            fixes = recommend({"boxes": boxes, "target": target, "ranking": [r for r in ranking if r in [b["label"] for b in boxes]] or [target], "subscores": ivy_scores})
        except Exception as e:
            print("recommendations.py failed:", e)
            fixes = []
    else:
        fixes = []
    if not LAST_TEXT.get("ai"):            # without the vision AI, box sizes are estimates: don't quote them
        fixes = [re.sub(r" \(\d+(\.\d+)?% of the image, contrast [\d.]+\)", "", f) for f in fixes]
        fixes = [re.sub(r", while your target '([^']+)' is only [\d.]+%\.", r", not your '\1'.", f) for f in fixes]
    if not problems:
        problems.append("Looks well composed. Small tweaks only.")
    return problems[:3], fixes[:3], explanations
