/**
 * Train Detector Shared Configuration
 */

/** Application title displayed in the UI. */
export const TITLE = 'Train Detector';

/** Default model used for classification. */
export const DEFAULT_MODEL = 'resnet18';

/** Default precision used for the model (e.g., 'int8', 'fp16', 'fp32'). */
export const DEFAULT_PRECISION = 'int8';

/** List of available models. */
export const MODEL_LIST = [
  'resnet18',
  'mobilenetV2',
];

/** Available precision options for model execution. */
export const PRECISION_OPTIONS = [
  'fp32',
  'fp16', 
  'int8',
];

/** Spacing of standard railroad tracks [mm]. */
export const STANDARD_GAUGE_MM = 1435; 

/** Default scale for model railroad layouts (e.g., 87 for HO). */
export const DEFAULT_SCALE = 87;  

/** Scaled size of markers in pixels in the editor view. */
export const MARKER_SIZE_PX = 36;

/** Size of markers in the live display view. */
export const LIVE_MARKER_SIZE = 80;

/** Visible radius for drag handles. */
export const DRAG_HANDLE_VISUAL_RADIUS = 0.1;

/** Interaction radius for drag handles (hitbox size). */
export const DRAG_HANDLE_INTERACTION_RADIUS = 2; 

/** Color for the reference calibration line. */
export const REF_LINE_COLOR = 'red';

/** Camera configuration for image capture. */
export const CAMERA_PARAMS = {
  facingMode: 'environment',
  width: { ideal: 4096 },
  height: { ideal: 2160 },
};

/** Interval in milliseconds between live display updates. */
export const LIVE_DISPLAY_UPDATE_INTERVAL_MS = 2000;

/** Timeout in milliseconds before committing local state changes to the database. */
export const DB_COMMIT_TIMEOUT_MS = 1500;

/** 
 * Maximum number of layouts a single user is permitted to create.
 * Enforced on the backend during creation.
 */
export const MAX_LAYOUTS = 5;

/** 
 * Maximum number of images allowed per layout.
 * Enforced on the backend during upload.
 */
export const MAX_IMAGES = 5;
