export type HeadingSource = "sensor" | "manual";

/** What the API returns for a camera. Never includes submitterHash. */
export type CameraDTO = {
  id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number;
  headingSource: HeadingSource;
  photoUrl: string;
  photoWidth: number | null;
  photoHeight: number | null;
  note: string | null;
  capturedAt: string;
  createdAt: string;
};

/** What the capture flow assembles before it is posted. */
export type DraftCamera = {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  heading: number | null;
  headingSource: HeadingSource;
  photo: Blob | null;
  photoPreviewUrl: string | null;
  photoWidth: number | null;
  photoHeight: number | null;
  note: string;
  capturedAt: string | null;
};

export const emptyDraft: DraftCamera = {
  lat: null,
  lng: null,
  accuracy: null,
  heading: null,
  headingSource: "sensor",
  photo: null,
  photoPreviewUrl: null,
  photoWidth: null,
  photoHeight: null,
  note: "",
  capturedAt: null,
};
