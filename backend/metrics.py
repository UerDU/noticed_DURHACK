# ===== B owns this file =====
# Real design measurements of the poster image.
# Function name and return format must stay the same (server.py uses them).

import numpy as np
from PIL import Image


def _lum(rgb):
    """Relative luminance (WCAG) of an RGB array in 0..1."""
    c = np.where(rgb <= 0.03928, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def contrast_ratio(rgb_region):
    """WCAG-style contrast between the darkest and lightest parts of a region (1..21)."""
    L = _lum(rgb_region).ravel()
    if L.size < 4:
        return 1.0
    lo, hi = np.percentile(L, 1), np.percentile(L, 99)    # small text is only a few % of the area
    return float((hi + 0.05) / (lo + 0.05))


def crop(rgb, box):
    h, w = rgb.shape[:2]
    x, y, bw, bh = box
    x0, y0 = int(max(0, x) / 100 * w), int(max(0, y) / 100 * h)
    x1, y1 = int(min(100, x + bw) / 100 * w), int(min(100, y + bh) / 100 * h)
    return rgb[y0:max(y1, y0 + 2), x0:max(x1, x0 + 2)]


def _load(image_path, width):
    img = Image.open(image_path).convert("RGB")
    h = max(8, round(width * img.height / img.width))
    return np.asarray(img.resize((width, h), Image.BILINEAR), dtype=np.float64) / 255.0


def _edges(gray):
    gy, gx = np.gradient(gray)
    return np.hypot(gx, gy)


def design_scores(image_path, elements, target=None):
    """Return {"legibility": 0-15, "contrast": 0-15, "clutter": 0-15, "balance": 0-15}

    contrast   -> WCAG contrast ratio inside the user's message (or the whole poster)
    clutter    -> edge density (busy detail) + number of elements
    legibility -> how much detail survives when shrunk to phone-feed size
    balance    -> visual weight left vs right, top vs bottom
    """
    rgb = _load(image_path, 300)
    gray = rgb.mean(axis=2)

    # contrast: inside the message if we know where it is
    tgt = next((e for e in elements if e.get("is_target") or e["label"] == target), None)
    cr = contrast_ratio(crop(rgb, tgt["box"]) if tgt else rgb)
    contrast = 15 * min(1, max(0, (cr - 2) / (7 - 2)))           # 2:1 -> 0 pts, 7:1 -> full

    # clutter: share of "busy" pixels + too many separate elements
    e = _edges(gray)
    dens = float((e > 0.08).mean())
    clutter = 15 * min(1, max(0, 1 - (dens - 0.06) / 0.22)) - max(0, len(elements) - 6) * 1.5

    # legibility: shrink to a phone-feed thumbnail and see how much detail is left
    small = _load(image_path, 110).mean(axis=2)
    big_e, small_e = _edges(gray).mean(), _edges(small).mean() / (300 / 110)
    keep = small_e / max(1e-6, big_e)
    rms = float(gray.std())
    legibility = 15 * min(1, max(0, 0.6 * (keep - 0.35) / 0.5 + 0.4 * (rms - 0.08) / 0.22))

    # balance: visual weight = darkness + detail
    weight = (1 - gray) * 0.5 + e / (e.max() + 1e-6) * 0.5
    h, w = weight.shape
    lw, rw = weight[:, : w // 2].sum(), weight[:, w // 2:].sum()
    tw, bw_ = weight[: h // 2].sum(), weight[h // 2:].sum()
    imbalance = abs(lw - rw) / (lw + rw) + 0.5 * abs(tw - bw_) / (tw + bw_)
    balance = 15 * min(1, max(0, 1 - imbalance * 2.2))

    return {
        "legibility": int(round(max(0, legibility))),
        "contrast": int(round(contrast)),
        "clutter": int(round(max(0, clutter))),
        "balance": int(round(balance)),
        "_details": {"contrast_ratio": round(cr, 2), "edge_density": round(dens, 3), "imbalance": round(imbalance, 3)},
    }


def colour_blind_check(image_path, box):
    """Simulate red-, green- and blue-blindness on the message area and check it stays readable."""
    rgb = crop(_load(image_path, 300), box)
    sims = {
        "protan": np.array([[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]]),
        "deutan": np.array([[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]]),
        "tritan": np.array([[0.95, 0.05, 0], [0, 0.433, 0.567], [0, 0.475, 0.525]]),
    }
    normal = contrast_ratio(rgb)
    out = {}
    for k, m in sims.items():
        sim = np.clip(rgb @ m.T, 0, 1)
        cr = contrast_ratio(sim)
        out[k] = "pass" if cr >= 3 or cr >= normal * 0.8 else "check"
    return out
