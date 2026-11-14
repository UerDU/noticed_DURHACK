import torch
import cv2
import numpy as np
import matplotlib.pyplot as plt

from PIL import Image
import os
import glob

# Create results directory
os.makedirs("results", exist_ok=True)

print("AI Attention Analysis Started")

# Load image
def load_image(image_path):

    image = Image.open(image_path).convert("RGB")

    return np.array(image)


# Generate a saliency prediction using a pretrained model
def generate_saliency(image_array, model):

    image_tensor = torch.from_numpy(
        image_array.copy()
    ).float()

    image_tensor = image_tensor.permute(2, 0, 1)
    image_tensor = image_tensor.unsqueeze(0) / 255.0

    with torch.no_grad():
        prediction = model(image_tensor)

    saliency = prediction.squeeze().cpu().numpy()

    return saliency


# Display and save results
def display_results(image, saliency, filename):

    saliency = cv2.resize(
        saliency,
        (image.shape[1], image.shape[0])
    )

    saliency = cv2.normalize(
        saliency,
        None,
        0,
        255,
        cv2.NORM_MINMAX
    ).astype(np.uint8)

    heatmap = cv2.applyColorMap(
        saliency,
        cv2.COLORMAP_JET
    )

    heatmap = cv2.cvtColor(
        heatmap,
        cv2.COLOR_BGR2RGB
    )

    overlay = cv2.addWeighted(
        image,
        0.5,
        heatmap,
        0.5,
        0
    )

    plt.figure(figsize=(15, 5))

    plt.subplot(1, 3, 1)
    plt.imshow(image)
    plt.title("Original Image")
    plt.axis("off")

    plt.subplot(1, 3, 2)
    plt.imshow(heatmap)
    plt.title("AI Saliency Heatmap")
    plt.axis("off")

    plt.subplot(1, 3, 3)
    plt.imshow(overlay)
    plt.title("Attention Overlay")
    plt.axis("off")

    plt.tight_layout()

    plt.savefig(
        f"results/{filename}_result.png"
    )

    plt.show()

    image_paths = []

for extension in ["*.jpg", "*.jpeg", "*.png"]:
    image_paths.extend(
        glob.glob(f"test_images/{extension}")
    )

print("Images found:", len(image_paths))

for path in image_paths:
    print(path)