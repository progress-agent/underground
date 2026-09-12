import proj4 from 'proj4';

// Canonical scene X/Z is BNG relative to this exact WGS84 Trafalgar origin.
// Source payloads already in these scene coordinates must not be shifted again.
export const SCENE_ORIGIN = {lat:51.5074,lon:-.1278};
proj4.defs('EPSG:27700','+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
export const [BNG_REF_E,BNG_REF_N] = proj4('EPSG:4326','EPSG:27700',[SCENE_ORIGIN.lon,SCENE_ORIGIN.lat]);
