import { consume } from '@lit/context';
import { LitElement, html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { Layout, layoutContext, Scale2Number } from './api/layout';
import { layoutClient } from './api/client.js';
import { 
  MODEL_LIST, 
  PRECISION_OPTIONS,
  DEFAULT_MODEL,
  DEFAULT_PRECISION
} from './app/config.ts';


@customElement('rr-settings')
export class RrSettings extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--sl-panel-background-color);
      border-left: 1px solid var(--sl-color-neutral-300);
      overflow: hidden;
      user-select: none;
    }
    
    .content {
      flex-grow: 1;
      overflow-y: auto;
      padding: 0;
    }

    .footer {
        padding: 1rem;
        background: var(--sl-color-neutral-50);
        border-top: 1px solid var(--sl-color-neutral-300);
        display: flex;
        justify-content: flex-end;
        flex-shrink: 0;
    }

    * {
      box-sizing: border-box;
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
      width: 100px;
      font-size: 0.9rem;
      color: var(--sl-color-neutral-600);
    }

    .settings-field {
      display: table-cell;
      vertical-align: middle;
    }

    sl-input,
    sl-textarea,
    sl-dropdown,
    sl-select {
      width: 100%;
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

    h3 {
      margin: 0 0 0.5rem 0;
      font-size: 1rem;
      color: var(--sl-color-neutral-600);
    }

    sl-tab-group {
        height: 100%;
        display: flex;
        flex-direction: column;
    }

    sl-tab-group::part(base) {
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    sl-tab-group::part(body) {
        flex-grow: 1;
        overflow-y: auto;
    }
  `;

  @consume({ context: layoutContext, subscribe: true })
  layout!: Layout;

  @property({ type: Boolean, reflect: true })
  open = false;

  @state()
  private _selectedModel: string = DEFAULT_MODEL;

  @state()
  private _selectedPrecision: string = DEFAULT_PRECISION;

  @state()
  private _layouts: any[] = [];
  @state()
  private _user: any = null;
  @state()
  private _newLayoutName: string = 'Layout';
  @state()
  private _newLayoutScale: string = 'HO';

  // Helper getters
  get layoutName() { return this.layout?.layout?.name || ''; }
  get layoutDescription() { return this.layout?.layout?.description || ''; }
  get layoutMqttTopic() { return this.layout?.mqttTopic || ''; }
  get layoutScale() { return this.layout?.layout?.scale || 'HO'; }
  // Backend uses referenceDistanceMm.
  get layoutReferenceDistance() { return this.layout?.layout?.referenceDistanceMm || 0; }

  connectedCallback() {
      super.connectedCallback();
      this._initClassifierSettings();
      this._fetchLayouts();
      this._fetchUser();
  }

  private _handleClose() {
    this.dispatchEvent(new CustomEvent('close-settings', { bubbles: true, composed: true }));
  }

  willUpdate(changedProperties: Map<string, any>) {
      if (changedProperties.has('layout')) {
          this._initClassifierSettings();
      }
  }

  private async _fetchUser() {
      try {
          this._user = await layoutClient.me();
      } catch (e) {
          console.error("Failed to fetch user", e);
      }
  }

  private async _fetchLayouts() {
      try {
          this._layouts = await layoutClient.listLayouts();
          this._newLayoutName = this._generateUniqueName();
      } catch (e) {
          console.error("Failed to list layouts", e);
      }
  }

  private _generateUniqueName(): string {
      const names = new Set(this._layouts.map(l => l.name));
      let i = 1;
      while (names.has(`Layout-${i}`)) {
          i++;
      }
      return `Layout-${i}`;
  }

  private _initClassifierSettings() {
      // 1. Resolve Model (Layout Metadata > LocalStorage > Default)
      let model = null;
      const layoutClassifier = this.layout?.layout?.classifier;
      
      if (layoutClassifier) {
          const parts = layoutClassifier.split('/');
          if (parts.length === 2 && MODEL_LIST.includes(parts[0])) {
              model = parts[0];
          }
      }

      if (!model || !MODEL_LIST.includes(model)) {
          model = localStorage.getItem('rr-selected-model');
          if (!model || !MODEL_LIST.includes(model)) {
              model = DEFAULT_MODEL;
          }
      }
      this._selectedModel = model!;

      // 2. Resolve Precision (Layout Metadata > LocalStorage > Default)
      let precision = null;

      if (layoutClassifier) {
          const parts = layoutClassifier.split('/');
          if (parts.length === 2 && PRECISION_OPTIONS.includes(parts[1])) {
              precision = parts[1];
          }
      }

      if (!precision || !PRECISION_OPTIONS.includes(precision)) {
          precision = localStorage.getItem('rr-selected-precision');
          if (!precision || !PRECISION_OPTIONS.includes(precision)) {
              precision = DEFAULT_PRECISION;
          }
      }
      this._selectedPrecision = precision!;

      // Sync/Update local storage persistence (optional but keeps consistency)
      localStorage.setItem('rr-selected-model', this._selectedModel);
      localStorage.setItem('rr-selected-precision', this._selectedPrecision);

      // Emit initial state to core
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
      <div class="content">
        <sl-tab-group>
            <sl-tab slot="nav" panel="profile">Profile</sl-tab>
            <sl-tab slot="nav" panel="layout">Layout</sl-tab>

            <sl-tab-panel name="profile">
            ${this._renderProfileSettings()}
            </sl-tab-panel>

            <sl-tab-panel name="layout">
            ${this._renderLayoutSettings()}
            </sl-tab-panel>
        </sl-tab-group>
      </div>
      <div class="footer">
        <sl-button variant="default" size="small" @click=${this._handleClose}>Close</sl-button>
      </div>
    `;
  }

  private _renderProfileSettings() {
      if (!this._user) return html`<div style="padding: 1rem;"><sl-spinner></sl-spinner></div>`;
      return html`
        <div style="padding: 1rem;">
          <div class="settings-table">
            <div class="settings-row">
                <div class="settings-label">Email:</div>
                <div class="settings-field">
                    <sl-input value=${this._user.email} readonly disabled size="small"></sl-input>
                </div>
            </div>
            <div class="settings-row">
                <div class="settings-label">Role:</div>
                <div class="settings-field">
                    <sl-input value=${this._user.role} readonly disabled size="small"></sl-input>
                </div>
            </div>
            <sl-divider></sl-divider>
            <div class="settings-row">
                <div class="settings-label">Profile:</div>
                <div class="settings-field">
                    <sl-textarea 
                        value=${this._user.profile || ''} 
                        @sl-change=${(e: any) => this._handleUserUpdate({ profile: e.target.value })}
                        placeholder="Enter profile info"
                        size="small"
                        rows="2"
                    ></sl-textarea>
                </div>
            </div>
            <div class="settings-row">
                <div class="settings-label">MQTT:</div>
                <div class="settings-field">
                    <sl-input 
                        value=${this._user.mqttBroker || ''} 
                        @sl-change=${(e: any) => this._handleUserUpdate({ mqttBroker: e.target.value })}
                        placeholder="mqtt://localhost:1883"
                        size="small"
                    ></sl-input>
                </div>
            </div>
          </div>
        </div>
      `;
  }

  private async _handleUserUpdate(updates: Partial<any>) {
      try {
          this._user = await layoutClient.updateUser(updates);
      } catch (e) {
          console.error("Failed to update user", e);
          alert("Failed to update profile");
      }
  }

  private _renderLayoutSettings() {
    return html`
      <div style="padding: 1rem; display: flex; flex-direction: column; gap: 1rem;">
        <div style="display: flex; justify-content: flex-end;">
            <sl-button variant="primary" size="small" @click=${this._handleCreateLayout}>
                <sl-icon slot="prefix" name="plus-lg"></sl-icon>
                New Layout
            </sl-button>
        </div>
        <sl-divider></sl-divider>
        <div class="settings-table">
        <div class="settings-row">
          <div class="settings-label">Name:</div>
          <div class="settings-field" style="display: flex; gap: 0.5rem; align-items: center;">
            <sl-input
              value=${this.layoutName}
              @sl-input=${this._handleLayoutNameChange}
              size="small"
            >
            </sl-input>
            <sl-icon-button 
                name="trash" 
                label="Delete Layout"
                style="font-size: 1rem; color: var(--sl-color-danger-600);"
                @click=${() => this._handleDeleteLayout(this.layout.id)}
            ></sl-icon-button>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label">Desc:</div>
          <div class="settings-field">
            <sl-textarea
              value=${this.layoutDescription}
              @sl-change=${(e: any) => this.layout.setDescription(e.target.value)}
              placeholder="Description..."
              size="small"
              rows="2"
            ></sl-textarea>
          </div>
        </div>
        <sl-divider></sl-divider>
        <div class="settings-row">
          <div class="settings-label">Ref [mm]:</div>
          <div class="settings-field">
            <sl-input
              type="number"
              value=${this.layoutReferenceDistance}
              @sl-change=${this._handleReferenceDistanceChange}
              size="small"
            ></sl-input>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label">Scale:</div>
          <div class="settings-field">
            <sl-dropdown>
              <sl-button slot="trigger" caret size="small" style="width: 100%;">
                ${this.layoutScale}
              </sl-button>
              <sl-menu @sl-select=${this._handleScaleSelect}>
                ${Object.keys(Scale2Number).map(
                  (scale) =>
                    html`<sl-menu-item type="checkbox" value=${scale} ?checked=${scale === this.layoutScale}
                      >${scale} (1:${Scale2Number[scale as keyof typeof Scale2Number]})</sl-menu-item
                    >`,
                )}
              </sl-menu>
            </sl-dropdown>
          </div>
        </div>
        <sl-divider></sl-divider>
        <div class="settings-row">
            <div class="settings-label">Model:</div>
            <div class="settings-field">
                <sl-radio-group 
                    value=${this._selectedModel}
                    @sl-change=${this._handleModelChange}
                    size="small"
                >
                    ${MODEL_LIST.map(m => html`<sl-radio-button value=${m}>${m}</sl-radio-button>`)}
                </sl-radio-group>
            </div>
        </div>
        <div class="settings-row">
            <div class="settings-label">Prec:</div>
            <div class="settings-field">
                <sl-radio-group 
                    value=${this._selectedPrecision}
                    @sl-change=${this._handlePrecisionChange}
                    size="small"
                >
                    ${PRECISION_OPTIONS.map(p => html`<sl-radio-button value=${p}>${p}</sl-radio-button>`)}
                </sl-radio-group>
            </div>
        </div>
        <sl-divider></sl-divider>
        <div class="settings-row">
            <div class="settings-label">MQTT:</div>
            <div class="settings-field">
                <sl-input 
                    value=${this.layoutMqttTopic} 
                    @sl-change=${(e: any) => this.layout.setMqttTopic(e.target.value)}
                    placeholder="Topic..."
                    size="small"
                ></sl-input>
            </div>
        </div>
      </div>
    </div>
      `;
  }



  private async _handleDeleteLayout(id: string) {
      if (!confirm("Delete this layout?")) return;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

      try {
          await layoutClient.deleteLayout(id);
          await this._fetchLayouts();
          
          if (id === this.layout.id) {
              if (this._layouts.length > 0) {
                   this.dispatchEvent(new CustomEvent('layout-selected', { 
                      detail: { layoutId: this._layouts[0].id },
                      bubbles: true, 
                      composed: true 
                  }));
              } else {
                  window.location.reload();
              }
          }
      } catch (e) {
          alert("Failed to delete layout");
      }
  }

  private async _handleCreateLayout() {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (!this._newLayoutName) return alert("Name required");
      try {
          const layout = await layoutClient.createLayout(this._newLayoutName, this._newLayoutScale);
          await this._fetchLayouts();
          this.dispatchEvent(new CustomEvent('layout-selected', { 
              detail: { layoutId: layout.id },
              bubbles: true, 
              composed: true 
          }));
      } catch (e) {
          alert("Failed to create layout");
      }
  }

  private _handleModelChange(e: CustomEvent) {
      this._selectedModel = (e.target as any).value;
      localStorage.setItem('rr-selected-model', this._selectedModel);
      this.layout.setClassifier(`${this._selectedModel}/${this._selectedPrecision}`);
      this._emitChange();
  }

  private _handlePrecisionChange(e: CustomEvent) {
      this._selectedPrecision = (e.target as any).value;
      localStorage.setItem('rr-selected-precision', this._selectedPrecision);
      this.layout.setClassifier(`${this._selectedModel}/${this._selectedPrecision}`);
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
