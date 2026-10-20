/**
 * Deterministic concept geometry, in metres. This is a design study, not a
 * structural, energy, daylight, cost, life-cycle, or code-compliance analysis.
 * The viewer, quantities and OBJ exporter consume this same geometry.
 */
export const DEFAULT_PARAMS = Object.freeze({
  floors: 18, width: 32, depth: 24, floorHeight: 3.6,
  twist: 60, taper: 0.18, shadeDepth: 0.9,
});

export const PARAM_LIMITS = Object.freeze({
  floors: [6, 32], width: [18, 48], depth: [16, 40],
  floorHeight: [3, 4.5], twist: [-120, 120], taper: [0, 0.4], shadeDepth: [0, 2.4],
});

export const PRESETS = Object.freeze([
  { id: 'helix', name: '01 / Helix', description: 'A gradual rotation with a light external shade.', params: { ...DEFAULT_PARAMS } },
  { id: 'compact', name: '02 / Compact', description: 'An untwisted reference with a smaller envelope.', params: { ...DEFAULT_PARAMS, floors: 15, twist: 0, taper: 0.08, shadeDepth: 0.6 } },
  { id: 'canopy', name: '03 / Canopy', description: 'Deeper horizontal shades and a more pronounced taper.', params: { ...DEFAULT_PARAMS, floors: 21, twist: 90, taper: 0.32, shadeDepth: 1.8 } },
]);

export const ASSUMPTIONS = Object.freeze({
  units: 'm, m², m³, kgCO₂e',
  slabThickness: 0.24,
  shadeThickness: 0.12,
  coreWidthRatio: 0.24,
  coreDepthRatio: 0.24,
  coreWallThickness: 0.3,
  coreClearance: 0.3,
  concreteCarbonFactor: 320,
  facadeCarbonFactor: 55,
  shadeCarbonFactor: 18,
  carbonFactorUnits: 'Concrete: kgCO₂e/m³; facade and shade: kgCO₂e/m²',
  carbonScope: 'Illustrative factor-based proxy for slabs, core walls, facade and shades only. Factors are study assumptions, not product declarations. Excludes foundations, columns, reinforcement, connections, MEP, interiors, construction and end of life.',
  geometryScope: 'Rectangular floor plates scale and rotate linearly with height; facade panels are triangulated between consecutive levels. Slabs include the ground slab and roof. Gross floor area excludes the roof and does not deduct the core.',
  quantityScope: 'Concrete is a sum of slab and core wall allowances; slab/core intersections are not Boolean-subtracted. Facade includes its conceptual framing in the area-based carbon factor. Small facade mullions are display lines, not separately quantified solids.',
  coreFitScope: 'The fixed, axis-aligned core starts at 24% of base width and depth. Both dimensions reduce uniformly where needed to retain 0.30 m horizontal clearance inside every floor/roof rectangle and the inward half-spaces of every facade triangle throughout each storey. Wall thickness remains 0.30 m. This geometric fit does not establish circulation or structural adequacy.',
  shadeScope: 'Shade openness = 1 − shade depth / floor height. This geometric ratio is not solar radiation, daylight, thermal comfort or climate simulation.',
  sweepScope: '3 × 2 × 2 factorial: floor count, taper and total twist. Pareto objectives: maximise gross floor area and minimise total carbon proxy. Width, depth, floor height and shade depth are held fixed.',
});

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const sum = (values) => values.reduce((total, value) => total + value, 0);

export function normalizeParams(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(Object.entries(DEFAULT_PARAMS).map(([key, fallback]) => {
    const raw = source[key];
    const value = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
    const bounded = clamp(Number.isFinite(value) ? value : fallback, ...PARAM_LIMITS[key]);
    return [key, key === 'floors' ? Math.round(bounded) : bounded];
  }));
}

function rectangle(width, depth, y, rotation = 0) {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]]
    .map(([x, z]) => [x * c + z * s, y, -x * s + z * c]);
}

function triangleArea(a, b, c) {
  const u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i]);
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
}

function signedTriangleVolume(a, b, c) {
  return (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
}

function prism(corners, thickness, name) {
  const vertices = [...corners.map(([x, y, z]) => [x, y - thickness, z]), ...corners.map((p) => [...p])];
  const faces = [[0, 1, 2], [0, 2, 3], [4, 7, 6], [4, 6, 5]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    faces.push([i, i + 4, j + 4], [i, j + 4, j]);
  }
  return { name, vertices, faces };
}

function shadeMesh(level, depth) {
  const outer = rectangle(level.width + 2 * depth, level.depth + 2 * depth, level.y, level.rotation);
  const inner = level.corners;
  const vertices = [...outer, ...inner, ...outer.map(([x, y, z]) => [x, y - ASSUMPTIONS.shadeThickness, z]), ...inner.map(([x, y, z]) => [x, y - ASSUMPTIONS.shadeThickness, z])];
  const faces = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    faces.push([i, i + 4, j + 4], [i, j + 4, j], [i + 8, j + 8, j + 12], [i + 8, j + 12, i + 12]);
    faces.push([i, j, j + 8], [i, j + 8, i + 8], [i + 4, i + 12, j + 12], [i + 4, j + 12, j + 4]);
  }
  return { name: `shade_${level.index}`, vertices, faces };
}

function fitCore(params, levels, facade) {
  const nominalWidth = params.width * ASSUMPTIONS.coreWidthRatio;
  const nominalDepth = params.depth * ASSUMPTIONS.coreDepthRatio;
  const clearance = ASSUMPTIONS.coreClearance;
  let scale = 1;
  for (const level of levels) {
    const c = Math.abs(Math.cos(level.rotation)), s = Math.abs(Math.sin(level.rotation));
    scale = Math.min(scale,
      (level.width - 2 * clearance) / (nominalWidth * c + nominalDepth * s),
      (level.depth - 2 * clearance) / (nominalWidth * s + nominalDepth * c));
  }
  // A floor-only check can miss a facet that leans inward between levels.
  // Each plane inequality is linear in y, so its two storey endpoints give
  // the exact maximum over the full height of an axis-aligned core prism.
  // Their intersection is a conservative region inside the faceted shell.
  for (const [ia, ib, ic] of facade.faces) {
    const a = facade.vertices[ia], b = facade.vertices[ib], c = facade.vertices[ic];
    const u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const radius = (Math.abs(n[0]) * nominalWidth + Math.abs(n[2]) * nominalDepth) / 2;
    const plane = n.reduce((total, component, i) => total + component * a[i], 0);
    for (const y of [Math.min(a[1], b[1], c[1]), Math.max(a[1], b[1], c[1])]) {
      scale = Math.min(scale, (plane - n[1] * y - clearance * Math.hypot(n[0], n[2])) / radius);
    }
  }
  return { scale, width: nominalWidth * scale, depth: nominalDepth * scale };
}

export function generateStudy(input = DEFAULT_PARAMS) {
  const params = normalizeParams(input);
  const levels = Array.from({ length: params.floors + 1 }, (_, index) => {
    const t = index / params.floors;
    const width = params.width * (1 - params.taper * t), depth = params.depth * (1 - params.taper * t);
    const rotation = params.twist * Math.PI / 180 * t, y = index * params.floorHeight;
    return { index, y, width, depth, rotation, corners: rectangle(width, depth, y, rotation), area: width * depth, perimeter: 2 * (width + depth) };
  });
  const floors = levels.slice(0, -1), roof = levels.at(-1);
  const vertices = levels.flatMap((level) => level.corners), faces = [];
  for (let i = 0; i < params.floors; i++) {
    for (let side = 0; side < 4; side++) {
      const a = i * 4 + side, b = i * 4 + (side + 1) % 4, c = b + 4, d = a + 4;
      // Reverse the diagonal with handedness so a negative twist is the
      // geometric mirror of a positive twist, rather than a different loft.
      if (params.twist >= 0) faces.push([a, d, c], [a, c, b]);
      else faces.push([a, d, b], [b, d, c]);
    }
  }
  const envelopeArea = sum(faces.map(([a, b, c]) => triangleArea(vertices[a], vertices[b], vertices[c])));
  const r = params.floors * 4;
  const closedFaces = [...faces, [0, 1, 2], [0, 2, 3], [r, r + 3, r + 2], [r, r + 2, r + 1]];
  const volume = Math.abs(sum(closedFaces.map(([a, b, c]) => signedTriangleVolume(vertices[a], vertices[b], vertices[c]))));
  const grossFloorArea = sum(floors.map((floor) => floor.area));
  const slabVolume = sum(levels.map((floor) => floor.area)) * ASSUMPTIONS.slabThickness;
  const height = roof.y;
  const facade = { name: 'facade', vertices, faces };
  const fittedCore = fitCore(params, levels, facade);
  const coreWidth = fittedCore.width, coreDepth = fittedCore.depth;
  const wall = ASSUMPTIONS.coreWallThickness;
  const coreVolume = (coreWidth * coreDepth - (coreWidth - 2 * wall) * (coreDepth - 2 * wall)) * height;
  const shadeArea = sum(levels.slice(1).map((floor) => (floor.width + 2 * params.shadeDepth) * (floor.depth + 2 * params.shadeDepth) - floor.area));
  const concreteVolume = slabVolume + coreVolume;
  const carbonBreakdown = {
    concrete: concreteVolume * ASSUMPTIONS.concreteCarbonFactor,
    facade: envelopeArea * ASSUMPTIONS.facadeCarbonFactor,
    shades: shadeArea * ASSUMPTIONS.shadeCarbonFactor,
  };
  const embodiedCarbon = sum(Object.values(carbonBreakdown));
  const slabs = levels.map((level) => prism(level.corners, ASSUMPTIONS.slabThickness, `slab_${level.index}`));
  const shades = params.shadeDepth > 0 ? levels.slice(1).map((level) => shadeMesh(level, params.shadeDepth)) : [];
  const core = [
    { w: coreWidth, d: wall, x: 0, z: (coreDepth - wall) / 2 },
    { w: coreWidth, d: wall, x: 0, z: -(coreDepth - wall) / 2 },
    { w: wall, d: coreDepth - 2 * wall, x: (coreWidth - wall) / 2, z: 0 },
    { w: wall, d: coreDepth - 2 * wall, x: -(coreWidth - wall) / 2, z: 0 },
  ].map((part, i) => prism(rectangle(part.w, part.d, height).map(([x, y, z]) => [x + part.x, y, z + part.z]), height, `core_wall_${i}`));
  return {
    params, floors, roof, levels,
    metrics: { height, grossFloorArea, envelopeArea, volume, slabVolume, coreWidth, coreDepth, coreScale: fittedCore.scale, coreVolume, concreteVolume, shadeArea, embodiedCarbon, carbonIntensity: embodiedCarbon / grossFloorArea, shadeOpenness: clamp(1 - params.shadeDepth / params.floorHeight, 0, 1), carbonBreakdown },
    assumptions: { ...ASSUMPTIONS },
    geometry: { envelope: facade, slabs, shades, core },
  };
}

/** A controlled factorial sample, not a numerical optimiser. */
export function runSweep(input = DEFAULT_PARAMS) {
  const base = normalizeParams(input);
  // Shift the whole three-value set near limits so every sample remains distinct.
  const midpoint = clamp(base.floors, PARAM_LIMITS.floors[0] + 3, PARAM_LIMITS.floors[1] - 3);
  const floorCounts = [midpoint - 3, midpoint, midpoint + 3];
  const twist = Math.abs(base.twist) > 0.001 ? base.twist : 60;
  const alternatives = floorCounts.flatMap((floors) => [0, 0.28].flatMap((taper) => [0, twist].map((rotation) => {
    const study = generateStudy({ ...base, floors, taper, twist: rotation });
    return { id: `F${floors}-T${Math.round(taper * 100)}-R${rotation}`, name: `${floors}F · ${Math.round(taper * 100)}% taper · ${rotation}°`, params: study.params, metrics: study.metrics, study };
  })));
  return alternatives.map((candidate) => ({
    ...candidate,
    pareto: !alternatives.some((other) =>
      other.metrics.grossFloorArea >= candidate.metrics.grossFloorArea - 1e-8 &&
      other.metrics.embodiedCarbon <= candidate.metrics.embodiedCarbon + 1e-8 &&
      (other.metrics.grossFloorArea > candidate.metrics.grossFloorArea + 1e-8 || other.metrics.embodiedCarbon < candidate.metrics.embodiedCarbon - 1e-8)),
  }));
}

/** OBJ coordinates and named triangular meshes match the un-exploded viewer. */
export function exportOBJ(studyOrParams = DEFAULT_PARAMS) {
  const study = studyOrParams.geometry ? studyOrParams : generateStudy(studyOrParams);
  const lines = [
    '# TWIST / Computational architecture study',
    '# Units: metres. Y up. Concept geometry only; not a BIM or fabrication model.',
    `# Parameters: ${JSON.stringify(study.params)}`,
  ];
  let offset = 1;
  for (const mesh of [study.geometry.envelope, ...study.geometry.slabs, ...study.geometry.shades, ...study.geometry.core]) {
    lines.push(`o ${mesh.name}`);
    mesh.vertices.forEach((vertex) => lines.push(`v ${vertex.map((v) => Number(v.toFixed(6))).join(' ')}`));
    mesh.faces.forEach((face) => lines.push(`f ${face.map((index) => index + offset).join(' ')}`));
    offset += mesh.vertices.length;
  }
  return `${lines.join('\n')}\n`;
}
