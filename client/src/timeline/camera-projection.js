import { Matrix4, PerspectiveCamera, Vector3 } from 'three';

// Use the same projective transform for WebGL and the accessible HTML hit targets.
// The DOM plane uses downward Y; the timeline's world plane uses upward Y.
export function perspectiveCamera(width, height, offset = 0, camera = new PerspectiveCamera()) {
  const distance = height / (2 * Math.tan(Math.PI / 8)) * 1.16;
  Object.assign(camera, { fov: 45, aspect: width / height, near: 0.1, far: distance * 5 + 100 });
  camera.position.set(width / 2 - offset, height / 2 - distance * .3, distance);
  camera.lookAt(width / 2 - offset, height / 2, 0);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  return camera;
}

export function projectedDomTransform(camera, width, height) {
  const world = new Matrix4().set(1, 0, 0, 0, 0, -1, 0, height, 0, 0, 1, 0, 0, 0, 0, 1);
  const screen = new Matrix4().set(width / 2, 0, 0, width / 2, 0, -height / 2, 0, height / 2, 0, 0, 1, 0, 0, 0, 0, 1);
  const matrix = screen.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(world);
  const divisor = matrix.elements[15];
  return `matrix3d(${matrix.elements.map(value => value / divisor).join(',')})`;
}

export function unprojectPlanePoint(camera, x, y, width, height) {
  const origin = new Vector3(x / width * 2 - 1, 1 - y / height * 2, .5).unproject(camera);
  const direction = origin.clone().sub(camera.position).normalize();
  const point = camera.position.clone().addScaledVector(direction, -camera.position.z / direction.z);
  return { x: point.x, y: height - point.y };
}
