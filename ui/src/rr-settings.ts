import { consume } from '@lit/context';
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Layout, layoutContext, Scale2Number } from './api/layout';
import { layoutClient } from './api/client.js';
import { 
  REF_LINE_COLOR, 
  MODEL_LIST, 
  PRECISION_OPTIONS,
  DEFAULT_MODEL,
  DEFAULT_PRECISION
} from './app/config.ts';


@customElement('rr-settings')
export class RrSettings extends LitElement {
  // Styles omitted (static styles = ...) - assuming replace_file_content preserves if I don't touch? 
  // Wait, I must provide replacement for range. I will target specific blocks or replace file if mostly changed.
  // I will use multi_replace for safer editing.
  
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .settings-table {
      display: table;
      width: 100%;
      border-spacing: 0 8px;
    }

    .settings-row {
      display: table-row;
    }

    .settings-label {
      display: table-cell;
      text-align: right;
      padding-right: 12px;
      vertical-align: middle;
      width: 150px;
    }

    .settings-field {
      display: table-cell;
      vertical-align: middle;
    }

    sl-input,
    sl-dropdown,
    sl-select {
      width: 200px;
    }

    /* Classifier Tab Styles */
    .classifier-settings {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    sl-radio-group::part(button-group) {
        gap: 8px;
    }
  `;

  @consume({ context: layoutContext, subscribe: true })
  layout!: Layout;

  @state()
  private _selectedModel: string = DEFAULT_MODEL;

  @state()
  private _selectedPrecision: string = DEFAULT_PRECISION;

  // TODO: make unique name, e.g. Layout-1, Layout-2, etc.
  @state()
  private _newLayoutName: string = 'Layout';

  @state()
  private _newLayoutScale: string = 'HO';

  // Helper getters
  get layoutName() { return this.layout?.layout?.name || ''; }
  get layoutScale() { return this.layout?.layout?.scale || 'HO'; }
  // Backend uses referenceDistanceMm.
  get layoutReferenceDistance() { return this.layout?.layout?.referenceDistanceMm || 0; }
  get cameraResolution() { return { width: 0, height: 0 }; } // Stub implementation

  connectedCallback() {
      super.connectedCallback();
      this._parseUrlParams();
  }

  private _parseUrlParams() {
      const params = new URLSearchParams(window.location.search);
      const urlModel = params.get('model');
      const urlPrecision = params.get('precision');

      // 1. Resolve Model (URL > LocalStorage > Default)
      let model = urlModel;
      if (!model || !MODEL_LIST.includes(model)) {
          model = localStorage.getItem('rr-selected-model');
          if (!model || !MODEL_LIST.includes(model)) {
              model = DEFAULT_MODEL;
          }
      }
      this._selectedModel = model;
      localStorage.setItem('rr-selected-model', model); // Sync/Update persistence

      // 2. Resolve Precision (URL > LocalStorage > Default)
      let precision = urlPrecision;
      if (!precision || !PRECISION_OPTIONS.includes(precision)) {
          precision = localStorage.getItem('rr-selected-precision');
          if (!precision || !PRECISION_OPTIONS.includes(precision)) {
              precision = DEFAULT_PRECISION;
          }
      }
      this._selectedPrecision = precision;
      localStorage.setItem('rr-selected-precision', precision); // Sync/Update persistence

      // Emit initial state
      this._emitChange();
  }

  private _emitChange() {
      this.dispatchEvent(new CustomEvent('rr-classifier-settings-change', {
          detail: {
              model: this._selectedModel,
              precision: this._selectedPrecision
          },
          bubbles: true,
          composed: true
      }));
  }

  render() {
    return html`
      <sl-tab-group>
        <sl-tab slot="nav" panel="layout">Layout</sl-tab>
        <sl-tab slot="nav" panel="classifier">Classifier</sl-tab>
        <sl-tab slot="nav" panel="project">Projects</sl-tab>

        <sl-tab-panel name="layout">
          ${this._renderLayoutSettings()}
        </sl-tab-panel>

        <sl-tab-panel name="classifier">
          ${this._renderClassifierSettings()}
        </sl-tab-panel>

        <sl-tab-panel name="project">
          ${this._renderProjectSettings()}
        </sl-tab-panel>
      </sl-tab-group>
    `;
  }

  private _renderLayoutSettings() {
    // TODO: replace width/heightwith referenceDistanceMm
    return html`
      <div class="settings-table">
        <div class="settings-row">
          <div class="settings-label">Name:</div>
          <div class="settings-field">
            <sl-input
              value=${this.layoutName}
              @sl-input=${this._handleLayoutNameChange}
            >
            </sl-input>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label" style="color: ${REF_LINE_COLOR}">Reference Dist (mm):</div>
          <div class="settings-field">
            <sl-input
              type="number"
              value=${this.layoutReferenceDistance}
              @sl-change=${this._handleReferenceDistanceChange}
            ></sl-input>
          </div>
        </div>
        <div class="settings-row">
           <!-- Placeholder for eventual other settings -->
        </div>
        <div class="settings-row">
          <div class="settings-label">Scale:</div>
          <div class="settings-field">
            <sl-dropdown>
              <sl-button class="scale" slot="trigger" caret>
                ${this.layoutScale}
              </sl-button>
              <sl-menu @sl-select=${this._handleScaleSelect}>
                ${Object.keys(Scale2Number).map(
                  (scale) =>
                    html`<sl-menu-item value=${scale}
                      >${scale} (1:${Scale2Number[scale as keyof typeof Scale2Number]})</sl-menu-item
                    >`,
                )}
              </sl-menu>
            </sl-dropdown>
          </div>
        </div>
      </div>
    `;
  }

  private _renderClassifierSettings() {
    return html`
      <div class="classifier-settings">
          <sl-radio-group 
              label="Model" 
              value=${this._selectedModel}
              @sl-change=${this._handleModelChange}
          >
              ${MODEL_LIST.map(m => html`<sl-radio-button value=${m}>${m}</sl-radio-button>`)}
          </sl-radio-group>

          <sl-radio-group 
              label="Precision" 
              value=${this._selectedPrecision}
              @sl-change=${this._handlePrecisionChange}
          >
              ${PRECISION_OPTIONS.map(p => html`<sl-radio-button value=${p}>${p}</sl-radio-button>`)}
          </sl-radio-group>
      </div>
    `;
  }

  private _renderProjectSettings() {
      return html`
        <div style="padding: 1rem; display: flex; flex-direction: column; gap: 1rem;">
            <h3>Create New Layout</h3>
            <sl-input 
                label="Layout Name" 
                value=${this._newLayoutName} 
                @sl-input=${(e: any) => this._newLayoutName = e.target.value}
            ></sl-input>
            
             <sl-select 
                label="Scale" 
                value=${this._newLayoutScale}
                @sl-change=${(e: any) => this._newLayoutScale = e.target.value}
            >
                ${Object.keys(Scale2Number).map(s => html`<sl-option value=${s}>${s}</sl-option>`)}
            </sl-select>

            <sl-button variant="primary" @click=${this._handleCreateLayout}>Create Layout</sl-button>
        </div>
      `;
  }

  // TODO: backup & restore layouts

  // TODO: replace with NewLayoutTool in rr-layout-editor. 
  // TODO: a way to delete layouts
  private async _handleCreateLayout() {
    console.log("Creating layout", this._newLayoutName, this._newLayoutScale);
      if (!this._newLayoutName) return alert("Name required");
      try {
          const layout = await layoutClient.createLayout(this._newLayoutName, this._newLayoutScale);
          // Dispatch selection
          this.dispatchEvent(new CustomEvent('layout-selected', { 
              detail: { layoutId: layout.id },
              bubbles: true, 
              composed: true 
          }));
          // Reset
          this._newLayoutName = '';          
          alert("Layout created! Please close settings.");
      } catch (e) {
          alert("Failed to create layout");
          console.error(e);
      }
  }

  private _handleModelChange(e: CustomEvent) {
      this._selectedModel = (e.target as any).value;
      localStorage.setItem('rr-selected-model', this._selectedModel);
      this._emitChange();
  }

  private _handlePrecisionChange(e: CustomEvent) {
      this._selectedPrecision = (e.target as any).value;
      localStorage.setItem('rr-selected-precision', this._selectedPrecision);
      this._emitChange();
  }

  private _handleLayoutNameChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.layout.setName(input.value);
  }

  private _handleScaleSelect(event: Event) {
    const menuItem = (event as CustomEvent).detail.item;
    const scale = menuItem.value as string;
    this.layout.setScale(scale);
  }

  private _handleReferenceDistanceChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const dist = parseFloat(input.value) || 0;
    this.layout.setReferenceDistance(dist);
  }
}
