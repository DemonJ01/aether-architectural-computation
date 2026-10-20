import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSUMPTIONS, DEFAULT_PARAMS, PARAM_LIMITS, normalizeParams, generateStudy, runSweep, exportOBJ } from '../public/aether-engine.mjs';

function near(actual, expected, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} differs from ${expected}`);
}

function meshVolume(mesh) {
  return Math.abs(mesh.faces.reduce((total, [a, b, c]) => {
    const p = mesh.vertices[a], q = mesh.vertices[b], r = mesh.vertices[c];
    return total + (p[0] * (q[1] * r[2] - q[2] * r[1]) + p[1] * (q[2] * r[0] - q[0] * r[2]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
  }, 0));
}

test('normalization rejects non-finite input and constrains each physical parameter', () => {
  assert.deepEqual(normalizeParams(null), DEFAULT_PARAMS);
  assert.deepEqual(normalizeParams({ width: Infinity, depth: NaN, floors: '', taper: null }), DEFAULT_PARAMS);
  const p = normalizeParams({ floors: 17.8, width: -5, depth: 500, twist: '-500', taper: 12, shadeDepth: -4 });
  assert.equal(p.floors, 18);
  assert.equal(p.width, PARAM_LIMITS.width[0]);
  assert.equal(p.depth, PARAM_LIMITS.depth[1]);
  assert.equal(p.twist, -120);
  assert.equal(p.taper, 0.4);
  assert.equal(p.shadeDepth, 0);
});

test('a straight untapered box has analytic area, envelope and volume', () => {
  const p = { floors: 10, width: 20, depth: 16, floorHeight: 3.6, twist: 0, taper: 0, shadeDepth: 0 };
  const study = generateStudy(p);
  near(study.metrics.height, 36);
  near(study.metrics.grossFloorArea, 3200);
  near(study.metrics.envelopeArea, 2 * (20 + 16) * 36);
  near(study.metrics.volume, 20 * 16 * 36);
  near(study.metrics.slabVolume, 11 * 320 * ASSUMPTIONS.slabThickness);
  assert.equal(study.floors.length, 10);
  assert.equal(study.levels.length, 11);
  assert.equal(study.geometry.shades.length, 0);
});

test('roof corners apply the full twist and taper; intermediate plates interpolate', () => {
  const study = generateStudy({ ...DEFAULT_PARAMS, width: 32, depth: 24, floors: 10, twist: 90, taper: 0.25 });
  near(study.roof.width, 24);
  near(study.roof.depth, 18);
  near(study.roof.rotation, Math.PI / 2);
  near(study.roof.corners[0][0], -9);
  near(study.roof.corners[0][2], 12);
  near(study.floors[5].rotation, Math.PI / 4);
  near(study.floors[5].width, 28);
  near(study.floors[5].area, 28 * 21);
});

test('an untwisted tapered tower has the analytic square-frustum volume', () => {
  const study = generateStudy({ ...DEFAULT_PARAMS, floors: 18, width: 30, depth: 30, twist: 0, taper: 0.3 });
  const lower = 30 * 30, upper = 21 * 21;
  near(study.metrics.volume, study.metrics.height / 3 * (lower + upper + Math.sqrt(lower * upper)));
});

test('reported slab, shade and core quantities correspond to generated meshes', () => {
  const study = generateStudy();
  assert.equal(study.metrics.coreScale, 1);
  near(study.geometry.slabs.reduce((n, mesh) => n + meshVolume(mesh), 0), study.metrics.slabVolume);
  near(study.geometry.core.reduce((n, mesh) => n + meshVolume(mesh), 0), study.metrics.coreVolume);
  near(study.geometry.shades.reduce((n, mesh) => n + meshVolume(mesh), 0), study.metrics.shadeArea * ASSUMPTIONS.shadeThickness);
  near(study.metrics.embodiedCarbon,
    study.metrics.concreteVolume * ASSUMPTIONS.concreteCarbonFactor +
    study.metrics.envelopeArea * ASSUMPTIONS.facadeCarbonFactor +
    study.metrics.shadeArea * ASSUMPTIONS.shadeCarbonFactor);
  near(study.metrics.carbonIntensity, study.metrics.embodiedCarbon / study.metrics.grossFloorArea);
  near(study.metrics.shadeOpenness, 0.75);
});

test('a fitted core remains inside the faceted envelope at extreme aspect ratios and rotations', () => {
  const extreme = generateStudy({ ...DEFAULT_PARAMS, width: 48, depth: 16, twist: 90, taper: 0.4 });
  near(extreme.metrics.coreWidth, 9);
  near(extreme.metrics.coreDepth, 3);
  assert.ok(extreme.metrics.coreScale < 1);
  for (const floors of [6, 18, 32]) for (const width of [18, 48]) for (const depth of [16, 40]) for (const twist of [-120, -90, 0, 90, 120]) for (const taper of [0, 0.4]) {
    const study = generateStudy({ ...DEFAULT_PARAMS, floors, width, depth, twist, taper });
    assert.ok(study.metrics.coreScale > 0 && study.metrics.coreScale <= 1);
    assert.ok(Math.min(study.metrics.coreWidth, study.metrics.coreDepth) - 2 * ASSUMPTIONS.coreWallThickness > 1.2);
    const coreCorners = study.geometry.core.flatMap((mesh) => mesh.vertices);
    // Check actual core vertices in every local floor coordinate frame.
    for (const level of study.levels) for (const [x, , z] of coreCorners) {
      const localX = x * Math.cos(level.rotation) - z * Math.sin(level.rotation);
      const localZ = x * Math.sin(level.rotation) + z * Math.cos(level.rotation);
      assert.ok(Math.abs(localX) <= level.width / 2 - ASSUMPTIONS.coreClearance + 1e-8);
      assert.ok(Math.abs(localZ) <= level.depth / 2 - ASSUMPTIONS.coreClearance + 1e-8);
    }
    // Facet half-space containment at each storey's two endpoints implies
    // containment throughout its height, since every plane is linear in y.
    const facade = study.geometry.envelope;
    for (const [ia, ib, ic] of facade.faces) {
      const a = facade.vertices[ia], b = facade.vertices[ib], c = facade.vertices[ic];
      const u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const horizontalLength = Math.hypot(n[0], n[2]);
      for (const [x, , z] of coreCorners) for (const y of [Math.min(a[1], b[1], c[1]), Math.max(a[1], b[1], c[1])]) {
        const outwardDistance = (n[0] * (x - a[0]) + n[1] * (y - a[1]) + n[2] * (z - a[2])) / horizontalLength;
        assert.ok(outwardDistance <= -ASSUMPTIONS.coreClearance + 1e-8, `Core protrudes for ${JSON.stringify(study.params)}`);
      }
    }
  }
});

test('twist changes the triangulated envelope while preserving floor areas', () => {
  const straight = generateStudy({ ...DEFAULT_PARAMS, twist: 0 });
  const twisted = generateStudy(DEFAULT_PARAMS);
  near(straight.metrics.grossFloorArea, twisted.metrics.grossFloorArea);
  assert.ok(twisted.metrics.envelopeArea > straight.metrics.envelopeArea);
  assert.ok(twisted.metrics.embodiedCarbon > straight.metrics.embodiedCarbon);
});

test('opposite twist handedness produces mirrored geometry with equal quantities', () => {
  for (const twist of [30, 90, 120]) {
    const positive = generateStudy({ ...DEFAULT_PARAMS, floors: 6, width: 48, depth: 16, taper: 0.4, twist });
    const negative = generateStudy({ ...positive.params, twist: -twist });
    for (const metric of ['grossFloorArea', 'envelopeArea', 'volume', 'coreScale', 'coreVolume', 'embodiedCarbon']) near(positive.metrics[metric], negative.metrics[metric]);
  }
});

test('the sweep is deterministic, controlled, distinct at limits and Pareto-correct', () => {
  for (const floors of [6, 18, 32]) {
    const sweep = runSweep({ ...DEFAULT_PARAMS, floors });
    assert.equal(sweep.length, 12);
    assert.equal(new Set(sweep.map((row) => row.id)).size, 12);
    assert.deepEqual(sweep, runSweep({ ...DEFAULT_PARAMS, floors }));
    for (const row of sweep) {
      for (const key of ['width', 'depth', 'floorHeight', 'shadeDepth']) assert.equal(row.params[key], DEFAULT_PARAMS[key]);
      const dominated = sweep.some((other) => other.metrics.grossFloorArea >= row.metrics.grossFloorArea && other.metrics.embodiedCarbon <= row.metrics.embodiedCarbon && (other.metrics.grossFloorArea > row.metrics.grossFloorArea || other.metrics.embodiedCarbon < row.metrics.embodiedCarbon));
      assert.equal(row.pareto, !dominated);
    }
  }
  const sweep = runSweep();
  assert.ok(sweep.some((row) => row.pareto));
  assert.ok(sweep.some((row) => !row.pareto));
});

test('OBJ has valid triangles and exactly the shared geometry vertices', () => {
  const study = generateStudy();
  const meshes = [study.geometry.envelope, ...study.geometry.slabs, ...study.geometry.shades, ...study.geometry.core];
  const obj = exportOBJ(study);
  assert.equal(obj, exportOBJ(DEFAULT_PARAMS));
  const vertices = obj.split('\n').filter((line) => line.startsWith('v '));
  const faces = obj.split('\n').filter((line) => line.startsWith('f '));
  assert.equal(vertices.length, meshes.reduce((n, mesh) => n + mesh.vertices.length, 0));
  assert.equal(faces.length, meshes.reduce((n, mesh) => n + mesh.faces.length, 0));
  for (const face of faces) {
    const indices = face.slice(2).split(' ').map(Number);
    assert.equal(indices.length, 3);
    indices.forEach((index) => assert.ok(Number.isInteger(index) && index >= 1 && index <= vertices.length));
  }
  const expected = meshes.flatMap((mesh) => mesh.vertices);
  vertices.forEach((line, i) => line.slice(2).split(' ').map(Number).forEach((value, axis) => near(value, expected[i][axis], 1e-6)));
});
