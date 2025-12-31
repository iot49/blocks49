import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';

import { captureImage } from './app/capture.ts';



import { Layout, layoutContext } from './api/layout';


import { layoutEditorStyles } from './styles/layout-editor.ts';

import { statusBarStyles } from './styles/status-bar.ts';

/**
 * RrLayoutEditor is the primary workspace for creating and editing model railroad layouts.
 * 
 * It manages:
 * - The status bar showing layout metadata (name, scale, size, DPT).
 * - A sidebar with file tools (Open/Save) and labeling tools (Track, Train, etc.).
 * - An image carousel (thumbnail bar) for navigating between captured images.
 * - The main layout view (rendered via `rr-label`).
 * 
 * It also handles the initial loading of the demo project if no images are present.
 */
@customElement('rr-layout-editor')
export class RrLayoutEditor extends LitElement {
  @consume({ context: layoutContext, subscribe: true })
  layout!: Layout;

  // Convenience getter
  get manifest() {
      // Compatibility shim: return structure expected by existing code if possible
      // But ideally we migrate usage.
      // Existing code expects: this.manifest.layout, this.manifest.images, etc.
      // Layout has .layout getter returning ApiLayout
      // We can map it.
      return {
          layout: this.layout.layout,
          images: this.layout.apiImages,
          dots_per_track: this.layout.dots_per_track,
          // Camera resolution? Layout doesn't have it explicitly yet, maybe in size?
          // Using any cast to bypass for now or stubbing.
          camera: { resolution: { width: 0, height: 0 } }
      };
  }

  get images(): { filename: string, labels: any }[] {
    return this.layout.apiImages.map(img => ({
        filename: img.filename,
        labels: img.labels || {}
    }));
  }

  /** The index of the currently selected image in the manifest. */
  @state()
  currentImageIndex: number = -1;

  /** The ID of the currently active tool (e.g. 'track', 'train', 'delete'). */
  @state()
  activeTool: string | null = null;

  static styles = [
    statusBarStyles,
    layoutEditorStyles
  ];

  protected async firstUpdated() {
    try {
      if (this.images.length > 0) return;

      // TODO: better way to handle this? Add to database? Or just remove?
      // Load default demo.r49 from server (not disk) if no images are present in R49File
      const response = await fetch('demo.r49');
      if (!response.ok) return;
      const blob = await response.blob();
      const file = new File([blob], 'demo.r49', { type: 'application/zip' });
      this._load_r49(file);
    } catch (e) {
      console.warn('Failed to load demo.r49', e);
    }
  }

  render() {
    // If manifest hasn't loaded (unlikely since it's prop), handle gracefully
    if (!this.manifest) return html``;

    // Editor Mode Status
    const layout = this.manifest.layout;
    const dpt = this.manifest.dots_per_track;
    const statusTemplate = html`
      <div slot="status" class="status-bar">
          <span style="font-weight: bold; font-size: var(--sl-font-size-medium);">${layout.name || 'Untitled Layout'}</span>
          <span>Scale: ${layout.scale}</span>
          <span>Ref Dist: ${layout.referenceDistanceMm ? layout.referenceDistanceMm.toFixed(0) : '?'} mm</span>
          <span>Resolution: ${dpt > 0 ? dpt.toFixed(2) + ' dpt' : 'Not Calibrated'}</span>
      </div>
    `;

    return html`
      <rr-page>
        ${statusTemplate}
        <div class="container">
          <nav>${this._fileToolsTemplate()} ${this._labelToolsTemplate()}</nav>
          <div class="main-content">
          ${this._thumbnailBarTemplate()}
          <main>
            ${this.currentImageIndex >= 0
            ? this._renderMainContent()
            : html``}
          </main>
          </div>
        </div>
      </rr-page>
    `;
  }

  private _fileToolsTemplate() {
    return html`
      <div class="toolbar-group">
        ${this._renderToolButton('Open Project or Upload Image', 'folder2-open', 'open', false)},
        ${this._renderToolButton('Save Image', 'floppy', 'save', this.currentImageIndex < 0)}
      </div>
    `;
  }

  private _thumbnailBarTemplate() {
    return html`
      <div class="thumbnails">
        ${this.images.map(
          (_, index) => html`
            <div class="thumbnail-wrapper">
              <img
                src="${this.layout.images[index]?.objectURL}"
                class="thumbnail ${index === this.currentImageIndex ? 'active' : ''}"
                @click=${() => (this.currentImageIndex = index)}
              />
              <div class="delete-btn" @click=${(e: Event) => this._handleDeleteImage(e, index)}>
                <sl-icon name="x-lg"></sl-icon>
              </div>
            </div>
          `,
        )}
        <div class="add-image-btn" @click=${() => this._handleAddImageClick('camera')}>
          <sl-icon name="camera"></sl-icon>
        </div>
        <div class="add-image-btn" @click=${() => this._handleAddImageClick('file')}>
          <sl-icon name="folder-plus"></sl-icon>
        </div>
      </div>
    `;
  }

  private _labelToolsTemplate() {
    // Safety check if manifest is undefined (should come from prop)
    const disabled = this.currentImageIndex < 0 || !this.manifest?.layout?.referenceDistanceMm;

    return html` <div class="toolbar-group">
      ${this._renderToolButton('Label as Other', 'question-circle', 'other', disabled)}
      ${this._renderToolButton('Label as Track', 'sign-railroad', 'track', disabled)}
      ${this._renderToolButton('Label as Train Car', 'truck-front', 'train', disabled)}
      ${this._renderToolButton(
      'Label as Train Front/Back',
      'arrow-bar-right',
      'train-end',
      disabled,
    )}
      ${this._renderToolButton(
      'Label as Train Coupling',
      'arrows-collapse-vertical',
      'coupling',
      disabled,
    )}
      ${this._renderToolButton('Delete Label', 'trash3', 'delete', disabled)}
      ${this._renderToolButton('Debug (Log Coordinates)', 'check-circle', 'debug', disabled)}
    </div>`;
  }

  private _renderToolButton(toolTip: string, name: string, tool_id: string, disabled: boolean) {
    return html`
      <sl-tooltip content=${toolTip}>
        <sl-icon-button
          name=${name}
          style="font-size: 2em; color: white;"
          @click=${() => this._handleToolClick(tool_id)}
          ?disabled=${disabled}
          class=${this.activeTool === tool_id ? 'active-tool' : ''}
        ></sl-icon-button>
      </sl-tooltip>
    `;
  }

  private async _handleToolClick(tool_id: string) {
    switch (tool_id) {
      case 'open': {
        this.activeTool = null;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.r49,application/zip,.zip,image/jpeg,image/png,image/jpg';
        input.onchange = this._handleChooseFile.bind(this);
        input.click();
        break;
      }
      case 'save': {
        this.layout.save();
        break;
      }
      default: {
        this.activeTool = tool_id;
        break;
      }
    }
  }

  private _renderMainContent() {
    // Default view
    return html` <rr-label
      .imageIndex=${this.currentImageIndex}
      .activeTool=${this.activeTool}
    ></rr-label>`;
  }

  private async _load_r49(file: File) {
    try {
      await this.layout.load(file);
      this.currentImageIndex = 0;
      
      // Removed auto-migration for now as Layout doesn't implement it yet.
      // This will just load it into local memory view.
    } catch (e) {
      alert(`Error loading file: ${(e as Error).message}`);
      console.error(e);
    }
  }

  private async _load_imgfile(file: File) {
    try {
        // We'll rely on Layout to handle adding images. 
        // Layout currently has `addImage` but it takes LayoutImage.
        // We need a helper or Layout should accept File.
        // For now:
        const { LayoutImage } = await import('./api/layout-image');
        const img = new LayoutImage(file, file.name);
        // validate? R49File did validation. Layout.addImage doesn't validation yet.
        this.layout.addImage(img);

        // Switch to the new image
        const newIndex = this.images.length - 1;
        this.currentImageIndex = newIndex;
    } catch (e) {
        alert((e as Error).message);
    }
  }

  private _handleChooseFile(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      file.name.toLowerCase().endsWith('.r49') ? this._load_r49(file) : this._load_imgfile(file);
    }
  }

  /**
   * Dispatches the image capture process and adds the result to the project.
   */
  private async _performInstantCapture() {
    const file = await captureImage();
    if (file) {
      this._load_imgfile(file);
    }
  }

  /**
   * Handles adding a new image from either the camera or a file input.
   */
  private _handleAddImageClick(source: 'camera' | 'file') {
    if (source === 'camera') {
      this._performInstantCapture();
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg, image/jpg, image/png';
      input.onchange = (e) => this._handleChooseFile(e);
      input.click();
    }
  }

  /**
   * Deletes an image from the project and handles index management for the carousel.
   */
  private _handleDeleteImage(e: Event, index: number) {
    e.stopPropagation(); // Prevent selecting the image when deleting

    // Remove image from array
    // Remove image using Layout method
    this.layout.removeImage(index);
    
    // Request update to refresh UI
    this.requestUpdate();
    // Context update handles re-render

    // Update index if needed
    if (this.currentImageIndex > index) {
      this.currentImageIndex--;
    } else if (this.currentImageIndex >= this.images.length) {
      this.currentImageIndex = this.images.length - 1;
    } else if (this.currentImageIndex === index) {
      // If we deleted the current image, safety check (handled by length check above mostly, but good for clarity)
      this.currentImageIndex = Math.max(0, this.currentImageIndex - 1);
      if (this.images.length === 1) this.currentImageIndex = 0;
    }

    // If no images left, reset
    if (this.images.length === 0) {
      this.currentImageIndex = -1;
    }
  }
}
