/**
 * Seeds a handful of cameras so the map isn't empty on first run.
 *
 *   npm run db:seed
 *
 * Idempotent: it clears any previously seeded rows (those whose note ends with
 * the SEED_TAG) before inserting, so running it twice does not duplicate.
 *
 * Photos are a single embedded placeholder written through the same storage
 * key convention the API uses, so /api/photos serves them normally.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_TAG = "[seed]";
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./storage/uploads");

// 480x360 JPEG: dark slate with an amber sightline wedge.
const PLACEHOLDER_JPEG_BASE64 = [
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7",
  "Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7",
  "Ozs7Ozs7Ozv/wAARCAFoAeADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF",
  "BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVW",
  "V1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi",
  "4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAEC",
  "AxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVm",
  "Z2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq",
  "8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDy2iiitCAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACii",
  "igAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAo",
  "oooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA",
  "KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKK",
  "ACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACii",
  "igAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAo",
  "oooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA",
  "KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKK",
  "ACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKK6PwTZ6RqWqvYapa+c0yZg",
  "bzHXDLkkfL6jnJ/u+9ZVqqpU3Nq6XYunBzkorqc5RXr/APwgvhr/AKBv/keT/wCKo/4QXw1/0Df/ACPJ/wDFV5X9tYf+V/h/mdv9",
  "nVe6/H/I8gor1/8A4QXw1/0Df/I8n/xVH/CC+Gv+gb/5Hk/+Ko/trD/yv8P8w/s6r3X4/wCR5BRXr/8Awgvhr/oG/wDkeT/4qj/h",
  "BfDX/QN/8jyf/FUf21h/5X+H+Yf2dV7r8f8AI8gor1//AIQXw1/0Df8AyPJ/8VR/wgvhr/oG/wDkeT/4qj+2sP8Ayv8AD/MP7Oq9",
  "1+P+R5BRXr//AAgvhr/oG/8AkeT/AOKo/wCEF8Nf9A3/AMjyf/FUf21h/wCV/h/mH9nVe6/H/I8gor1//hBfDX/QN/8AI8n/AMVR",
  "/wAIL4a/6Bv/AJHk/wDiqP7aw/8AK/w/zD+zqvdfj/keQUV6/wD8IL4a/wCgb/5Hk/8AiqP+EF8Nf9A3/wAjyf8AxVH9tYf+V/h/",
  "mH9nVe6/H/I8gor1/wD4QXw1/wBA3/yPJ/8AFUf8IL4a/wCgb/5Hk/8AiqP7aw/8r/D/ADD+zqvdfj/keQUV6/8A8IL4a/6Bv/ke",
  "T/4qj/hBfDX/AEDf/I8n/wAVR/bWH/lf4f5h/Z1Xuvx/yPIKK9f/AOEF8Nf9A3/yPJ/8VR/wgvhr/oG/+R5P/iqP7aw/8r/D/MP7",
  "Oq91+P8AkeQUV6//AMIL4a/6Bv8A5Hk/+Ko/4QXw1/0Df/I8n/xVH9tYf+V/h/mH9nVe6/H/ACPIKK9f/wCEF8Nf9A3/AMjyf/FU",
  "f8IL4a/6Bv8A5Hk/+Ko/trD/AMr/AA/zD+zqvdfj/keQUV1/jvTND0b7NZ6dZ+VdSfvXfzXbCcgDBJHJz9NvvXIV6dCsq9NVIppP",
  "ucdWm6cnFsKKKK3MwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAqS3",
  "nltbmK4hbbLE4dGwDhgcg81HRSaTVmGx7npOpRavpVvfxDCzJkrz8rdCOgzggjPtVyvN/htrPkXkujyn5LjMsPHRwPmHTuozyf4f",
  "evSK+GxuHeHrOHTp6H0uHq+1pqXUKKKK4zcKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKjuJ4rW2luJm2xRIX",
  "dsE4UDJPFSVw/wASdZ8izi0eI/PcYlm46ID8o6d2GeD/AA+9dOGoOvVjTXX8jKtUVKDkzhNW1KXV9VuL+UYaZ8hePlXoB0GcAAZ9",
  "qp0UV93GKjFRWyPmW23dhRRRVCCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAoooo",
  "AKKKKACiiigCxYXs2m38N7btiWFwy8nB9jjseh9jXt9hew6lYQ3tu2YpkDLyMj2OO46H3FeEV3/w21v/AFujTv6y2+4/99KMn8QA",
  "P7xrxc4w3tKXtVvH8j0MBW5Z8j2f5noFFFFfJnuBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFADZJEijaWV1REB",
  "ZmY4CgdSTXifiDV31vWZ75iwRjtiVv4UHQYycepxxkmu++Imt/YdKXTYXxPeffweVjHXocjJ46YI3V5hX1GTYblg60t3ovQ8bMK1",
  "5KmugUUUV7x5gUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFF",
  "FFABViwvZtNv4b23bEsLhl5OD7HHY9D7Gq9FJpSVmCbTuj3u3niuraK4hbdFKgdGwRlSMg81JXD/AA21nz7OXR5T89vmWHjqhPzD",
  "p2Y55P8AF7V3FfB4mg6FWVN9PyPp6NRVYKSCiiiuY1CiiigAooooAKKKKACiiigAooooAKKKKACiiigAoorl/H2s/wBmaCbWM4nv",
  "sxDjon8Z6Y6EDt97I6VtQpSrVFTjuzOpNU4OT6HnfiTVW1jXrq78zfFvKQ4yAIxwuAemep9yazKKK+9hBQiox2R8zKTlJyfUKKKK",
  "skKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAua",
  "TqUukarb38Qy0L5K8fMvQjocZBIz717fbzxXVtFcQtuilQOjYIypGQea8Er034caulzpD6W5VZbQlkHTcjEnPXnDE54xyteFnOH5",
  "qarLdb+n/D/mell9W0nTfU7Kiiivlj2gooooAKKKKACiiigAooooAKKKKACiiigAooooAK8X8U6z/bmvTXSHMCfuoOP4B0PQHkkn",
  "npnHavRvHGrppfh2aLKma8BgjU+hHzHGQeB39SK8ir6XJcPZOs/RfqeRmFXVU18wooor6E8oKKKKACiiigAooooAKKKKACiiigAo",
  "oooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACtHw/q76JrMF8pYop2yqv8AEh6j",
  "GRn1GeMgVnUVM4KcXGWzHGTi00e+xyJLGssTq6OAyspyGB6EGnVyPw71d7/RpLGUsz2JCqx5yjZ2jOe2COwAxXXV8FiKLo1ZU30P",
  "p6VRVIKa6hRRRWBoFFFFABRRRQAUUUUAFFFFABRRRQAUUVg+M9XfR/DsssJYTTkQRsv8BIOTkEEYAOD64rSlTdWahHdkTmoRcn0P",
  "PfGmt/2zr0nlPutbb91Dg5Bx95upHJ7jqAtYFFFffUqUaUFCOyPmZzc5OT6hRRRWhAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUU",
  "UUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAGv4W1n+w9ehunOIH/dT8fwHqehPB",
  "APHXGO9e0V4BXq/gHWf7T0EWshzPY4iPHVP4D0x0BHf7uT1r57OcNdKvHpo/0PUy+tZum/kdRRRRXzR7AUUUUAFFFFABRRRQAUUU",
  "UAFFFFABXk/j7Wf7T142sZzBY5iHHV/4z0z1AHf7uR1r0DxTrP8AYegzXSHE7/uoOP4z0PQjgAnnrjHevGK+hybDXbry6aL9Tysw",
  "rWSpr5hRRRX0p5AUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUA",
  "FFFFABRRRQAUUUUAFFFFABRRRQAVt+DtVXSfElvNLJ5cEuYZTxja3TJPQBtpJ9BWJRWdWmqkHCWzKhJwkpLoe/0Vz/gvW/7Z0GPz",
  "X3XVt+6myck4+63Unkdz1Iaugr4KrSlSm4S3R9PCanFSXUKKKKyLCiiigAooooAKKKKACiis3xBq6aJo098xUuo2xK38TnoMZGfU",
  "45wDVwg5yUY7smUlFNs89+Imqrfa8tpFJuisk2HGMeYeWwR/wEHPQg1ylOkkeWRpZXZ3clmZjksT1JNNr73D0VRpRprofM1ajqTc",
  "n1CiiitjMKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigA",
  "ooooAKKKKACiiigAooooAKKKKAN/wXrf9ja9H5r7bW5/dTZOAM/dbqBwe56AtXsFeAV7P4W1n+3NBhunOZ0/dT8fxjqegHIIPHTO",
  "O1fN51h9VWS8n+h62X1d6b+RsUUUV86esFFFFABRRRQAUUUUAFeX/ETW/t2qrpsL5gs/v4PDSHr0ODgcdMg7q9E1bUotI0q4v5Rl",
  "YUyF5+ZugHQ4ySBn3rxC4nlurmW4mbdLK5d2wBlick8V72TYfmqOs9lt6/1+Z5mYVbRVNdSOiiivqDxgooooAKKKKACiiigAoooo",
  "AKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKK",
  "KACun8A6z/ZmvC1kOIL7ER46P/AemepI7feyelcxRWVelGtTdOWzLpzdOakuh7/RWT4Y1Y6zoFtdyMpmxsmwQfnHBJx0zw2PcVrV",
  "8DUg6c3CW6Pp4yUoqS6hRRRUFBRRRQAUUVV1O+TTNMub6TaRBGXCs23cQOFz7nA/GqjFyaS3Ym0ldnA/EnWfPvItHiPyW+JZuOrk",
  "fKOnZTng/wAXtXEVJcTy3VzLcTNullcu7YAyxOSeKjr7zDUFQpRprp+Z8zWqOrNyYUUUV0GQUUUUAFFFFABRRRQAUUUUAFFFFABR",
  "RRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQB",
  "1/w71v7DqrabM+ILz7mTwsg6dTgZHHTJO2vUK8CjkeKRZYnZHQhlZTgqR0INe1+H9XTW9GgvlKh2G2VV/hcdRjJx6jPOCK+YznDc",
  "s1Wjs9H6ns5fWvF030NKiiivAPTCiiigArz/AOJOt/6rRoH9Jbjaf++VOD+JBH9013F/ew6bYTXtw2IoULNyMn2Ge56D3NeIX97N",
  "qV/Ne3DZlmcs3JwPYZ7DoPYV7WT4b2lX2r2j+Z52PrcsORbv8ivRRRX1h4gUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFF",
  "ABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFdr8NdWE",
  "Goz6XKzYuhviGTgOoORj3XnPH3R7VxVSW88trcxXELbZYnDo2AcMDkHmufE0FXoypvqa0ajpTU0e90VT0nUotX0q3v4hhZkyV5+V",
  "uhHQZwQRn2q5XwcouMnF7o+mTTV0FFFR3E8VrbS3EzbYokLu2CcKBknikk27INjifiXqwjtbfSY2YPKfOlwSPkGQAexycnrxtHtX",
  "nVXNW1KXV9VuL+UYaZ8hePlXoB0GcAAZ9qp191gsP9XoKHXr6nzeIq+1qOQUUUV1mAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUU",
  "UUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAF",
  "FFFAHb/DbWfIvJdHlPyXGZYeOjgfMOndRnk/w+9ekV4RYXs2m38N7btiWFwy8nB9jjseh9jXudvN9otopvLki8xA2yRcMuRnBHYi",
  "vlM5oKFVVFtL80e3l9Xmg4PoSVw/xJ1nyLOLR4j89xiWbjogPyjp3YZ4P8PvXcV4n4k1ObVteurmZZI8OUSKQEGNV4CkEnB7kepN",
  "Z5TQVWvzPaOvz6F46ryUuVdTMooor688EKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKK",
  "KACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA67w3ZWOjaP/AMJRqcTTP5hS",
  "yh4wzDPzexyG69NpPJxWPqmt6jq8zveXLsjPvEIY+Wh6DC9Bx+Nbvir9z4W8NwxfJE9tvZF4UttQ5I9cs3PufWuTrhwkVUvXlq23",
  "bySdrI6a7cLU1srfNtFmy1K+02TzLK6lgJIJCMQGx0yOh+hrpdUjtPF+hT6zbw+RqtigN0ij5ZV/vZPoASO/GOeDXI11vw6/eaxd",
  "20nzwS2jeZE3Kv8AMo5HQ8Ej8TRjYqEPbx0lH8V1TDDtyl7J7P8Aq5xdFFFdxzBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA",
  "UUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUU",
  "AFFFFAHZ6C9v4k8MDw3JcLb3ttIZrXI+WQcnB9T8zZx2wecGuYu7SexupLW6iaKaM4ZG7f59aqxyPFIssTsjoQyspwVI6EGuqt/H",
  "91JCsGs6daapEuSPMQK27PBPBXgEjhR/jxclWhJumuaL1tezT8vU6OaFSKU3Zrr5HORxvLIscaM7uQqqoyWJ6ACuunjj8G+GLq1u",
  "JlfVNVjCmAfMIk5BJx7M3Pr0BAJqtL4+a3jZNG0az04yAiR1UMT/AHSMBRxk9Qev58vd3dxf3Ul1dStLNKcu7d/8+nak41sQ0qi5",
  "YrW17t228khqVOkm4u7/AARDRRRXccwUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUA",
  "FFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFF",
  "ABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRR",
  "RQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAU",
  "UUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUA",
  "FFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf//Z"
].join("");

/** Points around downtown Toronto, with plausible bearings. */
const SAMPLES = [
  { lat: 43.64877, lng: -79.38171, heading: 41, accuracy: 6.2, note: "Above the bank entrance, facing the intersection." },
  { lat: 43.65107, lng: -79.38393, heading: 0, is360: true, accuracy: 9.8, note: "Panoramic dome under the parking garage soffit — covers the whole level." },
  { lat: 43.65322, lng: -79.38412, heading: 275, accuracy: 4.5, note: "Two units on the same bracket; this is the left one." },
  { lat: 43.64611, lng: -79.38079, heading: 118, accuracy: 14.1, note: "Covers the loading bay and the alley behind it." },
  { lat: 43.65544, lng: -79.38065, heading: 352, accuracy: 7.7, note: "Pointed up the sidewalk toward the transit entrance." },
  { lat: 43.64998, lng: -79.37718, heading: 224, accuracy: 22.4, note: "Poor fix here — tall glass on three sides." },
  { lat: 43.65231, lng: -79.37941, heading: 96, accuracy: 5.1, note: null },
  { lat: 43.64742, lng: -79.38594, heading: 309, accuracy: 11.3, headingSource: "manual", note: "Bearing set by hand; compass was unreliable next to the railing." },
];

/**
 * Mirrors the key convention in src/lib/storage.ts. It is duplicated rather
 * than imported because this is a plain .mjs script and that module is
 * TypeScript — keep the two in step if the convention changes.
 */
async function writePlaceholder() {
  const bytes = Buffer.from(PLACEHOLDER_JPEG_BASE64, "base64");
  const now = new Date();
  const dir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const key = `${dir}/${randomUUID()}.jpg`;

  const full = path.join(UPLOAD_DIR, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
  return key;
}

async function main() {
  const removed = await prisma.camera.deleteMany({
    where: { note: { endsWith: SEED_TAG } },
  });
  if (removed.count > 0) console.log(`Removed ${removed.count} previously seeded rows.`);

  let created = 0;
  for (const sample of SAMPLES) {
    const photoKey = await writePlaceholder();
    // Spread the timestamps over the past few weeks.
    const daysAgo = Math.floor(Math.random() * 21) + 1;
    const capturedAt = new Date(Date.now() - daysAgo * 86_400_000);

    await prisma.camera.create({
      data: {
        lat: sample.lat,
        lng: sample.lng,
        accuracy: sample.accuracy,
        heading: sample.heading,
        headingSource: sample.headingSource ?? "sensor",
        is360: sample.is360 ?? false,
        photoKey,
        photoWidth: 480,
        photoHeight: 360,
        note: sample.note ? `${sample.note} ${SEED_TAG}` : SEED_TAG,
        capturedAt,
        submitterHash: null,
      },
    });
    created += 1;
  }

  console.log(`Seeded ${created} cameras. Photos written to ${UPLOAD_DIR}`);
  console.log("Open http://localhost:3000 and pan to downtown Toronto.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
