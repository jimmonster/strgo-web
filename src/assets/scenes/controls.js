import * as T from '../vendor/three.module.js';
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export class SceneControls {
  constructor(camera, canvas, model, onChange, onInteract) {
    this.camera = camera; this.canvas = canvas; this.model = model; this.onChange = onChange;
    this.base = { ...model.camera, target: model.target.slice() }; this.state = { ...model.camera };
    this.target = new T.Vector3(...model.target); this.desired = { ...this.state }; this.desiredTarget = this.target.clone();
    this.pointers = new Map(); this.cleanups = []; this.mobile = false; this.pinch = 0;
    const on = (target, name, handler, options) => { target.addEventListener(name, handler, options); this.cleanups.push(() => target.removeEventListener(name, handler, options)); };
    const interact = () => { onInteract(); onChange(); };
    on(canvas, 'pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, [event.clientX, event.clientY]); this.pinch = this.distance(); interact();
    });
    on(canvas, 'pointermove', event => {
      if (!this.pointers.has(event.pointerId)) return;
      const old = this.pointers.get(event.pointerId); this.pointers.set(event.pointerId, [event.clientX, event.clientY]);
      if (this.pointers.size === 1) {
        this.desired.theta -= (event.clientX - old[0]) * .005;
        this.desired.phi -= (event.clientY - old[1]) * .004;
      } else { const next = this.distance(); if (next && this.pinch) this.desired.radius *= this.pinch / next; this.pinch = next; }
      this.constrain(); onChange();
    });
    const release = event => { this.pointers.delete(event.pointerId); this.pinch = this.distance(); };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) on(canvas, name, release);
    on(canvas, 'wheel', event => { event.preventDefault(); this.desired.radius *= Math.exp(clamp(event.deltaY, -150, 150) * .0015); this.constrain(); interact(); }, { passive: false });
    on(canvas, 'keydown', event => {
      const keys = { ArrowLeft: ['theta', .08], ArrowRight: ['theta', -.08], ArrowUp: ['phi', -.06], ArrowDown: ['phi', .06], '+': ['radius', -1], '=': ['radius', -1], '-': ['radius', 1] };
      if (event.key === 'Home') { event.preventDefault(); this.reset(); interact(); }
      const action = keys[event.key]; if (!action) return;
      event.preventDefault(); this.desired[action[0]] += action[1]; this.constrain(); interact();
    });
    this.update(1, true);
  }
  distance() { const values = [...this.pointers.values()]; return values.length < 2 ? 0 : Math.hypot(values[0][0] - values[1][0], values[0][1] - values[1][1]); }
  constrain() {
    for (const key of ['theta', 'phi', 'radius']) { const bounds = this.model.limits[key]; this.desired[key] = clamp(this.desired[key], bounds[0], bounds[1]); }
  }
  setView(view, immediate = false) {
    this.desired = { theta: view.theta, phi: view.phi, radius: view.radius };
    this.desiredTarget.set(...view.target); this.constrain(); this.update(1, immediate); this.onChange();
  }
  reset() { this.setView(this.base); }
  update(delta, immediate = false) {
    const amount = immediate ? 1 : 1 - Math.exp(-delta * 10);
    let difference = this.target.distanceTo(this.desiredTarget);
    for (const key of ['theta', 'phi', 'radius']) { difference += Math.abs(this.state[key] - this.desired[key]); this.state[key] += (this.desired[key] - this.state[key]) * amount; }
    this.target.lerp(this.desiredTarget, amount);
    const fit = this.mobile ? Math.max(1, (this.model.duration ? 1.1 : .95) / this.camera.aspect) : 1;
    const radius = this.state.radius * fit;
    const { theta, phi } = this.state;
    this.camera.position.set(radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.cos(theta)).add(this.target);
    this.camera.lookAt(this.target); return difference > .0002;
  }
  destroy() { this.cleanups.splice(0).forEach(fn => fn()); this.pointers.clear(); }
}
