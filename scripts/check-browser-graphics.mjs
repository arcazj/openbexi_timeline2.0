import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { firefox } from '@playwright/test';
import { firefoxTestOptions } from './firefox-test-options.mjs';

// Executed inside a real browser; a successful getContext alone is insufficient.
export function drawWebGL2Probe() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  document.body.append(canvas);
  const creationErrors = [];
  canvas.addEventListener('webglcontextcreationerror', event => creationErrors.push(event.statusMessage));
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
  if (!gl) return { status: 'failed', error: 'WebGL2 context creation failed', creationErrors };
  const shaders = [];
  let program, vertexArray;
  const result = { creationErrors, version: gl.getParameter(gl.VERSION), renderer: gl.getParameter(gl.RENDERER),
    vendor: gl.getParameter(gl.VENDOR), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    contextAttributes: gl.getContextAttributes() };
  try {
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Shader compilation failed: ${gl.getShaderInfoLog(shader)}`);
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
      void main() {
        vec2 positions[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
        gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
      }`);
    const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      out vec4 color;
      void main() { color = vec4(1.0, 0.0, 0.0, 1.0); }`);
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Shader linking failed: ${gl.getProgramInfoLog(program)}`);
    gl.useProgram(program);
    vertexArray = gl.createVertexArray();
    gl.bindVertexArray(vertexArray);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixel = new Uint8Array(4);
    gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    result.pixel = Array.from(pixel);
    result.expectedPixel = [255, 0, 0, 255];
    result.glError = gl.getError();
    if (gl.isContextLost() || result.glError !== gl.NO_ERROR) throw new Error(`WebGL2 draw failed (GL error ${result.glError}, context lost ${gl.isContextLost()})`);
    if (result.pixel.some((value, index) => value !== result.expectedPixel[index])) {
      throw new Error(`WebGL2 pixel mismatch: expected ${result.expectedPixel}, received ${result.pixel}`);
    }
    return { ...result, status: 'passed' };
  } catch (error) {
    return { ...result, status: 'failed', error: error.message };
  } finally {
    if (vertexArray) gl.deleteVertexArray(vertexArray);
    if (program) gl.deleteProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
    canvas.remove();
  }
}

const defaults = firefoxTestOptions();
export async function checkFirefoxGraphics({ launchOptions = { headless: defaults.headless, ...defaults.launchOptions } } = {}) {
  const report = { format: 'openbexi-firefox-graphics', startedAt: new Date().toISOString(), platform: process.platform,
    headless: launchOptions.headless, firefoxUserPrefs: launchOptions.firefoxUserPrefs,
    softwareEnvironment: Object.fromEntries(['LIBGL_ALWAYS_SOFTWARE', 'GALLIUM_DRIVER']
      .map(name => [name, launchOptions.env?.[name] ?? process.env[name] ?? null])), console: [] };
  let browser, deadline;
  try {
    browser = await firefox.launch({ ...launchOptions, timeout: 30000 });
    report.browserVersion = browser.version();
    const page = await browser.newPage();
    page.on('console', message => {
      if (['error', 'warning'].includes(message.type()) && report.console.length < 20) report.console.push(message.text());
    });
    Object.assign(report, await Promise.race([
      page.evaluate(drawWebGL2Probe),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('WebGL2 preflight exceeded 15 seconds')), 15000); }),
    ]));
  } catch (error) {
    Object.assign(report, { status: 'failed', error: error.message });
  } finally {
    clearTimeout(deadline);
    await browser?.close();
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { output: { type: 'string', default: 'artifacts/browser/firefox-graphics.json' } } });
  const report = await checkFirefoxGraphics();
  await mkdir(path.dirname(values.output), { recursive: true });
  await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'passed') {
    console.error('Firefox WebGL2 graphics preflight failed; inspect runner graphics provisioning before application tests.');
    process.exitCode = 1;
  }
}
