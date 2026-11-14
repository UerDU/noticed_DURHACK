# ===== C owns this file =====
# Run:  cd backend && pip install -r requirements.txt && uvicorn server:app --reload --port 8000
import os, sys, tempfile
from typing import Optional
# A's code now lives in backend/attention-analysis/
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "attention-analysis"))
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware

import attention   # A's file
import metrics     # B's file
import llm         # C's file

app = FastAPI()

# Lets the frontend (D) call this server from the browser
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

BANDS = [(85, "Ready to launch"), (65, "Almost there"), (40, "Needs work"), (0, "Will be ignored")]


@app.post("/analyse")
async def analyse(image: UploadFile = File(...), objective: str = Form(...),
                  target_x: Optional[float] = Form(None), target_y: Optional[float] = Form(None)):
    # Save the upload to a temp file so everyone's functions can read it by path
    suffix = os.path.splitext(image.filename or "")[1] or ".png"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await image.read())
        path = tmp.name
    target_pt = (target_x, target_y) if target_x is not None and target_y is not None else None

    try:
        elements = llm.label_elements(path, objective, target_pt)          # C
        eye_path = attention.get_eye_path(path)                            # A
        eye_path = attention.label_path(eye_path, elements)                # A
        focal = attention.focal_scores(eye_path, elements, objective)      # A
        target = attention.target_label(elements, objective)
        design = metrics.design_scores(path, elements, target)             # B
        details = design.pop("_details", {})

        subscores = {**focal, **design}
        total = int(round(sum(subscores.values())))
        band = next(label for minimum, label in BANDS if total >= minimum)
        problems, fixes, explanations = llm.explain(path, objective, eye_path, subscores, elements, details)  # C

        tbox = next((e["box"] for e in elements if e["label"] == target), None)
        return {
            "objective": objective, "target": target, "elements": elements, "eye_path": eye_path,
            "subscores": subscores, "total": total, "band": band,
            "problems": problems, "fixes": fixes, "explanations": explanations,
            "colour_blind": metrics.colour_blind_check(path, tbox) if tbox else None,
            "reading_level": llm.reading_level(),
        }
    finally:
        os.remove(path)


@app.get("/")
def health():
    return {"status": "ok"}
