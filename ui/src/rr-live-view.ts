import { LIVE_DISPLAY_UPDATE_INTERVAL_MS, LIVE_MARKER_SIZE } from './app/config.ts';
import { LitElement, html, css, svg } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { Manifest } from './app/manifest.ts';
import { R49File, r49FileContext } from './app/r49file.ts';
import { Classifier, classifierContext } from './app/classifier.ts';
import { statusBarStyles } from './styles/status-bar.ts';
import { getMarkerDefs } from './styles/marker-defs.ts';
import { getCameraStream } from './app/capture.ts';


interface LiveMarker {
  id: string;
  x: number;
  y: number;
  prediction: string;
}

@customElement('rr-live-view')
export class RrLiveView extends LitElement {
  @consume({ context: r49FileContext, subscribe: true })
  r49File!: R49File;

  @consume({ context: classifierContext, subscribe: true })
  @state()
  classifier: Classifier | undefined;

  get manifest(): Manifest {
    return this.r49File?.manifest;
  }

  private _stream: MediaStream | null = null;

  // Consolidated state for rendering, throttled to reduce re-renders
  @state()
  private _displayState = {
    markers: [] as LiveMarker[],
    tTotMs: 0,
    inferenceTimeMs: 0
  };

  @query('video')
  private _video!: HTMLVideoElement;

  private _isWorkerBusy = false;
  private _worker: Worker | null = null;
  private _loopId: number | null = null;

  // time live-view was last updated
  private _lastDisplayUpdateTime = 0;

  // total time to grab and classify a frame
  private _frameStartTime = 0;
  private _tTotMs = 0;

  async connectedCallback() {
    super.connectedCallback();
    this._initWorker();
    await this._startCamera();
    this._startLoop();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopCamera();
    this._stopLoop();
    this._terminateWorker();
  }

  private _initWorker() {
    if (this._worker) return;
    
    // Vite handles ?worker imports
    this._worker = new Worker(new URL('./app/classifier.worker.ts', import.meta.url), { type: 'module' });
    
    this._worker.onmessage = (e) => {
        const { type, payload, error } = e.data;
        if (type === 'results') {
            this._handleWorkerResults(payload.results, payload.inferenceTimeMs);
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

  private _handleWorkerResults(results: Record<string, string>, inferenceTimeMs: number) {
      this._isWorkerBusy = false;
      
      const labels = this.manifest?.images?.[0]?.labels;
      if (!labels) return;

      const classificationResults: LiveMarker[] = Object.entries(results).map(([id, prediction]) => ({
          id,
          x: labels[id]?.x || 0,
          y: labels[id]?.y || 0,
          prediction
      }));

      // Throttle display updates and stats updates
      const now = performance.now();
      if (now - this._lastDisplayUpdateTime >= LIVE_DISPLAY_UPDATE_INTERVAL_MS) {
          this._lastDisplayUpdateTime = now;
          this._displayState = {
              markers: classificationResults,
              tTotMs: this._tTotMs,
              inferenceTimeMs
          };
          
          if (Object.keys(results).length > 0) {
              // console.log(`[LiveView] Results (${Object.keys(results).length} markers):`, results);
          } else {
              console.log("[LiveView] No markers detected");
          }
      }
  }

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

  private async _sendFrameToWorker() {
    if (!this.manifest || !this.manifest.images || this.manifest.images.length === 0) return;
    if (!this._worker) return;

    const labels = this.manifest.images[0].labels;
    if (!labels) return;

    const dpt = this.manifest.dots_per_track;
    if (dpt <= 0) return;

    this._isWorkerBusy = true;

    try {
        const imageBitmap = await createImageBitmap(this._video);

        // Extract marker positions to simplify worker payload
        const markers: Record<string, {x: number, y: number}> = {};
        for (const [id, marker] of Object.entries(labels)) {
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

    // Calculate scale factors for rendering
    const manifestW = this.manifest?.camera.resolution.width || w;
    const manifestH = this.manifest?.camera.resolution.height || h;
    const scaleX = w / manifestW;
    const scaleY = h / manifestH;

    // Live Stats Template
    const { tTotMs, inferenceTimeMs, markers } = this._displayState;
    const numMarkers = markers.length;
    const perMarkerMs = numMarkers > 0 ? Number((inferenceTimeMs / numMarkers).toFixed(1)) : 0;

    const statusTemplate = html`
        <div slot="status" class="status-bar">
            <span>Live View</span>
            <span>Model: ${this.classifier ? `${this.classifier.model}-${this.classifier.precision}` : 'None'}</span>
            <span>FPS: ${tTotMs > 0 ? Math.round(1000 / tTotMs) : 0}</span>
            <!-- <span>Frame Acquisition: ${tTotMs > 0 ? Math.round(tTotMs - inferenceTimeMs) : 0}ms</span> -->
            <span>${perMarkerMs}ms/marker</span>
        </div>
    `;

    return html`
      <rr-page>
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
