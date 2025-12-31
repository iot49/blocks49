import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { railsClient, type ApiLayout } from './api/client.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import './rr-settings.ts';

/**
 * RrPage is a common layout wrapper for all main views in the application.
 * 
 * It provides a consistent header with:
 * - A view toggle button (dispatches 'rr-view-toggle').
 * - A slot for view-specific status information.
 * - A settings button to open the global configuration dialog.
 * 
 * It also encapsulates the Shoelace dialog used for application-wide settings.
 */
@customElement('rr-page')
export class RrPage extends LitElement {
  // ... styles ...
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      font-family: sans-serif;
      overflow: hidden;
    }

    header {
      height: var(--rr-main-header-height);
      background-color: var(--sl-color-primary-600);
      color: var(--sl-color-neutral-0);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1em;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      font-weight: bold;
      font-size: 2em;
      flex-shrink: 0;
    }

    .left-align {
      display: flex;
      align-items: center;
      gap: 0.5em;
    }

    .right-align {
      display: flex;
      align-items: center;
      gap: 0.5em;
    }

    .view-toggle {
        cursor: pointer;
        font-size: 1.2rem;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.5em;
        height: 1.5em;
        border-radius: 50%;
        transition: background-color 0.2s;
    }
    
    .view-toggle:hover {
        background-color: rgba(255, 255, 255, 0.2);
    }

    main {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
      position: relative;
    }
  `;

  @state()
  layouts: ApiLayout[] = [];

  @state()
  selectedLayoutId: string = '';

  async firstUpdated() {
      try {
          this.layouts = await railsClient.listLayouts();
          if (this.layouts.length > 0) {
              this.selectedLayoutId = this.layouts[0].id;
              // We should notify parent or context of initial selection?
              // For now, let's just let the user pick.
          }
      } catch (e) {
          console.error("Failed to load layouts:", e);
      }
  }

  private _handleLayoutChange(e: CustomEvent) {
      const select = e.target as any;
      this.selectedLayoutId = select.value;
      console.log('Layout switched to:', this.selectedLayoutId);
      this._emitLayoutSelected(this.selectedLayoutId);
  }

  private _emitLayoutSelected(layoutId: string) {
      this.dispatchEvent(new CustomEvent('layout-selected', { 
          detail: { layoutId },
          bubbles: true, 
          composed: true 
      }));
  }

  connectedCallback() {
      super.connectedCallback();
      this.addEventListener('layout-selected', this._onLayoutSelected);
  }

  disconnectedCallback() {
      super.disconnectedCallback();
      this.removeEventListener('layout-selected', this._onLayoutSelected);
  }

  /**
   * Listener for `layout-selected` event found on `this` (bubbled from children).
   * Refetches list and updates selection.
   */
  private _onLayoutSelected = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const layoutId = detail.layoutId;
      
      // If the event came from our own dropdown change, we don't strictly need to refetch,
      // but if it came from creation, we definitely do.
      // Easiest is to always refetch to be safe/sync.
      // But avoid infinite loop if refetch triggers something? No.
      
      await this._fetchLayouts();
      
      if (this.layouts.some(l => l.id === layoutId)) {
        this.selectedLayoutId = layoutId;
      }
  }

  private async _fetchLayouts() {
      try {
          this.layouts = await railsClient.listLayouts();
      } catch(e) {
          console.error("Failed to refresh layouts", e);
      }
  }

  /**
   * Opens the settings dialog.
   */
  private _handleSettingsClick() {
    const dialog = this.shadowRoot?.querySelector('sl-dialog') as any;
    if (dialog) {
      dialog.show();
    }
  }

  /**
   * Dispatches a global event to RrMain to toggle between Editor and Live modes.
   */
  private _handleViewToggle() {
      this.dispatchEvent(new CustomEvent('rr-view-toggle', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <header>
        <div class="left-align">
            <div class="view-toggle" @click=${this._handleViewToggle} title="Toggle View">
               <sl-icon name="list"></sl-icon>
            </div>
            
            <sl-select 
                hoist 
                value=${this.selectedLayoutId} 
                @sl-change=${this._handleLayoutChange}
                style="width: 250px; margin-left: 1em; --sl-input-border-width: 0; --sl-input-background-color: transparent; --sl-input-color: white;"
            >
                ${this.layouts.map(l => html`
                    <sl-option value=${l.id}>${l.name}</sl-option>
                `)}
            </sl-select>

            <slot name="status"></slot>
        </div>

        <div class="right-align">
            <sl-icon-button
            name="gear"
            label="Settings"
            style="font-size: 1.5rem; color: white;"
            @click=${this._handleSettingsClick}
          ></sl-icon-button>
        </div>
      </header>
      <main>
        <slot></slot>
      </main>
      
      <sl-dialog label="Layout">
        <rr-settings></rr-settings>
      </sl-dialog>
    `;
  }
}
