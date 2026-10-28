import * as THREE from '../assets/vendor/three.module.js';
import { textureDimensions, viewDirection } from './core.js';

export function createPanoramaRenderer(container, onContextChange) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.hidden = true;
  canvas.setAttribute('aria-hidden', 'true');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  const geometry = new THREE.SphereGeometry(500, 64, 40);
  geometry.scale(-1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  scene.add(new THREE.Mesh(geometry, material));
  let frame = 0, disposed = false, lost = false;
  const invalidate = () => {
    if (frame || disposed || lost || document.hidden) return;
    frame = requestAnimationFrame(() => { frame = 0; if (!disposed && !lost) renderer.render(scene, camera); });
  };
  const resize = () => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix(); invalidate();
  };
  const contextLost = event => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0; onContextChange(false); };
  const contextRestored = () => { lost = false; if (material.map) material.map.needsUpdate = true; material.needsUpdate = true; resize(); onContextChange(true); };
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  container.append(canvas);
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  return {
    setView(view) { camera.fov = view.fov; camera.updateProjectionMatrix(); camera.lookAt(...viewDirection(view)); invalidate(); },
    setImage(image) {
      const size = textureDimensions(image.naturalWidth, image.naturalHeight, Math.min(renderer.capabilities.maxTextureSize, 8192));
      let source = image;
      if (size.width !== image.naturalWidth || size.height !== image.naturalHeight) {
        source = document.createElement('canvas'); source.width = size.width; source.height = size.height;
        const context = source.getContext('2d');
        if (!context) throw new Error('图片无法读取，请换一张图片。');
        context.drawImage(image, 0, 0, size.width, size.height);
      }
      const texture = new THREE.Texture(source);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      const previous = material.map;
      material.map = texture; material.needsUpdate = true; previous?.dispose(); canvas.hidden = false; invalidate();
    },
    clear() { material.map?.dispose(); material.map = null; material.needsUpdate = true; canvas.hidden = true; invalidate(); },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('webglcontextrestored', contextRestored);
      material.map?.dispose(); material.dispose(); geometry.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    }
  };
}
