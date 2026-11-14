# ===== C owns this file =====
# STUBS returning fake data. Replace with real vision-LLM calls (temperature 0, JSON output).
# Keep API keys in an environment variable, never commit them to GitHub.

def label_elements(image_path, objective):
    """Ask the vision LLM to find the main elements and their boxes (in percent).
    Return: [{"label": "logo", "box": [x, y, w, h]}, ...]
    Make sure one element's label matches the user's objective (e.g. "discount").
    """
    return [
        {"label": "logo", "box": [8, 5, 45, 18]},
        {"label": "photo", "box": [10, 28, 80, 40]},
        {"label": "headline", "box": [12, 70, 76, 10]},
        {"label": "discount", "box": [60, 84, 32, 10]},
    ]


def explain(image_path, objective, eye_path, subscores):
    """Ask the LLM for 3 problems + 3 fixes, based on the sub-scores and eye path.
    The LLM explains; it does NOT invent the numbers.
    Return: (problems, fixes), each a list of 3 strings.
    """
    problems = [
        "Your discount is the LAST thing people see. It's 4th in the eye path.",
        "The logo is bigger and brighter than the offer, so it steals attention.",
        "The discount text is too small to read when scrolling on a phone.",
    ]
    fixes = [
        "Make '50% OFF' the biggest element and move it to the top half.",
        "Shrink the logo and move it to a corner.",
        "Put the discount on a high-contrast block colour.",
    ]
    return problems, fixes
