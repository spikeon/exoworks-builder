/**
 * GLTFLoader uses fetch(); URLs with raw spaces (common in CAD exports) are invalid and fail.
 * Encodes each path segment while preserving protocol, origin, and query string.
 */
export function encodeModelUrlForFetch(url: string): string {
  const q = url.indexOf('?');
  const pathPart = q >= 0 ? url.slice(0, q) : url;
  const query = q >= 0 ? url.slice(q) : '';

  const abs = pathPart.match(/^(\w+:\/\/[^/]+)(\/.*)?$/);
  if (abs) {
    const [, origin, path = ''] = abs;
    const encPath = path
      .split('/')
      .map((segment) => encodePathSegment(segment))
      .join('/');
    return `${origin}${encPath}${query}`;
  }

  const encRel = pathPart
    .split('/')
    .map((segment) => encodePathSegment(segment))
    .join('/');
  return `${encRel}${query}`;
}

function encodePathSegment(segment: string): string {
  if (segment === '') return segment;
  try {
    return encodeURIComponent(decodeURIComponent(segment));
  } catch {
    return encodeURIComponent(segment);
  }
}
