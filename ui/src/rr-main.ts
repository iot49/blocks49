import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { provide } from '@lit/context';
import { Layout, layoutContext } from './api/layout';
import { Classifier, classifierContext } from './app/classifier.ts';

/**
 * RrMain is the root component of the application.
 * 
 * It manages the global application state and provides it to child components via context:
 * 1. Layout: The active project file containing the manifest and images.
 * 2. Classifier: The current ML model and precision used for inference.
 * 
 * It also handles the primary view routing between the Layout Editor and Live View modes.
 */
@customElement('rr-main')
export class RrMain extends LitElement {
  /** The active project file context. Provided to all child elements. */
  @provide({ context: layoutContext })
  @state()
  private _layout: Layout;

  /* 
     State Management:
     We hold a stable `_layout` instance and provide it via Context.
     Consumers (rr-layout-editor, etc.) must listen to 'rr-layout-changed' events 
     on this instance to trigger their own updates.
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
    this._layout = new Layout();
    this._layout.addEventListener('rr-layout-changed', this._handleLayoutChange);
  }

  /**
   * Recreates the Layout wrapper when the underlying data changes significantly (optional).
   * Note: Layout uses internal reactivity so we might not need to replace the instance always,
   * but sticking to the pattern of immutability for Lit Context if deep properties change.
   * However, Layout emits events.
   * 
   * For now, we just force update.
   */
  private _handleLayoutChange = (e: Event) => {
      // Successive moves might still be firing on the old Layout instance 
      // before the component re-renders with the new one.
      // We clone the emitting instance to ensure we always have latest data.
      const current = e.target as Layout;
      const next = new Layout(current);
      next.addEventListener('rr-layout-changed', this._handleLayoutChange);
      this._layout = next;
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
          this._layout.loadFromApi(layoutId).catch(err => {
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
