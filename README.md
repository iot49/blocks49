# Rails49 (iot49/rails49)

A real-time train detection and labeling system for model railroads.

## Overview

Rails49 consists of two major parts:
1. **Frontend (ui/)**: A web application for creating layouts, labeling images, and real-time monitoring using background ML classification.
2. **Backend (classifier/)**: A Python pipeline for processing `.r49` datasets, training models (ResNet, etc.), and exporting them for web deployment.

## Key Architectures

### Real-Time Live View
The browser-based Live View acquisitions image from a camera and uses a **Web Worker** to run ONNX models on the **NPU or GPU** (via WebNN/WebGPU). This allows for low-latency, real-time tracking of trains on the layout.

### Unified Calibration (DPT)
Both the UI and the Python training pipeline share the same "Dots Per Track" (DPT) calibration logic. This ensures that the image patches used during training exactly match the patches seen by the model during real-time inference.

## Quick Start

### 1. Training & Export (Python)
```bash
# Setup environment
python -m venv .venv
source .venv/bin/activate
pip install -e .

# Export a pre-trained model
python bin/export.py resnet18
```

### 2. Frontend Development (Web)
```bash
cd ui
npm install
npm run dev
```

## Documentation

- [UI Documentation (Vite + Lit)](ui/README.md)
- [Classifier & Training Pipeline (fastai + ONNX)](classifier/README.md)
- [Live View Architecture](LIVE_VIEW.md)
