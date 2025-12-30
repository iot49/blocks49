# R49 Classifier Training & Data Pipeline

This directory contains the Python-side implementation for training models and managing datasets.

## Core Components

- **Manifest & Data Loading**:
  - `manifest.py`: Python implementation of the project manifest, providing parity with the TypeScript version.
  - `dataset.py`: Implements `R49Dataset` which exposes a collection of `.r49` files as a standard PyTorch dataset.
  - `dataloaders.py`: Provides `R49DataLoaders` for fastai, including support for data augmentation and training/validation splits.

- **Training & Export**:
  - `learn/learner.py`: High-level wrapper for training vision models using fastai. 
  - `learn/exporter.py`: Handles model conversion from PyTorch to ONNX (FP32, FP16, Int8) and finally to the optimized `.ort` format for web deployment.

## Key Features

### Dots Per Track (DPT) Calibration
The training pipeline uses the same DPT logic as the UI to ensure training patches and live-view patches are scaled identically. This is critical for model accuracy when deployed to the browser.

### Optimized Export
The `Exporter` automatically generates three variants of the model:
1. **FP32 (.ort)**: Highest accuracy, largest size.
2. **FP16 (.ort)**: Optimized for GPUs (Apple M-series).
3. **Int8 (.ort)**: Quantized for high-performance NPUs.

## Usage

Models are typically trained and exported using the scripts in the `bin/` directory:

```bash
# Train a model
python bin/train.py resnet18

# Export for UI
python bin/export.py resnet18
```