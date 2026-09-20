import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { perspectiveCamera, unprojectPlanePoint } from '../../client/src/timeline/camera-projection.js';

test('perspective screen hits invert to the same timeline point at wide and narrow sizes', () => {
  for (const [width, height] of [[1500, 700], [350, 400]]) {
    const camera = perspectiveCamera(width, height);
    for (const [x, y] of [[40, 60], [width / 2, height / 2], [width - 50, height - 30]]) {
      const projected = new Vector3(x, height - y, 0).project(camera);
      const point = unprojectPlanePoint(camera, (projected.x + 1) * width / 2, (1 - projected.y) * height / 2, width, height);
      assert.ok(Math.abs(point.x - x) < 1e-8); assert.ok(Math.abs(point.y - y) < 1e-8);
    }
  }
});
test('horizontal drag distance is stable while the perspective camera follows navigation', () => {
  const camera = perspectiveCamera(1500, 700), at = (x, y) => unprojectPlanePoint(camera, x, y, 1500, 700).x;
  const delta = at(200, 160) - at(0, 160);
  perspectiveCamera(1500, 700, 350, camera);
  assert.ok(Math.abs((at(200, 160) - at(0, 160)) - delta) < 1e-8);
});
