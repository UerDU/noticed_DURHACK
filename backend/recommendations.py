def recommend(result):
    boxes = {b["label"]: b for b in result["boxes"]}
    target = result["target"]
    t = boxes[target]
    top = result["ranking"][0]
    sub = result["subscores"]
    ideas = []  # (severity, text)

    if top != target:
        o = boxes[top]
        ideas.append((100, f"'{top}' grabs attention first ({o['area_percent']}% of the image, "
            f"contrast {o['contrast_ratio']}), while your target '{target}' is only "
            f"{t['area_percent']}%. Make '{target}' bigger than '{top}', or shrink '{top}'."))

    if t["contrast_ratio"] < 4.5:
        ideas.append(((1 - sub["Target contrast"] / 100) * 80,
            f"'{target}' has a contrast ratio of {t['contrast_ratio']}, below the 4.5 "
            f"recommended for readable text. Use a much lighter colour on a dark "
            f"background (or the reverse)."))

    if sub["Text legibility"] < 70:
        ideas.append(((1 - sub["Text legibility"] / 100) * 60,
            "Some text is too small or too faint. Make key text at least 4% of the "
            "image height and increase its contrast against the background."))

    if sub["Clutter"] < 60:
        ideas.append(((1 - sub["Clutter"] / 100) * 50,
            "The design is visually busy. Remove decorative elements and leave more "
            "empty space around your main message."))

    if sub["Balance"] < 60:
        ideas.append(((1 - sub["Balance"] / 100) * 40,
            "The visual weight is concentrated on one side. Move or resize elements "
            "so the layout feels more balanced."))

    ideas.sort(key=lambda x: -x[0])
    tips = [text for _, text in ideas[:3]]

    fillers = [
        f"Keep '{target}' as the first thing people see and give it room around it.",
        "Limit the post to one main message and one call to action.",
        "Use no more than two typefaces and a small colour palette.",
    ]
    for f in fillers:
        if len(tips) == 3:
            break
        tips.append(f)
    return tips
    boxes = {b["label"]: b for b in result["boxes"]}
    target = result["target"]
    t = boxes[target]
    top = result["ranking"][0]
    sub = result["subscores"]
    ideas = []  # (severity, text)

    if top != target:
        o = boxes[top]
        ideas.append((100, f"'{top}' grabs attention first ({o['area_percent']}% of the image, "
            f"contrast {o['contrast_ratio']}), while your target '{target}' is only "
            f"{t['area_percent']}%. Make '{target}' bigger than '{top}', or shrink '{top}'."))

    if t["contrast_ratio"] < 4.5:
        ideas.append(((1 - sub["Target contrast"] / 100) * 80,
            f"'{target}' has a contrast ratio of {t['contrast_ratio']}, below the 4.5 "
            f"recommended for readable text. Use a much lighter colour on a dark "
            f"background (or the reverse)."))

    if sub["Text legibility"] < 70:
        ideas.append(((1 - sub["Text legibility"] / 100) * 60,
            "Some text is too small or too faint. Make key text at least 4% of the "
            "image height and increase its contrast against the background."))

    if sub["Clutter"] < 60:
        ideas.append(((1 - sub["Clutter"] / 100) * 50,
            "The design is visually busy. Remove decorative elements and leave more "
            "empty space around your main message."))

    if sub["Balance"] < 60:
        ideas.append(((1 - sub["Balance"] / 100) * 40,
            "The visual weight is concentrated on one side. Move or resize elements "
            "so the layout feels more balanced."))

    ideas.sort(key=lambda x: -x[0])
    tips = [text for _, text in ideas[:3]]

    fillers = [
        f"Keep '{target}' as the first thing people see and give it room around it.",
        "Limit the post to one main message and one call to action.",
        "Use no more than two typefaces and a small colour palette.",
    ]
    for f in fillers:
        if len(tips) == 3:
            break
        tips.append(f)
    return tips
  