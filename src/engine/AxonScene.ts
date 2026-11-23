import { FloorReflectionPass } from './floorReflectionPass';
import { FluidSimulation } from './fluidSimulation';
import { ParticleSystem } from './particleSimulation';

function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function detectMobileViewport(): boolean {
  return (
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    window.innerWidth <= 760
  );
}

export class AxonScene {
  private canvas: HTMLCanvasElement;
  private renderer: any;
  private scene: any;
  private camera: any;
  private fluid: FluidSimulation;
  private particles: ParticleSystem;
  private reflectionPass: FloorReflectionPass;

  private isSoftwareGl: boolean;
  private isMobile: boolean;
  private width: number;
  private height: number;
  private dpr: number;

  private baseCamPos = new THREE.Vector3(-1.17, 0, 6);
  private targetCamPos = new THREE.Vector3(-1.17, 0, 6);
  private origin = new THREE.Vector3(0, 0, 0);
  private floorRefWorld = new THREE.Vector3(0.343, -1.32, -1.0);

  private currX = 0;
  private currY = 0;
  private prevX = 0;
  private prevY = 0;
  private hasPointerInit = false;
  private pointerMoved = false;

  private clock = new THREE.Clock();
  private rafId = 0;
  private timerId = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.isSoftwareGl = detectSoftwareWebGL();
    this.isMobile = detectMobileViewport();
    this.dpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);

    this.currX = this.width * 0.5;
    this.currY = this.height * 0.5;
    this.prevX = this.currX;
    this.prevY = this.currY;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.extensions?.get?.('EXT_color_buffer_float');
    this.renderer.extensions?.get?.('EXT_color_buffer_half_float');
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(
      30,
      this.width / this.height,
      0.1,
      1000,
    );
    this.camera.position.copy(this.baseCamPos);
    this.camera.lookAt(this.origin);

    this.fluid = new FluidSimulation(
      this.renderer,
      this.width,
      this.height,
      this.isMobile,
    );
    this.particles = new ParticleSystem(
      this.renderer,
      this.isMobile,
      this.dpr,
    );
    this.scene.add(this.particles.group);

    this.reflectionPass = new FloorReflectionPass(
      this.renderer,
      this.width,
      this.height,
      this.dpr,
    );

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    window.addEventListener('mousemove', this.onMouseMove, { passive: true });
    window.addEventListener('touchstart', this.onTouchStart, { passive: true });
    window.addEventListener('touchmove', this.onTouchMove, { passive: true });
    window.addEventListener('resize', this.onResize, { passive: true });
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);

    this.tick();
  }

  private setPointer(x: number, y: number, resetPrev = false) {
    if (!this.hasPointerInit || resetPrev) {
      this.prevX = x;
      this.prevY = y;
      this.currX = x;
      this.currY = y;
      this.hasPointerInit = true;
      return;
    }
    this.currX = x;
    this.currY = y;
    this.pointerMoved = true;
  }

  private onMouseMove = (e: MouseEvent) => {
    this.setPointer(e.clientX, e.clientY, false);
  };

  private onTouchStart = (e: TouchEvent) => {
    if (e.touches.length > 0) {
      const t = e.touches[0];
      this.setPointer(t.clientX, t.clientY, true);
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    if (e.touches.length > 0) {
      const t = e.touches[0];
      this.setPointer(t.clientX, t.clientY, false);
    }
  };

  private onResize = () => {
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.isMobile = detectMobileViewport();
    this.dpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height, false);

    this.fluid.resize(this.width, this.height, this.isMobile);
    this.particles.setDPR(this.dpr);
    this.reflectionPass.resize(this.width, this.height, this.dpr);
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
  };

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.timerId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.timerId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.timerId = window.setTimeout(cb, 80);
      }
    };
    this.timerId = window.setTimeout(poll, 5);
  }

  private tick = () => {
    if (this.disposed) return;

    const dt = Math.min(0.05, Math.max(0.001, this.clock.getDelta()));
    const elapsed = this.clock.elapsedTime;
    const nowMs = performance.now();

    // Gaze camera: base + (mouse.x 0..width -> -1..1)*(-1) on x, (mouse.y 0..height -> -1..1)*2 on y
    const nx = (this.currX / this.width) * 2 - 1;
    const ny = (this.currY / this.height) * 2 - 1;
    this.targetCamPos.set(
      this.baseCamPos.x + nx * -1,
      this.baseCamPos.y + ny * 2,
      this.baseCamPos.z,
    );
    const camLerp = 1 - Math.pow(0.95, dt * 60);
    this.camera.position.lerp(this.targetCamPos, camLerp);
    this.camera.lookAt(this.origin);

    // Step fluid simulation
    this.fluid.step(
      this.prevX,
      this.prevY,
      this.currX,
      this.currY,
      this.pointerMoved,
      nowMs,
    );
    this.prevX = this.currX;
    this.prevY = this.currY;
    this.pointerMoved = false;

    // Step GPU particle simulation
    this.particles.update(
      elapsed,
      dt,
      this.camera,
      this.fluid.velocityTexture,
      this.fluid.densityMaskTexture,
    );

    // Render particle scene to offscreen target, then apply screen-space virtual floor reflection
    this.renderer.setRenderTarget(this.reflectionPass.renderTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    this.floorRefWorld.set(0.343, -1.32, -1.0).project(this.camera);
    const floorScreenY = THREE.MathUtils.clamp(
      this.floorRefWorld.y * 0.5 + 0.5,
      0.08,
      0.42,
    );
    this.reflectionPass.renderToScreen(floorScreenY, elapsed);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.timerId);

    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);

    this.fluid.dispose();
    this.particles.dispose();
    this.reflectionPass.dispose();
    this.renderer.dispose();
  }
}
