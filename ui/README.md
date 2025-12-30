# RR Labeler UI

A web-based tool for labeling, calibrating, and real-time monitoring of model railroad layouts.

## Technical Stack

- **Framework**: [Lit](https://lit.dev/) (Web Components)
- **State Management**: Lit Context (`@lit/context`)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Machine Learning**: [onnxruntime-web](https://onnxruntime.ai/)
- **Language**: TypeScript

## Project Structure

- `src/`: Core source code
  - `app/`: Business logic and app-level services
    - `classifier.ts`: Main wrapper for ONNX inference.
    - `classifier.worker.ts`: Web Worker for background classification.
    - `r49file.ts`: Management of `.r49` project files.
    - `manifest.ts`: Layout description and marker metadata.
    - `capture.ts`: Camera and image acquisition utilities.
  - `styles/`: Shared CSS and SVG definitions.
  - `rr-main.ts`: Application entry and routing shell.
  - `rr-label.ts`: The interactive labeling and calibration component.
  - `rr-live-view.ts`: Real-time monitoring with background classification.
  - `rr-settings.ts`: Model selection and global configuration.

## Key Features

### Real-time Live View
The `rr-live-view` component acquired images at 60fps and performs asynchronous classification in a background Web Worker. It supports hardware acceleration via **WebGPU** and **WebNN** to minimize latency on modern devices (like Mac M-series).

### Labeling & Calibration
The `rr-label` component allows users to define marker positions, types, and calibration rectangles. Calibration calculates the "Dots Per Track" (DPT) needed for the classifier to accurately normalize image patches.

### Multi-Format Model Support
The UI supports switching between **FP32**, **FP16**, and **Int8** quantized models. It automatically detects the available hardware backend (NPU, GPU, or CPU) and reports performance metrics like FPS and per-marker inference time.

## Development

```bash
cd ui
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

## Usage & Operation

For a detailed user guide on calibration and labeling, see the top-level project documentation.
