# ===== B owns this file =====
# STUB returning fake data, so the server works today.
# Replace the insides with real calculations. Do NOT change the name or return format.

def design_scores(image_path, elements):
    """Return {"legibility": 0-15, "contrast": 0-15, "clutter": 0-15, "balance": 0-15}

    elements = [{"label": "logo", "box": [x, y, w, h]}, ...] (all in percent of image size)

    contrast   -> contrast ratio between text and background (WCAG-style)
    clutter    -> number of elements + % of empty space
    legibility -> is key text still readable when shrunk to phone-feed size?
    balance    -> visual weight left vs right, top vs bottom
    """
    return {"legibility": 8, "contrast": 10, "clutter": 5, "balance": 9}
