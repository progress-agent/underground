import { execSync } from 'node:child_process';

const txt = execSync('pdftotext -layout data/sources/london-underground-depth-diagrams.pdf -', { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
const lines = txt.split(/\r?\n/);

const start = lines.findIndex(l => l.includes('Victoria line'));
if (start === -1) throw new Error('Victoria line section not found');

const end = lines.findIndex((l, i) => i > start && /^Sea level \(0m\)/.test(l));
const block = lines.slice(start, end === -1 ? start + 80 : end);

const joined = block.join('\n');

// station names we care about
const stations = [
  "Walthamstow Central",
  "Blackhorse Road",
  "Tottenham Hale",
  "Seven Sisters",
  "Finsbury Park",
  "Highbury & Islington",
  "King’s Cross St. Pancras",
  "Euston",
  "Warren Street",
  "Oxford Circus",
  "Green Park",
  "Victoria",
  "Pimlico",
  "Vauxhall",
  "Stockwell",
  "Brixton",
];

function escapeRe(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

const results = [];
for (const name of stations) {
  // Depth diagrams show numbers near names, but text extraction linearizes.
  // We'll search for "<name>\n ... <number>" and also "<name> <spaces> <number>".
  const re1 = new RegExp(`${escapeRe(name)}\\n[^\n]{0,40}\\n[^\n]*?(\\d{1,3})`, 'i');
  const re2 = new RegExp(`${escapeRe(name)}[^\n]{0,40}?(\\d{1,3})`, 'i');
  let m = joined.match(re1) || joined.match(re2);
  const val = m ? Number(m[1]) : null;
  results.push({ name, depth_m: val });
}

console.log(JSON.stringify({ source: 'London Underground Depth Diagrams (PDF)', results }, null, 2));
