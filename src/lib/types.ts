export type HeadingSource = "sensor" | "manual";

/** What the API returns for a camera. Never includes submitterHash. */
export type CameraDTO = {
  id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number;
  headingSource: HeadingSource;
  /** Covers every bearing at once — a dome or panoramic rig. `heading` is unused when true. */
  is360: boolean;
  photoUrl: string;
  photoWidth: number | null;
  photoHeight: number | null;
  note: string | null;
  capturedAt: string;
  createdAt: string;
  /** Username of whoever submitted it; null for rows predating accounts. */
  submittedBy: string | null;
  /** Whether the requesting viewer may delete it — see canDelete() in serialize.ts. */
  canDelete: boolean;
};

/** The signed-in account, as the browser sees it. Null means browsing as a guest. */
export type AuthUser = {
  id: string;
  username: string;
  role: "user" | "admin";
};

/** What the capture flow assembles before it is posted. */
export type DraftCamera = {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  heading: number | null;
  headingSource: HeadingSource;
  is360: boolean;
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
  is360: false,
  photo: null,
  photoPreviewUrl: null,
  photoWidth: null,
  photoHeight: null,
  note: "",
  capturedAt: null,
};
