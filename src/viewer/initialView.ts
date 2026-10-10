import type { DrawingBounds } from "./savedView";

const MAX_OUTLIER_FRACTION = 0.05;
const MAX_MARKER_SIZE_FRACTION = 0.01;
const MIN_SEPARATION_FACTOR = 8;
const MAX_UNACCOUNTED_MARGIN_FRACTION = 0.05;

type BoundsSplit = { bounds: DrawingBounds; entities: DrawingBounds[] };

function validBounds(bounds: DrawingBounds): boolean {
  return Object.values(bounds).every(Number.isFinite) &&
    bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY;
}

function span(bounds: DrawingBounds): number {
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

function includeBounds(target: DrawingBounds, next: DrawingBounds): void {
  target.minX = Math.min(target.minX, next.minX);
  target.minY = Math.min(target.minY, next.minY);
  target.maxX = Math.max(target.maxX, next.maxX);
  target.maxY = Math.max(target.maxY, next.maxY);
}

function combinedBounds(
  entities: readonly DrawingBounds[],
  start = 0,
  end = entities.length,
): DrawingBounds {
  const bounds = { ...entities[start] };
  for (let index = start + 1; index < end; index += 1) {
    includeBounds(bounds, entities[index]);
  }
  return bounds;
}

function separatedMarkerGroup(
  referenceSpan: number,
  gap: number,
  markerSpan: number,
): boolean {
  return gap >= referenceSpan * MIN_SEPARATION_FACTOR &&
    markerSpan <= referenceSpan * MAX_MARKER_SIZE_FRACTION;
}

function referenceContentSpan(
  entities: readonly DrawingBounds[],
  maximumRemoved: number,
): number {
  const centralBounds = {} as DrawingBounds;
  for (const key of ["minX", "minY", "maxX", "maxY"] as const) {
    const coordinates = entities.map((bounds) => bounds[key]).sort((a, b) => a - b);
    centralBounds[key] = coordinates[key.startsWith("min")
      ? maximumRemoved
      : coordinates.length - maximumRemoved - 1];
  }
  // This estimate only defines how large a genuine empty gap must be. It never
  // becomes the fitted rectangle: all retained entities are included below.
  return span(centralBounds);
}

/** Look for a genuine empty gap, never a percentile cut through a sheet. */
function dominantSplit(
  entities: readonly DrawingBounds[],
  maximumRemoved: number,
  referenceSpan: number,
): BoundsSplit | null {
  let best: BoundsSplit | null = null;
  for (const axis of ["x", "y"] as const) {
    const minimum = axis === "x" ? "minX" : "minY";
    const maximum = axis === "x" ? "maxX" : "maxY";
    const sorted = [...entities].sort((a, b) => a[minimum] - b[minimum]);
    const limit = Math.min(maximumRemoved, sorted.length - 1);
    const removedEdges = new Float64Array(limit);
    const removedSpans = new Float64Array(limit);

    let edge = -Infinity;
    let maximumSpan = 0;
    for (let index = 0; index < limit; index += 1) {
      edge = Math.max(edge, sorted[index][maximum]);
      maximumSpan = Math.max(maximumSpan, span(sorted[index]));
      removedEdges[index] = edge;
      removedSpans[index] = maximumSpan;
    }
    let core = combinedBounds(sorted, limit);
    for (let count = limit; count >= 1; count -= 1) {
      if (
        separatedMarkerGroup(
          referenceSpan,
          core[minimum] - removedEdges[count - 1],
          removedSpans[count - 1],
        ) &&
        (!best || span(core) < span(best.bounds))
      ) {
        best = { bounds: { ...core }, entities: sorted.slice(count) };
      }
      includeBounds(core, sorted[count - 1]);
    }

    edge = Infinity;
    maximumSpan = 0;
    for (let index = 0; index < limit; index += 1) {
      const entity = sorted[sorted.length - index - 1];
      edge = Math.min(edge, entity[minimum]);
      maximumSpan = Math.max(maximumSpan, span(entity));
      removedEdges[index] = edge;
      removedSpans[index] = maximumSpan;
    }
    core = combinedBounds(sorted, 0, sorted.length - limit);
    for (let count = limit; count >= 1; count -= 1) {
      if (
        separatedMarkerGroup(
          referenceSpan,
          removedEdges[count - 1] - core[maximum],
          removedSpans[count - 1],
        ) &&
        (!best || span(core) < span(best.bounds))
      ) {
        best = {
          bounds: { ...core },
          entities: sorted.slice(0, sorted.length - count),
        };
      }
      includeBounds(core, sorted[sorted.length - count]);
    }
  }
  return best;
}

/**
 * Prefer the complete rendered bounds. Only ignore very small, disconnected,
 * distant markers when more than 95% of the indexed entities form the content.
 * Entity bounds must already include block transforms and visible-layer rules.
 * This is for opening a drawing; a fit-all command can still use fullBounds.
 */
export function selectInitialDrawingBounds(
  fullBounds: DrawingBounds | null,
  entityBounds: readonly DrawingBounds[],
): DrawingBounds | null {
  if (!fullBounds || !validBounds(fullBounds)) {
    return null;
  }
  const entities = entityBounds.filter(validBounds);
  // Subtract one before rounding so the retained group is strictly over 95%.
  const maximumRemoved = Math.floor((entities.length - 1) * MAX_OUTLIER_FRACTION);
  if (maximumRemoved <= 0) {
    return fullBounds;
  }

  const allBounds = combinedBounds(entities);
  const referenceSpan = referenceContentSpan(entities, maximumRemoved);
  if (!Number.isFinite(referenceSpan) || referenceSpan <= 0) {
    return fullBounds;
  }
  let retained = entities;
  let contentBounds = allBounds;
  // At most one empty gap on each side is enough to handle isolated markers
  // without repeatedly eroding the content of a complex drawing.
  for (let pass = 0; pass < 4; pass += 1) {
    const remainingBudget = maximumRemoved - (entities.length - retained.length);
    if (remainingBudget <= 0) {
      break;
    }
    const split = dominantSplit(retained, remainingBudget, referenceSpan);
    if (!split) {
      break;
    }
    retained = split.entities;
    contentBounds = split.bounds;
  }
  if (retained.length === entities.length) {
    return fullBounds;
  }

  const contentSpan = span(contentBounds);
  const retainedSet = new Set(retained);
  if (entities.some((entity) => {
    if (retainedSet.has(entity)) {
      return false;
    }
    const gap = Math.max(
      contentBounds.minX - entity.maxX,
      entity.minX - contentBounds.maxX,
      contentBounds.minY - entity.maxY,
      entity.minY - contentBounds.maxY,
    );
    return !separatedMarkerGroup(contentSpan, gap, span(entity));
  })) {
    return fullBounds;
  }
  const tolerance = contentSpan * 1e-6;
  if (
    allBounds.minX < fullBounds.minX - tolerance ||
    allBounds.minY < fullBounds.minY - tolerance ||
    allBounds.maxX > fullBounds.maxX + tolerance ||
    allBounds.maxY > fullBounds.maxY + tolerance
  ) {
    // The index and renderer disagree (for example, about hidden geometry).
    return fullBounds;
  }
  const margins = [
    Math.max(0, allBounds.minX - fullBounds.minX),
    Math.max(0, allBounds.minY - fullBounds.minY),
    Math.max(0, fullBounds.maxX - allBounds.maxX),
    Math.max(0, fullBounds.maxY - allBounds.maxY),
  ];
  if (margins.some((margin) => margin > contentSpan * MAX_UNACCOUNTED_MARGIN_FRACTION)) {
    // Unindexed visible geometry might be another sheet. Keep it all in view.
    return fullBounds;
  }
  return {
    minX: contentBounds.minX - margins[0],
    minY: contentBounds.minY - margins[1],
    maxX: contentBounds.maxX + margins[2],
    maxY: contentBounds.maxY + margins[3],
  };
}
