import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { captureImage } from './app/capture.ts';
import { Layout, layoutContext } from './api/layout';
import { layoutEditorStyles } from './styles/layout-editor.ts';
import { statusBarStyles } from './styles/status-bar.ts';

import { layoutClient, type ApiLayout } from './api/client.js';

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

  @state()
  private _layouts: ApiLayout[] = [];


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

  connectedCallback() {
      super.connectedCallback();
      this.addEventListener('layout-selected', this._onLayoutSelected);
      this._fetchLayouts();
  }

  disconnectedCallback() {
      super.disconnectedCallback();
      this.removeEventListener('layout-selected', this._onLayoutSelected);
  }

  willUpdate(changedProperties: Map<string | number | symbol, unknown>) {
      if (changedProperties.has('layout')) {
          const oldLayout = changedProperties.get('layout') as Layout | undefined;
          const newLayout = this.layout;

          // Only reset the index if the layout ID changed (new project loaded)
          // or if the number of images changed.
          // Note: RrMain replaces the instance on EVERY change to propagate state,
          // so we must compare the underlying IDs or image lengths.
          const layoutIdChanged = newLayout?.id !== oldLayout?.id;
          const imagesCountChanged = newLayout?.images?.length !== (oldLayout?.images?.length || 0);

          if (layoutIdChanged || imagesCountChanged) {
              if (this.images.length > 0) {
                  this.currentImageIndex = 0;
              } else {
                  this.currentImageIndex = -1;
              }
          }
      }
  }

  private _onLayoutSelected = async () => {
      // Proactively reset index to show loading/empty state
      this.currentImageIndex = -1;
      await this._fetchLayouts();
  }

  private async _fetchLayouts() {
      try {
          this._layouts = await layoutClient.listLayouts();
      } catch (e) {
          console.error("Failed to list layouts", e);
      }
  }

  private _handleLayoutMenuSelect(e: CustomEvent) {
      const item = e.detail.item;
      const layoutId = item.value;
      this._selectLayout(layoutId);
  }


  protected async firstUpdated() {
    try {
      // 1. Fetch available layouts
      await this._fetchLayouts();

      // 2. Priority Logic:
      // a. Is there a layout named "demo"?
      const demoLayout = this._layouts.find(l => l.name === 'demo');
      if (demoLayout) {
          this._selectLayout(demoLayout.id);
          return;
      }

      // b. Are there any other layouts?
      if (this._layouts.length > 0) {
          const firstLayout = this._layouts[0];
          this._selectLayout(firstLayout.id);
          return;
      }

      // c. Backend is empty, load demo.r49
      const response = await fetch('demo.r49');
      if (!response.ok) return;
      const blob = await response.blob();
      const file = new File([blob], 'demo.r49', { type: 'application/zip' });
      await this._load_r49(file);
    } catch (e) {
      console.warn('Failed to initialize layout', e);
    }
  }

  private _selectLayout(layoutId: string) {
      this.dispatchEvent(new CustomEvent('layout-selected', { 
          detail: { layoutId },
          bubbles: true, 
          composed: true 
      }));
  }

  render() {
    // If manifest hasn't loaded (unlikely since it's prop), handle gracefully
    if (!this.manifest) return html``;

    // Editor Mode Status
    const layout = this.manifest.layout;
    const dpt = this.manifest.dots_per_track;
    const allLayouts = [...this._layouts];
    if (!allLayouts.find(l => l.id === this.layout.id)) {
        allLayouts.push({
            id: this.layout.id,
            name: this.layout.name,
            scale: this.layout.layout.scale,
            userId: "",
            images: [],
            createdAt: this.layout.layout.createdAt || "",
            updatedAt: this.layout.layout.updatedAt || ""
        });
    }

    const statusTemplate = html`
      <div slot="status" class="status-bar">
          <sl-dropdown>
              <span slot="trigger" class="layout-name">
                  ${this.layout.name}
                  <sl-icon name="caret-down-fill" style="font-size: 0.8em; margin-top: 2px;"></sl-icon>
              </span>
              <sl-menu @sl-select=${this._handleLayoutMenuSelect}>
                  ${allLayouts.map(l => html`
                      <sl-menu-item type="checkbox" value=${l.id} ?checked=${l.id === this.layout.id}>${l.name}</sl-menu-item>
                  `)}
              </sl-menu>
          </sl-dropdown>
          <span>Scale: ${layout.scale}</span>
          <!-- <span>[Ref] Dist: ${layout.referenceDistanceMm ? layout.referenceDistanceMm.toFixed(0) : '?'} mm</span> -->
          <span>Resolution: ${dpt > 0 ? Math.round(dpt) + ' dpt' : 'Not Calibrated'}</span>
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

      // Ensure the auto-loaded demo is named "demo" as per requirement
      if (file.name === 'demo.r49') {
          this.layout.setName('demo');
      }

      // Check for existing layout with same name
      const existing = this._layouts.find(l => l.name === this.layout.name);
      if (existing) {
          this._selectLayout(existing.id);
          return;
      }

      this.currentImageIndex = 0;

      // Auto-migrate to backend
      const newId = await this.layout.migrateToBackend();
      
      // Dispatch event to sync and refresh UI
      this.dispatchEvent(new CustomEvent('layout-selected', { 
          detail: { layoutId: newId },
          bubbles: true, 
          composed: true 
      }));
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
