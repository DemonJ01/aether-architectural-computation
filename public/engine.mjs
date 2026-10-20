// Independent computational study. Geometry is in metres.
// Study rules are authored assumptions, not statutory requirements.
export const DEFAULT = Object.freeze({ beamSoffit: 2.7, headroom: 2.4, clearance: .1, maintenance: true });
export const LIMITS = { beamSoffit: [2.45, 3.2], headroom: [2.1, 2.6], clearance: [.05, .2] };
export const STUDY = { width: 12, depth: 8, height: 3.6, slabBottom: 3.4, ductWidth: .6, ductHeight: .35, start: [.7, 4, 3], end: [11.3, 4, 3] };
export const RULES = [
  { id: 'R01', title: 'Geometric separation', text: 'Maintain the selected separation from the beam, slab and zone boundary.', applies: ['service-route', 'beam-01', 'slab-01'], source: 'Authored study brief / R01', kind: 'Authored study assumption' },
  { id: 'R02', title: 'Occupied-zone headroom', text: 'Keep the service underside above the selected minimum. This condition applies to the occupied zone; plant-only bays require separate review.', applies: ['service-route', 'occupied-zone'], source: 'Authored study brief / R02', kind: 'Authored study assumption' },
  { id: 'R03', title: 'Maintenance access', text: 'Keep the declared maintenance volume free of the service and its separation allowance while this requirement is active.', applies: ['service-route', 'access-01'], source: 'Authored study brief / R03', kind: 'Authored study assumption' },
];

export function normalize(p = {}) {
  const out = { ...DEFAULT };
  for (const [key, [a, b]] of Object.entries(LIMITS)) {
    const v = Number(p[key]);
    out[key] = Number.isFinite(v) && p[key] !== '' && p[key] != null ? Math.max(a, Math.min(b, v)) : DEFAULT[key];
  }
  out.maintenance = typeof p.maintenance === 'boolean' ? p.maintenance : true;
  return out;
}
export function obstacles(input) {
  const p = normalize(input);
  return [
    { id: 'beam-01', name: 'Beam', min: [5.2, 1.4, p.beamSoffit], max: [6, 6.4, 3.4], kind: 'solid' },
    { id: 'access-01', name: 'Maintenance volume', min: [8.6, 6.65, 2.65], max: [10.4, 7.65, 3.35], kind: 'access', active: p.maintenance },
  ];
}
const length = (a, b) => Math.hypot(...a.map((v, i) => b[i] - v));
export function routeLength(points) { return points.slice(1).reduce((s, b, i) => s + length(points[i], b), 0); }
export function segmentBox(a, b) {
  const axis = a.findIndex((v, i) => Math.abs(v - b[i]) > 1e-8);
  if (axis < 0 || a.some((v, i) => i !== axis && Math.abs(v - b[i]) > 1e-8)) throw new Error('Routes must use non-zero orthogonal segments');
  const half = [STUDY.ductWidth / 2, STUDY.ductWidth / 2, STUDY.ductHeight / 2];
  // Physical cross-section is normal to the segment; endpoints butt together.
  half[axis] = 0;
  return { min: a.map((v, i) => Math.min(v, b[i]) - half[i]), max: a.map((v, i) => Math.max(v, b[i]) + half[i]) };
}
export function intersects(a, b, tolerance = 0) {
  return a.min.every((v, i) => v < b.max[i] + tolerance - 1e-9 && a.max[i] > b.min[i] - tolerance + 1e-9);
}
export function clearanceToBox(a, b) {
  return Math.hypot(...a.min.map((v, i) => Math.max(b.min[i] - a.max[i], v - b.max[i], 0)));
}
export function evaluate(route, input) {
  const p = normalize(input), obs = obstacles(p);
  const segments = route.points.slice(1).map((b, i) => segmentBox(route.points[i], b));
  const solid = obs.filter(o => o.kind === 'solid');
  // Separation uses an axis-aligned expanded box, conservatively enclosing corners.
  const solidHit = segments.some(s => solid.some(o => intersects(s, o, p.clearance)));
  const boundaryHit = segments.some(s => s.min[0] < p.clearance - 1e-9 || s.min[1] < p.clearance - 1e-9 || s.min[2] < 0 || s.max[0] > STUDY.width - p.clearance + 1e-9 || s.max[1] > STUDY.depth - p.clearance + 1e-9 || s.max[2] > STUDY.slabBottom - p.clearance + 1e-9);
  const minHeadroom = Math.min(...segments.map(s => s.min[2]));
  const headroomHit = minHeadroom < p.headroom - 1e-9;
  const accessHit = p.maintenance && segments.some(s => intersects(s, obs.find(o => o.id === 'access-01'), p.clearance));
  const checks = [
    { rule: 'R01', pass: !(solidHit || boundaryHit), detail: solidHit ? 'Beam separation fails' : boundaryHit ? 'Zone / slab separation fails' : 'Beam, slab and zone separation retained' },
    { rule: 'R02', pass: !headroomHit, detail: `${minHeadroom.toFixed(3)} m underside; ${p.headroom.toFixed(2)} m required in occupied zone` },
    { rule: 'R03', pass: !accessHit, detail: !p.maintenance ? 'Inactive in this counterfactual' : accessHit ? 'Maintenance volume obstructed' : 'Maintenance volume remains free' },
  ];
  return { ...route, length: routeLength(route.points), bends: route.points.length - 2, minHeadroom, checks, violations: checks.filter(c => !c.pass).map(c => c.rule), feasible: checks.every(c => c.pass), segments, minBeamDistance: Math.min(...segments.map(s => clearanceToBox(s, solid[0]))) };
}
export function candidates(input) {
  const p = normalize(input), [a, b] = [STUDY.start, STUDY.end];
  const z = p.beamSoffit - p.clearance - STUDY.ductHeight / 2;
  const beam = obstacles(p)[0], halfWidth = STUDY.ductWidth / 2;
  const left = beam.min[0] - p.clearance - halfWidth;
  const right = beam.max[0] + p.clearance + halfWidth;
  const north = beam.max[1] + p.clearance + halfWidth;
  return [
    { id: 'direct', name: 'Direct reference', family: 'Unchanged', points: [a, b] },
    { id: 'under', name: 'Pass below beam', family: 'Vertical offset', points: [a, [4.4,4,3], [4.4,4,z], [6.8,4,z], [6.8,4,3], b] },
    { id: 'north', name: 'North local bypass', family: 'Plan detour', points: [a, [4.4,4,3], [4.4,7.1,3], [6.8,7.1,3], [6.8,4,3], b] },
    { id: 'south', name: 'South local bypass', family: 'Plan detour', points: [a, [4.4,4,3], [4.4,.7,3], [6.8,.7,3], [6.8,4,3], b] },
    { id: 'perimeter', name: 'North perimeter', family: 'Perimeter detour', points: [a, [.7,7.1,3], [11.3,7.1,3], b] },
    { id: 'derived', name: 'Clearance-derived bypass', family: 'Derived from geometry', points: [a, [left,4,3], [left,north,3], [right,north,3], [right,4,3], b] },
  ].map(r => evaluate(r, p));
}
export function solve(input = {}) {
  const params = normalize(input), rows = candidates(params);
  const feasible = rows.filter(r => r.feasible).sort((a,b) => a.length-b.length || a.bends-b.bends || a.id.localeCompare(b.id));
  return { schema: 'context-to-geometry/1.0', params, geometry: STUDY, rules: RULES, obstacles: obstacles(params), rows, selectedId: feasible[0]?.id ?? null, feasibleCount: feasible.length,
    scope: 'Finite authored candidate grammar; geometric checks against authored assumptions. No certified design, pressure-loss, fire, structural or compliance analysis.' };
}

export const REQUIREMENT = 'R02 requires every service underside to remain at least 2.40 metres above the floor.';
export const CONDITION = 'This minimum applies only in occupied zones; plant-only bays require a separate design review.';
export function contextFixture(prefixWords = 486) {
  const background = Array.from({length: prefixWords}, (_, i) => `context${i + 1}`).join(' ');
  return `${background}\n\n${REQUIREMENT} ${CONDITION}\n\nEnd of authored study fixture.`;
}
export function fixedChunks(text, size = 500) {
  const words = text.trim().split(/\s+/), chunks = [];
  for (let i = 0; i < words.length; i += size) chunks.push(words.slice(i, i + size).join(' '));
  return chunks;
}
export function requirementBlocks(text) {
  // This extension groups authored paragraphs; it does not parse arbitrary regulations.
  return text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
}
export function contextExperiment() {
  const positions = [480, 484, 486, 490, 495, 499];
  return positions.map(prefix => {
    const text = contextFixture(prefix);
    const before = fixedChunks(text).find(c => c.includes('R02'));
    const after = requirementBlocks(text).find(c => c.startsWith('R02'));
    return { prefix, fixedRetainsCondition: before.includes(CONDITION), blockRetainsCondition: after.includes(CONDITION), before, after };
  });
}
export function csv(study) {
  return ['case,route_m,bends,underside_m,R01,R02,R03,feasible', ...study.rows.map(r => [r.id,r.length.toFixed(3),r.bends,r.minHeadroom.toFixed(3),...r.checks.map(c => c.pass?'pass':'fail'),r.feasible].join(','))].join('\n');
}

export function planSVG(study, routeId, options = {}) {
  const r = study.rows.find(r => r.id === routeId) || study.rows[0];
  const scale = options.scale || 32, ox = 32, oy = 25;
  const X = x => ox+x*scale, Y = y => oy+(8-y)*scale;
  const color = r.feasible ? '#087f78' : '#bb5639';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${12*scale+64} ${8*scale+62}" role="img" aria-label="${r.name} plan in metres">
    <rect width="100%" height="100%" fill="#f4f2eb"/><defs><pattern id="grid-${r.id}" width="${scale}" height="${scale}" patternUnits="userSpaceOnUse"><path d="M ${scale} 0 L 0 0 0 ${scale}" fill="none" stroke="#dedfd7" stroke-width=".5"/></pattern></defs>
    <rect x="${X(0)}" y="${Y(8)}" width="${12*scale}" height="${8*scale}" fill="url(#grid-${r.id})" stroke="#626e6b"/>
    ${study.obstacles.map(o => `<rect x="${X(o.min[0])}" y="${Y(o.max[1])}" width="${(o.max[0]-o.min[0])*scale}" height="${(o.max[1]-o.min[1])*scale}" fill="${o.kind==='solid'?'#8e9b97':'#e5bc69'}" opacity="${o.active===false?.25:.65}" stroke="${o.kind==='solid'?'#455b55':'#a67d2f'}" ${o.kind==='access'?'stroke-dasharray="4 3"':''}/>`).join('')}
    <polyline points="${r.points.map(p => `${X(p[0])},${Y(p[1])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${STUDY.ductWidth*scale}" stroke-linejoin="miter" opacity=".8"/>
    <polyline points="${r.points.map(p => `${X(p[0])},${Y(p[1])}`).join(' ')}" fill="none" stroke="white" stroke-width="1" stroke-dasharray="3 3"/>
    ${[STUDY.start,STUDY.end].map((p,i)=>`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="4" fill="#142f2c"/><text x="${X(p[0])+6}" y="${Y(p[1])-8}" fill="#142f2c" font-size="10" font-family="Arial">${i?'OUT':'IN'}</text>`).join('')}
    <text x="${X(6)}" y="${Y(0)+23}" text-anchor="middle" font-size="10" fill="#536963" font-family="Arial">12.00 m / X</text><text x="12" y="${Y(4)}" transform="rotate(-90 12 ${Y(4)})" text-anchor="middle" font-size="10" fill="#536963" font-family="Arial">8.00 m / Y</text>
    <text x="${X(5.6)}" y="${Y(5.4)}" text-anchor="middle" font-size="9" fill="#142f2c" font-family="Arial" transform="rotate(-90 ${X(5.6)} ${Y(5.4)})">BEAM 01</text>
  </svg>`;
}

export function axonSVG(study, routeId = 'north', options = {}) {
  const r = study.rows.find(r=>r.id===routeId) || study.rows[0];
  const project = ([x,y,z]) => [310+(x-6)*27-(y-4)*22,293+(x-6)*10+(y-4)*12-z*49];
  const P = ps => ps.map(p=>project(p).map(v=>v.toFixed(2)).join(',')).join(' ');
  const box = (o, color, opacity) => {
    const [a,b]=[o.min,o.max];
    const v = [[a[0],a[1],a[2]],[b[0],a[1],a[2]],[b[0],b[1],a[2]],[a[0],b[1],a[2]],[a[0],a[1],b[2]],[b[0],a[1],b[2]],[b[0],b[1],b[2]],[a[0],b[1],b[2]]];
    return [[0,1,5,4],[1,2,6,5],[4,5,6,7]].map((f,i)=>`<polygon points="${P(f.map(j=>v[j]))}" fill="${color}" fill-opacity="${opacity*(i===2?1:.65)}" stroke="${color}" stroke-width=".7"/>`).join('');
  };
  let content = `<polygon points="${P([[0,0,0],[12,0,0],[12,8,0],[0,8,0]])}" fill="#e7e9de" stroke="#88988e"/>`;
  for(let x=0;x<=12;x++)content+=`<polyline points="${P([[x,0,0],[x,8,0]])}" stroke="#c5d0c4" stroke-width=".5"/>`;
  for(let y=0;y<=8;y++)content+=`<polyline points="${P([[0,y,0],[12,y,0]])}" stroke="#c5d0c4" stroke-width=".5"/>`;
  content += box(study.obstacles[0], '#516f65', .62);
  if(study.params.maintenance)content += box(study.obstacles[1], '#d7a847', .32);
  content += `<polyline points="${P(r.points.map(p=>[p[0],p[1],0]))}" fill="none" stroke="#a4bbb0" stroke-width="5" stroke-dasharray="4 5"/>`;
  content += r.segments.map(s=>box(s,r.feasible?'#138d81':'#c26443',.9)).join('');
  content += `<polyline points="${P([[0,0,0],[0,0,3.6],[12,0,3.6],[12,8,3.6],[0,8,3.6],[0,0,3.6]])}" fill="none" stroke="#9faf9f" stroke-width=".8" stroke-dasharray="4 4"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 410" role="img" aria-label="Axonometric service zone with beam and route"><rect width="620" height="410" fill="${options.background || '#f4f2eb'}"/>${content}<text x="34" y="384" font-family="Arial" font-size="11" fill="#476255">X 12 m / Y 8 m / Z 3.6 m  |  Authored study geometry</text></svg>`;
}
