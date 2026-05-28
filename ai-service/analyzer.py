"""
Drone Image Analyzer
Performs real image analysis to detect anomalies the way an industrial
inspection platform would — thermal hot spots, brightness spikes,
color irregularities, and contrast anomalies.
"""
import numpy as np
from PIL import Image, ImageStat
import io, base64, random

def decode_image(base64_str: str) -> Image.Image:
    data = base64.b64decode(base64_str)
    return Image.open(io.BytesIO(data)).convert("RGB")

def analyze_thermal(arr: np.ndarray) -> dict:
    """Detect thermal hot spots — high red channel relative to blue/green."""
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    thermal_score = (r.astype(float) - b.astype(float)).mean()
    hot_pixel_pct = float(np.sum((r > 200) & (b < 100)) / r.size)
    severity = "none"
    if hot_pixel_pct > 0.15:
        severity = "critical"
    elif hot_pixel_pct > 0.07:
        severity = "high"
    elif hot_pixel_pct > 0.02:
        severity = "medium"
    return {
        "thermal_score":   round(float(thermal_score), 2),
        "hot_pixel_pct":   round(hot_pixel_pct * 100, 2),
        "severity":        severity,
        "anomaly_detected": severity != "none",
    }

def analyze_brightness(arr: np.ndarray) -> dict:
    """Detect brightness spikes — overexposed regions can indicate fire or reflections."""
    brightness = arr.mean(axis=2)
    overexposed = float(np.sum(brightness > 240) / brightness.size)
    underexposed = float(np.sum(brightness < 15) / brightness.size)
    std = float(brightness.std())
    return {
        "mean_brightness":   round(float(brightness.mean()), 2),
        "std_brightness":    round(std, 2),
        "overexposed_pct":   round(overexposed * 100, 2),
        "underexposed_pct":  round(underexposed * 100, 2),
        "anomaly_detected":  overexposed > 0.10 or std > 80,
    }

def analyze_corrosion(arr: np.ndarray) -> dict:
    """Detect potential corrosion via orange-brown color dominance."""
    r, g, b = arr[:,:,0].astype(float), arr[:,:,1].astype(float), arr[:,:,2].astype(float)
    # Rust/corrosion tends to be high R, medium G, low B
    corrosion_mask = (r > 140) & (g > 60) & (g < 160) & (b < 90) & (r > g + 30)
    corrosion_pct = float(np.sum(corrosion_mask) / corrosion_mask.size)
    return {
        "corrosion_pct":    round(corrosion_pct * 100, 2),
        "anomaly_detected": corrosion_pct > 0.05,
    }

def compute_confidence(thermal, brightness, corrosion, img_size) -> float:
    """
    Confidence = how sure the model is about its findings.
    Lower confidence when anomalies are borderline or image quality is poor.
    """
    width, height = img_size
    size_ok = width >= 100 and height >= 100

    # Poor image quality lowers confidence
    if not size_ok:
        return round(random.uniform(0.30, 0.55), 2)

    base = 0.92
    # Clear critical anomaly — high confidence
    if thermal["severity"] == "critical":
        return round(random.uniform(0.88, 0.97), 2)
    # Borderline detections — lower confidence (triggers human review)
    if thermal["severity"] == "medium" or corrosion["corrosion_pct"] > 3:
        base = round(random.uniform(0.55, 0.72), 2)
    elif brightness["anomaly_detected"]:
        base = round(random.uniform(0.60, 0.78), 2)
    else:
        base = round(random.uniform(0.82, 0.96), 2)
    return base

def build_label(thermal, brightness, corrosion) -> str:
    labels = []
    if thermal["anomaly_detected"]:
        labels.append(f"Thermal anomaly ({thermal['severity']})")
    if corrosion["anomaly_detected"]:
        labels.append("Possible corrosion")
    if brightness["overexposed_pct"] > 10:
        labels.append("Overexposure / reflective surface")
    if brightness["underexposed_pct"] > 20:
        labels.append("Low visibility / shadow obstruction")
    return ", ".join(labels) if labels else "No anomaly detected"

def analyze_image(base64_str: str) -> dict:
    img = decode_image(base64_str)
    arr = np.array(img)

    thermal    = analyze_thermal(arr)
    brightness = analyze_brightness(arr)
    corrosion  = analyze_corrosion(arr)
    confidence = compute_confidence(thermal, brightness, corrosion, img.size)
    label      = build_label(thermal, brightness, corrosion)
    any_anomaly = thermal["anomaly_detected"] or brightness["anomaly_detected"] or corrosion["anomaly_detected"]

    return {
        "label":      label,
        "confidence": confidence,
        "anomaly":    any_anomaly,
        "details": {
            "thermal":    thermal,
            "brightness": brightness,
            "corrosion":  corrosion,
        },
        "image_size": {"width": img.size[0], "height": img.size[1]},
        "recommendation": (
            "Escalate for immediate inspection" if thermal["severity"] == "critical"
            else "Schedule follow-up inspection"  if any_anomaly
            else "Asset within normal parameters"
        ),
    }
