import { LitElement, html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
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
  @property({ type: String })
  viewMode: 'editor' | 'live' = 'editor';
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


    main {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
      position: relative;
    }
  `;

  // No longer managing layouts here. 
  // RrLayoutEditor will handle its own selection.

  @state()
  private _isSettingsOpen = false;

  /**
   * Opens the settings dialog.
   */
  private _handleSettingsClick() {
    this._isSettingsOpen = true;
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
                style="font-size: 1.5rem; color: white;"
            ></sl-icon-button>
            
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
      
      <sl-dialog 
        label="Settings" 
        .open=${this._isSettingsOpen} 
        @sl-after-hide=${() => this._isSettingsOpen = false}
        @close-settings=${() => this._isSettingsOpen = false}
        style="--width: 600px;"
      >
        <rr-settings></rr-settings>
      </sl-dialog>
    `;
  }
}
