import * as THREE from '../assets/vendor/three.module.js';
import { Component } from '../core/Component.js';
import { makeParticleField, lerp, seededRandom } from '../core/math.js';
export const particleVertexShader = `
  attribute vec3 color;
  attribute float aSize;
  uniform vec2 uMouse;
  uniform vec2 uResolution;
  uniform float uMouseActive;
  uniform float uDpr;
  varying vec3 vColor;
  varying float vInfluence;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vec4 clip = projectionMatrix * viewPosition;
    vec2 screen = clip.xy / clip.w * 0.5 + 0.5;
    vec2 delta = (screen - uMouse) * uResolution;
    float distanceToMouse = length(delta);
    float influence = pow(max(1.0 - distanceToMouse / 150.0, 0.0), 2.0) * uMouseActive;
    vec2 direction = delta / max(distanceToMouse, 1.0);
    clip.xy += direction * influence * 45.0 / uResolution * 2.0 * clip.w;
    gl_Position = clip;
    gl_PointSize = clamp(aSize * 85.0 / max(-viewPosition.z, 1.0), 1.0, 5.0) * uDpr * (1.0 + influence * 1.8);
    vColor = color;
    vInfluence = influence;
  }
`;
export const particleFragmentShader = `
  varying vec3 vColor;
  varying float vInfluence;
  void main() {
    float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (radius > 1.0) discard;
    float glow = pow(1.0 - radius, 2.2);
    gl_FragColor = vec4(mix(vColor, vec3(0.75, 1.0, 1.0), vInfluence), glow * (0.55 + vInfluence * 0.45));
  }
`;
export class HeroSection extends Component {
  constructor(element, guard) {
    super(element, guard);
    const letters = [...element.querySelectorAll('.hero-letter')];
    if (!guard.paused) {
      if (window.gsap) {
        const timeline = window.gsap.timeline();
        timeline.fromTo(letters, { opacity: 0, y: 120, rotateX: -90, filter: 'blur(15px)' }, { opacity: 1, y: 0, rotateX: 0, filter: 'blur(0px)', stagger: .04, duration: 1.5, ease: 'expo.out', clearProps: 'filter,transform,opacity' }, .1);
        this.own(guard.subscribe(() => { if (guard.paused || document.hidden) timeline.progress(1); }));
        this.own(() => timeline.kill());
      } else {
        const animations = letters.map((letter, i) => letter.animate([
          { opacity: 0, transform: 'translateY(120px) rotateX(-90deg)', filter: 'blur(15px)' },
          { opacity: 1, transform: 'translateY(0) rotateX(0)', filter: 'blur(0)' }
        ], { duration: 1400, delay: 100 + i * 40, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }));
        this.own(guard.subscribe(() => { if (guard.paused || document.hidden) animations.forEach(animation => animation.finish()); }));
        this.own(() => animations.forEach(animation => animation.cancel()));
      }
    }
    const canvas = element.querySelector('.nebula-canvas');
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' }); }
    catch { element.dataset.renderer = 'css-fallback'; return; }
    element.classList.add('has-webgl'); element.dataset.renderer = 'three';
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 1, .1, 100);
    camera.position.z = 12;
    const data = makeParticleField(2500), random = seededRandom(16);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(Float32Array.from({ length: 2500 }, () => .15 + random() * .42), 1));
    const uniforms = { uMouse: { value: new THREE.Vector2(.5, .5) }, uResolution: { value: new THREE.Vector2(1, 1) }, uMouseActive: { value: 0 }, uDpr: { value: 1 } };
    const material = new THREE.ShaderMaterial({ uniforms, vertexShader: particleVertexShader, fragmentShader: particleFragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geometry, material); scene.add(points);
    const mouse = { x: 0, y: 0 };
    let lastRender = 0, elapsed = 0, tiltX = 0, tiltY = 0, active = true;
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, guard.mobile ? 1 : 1.5);
      renderer.setPixelRatio(dpr); renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix();
      uniforms.uResolution.value.set(width, height); uniforms.uDpr.value = dpr;
      geometry.setDrawRange(0, guard.mobile ? 850 : 2500);
      renderer.render(scene, camera);
    };
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(element);
    this.on(element, 'pointermove', event => {
      if (guard.mobile || guard.paused) return;
      const box = element.getBoundingClientRect();
      const nx = (event.clientX - box.left) / box.width, ny = (event.clientY - box.top) / box.height;
      uniforms.uMouse.value.set(nx, 1 - ny); uniforms.uMouseActive.value = 1;
      mouse.x = (nx - .5) * -.11; mouse.y = (ny - .5) * -.1;
    }, { passive: true });
    this.on(element, 'pointerleave', () => { uniforms.uMouseActive.value = 0; mouse.x = mouse.y = 0; });
    const stopLoop = guard.animationLoop(element, (time, delta) => {
      if (!active || (guard.mobile && time - lastRender < 32)) return;
      elapsed += delta / 1000;
      tiltY = lerp(tiltY, mouse.x, .035); tiltX = lerp(tiltX, mouse.y, .035);
      points.rotation.y = elapsed * .019 + tiltY; points.rotation.x = tiltX;
      renderer.render(scene, camera); lastRender = time;
      canvas.dataset.frames = String(Number(canvas.dataset.frames || 0) + 1);
    });
    this.own(guard.subscribe(() => { if (guard.mobile) { uniforms.uMouseActive.value = 0; mouse.x = mouse.y = 0; } resize(); }));
    this.on(canvas, 'webglcontextlost', event => { event.preventDefault(); active = false; element.classList.remove('has-webgl'); });
    this.on(canvas, 'webglcontextrestored', () => { active = true; element.classList.add('has-webgl'); resize(); });
    this.own(() => { stopLoop(); resizeObserver.disconnect(); geometry.dispose(); material.dispose(); renderer.dispose(); });
    resize();
  }
}
