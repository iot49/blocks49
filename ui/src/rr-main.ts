import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { provide } from '@lit/context';
import { R49File, r49FileContext } from './app/r49file.ts';
import { Classifier, classifierContext } from './app/classifier.ts';

/**
 * RrMain is the root component of the application.
 * 
 * It manages the global application state and provides it to child components via context:
 * 1. R49File: The active project file containing the manifest and images.
 * 2. Classifier: The current ML model and precision used for inference.
 * 
 * It also handles the primary view routing between the Layout Editor and Live View modes.
 */
@customElement('rr-main')
export class RrMain extends LitElement {
  /** The active project file context. Provided to all child elements. */
  @provide({ context: r49FileContext })
  @state()
  private _r49File: R49File;

  /* 
     State Management:
     We hold a stable `_r49File` instance and provide it via Context.
     Consumers (rr-layout-editor, etc.) must listen to 'r49-file-changed' events 
     on this instance to trigger their own updates.
     This avoids recreating the R49File wrapper for every change.
  */

  /** The active classifier instance. Provided to all child elements. */
  @provide({ context: classifierContext })
  @state()
  _classifier: Classifier | undefined;

  /** Controls whether the app is in 'editor' (labeling/calibration) or 'live' (monitoring) mode. */
  @state()
  private _viewMode: 'editor' | 'live' = 'editor';

  constructor() {
    super();
    this._r49File = new R49File();
    this._r49File.addEventListener('r49-file-changed', this._handleFileChange);
  }

  /**
   * Recreates the R49File wrapper when the underlying manifest or images change.
   * This ensures a single stable reference for the Context while allowing state updates.
   */
  private _handleFileChange = (_: Event) => {
    // Clean up old instance logic:
    // 1. Remove RrMain's listener
    this._r49File.removeEventListener('r49-file-changed', this._handleFileChange);
    
    // 2. Detach old instance from Manifest (stop it from listening)
    // We use .detach() instead of .dispose() to PRESERVE the images/manifest for the new instance.
    this._r49File.detach();

    // 3. Create new instance (Copy Constructor)
    // This new instance takes the Manifest and Images from the old one.
    this._r49File = new R49File(this._r49File);
    
    // 4. Attach listener to new instance
    this._r49File.addEventListener('r49-file-changed', this._handleFileChange);
  }

  /**
   * Responds to model or precision changes requested by child components (e.g. Settings).
   */
  private _handleClassifierSettingsChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const { model, precision } = detail;
      
      // Deduplicate: Don't recreate if settings are the same
      if (this._classifier && this._classifier.model === model && this._classifier.precision === precision) {
          return;
      }

      console.log(`Setting classifier: ${model} (${precision})`);
      this._classifier = new Classifier(model, precision);
  }

  /**
   * Toggles between Editor and Live View modes.
   */
  private _handleViewToggle = () => {
      this._viewMode = this._viewMode === 'editor' ? 'live' : 'editor';
  };

  /**
   * Loads the selected layout from the API.
   */
  private _handleLayoutSelected = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const layoutId = detail.layoutId;
      console.log(`Loading layout: ${layoutId}`);
      if (layoutId) {
          this._r49File.syncFromApi(layoutId).catch(err => {
              console.error("Failed to sync layout:", err);
              alert("Failed to load layout. See console.");
          });
      }
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      font-family: sans-serif;
    }
  `;

  async connectedCallback() {
    super.connectedCallback();
    this.addEventListener('rr-view-toggle', this._handleViewToggle as EventListener);
    this.addEventListener('rr-classifier-settings-change', this._handleClassifierSettingsChange as EventListener);
    this.addEventListener('layout-selected', this._handleLayoutSelected as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('rr-view-toggle', this._handleViewToggle as EventListener);
    this.removeEventListener('rr-classifier-settings-change', this._handleClassifierSettingsChange as EventListener);
    this.removeEventListener('layout-selected', this._handleLayoutSelected as EventListener);
  }

  render() {
    // trivial routing
    return html`
        ${this._viewMode === 'live' 
            ? html`<rr-live-view></rr-live-view>`
            : html`<rr-layout-editor></rr-layout-editor>`
        }
    `;
  }
}
