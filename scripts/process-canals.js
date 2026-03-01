// Process Overpass API data into canals JSON format

import fs from 'fs';

const overpassData = JSON.parse(fs.readFileSync('public/data/canals_overpass.json', 'utf8'));

// Build node lookup
const nodes = {};
const ways = [];

for (const el of overpassData.elements) {
  if (el.type === 'node') {
    nodes[el.id] = { lat: el.lat, lon: el.lon };
  } else if (el.type === 'way') {
    ways.push(el);
  }
}

// Group ways by canal name
const canalGroups = {};

for (const way of ways) {
  const name = way.tags?.name || `Canal ${way.id}`;
  if (!canalGroups[name]) {
    canalGroups[name] = [];
  }
  canalGroups[name].push(way);
}

// Build continuous line from connected ways
function buildLine(ways) {
  // Create node -> way mapping
  const nodeToWays = {};
  for (const way of ways) {
    const startNode = way.nodes[0];
    const endNode = way.nodes[way.nodes.length - 1];
    if (!nodeToWays[startNode]) nodeToWays[startNode] = [];
    if (!nodeToWays[endNode]) nodeToWays[endNode] = [];
    nodeToWays[startNode].push(way);
    nodeToWays[endNode].push(way);
  }
  
  // Find endpoints (nodes connected to only 1 way)
  const endpoints = [];
  for (const [nodeId, connectedWays] of Object.entries(nodeToWays)) {
    if (connectedWays.length === 1) {
      endpoints.push(parseInt(nodeId));
    }
  }
  
  // If no clear endpoints, use any node
  const startNode = endpoints.length > 0 ? endpoints[0] : ways[0].nodes[0];
  
  // Build line by following connections
  const usedWays = new Set();
  const lineCoords = [];
  let currentNode = startNode;
  
  while (true) {
    // Find an unused way connected to currentNode
    let nextWay = null;
    let nextNode = null;
    
    for (const way of nodeToWays[currentNode] || []) {
      if (usedWays.has(way.id)) continue;
      
      const start = way.nodes[0];
      const end = way.nodes[way.nodes.length - 1];
      
      if (start === currentNode) {
        nextWay = way;
        nextNode = end;
        break;
      } else if (end === currentNode) {
        nextWay = way;
        nextNode = start;
        break;
      }
    }
    
    if (!nextWay) break;
    
    usedWays.add(nextWay.id);
    
    // Add nodes from this way (avoiding duplicate at connection)
    const startIdx = nextWay.nodes[0] === currentNode ? 0 : nextWay.nodes.length - 1;
    const endIdx = nextWay.nodes[0] === currentNode ? nextWay.nodes.length - 1 : 0;
    const step = startIdx < endIdx ? 1 : -1;
    
    for (let i = startIdx; i !== endIdx + step; i += step) {
      const nodeId = nextWay.nodes[i];
      const node = nodes[nodeId];
      if (node) {
        // Avoid duplicates at connection points
        if (lineCoords.length === 0 || 
            lineCoords[lineCoords.length - 1][0] !== node.lat ||
            lineCoords[lineCoords.length - 1][1] !== node.lon) {
          lineCoords.push([node.lat, node.lon]);
        }
      }
    }
    
    currentNode = nextNode;
  }
  
  return lineCoords;
}

const features = [];

for (const [name, canalWays] of Object.entries(canalGroups)) {
  const coords = buildLine(canalWays);
  if (coords.length < 2) continue;
  
  // Estimate length (rough approximation)
  let lengthKm = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lat1, lon1] = coords[i - 1];
    const [lat2, lon2] = coords[i];
    const dLat = (lat2 - lat1) * 111000;
    const dLon = (lon2 - lon1) * 69000; // at ~51.5°N
    lengthKm += Math.sqrt(dLat * dLat + dLon * dLon) / 1000;
  }
  
  features.push({
    id: `canal/${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    name: name,
    length_km: Math.round(lengthKm * 10) / 10,
    coords: coords
  });
}

// Sort by length
features.sort((a, b) => b.length_km - a.length_km);

const output = {
  type: 'canals',
  source: 'OpenStreetMap Overpass API',
  crs: 'WGS84',
  count: features.length,
  features: features
};

fs.writeFileSync('public/data/canals.json', JSON.stringify(output, null, 2));
console.log(`Processed ${features.length} canals`);
console.log('All canals:');
features.forEach(f => console.log(`  ${f.name}: ${f.length_km} km`));
