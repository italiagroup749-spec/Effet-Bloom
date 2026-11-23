export interface FluidConfig {
  simResolution: number;
  dyeResolution: number;
  velocityDissipation: number;
  densityDissipation: number;
  pressureDissipation: number;
  pressureIterations: number;
  curl: number;
  dt: number;
}

const DEFAULT_CONFIG: FluidConfig = {
  simResolution: 256,
  dyeResolution: 512,
  velocityDissipation: 0.98,
  densityDissipation: 0.97,
  pressureDissipation: 0.95,
  pressureIterations: 5,
  curl: 30,
  dt: 1 / 60,
};

interface DoubleFBO {
  read: any;
  write: any;
  swap: () => void;
  dispose: () => void;
}

const BASE_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SPLAT_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform vec2 uPoint0;
  uniform vec2 uPoint1;
  uniform float uRadius;
  uniform float uAspect;
  uniform vec3 uColor;
  uniform float uClampMax;

  void main() {
    vec4 base = texture2D(uTarget, vUv);
    vec2 p = vUv - uPoint0;
    vec2 ba = uPoint1 - uPoint0;
    float baDot = dot(ba, ba);
    float h = baDot > 1e-8 ? clamp(dot(p, ba) / baDot, 0.0, 1.0) : 0.0;
    vec2 diff = p - ba * h;
    diff.x *= uAspect;
    float r = max(uRadius, 1e-4);
    float splat = exp(-dot(diff, diff) / (r * r));
    vec3 col = base.rgb + splat * uColor;
    if (uClampMax > 0.0) {
      col = min(col, vec3(uClampMax));
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const CURL_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 uTexelSize;

  void main() {
    float L = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).y;
    float R = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).y;
    float T = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).x;
    float B = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).x;
    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
  }
`;

const VORTICITY_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform vec2 uTexelSize;
  uniform float uCurlStrength;
  uniform float uDt;

  void main() {
    float L = texture2D(uCurl, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture2D(uCurl, vUv + vec2(uTexelSize.x, 0.0)).x;
    float T = texture2D(uCurl, vUv + vec2(0.0, uTexelSize.y)).x;
    float B = texture2D(uCurl, vUv - vec2(0.0, uTexelSize.y)).x;
    float C = texture2D(uCurl, vUv).x;

    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= uCurlStrength * C;
    force.y *= -1.0;

    vec2 vel = texture2D(uVelocity, vUv).xy;
    gl_FragColor = vec4(vel + force * uDt, 0.0, 1.0);
  }
`;

const DIVERGENCE_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 uTexelSize;

  void main() {
    float L = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;
    float T = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;
    float B = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`;

const CLEAR_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float uValue;

  void main() {
    gl_FragColor = uValue * texture2D(uTexture, vUv);
  }
`;

const PRESSURE_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  uniform vec2 uTexelSize;

  void main() {
    float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
    float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
    float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`;

const GRADIENT_SUBTRACT_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  uniform vec2 uTexelSize;

  void main() {
    float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
    float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
    float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
    vec2 vel = texture2D(uVelocity, vUv).xy;
    vel.xy -= 0.5 * vec2(R - L, T - B);
    gl_FragColor = vec4(vel, 0.0, 1.0);
  }
`;

const ADVECT_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 uTexelSize;
  uniform float uDt;
  uniform float uDissipation;

  void main() {
    vec2 vel = texture2D(uVelocity, vUv).xy;
    vec2 coord = clamp(vUv - uDt * vel * uTexelSize, vec2(0.0), vec2(1.0));
    vec4 result = texture2D(uSource, coord);
    gl_FragColor = vec4(result.rgb * uDissipation, 1.0);
  }
`;

const DISPLAY_MASK_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uDensity;

  void main() {
    vec3 c = texture2D(uDensity, vUv).rgb;
    float a = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c, a);
  }
`;

function clampMap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const t = Math.min(1, Math.max(0, (value - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

export class FluidSimulation {
  private renderer: any;
  private config: FluidConfig;
  private scene: any;
  private camera: any;
  private quad: any;
  private quadGeo: any;

  private velocity: DoubleFBO;
  private density: DoubleFBO;
  private pressure: DoubleFBO;
  private divergence: any;
  private curlTarget: any;
  private maskTarget: any;

  private splatMat: any;
  private curlMat: any;
  private vorticityMat: any;
  private divergenceMat: any;
  private clearMat: any;
  private pressureMat: any;
  private gradSubtractMat: any;
  private advectMat: any;
  private displayMaskMat: any;

  private lastSplatTime = 0;
  private width: number;
  private height: number;
  private isMobile: boolean;

  constructor(
    renderer: any,
    width: number,
    height: number,
    isMobile: boolean,
    config: Partial<FluidConfig> = {},
  ) {
    this.renderer = renderer;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.isMobile = isMobile;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.quadGeo, undefined);
    this.scene.add(this.quad);

    const simRes = this.config.simResolution;
    const dyeRes = this.config.dyeResolution;

    this.velocity = this.createDoubleFBO(simRes, simRes, THREE.LinearFilter);
    this.density = this.createDoubleFBO(dyeRes, dyeRes, THREE.LinearFilter);
    this.pressure = this.createDoubleFBO(simRes, simRes, THREE.NearestFilter);
    this.divergence = this.createFBO(simRes, simRes, THREE.NearestFilter);
    this.curlTarget = this.createFBO(simRes, simRes, THREE.NearestFilter);
    this.maskTarget = this.createMaskTarget(this.width, this.height);

    this.splatMat = new THREE.ShaderMaterial({
      vertexShader: BASE_VERTEX,
      fragmentShader: SPLAT_FRAGMENT,
      uniforms: {
        uTarget: { value: null },
        uPoint0: { value: new THREE.Vector2() },
        uPoint1: { value: new THREE.Vector2() },
        uRadius: { value: 0.05 },
        uAspect: { value: this.width / this.height },
        uColor: { value: new THREE.Vector3() },
        uClampMax: { value: 0.0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    const simTexel = new THREE.Vector2(1 / simRes, 1 / simRes);

    this.curlMat = new THREE.ShaderMaterial({
      vertexShader: BASE_VERTEX,
      fragmentShader: CURL_FRAGMENT,
      uniforms: {
        uVelocity: { value: null },
        uTexelSize: { value: simTexel },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.vorticityMat = new THREE.ShaderMaterial({
      vertexShader: BASE_VERTEX,
      fragmentShader: VORTICITY_FRAGMENT,
      uniforms: {
        uVelocity: { value: null },
        uCurl: { value: null },
        uTexelSize: { value: simTexel },
        uCurlStrength: { value: this.config.curl },
        uDt: { value: this.config.dt },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.divergenceMat = new THREE.ShaderMaterial({
      vertexShader: BASE_VERTEX,
      fragmentShader: DIVERGENCE_FRAGMENT,
      uniforms: {
        uVelocity: { value: null },
        uTexelSize: { value: simTexel },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.clearMat = new THREE.ShaderMaterial({
      vertexShader: BASE_VERTEX,
      fragmentShader: CLEAR_FRAGMENT,
      uniforms: {
        uTexture: { value: null },
        uValue: { value: this.config.pressureDissipation },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.pressureMat = new THREE.ShaderMaterial({
      vertexShader: BASE_VERTEX,
      fragmentShader: PRESSURE_FRAGMENT,
      uniforms: {
        uPressure: { value: null },
        uDivergence: { value: null },
        uTexelSize: { value: simTexel },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.gradSubtractMat = new THREE.ShaderMaterial({
      vertexShader: BASE_VERTEX,
      fragmentShader: GRADIENT_SUBTRACT_FRAGMENT,
      uniforms: {
        uPressure: { value: null },
        uVelocity: { value: null },
        uTexelSize: { value: simTexel },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.advectMat = new THREE.ShaderMaterial({
      vertexShader: BASE_VERTEX,
      fragmentShader: ADVECT_FRAGMENT,
      uniforms: {
        uVelocity: { value: null },
        uSource: { value: null },
        uTexelSize: { value: simTexel },
        uDt: { value: this.config.dt },
        uDissipation: { value: 1.0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.displayMaskMat = new THREE.ShaderMaterial({
      vertexShader: BASE_VERTEX,
      fragmentShader: DISPLAY_MASK_FRAGMENT,
      uniforms: {
        uDensity: { value: null },
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  private createFBO(w: number, h: number, filter: any) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: filter,
      magFilter: filter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  private createDoubleFBO(w: number, h: number, filter: any): DoubleFBO {
    let fbo1 = this.createFBO(w, h, filter);
    let fbo2 = this.createFBO(w, h, filter);
    return {
      get read() {
        return fbo1;
      },
      get write() {
        return fbo2;
      },
      swap() {
        const tmp = fbo1;
        fbo1 = fbo2;
        fbo2 = tmp;
      },
      dispose() {
        fbo1.dispose();
        fbo2.dispose();
      },
    };
  }

  private createMaskTarget(w: number, h: number) {
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  private blit(material: any, target: any) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  public resize(width: number, height: number, isMobile: boolean) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.isMobile = isMobile;
    this.maskTarget.setSize(this.width, this.height);
    this.splatMat.uniforms.uAspect.value = this.width / this.height;
  }

  public step(
    prevX: number,
    prevY: number,
    currX: number,
    currY: number,
    hasMoved: boolean,
    nowMs: number,
  ) {
    const dx = currX - prevX;
    const dy = currY - prevY;
    const len = Math.hypot(dx, dy);

    if (hasMoved && len > 0.01) {
      const mobileScale = this.isMobile ? 0.8 : 1.0;
      const radiusPx = clampMap(len, 0, 5, 0, 60) * 0.6 * mobileScale;
      const mult = clampMap(len, 0, 15, 0, 10);

      const startX = nowMs - this.lastSplatTime > 50 ? currX : prevX;
      const startY = nowMs - this.lastSplatTime > 50 ? currY : prevY;
      this.lastSplatTime = nowMs;

      const u0 = startX / this.width;
      const v0 = 1.0 - startY / this.height;
      const u1 = currX / this.width;
      const v1 = 1.0 - currY / this.height;

      const uvRadius = (radiusPx / 200.0) * 0.45;

      // Splat velocity (additive)
      this.splatMat.uniforms.uTarget.value = this.velocity.read.texture;
      this.splatMat.uniforms.uPoint0.value.set(u0, v0);
      this.splatMat.uniforms.uPoint1.value.set(u1, v1);
      this.splatMat.uniforms.uRadius.value = uvRadius;
      this.splatMat.uniforms.uColor.value.set(dx * mult, -dy * mult, 1.0);
      this.splatMat.uniforms.uClampMax.value = 0.0;
      this.blit(this.splatMat, this.velocity.write);
      this.velocity.swap();

      // Splat white into density
      this.splatMat.uniforms.uTarget.value = this.density.read.texture;
      this.splatMat.uniforms.uColor.value.set(1.0, 1.0, 1.0);
      this.splatMat.uniforms.uClampMax.value = 1.0;
      this.blit(this.splatMat, this.density.write);
      this.density.swap();
    }

    // 1. Curl
    this.curlMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.blit(this.curlMat, this.curlTarget);

    // 2. Vorticity confinement
    this.vorticityMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.vorticityMat.uniforms.uCurl.value = this.curlTarget.texture;
    this.blit(this.vorticityMat, this.velocity.write);
    this.velocity.swap();

    // 3. Divergence
    this.divergenceMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.blit(this.divergenceMat, this.divergence);

    // 4. Pressure dissipation
    this.clearMat.uniforms.uTexture.value = this.pressure.read.texture;
    this.clearMat.uniforms.uValue.value = this.config.pressureDissipation;
    this.blit(this.clearMat, this.pressure.write);
    this.pressure.swap();

    // 5. Pressure Jacobi iterations
    this.pressureMat.uniforms.uDivergence.value = this.divergence.texture;
    for (let i = 0; i < this.config.pressureIterations; i++) {
      this.pressureMat.uniforms.uPressure.value = this.pressure.read.texture;
      this.blit(this.pressureMat, this.pressure.write);
      this.pressure.swap();
    }

    // 6. Gradient subtract
    this.gradSubtractMat.uniforms.uPressure.value = this.pressure.read.texture;
    this.gradSubtractMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.blit(this.gradSubtractMat, this.velocity.write);
    this.velocity.swap();

    // 7. Advect velocity
    this.advectMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.advectMat.uniforms.uSource.value = this.velocity.read.texture;
    this.advectMat.uniforms.uDissipation.value = this.config.velocityDissipation;
    this.blit(this.advectMat, this.velocity.write);
    this.velocity.swap();

    // 8. Advect density
    this.advectMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.advectMat.uniforms.uSource.value = this.density.read.texture;
    this.advectMat.uniforms.uDissipation.value = this.config.densityDissipation;
    this.blit(this.advectMat, this.density.write);
    this.density.swap();

    // 9. Display density to viewport-sized mask target (alpha = max(r, g, b))
    this.displayMaskMat.uniforms.uDensity.value = this.density.read.texture;
    this.blit(this.displayMaskMat, this.maskTarget);

    this.renderer.setRenderTarget(null);
  }

  public get velocityTexture() {
    return this.velocity.read.texture;
  }

  public get densityMaskTexture() {
    return this.maskTarget.texture;
  }

  public dispose() {
    this.velocity.dispose();
    this.density.dispose();
    this.pressure.dispose();
    this.divergence.dispose();
    this.curlTarget.dispose();
    this.maskTarget.dispose();
    this.quadGeo.dispose();
    this.splatMat.dispose();
    this.curlMat.dispose();
    this.vorticityMat.dispose();
    this.divergenceMat.dispose();
    this.clearMat.dispose();
    this.pressureMat.dispose();
    this.gradSubtractMat.dispose();
    this.advectMat.dispose();
    this.displayMaskMat.dispose();
  }
}
