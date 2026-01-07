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
      // Re-trigger re-render of the app by replacing the provided context identity.
      // This is the correct way for Lit context to propagate deep state changes
      // when using mutable objects. Logic belongs here in the provider.
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
    if (layoutId) {
      localStorage.setItem('rr-active-layout-id', layoutId);
      this._loadLayout(layoutId);
    }
  }

  private async _loadLayout(layoutId: string) {
    try {
      await this._layout.loadFromApi(layoutId);
    } catch (err) {
      console.error("Failed to sync layout:", err);
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

    // Restore session
    const lastId = localStorage.getItem('rr-active-layout-id');
    if (lastId) {
      this._loadLayout(lastId);
    }
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
