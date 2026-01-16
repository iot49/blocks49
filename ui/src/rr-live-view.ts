import { LIVE_DISPLAY_UPDATE_INTERVAL_MS, LIVE_MARKER_SIZE } from './app/config.ts';
import { LitElement, html, css, svg } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { type Layout, layoutContext } from './api/layout.ts';
import { userContext } from './rr-main.ts';
import { type ApiUser } from './api/client.js';
import { Classifier, classifierContext } from './app/classifier.ts';
import { statusBarStyles } from './styles/status-bar.ts';
import { getMarkerDefs } from './styles/marker-defs.ts';
import { getCameraStream } from './app/capture.ts';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';

interface LiveMarker {
  id: string;
  x: number;
  y: number;
  prediction: string;
}

/**
 * RrLiveView provides a real-time camera view with overlayed classification results.
 * 
 * It uses a dual-threaded model:
 * 1. Main Thread: Handles camera stream, UI rendering, and frame capture.
 * 2. Web Worker: Handles synchronous ONNX inference to avoid blocking the UI.
 * 
 * Rendering in the main thread is throttled to reduce CPU/GPU load, while the 
 * classification loop runs as fast as the hardware allows.
 * 
 * Public Interface:
 * - classifier: The current active Classifier instance (FP32/FP16/Int8).
 * - layout: The active project context.
 */
@customElement('rr-live-view')
export class RrLiveView extends LitElement {
  @consume({ context: layoutContext, subscribe: true })
  layout!: Layout;

  @consume({ context: classifierContext, subscribe: true })
  @state()
  classifier: Classifier | undefined;

  @consume({ context: userContext, subscribe: true })
  @state()
  private _user: ApiUser | undefined;



  /** The media stream from the camera. Used for teardown. */
  private _stream: MediaStream | null = null;

  /** Consolidated state for rendering, throttled to reduce re-renders. */
  @state()
  private _displayState = {
    markers: [] as LiveMarker[],
    /** Total time taken for the entire frame processing cycle (capture + inference + overhead). */
    tTotMs: 0,
    /** Time spent by the worker on model inference for the last frame. */
    inferenceTimeMs: 0,
    /** The actual hardware backend used for inference (NPU, GPU, WASM). */
    executionProvider: ''
  };

  /** Reference to the video element used for frame capture. */
  @query('video')
  private _video!: HTMLVideoElement;

  /** Flag to prevent overwhelming the background worker with redundant requests. */
  private _isWorkerBusy = false;
  /** The classification Web Worker instance. */
  private _worker: Worker | null = null;
  /** ID for the requestAnimationFrame loop. */
  private _loopId: number | null = null;

  /** MQTT client for publishing results. */
  private _mqttClient: MqttClient | null = null;

  /** Timestamp of the last successful UI state update. */
  private _lastDisplayUpdateTime = 0;

  /** Timestamp of when the current frame capture began. Used for FPS and latency metrics. */
  private _frameStartTime = 0;
  /** The total cycle time (latency + overhead) of the most recent frame. */
  private _tTotMs = 0;

  async connectedCallback() {
    super.connectedCallback();
    this._initWorker();
    this._initMqtt();
    await this._startCamera();
    this._startLoop();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopCamera();
    this._stopLoop();
    this._terminateWorker();
    this._terminateMqtt();
  }

  /**
   * Initializes the Web Worker and sets up the message handler for classification results.
   */
  private _initWorker() {
    if (this._worker) return;
    
    // Vite handles ?worker imports
    this._worker = new Worker(new URL('./app/classifier.worker.ts', import.meta.url), { type: 'module' });
    
    this._worker.onmessage = (e) => {
        const { type, payload, error } = e.data;
        if (type === 'results') {
            this._handleWorkerResults(payload.results, payload.inferenceTimeMs, payload.executionProvider);
        } else if (type === 'error') {
            console.error("[ClassifierWorker] Error:", error);
        }
    };

    if (this.classifier) {
        this._worker.postMessage({ 
            type: 'init', 
            payload: { model: this.classifier.model, precision: this.classifier.precision } 
        });
    }
  }

  private _terminateWorker() {
      if (this._worker) {
          this._worker.terminate();
          this._worker = null;
      }
  }

  /**
   * Processes results arriving from the classification worker.
   * Updates the throttled UI state if the refresh interval has elapsed.
   * 
   * @param results Map of marker ID to predicted label
   * @param inferenceTimeMs Total time spent by the worker on model inference
   */
  private _handleWorkerResults(results: Record<string, string>, inferenceTimeMs: number, executionProvider: string) {
      this._isWorkerBusy = false;
      
      const markers = this.layout?.apiImages?.[0]?.markers;
      if (!markers) return;

      const classificationResults: LiveMarker[] = Object.entries(results).map(([id, prediction]) => ({
          id,
          x: markers[id]?.x || 0,
          y: markers[id]?.y || 0,
          prediction
      }));

      // Throttle display updates and stats updates
      const now = performance.now();
      if (now - this._lastDisplayUpdateTime >= LIVE_DISPLAY_UPDATE_INTERVAL_MS) {
          this._lastDisplayUpdateTime = now;
          this._displayState = {
              markers: classificationResults,
              tTotMs: this._tTotMs,
              inferenceTimeMs,
              executionProvider
          };
      }

      this._publishResults(classificationResults);
  }

  private _initMqtt() {
      if (this._mqttClient) return;
      
      const brokerUrl = this._user?.mqttBroker || `ws://${window.location.hostname}:8083`;
      console.log(`[MQTT] Connecting to ${brokerUrl}...`);
      this._mqttClient = mqtt.connect(brokerUrl, {
          clientId: `rails49_ui_${Math.random().toString(16).slice(2, 10)}`,
          clean: true,
          connectTimeout: 4000,
          reconnectPeriod: 1000,
      });

      this._mqttClient.on('connect', () => {
          console.log('[MQTT] Connected to NanoMQ');
      });

      this._mqttClient.on('error', (err) => {
          console.error('[MQTT] Connection error:', err);
      });
  }

  private _terminateMqtt() {
      if (this._mqttClient) {
          this._mqttClient.end();
          this._mqttClient = null;
      }
  }

  private _publishResults(markers: LiveMarker[]) {
      if (!this._mqttClient || !this._mqttClient.connected) return;

      const payload = {
          timestamp: Date.now(),
          layoutId: this.layout?.id,
          markers: markers.map(m => ({ id: m.id, prediction: m.prediction })),
          metrics: {
              inferenceTimeMs: this._displayState.inferenceTimeMs,
              tTotMs: this._tTotMs
          }
      };

      const topic = this.layout?.mqttTopic || 'marker/predict';
      this._mqttClient.publish(topic, JSON.stringify(payload), { qos: 0 });
  }

  /**
   * Requests camera access and attaches the stream to the hidden video element.
   */
  private async _startCamera() {
    try {
      this._stream = await getCameraStream();

      await this.updateComplete;

      if (this._video) {
        this._video.srcObject = this._stream;
        this._video.setAttribute('playsinline', '');
        this._video.muted = true;
        await this._video.play();
      }
    } catch (e) {
      console.error("Failed to start camera", e);
    }
  }

  private _stopCamera() {
    if (this._stream) {
      this._stream.getTracks().forEach(track => track.stop());
      this._stream = null;
    }
  }

  /**
   * Starts the internal processing loop using requestAnimationFrame.
   * The loop runs at the camera frame rate (e.g. 60fps) and captures a new frame 
   * whenever the worker is idle.
   */
  private _startLoop() {
    if (this._loopId) return;

    // Loop runs at the display refresh rate (e.g. 60fps).
    // Classification is throttled to the worker's processing speed.
    const loop = async (_: number) => {
      if (!this.isConnected) return;

      if (!this._isWorkerBusy && this._video && this._video.readyState >= 2) {
        const now = performance.now();
        if (this._frameStartTime > 0) {
          this._tTotMs = now - this._frameStartTime;
        }
        this._frameStartTime = now;
        this._sendFrameToWorker();
      }

      this._loopId = requestAnimationFrame(loop);
    };
    this._loopId = requestAnimationFrame(loop);
  }

  private _stopLoop() {
    if (this._loopId) {
      cancelAnimationFrame(this._loopId);
      this._loopId = null;
    }
  }

  /**
   * Captures the current video frame as an ImageBitmap and transfers it 
   * along with marker coordinates to the worker for classification.
   */
  private async _sendFrameToWorker() {
    if (!this.layout || !this.layout.apiImages || this.layout.apiImages.length === 0) return;
    if (!this._worker) return;

    const markersData = this.layout.apiImages[0].markers;
    if (!markersData) return;

    const dpt = this.layout.dots_per_track;
    if (dpt <= 0) return;

    this._isWorkerBusy = true;

    try {
        const imageBitmap = await createImageBitmap(this._video);

        // Extract marker positions to simplify worker payload
        const markers: Record<string, {x: number, y: number}> = {};
        for (const [id, marker] of Object.entries(markersData)) {
            markers[id] = { 
                x: marker.x, 
                y: marker.y
            };
        }

        this._worker.postMessage({
            type: 'classify-batch',
            payload: {
                imageBitmap,
                markers,
                dpt,
                timestamp: this._frameStartTime
            }
        }, [imageBitmap]); // Transfer the bitmap


    } catch (e) {
        console.error("Inference Post Error", e);
        this._isWorkerBusy = false;
    }
  }

  render() {
    const w = this._video?.videoWidth || 100;
    const h = this._video?.videoHeight || 100;

    // BUG: wrong marker position. Let's fix this later and focus on rr-marker for now.
    // Fix: Use actual layout resolution for scaling factors
    const firstImg = this.layout?._images?.[0];
    
    // We MUST have the image dimensions to scale correctly
    // If not loaded yet, try to trigger a load (but don't await here to keep render fast)
    if (firstImg && firstImg.width === 0) {
        firstImg.getBitmap(); 
    }

    const manifestW = firstImg?.width || 1000;
    const manifestH = firstImg?.height || 1000;
    
    const scaleX = w / manifestW;
    const scaleY = h / manifestH;

    // Live Stats Template
    const { tTotMs, inferenceTimeMs, markers, executionProvider } = this._displayState;
    const numMarkers = markers.length;
    const perMarkerMs = numMarkers > 0 ? Number((inferenceTimeMs / numMarkers).toFixed(1)) : 0;

    const statusTemplate = html`
        <div slot="status" class="status-bar">
            <span>Live View</span>
            <span>Model: ${this.classifier ? `${this.classifier.model}-${this.classifier.precision}` : 'None'} (${executionProvider || '...'})</span>
            <span>FPS: ${tTotMs > 0 ? Math.round(1000 / tTotMs) : 0}</span>
            <!-- <span>Frame Acquisition: ${tTotMs > 0 ? Math.round(tTotMs - inferenceTimeMs) : 0}ms</span> -->
            <span>${perMarkerMs}ms/marker</span>
        </div>
    `;

    return html`
      <rr-page viewMode="live">
        ${statusTemplate}
        <div style="position: relative; width: 100%; height: 100%;">
            <video></video>
            <svg class="overlay-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
                ${getMarkerDefs(LIVE_MARKER_SIZE)}
                ${this._displayState.markers.map(m => 
                  svg`<g><use href="#${m.prediction}" x="${m.x * scaleX}" y="${m.y * scaleY}"></use></g>`)}
            </svg>
        </div>
      </rr-page>
    `;
  }

  static styles = [
    statusBarStyles,
    css`
    :host {
      display: flex;
      flex-direction: column;
      flex-grow: 1;
      position: relative;
      background-color: #000;
      overflow: hidden;
    }
    
    video {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    
    .overlay-svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 10;
    }

    symbol {
      overflow: visible;
    }
    
    .validation-rect {
        fill: none;
        stroke-width: 3;
    }
  `];

}
