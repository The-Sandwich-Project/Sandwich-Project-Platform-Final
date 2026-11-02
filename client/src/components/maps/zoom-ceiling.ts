import type L from 'leaflet';

/** Map zoom ceiling. Google serves z20; the OSM fallback upscales past z19. */
export const BASEMAP_MAX_ZOOM = 20;

/**
 * Leaflet takes its max zoom from its tile layers. Until one is added (while
 * the basemap config is still loading) getMaxZoom() is Infinity, so fitting
 * a single point, or any bounds in a hidden or tiny container, sets zoom to
 * Infinity and the next projection throws "Invalid LatLng object: (NaN, NaN)".
 * Giving the map its own ceiling keeps the zoom finite in that window.
 */
export function ensureZoomCeiling(map: L.Map): void {
  if (map.options.maxZoom === undefined) {
    map.options.maxZoom = BASEMAP_MAX_ZOOM;
  }
}
