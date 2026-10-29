import * as THREE from '../assets/vendor/three-spatial.module.js';
import { SparkRenderer, SplatMesh } from '../assets/vendor/spark.module.js';

// A single immutable splat scene is projected at every camera. No image model
// is called here, so changing cameras cannot invent a different scene layout.
export async function renderFixedPanoramas({ bytes, cameras, scale = 1, onPanorama, width = 2048 }) {
  if (![3, 5].includes(cameras?.length) || !Number.isFinite(scale) || scale <= 0 || scale > 10000
      || ![1024, 2048].includes(width) || cameras.some(camera => !Array.isArray(camera.position) || camera.position.length !== 3
      || camera.position.some(value => !Number.isFinite(value) || Math.abs(value) > 10))) throw new Error('固定机位参数无效。');
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1); renderer.setSize(width, width / 2);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x070b10, 1);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x070b10);
  const spark = new SparkRenderer({ renderer, autoUpdate: false }); scene.add(spark);
  const splats = new SplatMesh({ fileBytes: bytes });
  // Marble raw assets use OpenCV axes; the original camera is at the origin.
  // Preserve that origin and eye height, while converting asset units to meters.
  splats.rotation.x = Math.PI; splats.scale.setScalar(scale); scene.add(splats);
  const cubeTarget = new THREE.WebGLCubeRenderTarget(width / 2, { generateMipmaps: false, minFilter: THREE.LinearFilter });
  const cubeCamera = new THREE.CubeCamera(.03, 1000, cubeTarget);
  const viewpoint = spark.newViewpoint({ sort360: true, sortRadial: true });
  const output = new THREE.WebGLRenderTarget(width, width / 2, { depthBuffer: false, stencilBuffer: false });
  output.texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.ShaderMaterial({ uniforms: { image: { value: cubeTarget.texture } },
    vertexShader: 'varying vec2 uvP; void main(){uvP=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `uniform samplerCube image; varying vec2 uvP;
      void main(){float phi=uvP.x*6.28318530718;float theta=(1.0-uvP.y)*3.14159265359;
        vec3 dir=vec3(cos(phi)*sin(theta),cos(theta),sin(phi)*sin(theta));
        gl_FragColor=textureCube(image,dir);
        #include <colorspace_fragment>
      }`, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material), flat = new THREE.Scene(); flat.add(quad);
  const flatCamera = new THREE.Camera();
  try {
    await splats.initialized;
    scene.updateMatrixWorld(true);
    for (let index = 0; index < cameras.length; index++) {
      const position = new THREE.Vector3(...cameras[index].position);
      await viewpoint.prepare({ scene, viewToWorld: new THREE.Matrix4().setPosition(position), update: true, forceOrigin: true });
      spark.prepareViewpoint(viewpoint);
      cubeCamera.position.copy(position); cubeCamera.update(renderer, scene);
      spark.prepareViewpoint(spark.defaultView);
      renderer.setRenderTarget(output); renderer.render(flat, flatCamera);
      const pixels = new Uint8Array(width * width / 2 * 4);
      await renderer.readRenderTargetPixelsAsync(output, 0, 0, width, width / 2, pixels);
      renderer.setRenderTarget(null);
      // WebGL readback starts at the bottom; Canvas image data starts at the top.
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = width / 2;
      const context = canvas.getContext('2d'), image = context.createImageData(width, width / 2);
      const stride = width * 4;
      for (let y = 0; y < width / 2; y++) image.data.set(pixels.subarray((width / 2 - 1 - y) * stride, (width / 2 - y) * stride), y * stride);
      context.putImageData(image, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .95));
      if (!blob) throw new Error('全景图片编码失败。');
      await onPanorama(blob, index);
      canvas.width = canvas.height = 1;
    }
  } finally {
    viewpoint.dispose(); spark.defaultView.dispose(); spark.active.splats.dispose();
    splats.dispose(); spark.material.dispose(); spark.geometry.dispose();
    cubeTarget.dispose(); output.dispose(); material.dispose(); quad.geometry.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  }
}
