# API surface

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/cameras?bbox=w,s,e,n&limit=500` | — | `{ cameras: CameraDTO[], count, truncated }` |
| `POST` | `/api/cameras` | `multipart/form-data` | `201 { camera: CameraDTO }` |
| `GET` | `/api/cameras/:id` | — | `{ camera: CameraDTO }` |
| `GET` | `/api/photos/:key` | — | image bytes, immutable cache |

## POST /api/cameras fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `photo` | file | yes | JPEG / PNG / WebP, magic-number checked, 8 MB cap |
| `lat` | number | yes | -90 … 90 |
| `lng` | number | yes | -180 … 180 |
| `heading` | number | yes | 0 … 360, degrees clockwise from true north |
| `headingSource` | `sensor` \| `manual` | no | defaults to `sensor` |
| `accuracy` | number | no | metres; omitted when the pin was placed by hand |
| `photoWidth` / `photoHeight` | int | no | lets the client reserve layout space |
| `note` | string | no | 280 chars |
| `capturedAt` | ISO 8601 | no | rejected if in the future; defaults to now |

## Status codes

`400` malformed body or query · `413` photo too large · `415` disallowed or
mismatched image type · `429` rate limited, with `Retry-After` · `502` storage
write failed · `500` insert failed
