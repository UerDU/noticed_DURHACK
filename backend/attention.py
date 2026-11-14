# ===== A owns this file =====
# Everything here is a STUB returning fake data, so the server works today.
# Replace the insides of each function with the real thing. Do NOT change the names or return format.

def get_eye_path(image_path):
    """Run the saliency model (DeepGaze / UMSI), find the top peaks in order.
    Return a list of points in PERCENT of image width/height, in viewing order:
    [{"x": 30, "y": 14}, {"x": 50, "y": 48}, ...]
    """
    return [{"x": 30, "y": 14}, {"x": 50, "y": 48}, {"x": 50, "y": 75}, {"x": 76, "y": 89}]


def label_path(eye_path, elements):
    """Give each eye-path point the label of the element box it falls inside.
    elements = [{"label": "logo", "box": [x, y, w, h]}, ...] (all in percent)
    """
    out = []
    for p in eye_path:
        label = "background"
        for el in elements:
            x, y, w, h = el["box"]
            if x <= p["x"] <= x + w and y <= p["y"] <= y + h:
                label = el["label"]
                break
        out.append({**p, "label": label})
    return out


def focal_scores(eye_path, elements, objective):
    """Return {"focal_match": 0-25, "focal_point": 0-15}
    focal_match: is the element the user cares about (objective) in the first 2 stops of the eye path?
    focal_point: is there ONE clear winner on the heatmap, or is attention spread out?
    """
    return {"focal_match": 5, "focal_point": 8}
