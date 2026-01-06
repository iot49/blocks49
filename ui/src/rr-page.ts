import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
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
    // BUG: sl-select is always blank. Also, it should be part 
    // the status slot in rr-layout-editor where it should allow to select the Layout, not here (should not show in rr-live-view).
    return html`
      <header>
        <div class="left-align">
            <div class="view-toggle" @click=${this._handleViewToggle} title="Toggle View">
               <sl-icon name="list"></sl-icon>
            </div>
            
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
      >
        <rr-settings></rr-settings>
      </sl-dialog>
    `;
  }
}
