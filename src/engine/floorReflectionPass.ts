const SSR_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SSR_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uSceneTex;
  uniform float uFloorY;
  uniform float uAspect;
  uniform float uTime;

  void main() {
    vec3 direct = texture2D(uSceneTex, vUv).rgb;
    float dist = uFloorY - vUv.y;

    if (dist > 0.0) {
      vec2 refBase = vec2(vUv.x, uFloorY + dist * 1.12);
      if (refBase.y < 1.0) {
        float blurY = 0.0025 + dist * 0.055;
        float blurX = (0.0035 + dist * 0.075) / max(uAspect, 0.5);
        float ripple = sin(vUv.y * 130.0 - uTime * 1.5 + vUv.x * 18.0) * 0.0022 * smoothstep(0.0, 0.12, dist);

        vec3 refCol = vec3(0.0);
        for (int ix = -1; ix <= 1; ix++) {
          for (int iy = -1; iy <= 1; iy++) {
            float w = (ix == 0 && iy == 0) ? 0.25 : ((abs(ix) + abs(iy) == 1) ? 0.125 : 0.0625);
            vec2 sampleUv = refBase + vec2(float(ix) * blurX + ripple, float(iy) * blurY);
            if (sampleUv.y > uFloorY && sampleUv.y < 1.0) {
              refCol += texture2D(uSceneTex, clamp(sampleUv, vec2(0.001), vec2(0.999))).rgb * w;
            }
          }
        }

        float edgeIn = smoothstep(0.0, 0.025, dist);
        float edgeOut = smoothstep(0.0, 0.04, vUv.y);
        float falloff = exp(-dist * 7.5);
        float strength = 0.24 * edgeIn * edgeOut * falloff;

        direct += refCol * vec3(0.86, 0.88, 1.0) * strength;
      }
    }

    gl_FragColor = vec4(direct, 1.0);
  }
`;

export class FloorReflectionPass {
  private renderer: any;
  private target: any;
  private scene: any;
  private camera: any;
  private quadGeo: any;
  private material: any;
  private quad: any;

  constructor(renderer: any, width: number, height: number, dpr: number) {
    this.renderer = renderer;

    const rtW = Math.max(1, Math.floor(width * dpr));
    const rtH = Math.max(1, Math.floor(height * dpr));

    this.target = new THREE.WebGLRenderTarget(rtW, rtH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeo = new THREE.PlaneGeometry(2, 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader: SSR_VERTEX,
      fragmentShader: SSR_FRAGMENT,
      uniforms: {
        uSceneTex: { value: this.target.texture },
        uFloorY: { value: 0.16 },
        uAspect: { value: Math.max(1, width) / Math.max(1, height) },
        uTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(this.quadGeo, this.material);
    this.scene.add(this.quad);
  }

  public get renderTarget() {
    return this.target;
  }

  public resize(width: number, height: number, dpr: number) {
    const rtW = Math.max(1, Math.floor(width * dpr));
    const rtH = Math.max(1, Math.floor(height * dpr));
    this.target.setSize(rtW, rtH);
    this.material.uniforms.uAspect.value = Math.max(1, width) / Math.max(1, height);
  }

  public renderToScreen(floorScreenY: number, time: number) {
    this.material.uniforms.uFloorY.value = floorScreenY;
    this.material.uniforms.uTime.value = time;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  public dispose() {
    this.target.dispose();
    this.quadGeo.dispose();
    this.material.dispose();
  }
}
