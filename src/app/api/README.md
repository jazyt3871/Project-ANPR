# API surface

| Method | Path | Auth | Body | Returns |
| --- | --- | --- | --- | --- |
| `GET` | `/api/cameras?bbox=w,s,e,n&limit=500` | none | — | `{ cameras: CameraDTO[], count, truncated }` |
| `POST` | `/api/cameras` | required | `multipart/form-data` | `201 { camera: CameraDTO }` |
| `GET` | `/api/cameras/:id` | none | — | `{ camera: CameraDTO }` |
| `DELETE` | `/api/cameras/:id` | required | — | `{ ok: true, id }` |
| `GET` | `/api/photos/:key` | none | — | image bytes, immutable cache |
| `POST` | `/api/auth/register` | none | `{ username, password }` | `201 { user }`, sets session cookie |
| `POST` | `/api/auth/login` | none | `{ username, password }` | `{ user }`, sets session cookie |
| `POST` | `/api/auth/logout` | none | — | `{ ok: true }`, clears session cookie |
| `GET` | `/api/auth/me` | none | — | `{ user: AuthUser \| null }` |
| `GET` | `/api/geo` | none | — | `{ bounds: [w,s,e,n], country: string \| null }`, for the map's opening view |

"Auth" here means a session cookie, not a token in the body — see
[Accounts](../../../README.md#accounts).

## CameraDTO

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | UUID |
| `lat` / `lng` | number | WGS84 |
| `accuracy` | number \| null | metres; null when placed by hand |
| `heading` | number | 0 … 360; meaningless when `is360` is true (stored as `0`) |
| `headingSource` | `sensor` \| `manual` | |
| `is360` | boolean | a dome/panoramic rig with no single bearing |
| `photoUrl` | string | |
| `photoWidth` / `photoHeight` | number \| null | |
| `note` | string \| null | |
| `capturedAt` / `createdAt` | ISO 8601 | |
| `submittedBy` | string \| null | username, or null for rows predating accounts |
| `canDelete` | boolean | true for the owner, or any admin, given the requesting session |

## POST /api/cameras fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `photo` | file | yes | JPEG / PNG / WebP, magic-number checked, 8 MB cap |
| `lat` | number | yes | -90 … 90 |
| `lng` | number | yes | -180 … 180 |
| `heading` | number | yes | 0 … 360, degrees clockwise from true north. Ignored if `is360` is `"true"` — send `0` |
| `headingSource` | `sensor` \| `manual` | no | defaults to `sensor` |
| `is360` | `"true"` \| `"false"` | no | defaults to `false`; the literal string, since FormData has no boolean type |
| `accuracy` | number | no | metres; omitted when the pin was placed by hand |
| `photoWidth` / `photoHeight` | int | no | lets the client reserve layout space |
| `note` | string | no | 280 chars |
| `capturedAt` | ISO 8601 | no | rejected if in the future; defaults to now |

## Status codes

`400` malformed body or query · `401` no session (`POST`/`DELETE /api/cameras`,
where the session is required) · `403` signed in, but not the owner or an admin
(`DELETE /api/cameras/:id`) · `409` username taken (`POST /api/auth/register`)
· `413` photo too large · `415` disallowed or mismatched image type · `429`
rate limited, with `Retry-After` (submissions, and register/login attempts) ·
`502` storage write failed · `500` insert or delete failed
