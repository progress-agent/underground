// Process Overpass API data into reservoir JSON format
// Filters to reservoirs >5 hectares

import fs from 'fs';

const overpassData = JSON.parse(fs.readFileSync('public/data/reservoirs_overpass.json', 'utf8'));

// Build node lookup
const nodes = {};
const ways = [];
const relations = [];

for (const el of overpassData.elements) {
  if (el.type === 'node') {
    nodes[el.id] = { lat: el.lat, lon: el.lon };
  } else if (el.type === 'way') {
    ways.push(el);
  } else if (el.type === 'relation') {
    relations.push(el);
  }
}

// Calculate polygon area using shoelace formula (approximate, in hectares)
function calculateAreaHa(nodeIds) {
  if (nodeIds.length < 3) return 0;
  
  let area = 0;
  for (let i = 0; i < nodeIds.length; i++) {
    const j = (i + 1) % nodeIds.length;
    const node1 = nodes[nodeIds[i]];
    const node2 = nodes[nodeIds[j]];
    if (!node1 || !node2) continue;
    area += node1.lon * node2.lat;
    area -= node2.lon * node1.lat;
  }
  
  // Convert to approximate square meters (at London lat ~51.5)
  // 1 degree lat ≈ 111km, 1 degree lon ≈ 69km at 51.5°N
  const latMPerDeg = 111000;
  const lonMPerDeg = 69000;
  
  area = Math.abs(area) * 0.5 * latMPerDeg * lonMPerDeg;
  return area / 10000; // Convert to hectares
}

// Extract coordinates from way nodes
function getWayCoords(way) {
  return way.nodes.map(nodeId => {
    const node = nodes[nodeId];
    return node ? [node.lat, node.lon] : null;
  }).filter(n => n !== null);
}

// Process ways (simple polygons)
const features = [];

for (const way of ways) {
  const name = way.tags?.name || `Reservoir ${way.id}`;
  const areaHa = calculateAreaHa(way.nodes);
  
  if (areaHa < 5) continue; // Skip small reservoirs
  
  const coords = getWayCoords(way);
  if (coords.length < 3) continue;
  
  features.push({
    id: `way/${way.id}`,
    name: name,
    area_ha: Math.round(areaHa),
    coords: coords
  });
}

// Process relations (multipolygons - use outer ways)
for (const rel of relations) {
  const name = rel.tags?.name || `Reservoir ${rel.id}`;
  
  // Find outer ways
  const outerWays = [];
  for (const member of rel.members || []) {
    if (member.type === 'way' && member.role === 'outer') {
      const way = ways.find(w => w.id === member.ref);
      if (way) outerWays.push(way);
    }
  }
  
  // Calculate combined area
  let totalArea = 0;
  for (const way of outerWays) {
    totalArea += calculateAreaHa(way.nodes);
  }
  
  if (totalArea < 5) continue; // Skip small reservoirs
  
  // Use the largest outer way for coordinates
  let largestWay = null;
  let largestArea = 0;
  for (const way of outerWays) {
    const area = calculateAreaHa(way.nodes);
    if (area > largestArea) {
      largestArea = area;
      largestWay = way;
    }
  }
  
  if (!largestWay) continue;
  
  const coords = getWayCoords(largestWay);
  if (coords.length < 3) continue;
  
  features.push({
    id: `relation/${rel.id}`,
    name: name,
    area_ha: Math.round(totalArea),
    coords: coords
  });
}

// Sort by area (largest first)
features.sort((a, b) => b.area_ha - a.area_ha);

const output = {
  type: 'reservoirs',
  source: 'OpenStreetMap Overpass API',
  crs: 'WGS84',
  count: features.length,
  features: features
};

fs.writeFileSync('public/data/reservoirs.json', JSON.stringify(output, null, 2));
console.log(`Processed ${features.length} reservoirs (>5ha)`);
console.log('Top 10 by area:');
features.slice(0, 10).forEach(f => console.log(`  ${f.name}: ${f.area_ha} ha`));
