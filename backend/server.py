# ===== C owns this file =====
# Run:  cd backend && pip install -r requirements.txt && uvicorn server:app --reload --port 8000
import os, tempfile
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
async def analyse(image: UploadFile = File(...), objective: str = Form(...)):
    # Save the upload to a temp file so everyone's functions can read it by path
    suffix = os.path.splitext(image.filename or "")[1] or ".png"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await image.read())
        path = tmp.name

    try:
        elements = llm.label_elements(path, objective)                    # C
        eye_path = attention.get_eye_path(path)                           # A
        eye_path = attention.label_path(eye_path, elements)               # A
        focal = attention.focal_scores(eye_path, elements, objective)     # A
        design = metrics.design_scores(path, elements)                    # B

        subscores = {**focal, **design}
        total = int(round(sum(subscores.values())))
        band = next(label for minimum, label in BANDS if total >= minimum)
        problems, fixes = llm.explain(path, objective, eye_path, subscores)  # C

        return {
            "objective": objective, "elements": elements, "eye_path": eye_path,
            "subscores": subscores, "total": total, "band": band,
            "problems": problems, "fixes": fixes,
        }
    finally:
        os.remove(path)


@app.get("/")
def health():
    return {"status": "ok"}
