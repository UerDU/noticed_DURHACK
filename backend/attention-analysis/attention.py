# ===== A owns this file =====
# Predicts where people's eyes go on a poster.
#
# Default: a fast saliency model in numpy (no downloads needed), based on
# the same ideas as eye-tracking research:
#   - local contrast and colour pull the eye
#   - edges and text pull the eye
#   - colours unlike the background pop out
#   - people look at the middle first (centre bias)
#   - after looking somewhere, the eye moves on (inhibition of return)
#
# Optional: set USE_DEEPGAZE=1 to use the pretrained DeepGaze IIE model
# instead (needs torch + deepgaze_pytorch installed, downloads weights once).
# Function names and return formats must stay the same (server.py uses them).

import os
import numpy as np
from PIL import Image

STOPS = 4            # how many eye stops to predict
CENTRE_BIAS = 0.2    # 0 = none, 1 = strong "look at the middle first"
JUMP = 0.36          # how far the eye moves on after each stop (fraction of width)
W = 96               # analysis width in pixels


def _box_blur(a, r):
    if r <= 0:
        return a
    k = 2 * r + 1
    p = np.pad(a, ((0, 0), (r, r)), mode="edge")
    c = np.cumsum(p, axis=1, dtype=np.float64)
    c = np.concatenate([np.zeros((a.shape[0], 1)), c], axis=1)
    a = (c[:, k:] - c[:, :-k]) / k
    p = np.pad(a, ((r, r), (0, 0)), mode="edge")
    c = np.cumsum(p, axis=0, dtype=np.float64)
    c = np.concatenate([np.zeros((1, a.shape[1])), c], axis=0)
    return (c[k:, :] - c[:-k, :]) / k


def _norm(a):
    m = a.max()
    return a / m if m > 0 else a


def _load(image_path):
    img = Image.open(image_path).convert("RGB")
    h = max(8, round(W * img.height / img.width))
    small = np.asarray(img.resize((W, h), Image.BILINEAR), dtype=np.float64) / 255.0
    return small


def _saliency_numpy(rgb):
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    L = 0.2126 * R + 0.7152 * G + 0.0722 * B
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    S = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)

    contrast = np.abs(L - _box_blur(L, 8)) + 0.6 * np.abs(S - _box_blur(S, 8))
    gy, gx = np.gradient(L)
    edge = np.hypot(gx, gy) * 2

    # colour uniqueness against the background (most common colour)
    q = (np.clip(rgb, 0, 0.999) * 8).astype(int)
    keys = q[..., 0] * 64 + q[..., 1] * 8 + q[..., 2]
    bg_key = np.bincount(keys.ravel()).argmax()
    bg = rgb[keys == bg_key].mean(axis=0)
    blurred = np.stack([_box_blur(rgb[..., i], 2) for i in range(3)], axis=2)
    uniq = np.linalg.norm(blurred - bg, axis=2) * (0.5 + S)

    sal = 0.3 * _norm(_box_blur(contrast, 3)) + 0.3 * _norm(_box_blur(edge, 4)) + 0.4 * _norm(_box_blur(uniq, 3))
    return sal


def _saliency_deepgaze(image_path, shape):
    import torch
    import deepgaze_pytorch
    from scipy.ndimage import zoom
    model = deepgaze_pytorch.DeepGazeIIE(pretrained=True).eval()
    img = np.asarray(Image.open(image_path).convert("RGB"), dtype=np.float32)
    img_t = torch.tensor(img.transpose(2, 0, 1)[None])
    cb = torch.zeros((1, img.shape[0], img.shape[1]))   # we add our own centre bias below
    with torch.no_grad():
        log_density = model(img_t, cb)
    dens = np.exp(log_density.squeeze().numpy())
    return zoom(dens, (shape[0] / dens.shape[0], shape[1] / dens.shape[1]), order=1)


def saliency_map(image_path):
    """Returns (saliency map 0..1 at analysis size, small RGB image)."""
    rgb = _load(image_path)
    sal = None
    if os.environ.get("USE_DEEPGAZE") == "1":
        try:
            sal = _saliency_deepgaze(image_path, rgb.shape[:2])
        except Exception as e:                       # fall back if DeepGaze isn't installed
            print("DeepGaze unavailable, using numpy saliency:", e)
    if sal is None:
        sal = _saliency_numpy(rgb)
    h, w = sal.shape
    yy, xx = np.mgrid[0:h, 0:w]
    g = np.exp(-(((xx / w) - 0.5) ** 2 + ((yy / h) - 0.5) ** 2) / (2 * 0.3 ** 2))
    sal = sal * ((1 - CENTRE_BIAS) + CENTRE_BIAS * g)
    sal = _norm(_box_blur(sal, 10))
    return sal, rgb


def get_eye_path(image_path):
    """Run the saliency model, find the top peaks in order.
    Return a list of points in PERCENT of image width/height, in viewing order:
    [{"x": 30, "y": 14, "v": 0.93}, ...]   ("v" = how strongly that spot pulls the eye)
    """
    sal, _ = saliency_map(image_path)
    h, w = sal.shape
    work = sal.copy()
    r = round(w * JUMP)
    yy, xx = np.mgrid[0:h, 0:w]
    path = []
    for _ in range(STOPS):
        i = int(work.argmax())
        py, px = divmod(i, w)
        path.append({"x": round(px / w * 100, 1), "y": round(py / h * 100, 1), "v": round(float(work[py, px]), 3)})
        work[(xx - px) ** 2 + (yy - py) ** 2 < r * r] *= 0.08     # inhibition of return
    return path


def label_path(eye_path, elements):
    """Give each eye-path point the label of the element box it falls inside.
    elements = [{"label": "logo", "box": [x, y, w, h]}, ...] (all in percent)
    The smallest matching box wins, so a small offer beats the big photo behind it.
    """
    by_area = sorted(elements, key=lambda e: e["box"][2] * e["box"][3])
    out = []
    for p in eye_path:
        label = None
        for el in by_area:
            x, y, w, h = el["box"]
            if x - 2 <= p["x"] <= x + w + 2 and y - 2 <= p["y"] <= y + h + 2:
                label = el["label"]
                break
        if label is None:
            v = "top" if p["y"] < 33 else "bottom" if p["y"] > 66 else "middle"
            hz = " left" if p["x"] < 33 else " right" if p["x"] > 66 else ""
            label = "centre" if (v == "middle" and not hz) else v + hz
        out.append({**p, "label": label})
    return out


def target_label(elements, objective):
    """Which element is the user's message? (is_target from the labeller, else name match)."""
    for e in elements:
        if e.get("is_target"):
            return e["label"]
    o = (objective or "").lower()
    for e in elements:
        l = e["label"].lower()
        if l and (l in o or o in l):
            return e["label"]
    return None


def focal_scores(eye_path, elements, objective):
    """Return {"focal_match": 0-25, "focal_point": 0-15}
    focal_match: is the user's message in the first 2 stops of the eye path?
    focal_point: is there ONE clear winner, or is attention spread out?
    """
    target = target_label(elements, objective)
    labels = [p["label"] for p in eye_path]
    if target is None:
        focal_match = 13                      # unknown target: neutral score
    else:
        rank = labels.index(target) if target in labels else 99
        focal_match = [25, 25, 15, 5].__getitem__(rank) if rank < 4 else 0
    v = [p.get("v", 1) for p in eye_path] + [0.01, 0.01]
    dominance = v[0] / max(0.01, v[1])
    focal_point = round(15 * min(1, max(0, (dominance - 1) / 0.6)) * 0.8 + 3)
    return {"focal_match": int(focal_match), "focal_point": int(focal_point)}
