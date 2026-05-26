export interface Coordinates {
  lat: number;
  lng: number;
}

export interface LocationLike {
  addressLine1?: string | null;
  addressLine2?: string | null;
  parish?: string | null;
  location?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

const JAMAICA_LOCATION_CENTERS: Record<string, Coordinates> = {
  'kingston': { lat: 17.9712, lng: -76.7936 },
  'half way tree': { lat: 18.0125, lng: -76.7981 },
  'new kingston': { lat: 18.0075, lng: -76.7839 },
  'cross roads': { lat: 17.9959, lng: -76.7892 },
  'constant spring': { lat: 18.0421, lng: -76.7936 },
  'st andrew': { lat: 18.0179, lng: -76.8099 },
  'saint andrew': { lat: 18.0179, lng: -76.8099 },
  'portmore': { lat: 17.9503, lng: -76.8827 },
  'spanish town': { lat: 17.9911, lng: -76.9574 },
  'st catherine': { lat: 18.0364, lng: -77.0564 },
  'saint catherine': { lat: 18.0364, lng: -77.0564 },
  'montego bay': { lat: 18.4762, lng: -77.8939 },
  'st james': { lat: 18.3923, lng: -77.8596 },
  'saint james': { lat: 18.3923, lng: -77.8596 },
  'mandeville': { lat: 18.0417, lng: -77.5071 },
  'manchester': { lat: 18.0495, lng: -77.5337 },
  'may pen': { lat: 17.9654, lng: -77.2451 },
  'clarendon': { lat: 17.9557, lng: -77.2405 },
  'ocho rios': { lat: 18.4074, lng: -77.1031 },
  'st ann': { lat: 18.3281, lng: -77.2405 },
  'saint ann': { lat: 18.3281, lng: -77.2405 },
  'savanna-la-mar': { lat: 18.219, lng: -78.1332 },
  'westmoreland': { lat: 18.2944, lng: -78.1564 },
  'black river': { lat: 18.0264, lng: -77.8487 },
  'st elizabeth': { lat: 18.0788, lng: -77.6994 },
  'saint elizabeth': { lat: 18.0788, lng: -77.6994 },
  'port antonio': { lat: 18.1808, lng: -76.4502 },
  'portland': { lat: 18.1324, lng: -76.5344 },
  'morant bay': { lat: 17.8815, lng: -76.4093 },
  'st thomas': { lat: 17.9705, lng: -76.4332 },
  'saint thomas': { lat: 17.9705, lng: -76.4332 },
  'falmouth': { lat: 18.4936, lng: -77.6559 },
  'trelawny': { lat: 18.3526, lng: -77.6078 },
  'lucea': { lat: 18.4501, lng: -78.1736 },
  'hanover': { lat: 18.4098, lng: -78.1336 },
  'port maria': { lat: 18.3685, lng: -76.8895 },
  'st mary': { lat: 18.3167, lng: -76.9 },
  'saint mary': { lat: 18.3167, lng: -76.9 },
  'annotto bay': { lat: 18.2715, lng: -76.7675 },
  'negril': { lat: 18.2683, lng: -78.3472 }
};

export function resolveCoordinates(location: LocationLike | null | undefined): Coordinates | null {
  if (!location) return null;
  const hasExplicitCoordinates = location.latitude !== undefined
    && location.latitude !== null
    && location.latitude !== ''
    && location.longitude !== undefined
    && location.longitude !== null
    && location.longitude !== '';
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (hasExplicitCoordinates && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { lat: latitude, lng: longitude };
  }

  const fields = [
    location.addressLine1,
    location.addressLine2,
    location.location,
    location.parish
  ].filter(Boolean).map((value) => normalizeLocationKey(String(value)));

  for (const field of fields) {
    const exact = JAMAICA_LOCATION_CENTERS[field];
    if (exact) return exact;
    const partialKey = Object.keys(JAMAICA_LOCATION_CENTERS).find((key) => field.includes(key));
    if (partialKey) return JAMAICA_LOCATION_CENTERS[partialKey];
  }

  return null;
}

export function distanceKm(from: Coordinates | null, to: Coordinates | null): number | null {
  if (!from || !to) return null;
  const earthRadiusKm = 6371;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(kilometers: number | null): string {
  if (kilometers === null) return 'Distance unavailable';
  if (kilometers < 1) return `${Math.max(100, Math.round(kilometers * 1000 / 100) * 100)} m away`;
  return `About ${kilometers.toFixed(kilometers < 10 ? 1 : 0)} km away`;
}

export function locationSearchText(location: LocationLike | null | undefined): string {
  if (!location) return 'Jamaica';
  const coords = resolveCoordinates(location);
  const hasExplicitCoordinates = location.latitude !== undefined
    && location.latitude !== null
    && location.latitude !== ''
    && location.longitude !== undefined
    && location.longitude !== null
    && location.longitude !== '';
  if (hasExplicitCoordinates && coords) {
    return `${coords.lat},${coords.lng}`;
  }
  return [
    location.addressLine1,
    location.addressLine2,
    location.location,
    location.parish,
    'Jamaica'
  ].filter(Boolean).join(', ');
}

export function mapsDirectionsUrl(destination: LocationLike, origin?: LocationLike | null): string {
  const params = new URLSearchParams({
    api: '1',
    destination: locationSearchText(destination),
    travelmode: 'driving'
  });
  if (origin) {
    params.set('origin', locationSearchText(origin));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function mapsSearchUrl(destination: LocationLike): string {
  const params = new URLSearchParams({ api: '1', query: locationSearchText(destination) });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

export function mapsEmbedUrl(destination: LocationLike): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(locationSearchText(destination))}&output=embed`;
}

function normalizeLocationKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}
