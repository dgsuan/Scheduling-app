export type EditedImage = { uri: string; width: number; height: number };

export type ImageLightboxProps = {
  uri: string;
  width: number;
  height: number;
  /** Present when the image has been edited; enables "Revert to original". */
  originalUri?: string;
  title?: string;
  onClose: () => void;
  /** Editing is offered when provided (web). */
  onSave?: (next: EditedImage) => void;
  onRevert?: () => void;
};
