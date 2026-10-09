const MIN_FIT_PADDING = 0.12;
export const DEFAULT_VIEWER_OVERLAY_RESERVE = 80;

/** Keep centered drawing bounds inside the header and toolbar's clear area. */
export function fitPaddingForViewport(
  viewportHeight: number,
  overlayReserve = DEFAULT_VIEWER_OVERLAY_RESERVE,
): number {
  if (
    !Number.isFinite(viewportHeight) ||
    viewportHeight <= 0 ||
    !Number.isFinite(overlayReserve) ||
    overlayReserve < 0
  ) {
    return MIN_FIT_PADDING;
  }
  // A very short or temporarily resizing viewport must still produce a finite
  // camera rather than dividing by a zero/negative clear area.
  const clearHeight = Math.max(viewportHeight * 0.2, viewportHeight - 2 * overlayReserve);
  return Math.max(MIN_FIT_PADDING, viewportHeight / clearHeight - 1);
}
