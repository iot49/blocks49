import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/split-panel/split-panel.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';
import './rr-settings.ts';

/**
 * RrPage is a common layout wrapper for all main views in the application.
 * 
 * It provides a consistent header with:
 * - A view toggle button (dispatches 'rr-view-toggle').
 * - A slot for view-specific status information.
 * - A settings button to open the global configuration dialog.
 */
@customElement('rr-page')
export class RrPage extends LitElement {
  @property({ type: String })
  viewMode: 'editor' | 'live' = 'editor';

  @state()
  private _settingsPosition = 100;

  @state()
  private _lastOpenPosition = 70;

  constructor() {
    super();
    const saved = localStorage.getItem('rr-settings-position');
    if (saved) {
      const pos = parseFloat(saved);
      if (pos > 10 && pos < 90) {
        this._lastOpenPosition = pos;
      }
    }
  }

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

    main {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
      position: relative;
    }

    sl-icon-button::part(base) {
      color: white;
      transition: background-color 0.2s, color 0.2s, transform 0.2s;
      border-radius: var(--sl-border-radius-circle);
    }

    sl-icon-button::part(base):hover,
    sl-icon-button::part(base):focus-visible {
      background-color: rgba(255, 255, 255, 0.2);
      color: white;
      transform: scale(1.1);
    }

    sl-icon-button::part(base):active {
      background-color: rgba(255, 255, 255, 0.3);
      color: white;
      transform: scale(1.0);
    }
  `;

  connectedCallback() {
      super.connectedCallback();
      this.addEventListener('open-settings', () => this._settingsPosition = this._lastOpenPosition);
      this.addEventListener('close-settings', () => this._settingsPosition = 100);
  }

  /**
   * Toggles the settings panel open or closed.
   */
  private _handleSettingsClick() {
    if (this._settingsPosition === 100) {
      this._settingsPosition = this._lastOpenPosition;
    } else {
      this._settingsPosition = 100;
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
            <sl-icon-button 
                class="view-toggle"
                name=${this.viewMode === 'live' ? 'camera-video' : 'tools' } 
                @click=${this._handleViewToggle} 
                title=${this.viewMode === 'live' ? 'Switch to Editor' : 'Switch to Live View'}
                style="font-size: 1.5rem;"
            ></sl-icon-button>
            
            <slot name="status"></slot>
        </div>

        <div class="right-align">
            <sl-icon-button
            name="gear"
            label="Settings"
            style="font-size: 1.5rem;"
            @click=${this._handleSettingsClick}
          ></sl-icon-button>
        </div>
      </header>
      <main>
        <sl-split-panel 
            position=${this._settingsPosition} 
            @sl-reposition=${(e: any) => {
                const newPos = e.detail.position;
                
                // Guard 1: Ignore invalid/undefined values
                if (newPos === undefined || newPos === null || isNaN(newPos)) {
                    return;
                }

                // Guard 2: If we are intentionally closed (100), ignore accidental snaps to 0 or 100
                if (this._settingsPosition === 100 && (newPos === 0 || newPos === 100)) {
                    return;
                }

                this._settingsPosition = newPos;
                
                // Only persist sane open positions (between 10% and 90% of screen)
                if (this._settingsPosition > 10 && this._settingsPosition < 90) {
                    this._lastOpenPosition = this._settingsPosition;
                    localStorage.setItem('rr-settings-position', this._lastOpenPosition.toString());
                }
            }}
            style="height: 100%;"
        >
            <div slot="start" style="height: 100%; display: flex; flex-direction: column;">
                <slot></slot>
            </div>
            <div slot="end" style="height: 100%; overflow: hidden;">
                <rr-settings .open=${this._settingsPosition < 100}></rr-settings>
            </div>
        </sl-split-panel>
      </main>
    `;
  }
}
