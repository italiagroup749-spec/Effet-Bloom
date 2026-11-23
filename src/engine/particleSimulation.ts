import { createMatcapDataUri } from '../utils/matcap';

const SIM_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const COPY_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSource;

  void main() {
    gl_FragColor = texture2D(uSource, vUv);
  }
`;

const SIM_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uPositions;
  uniform sampler2D uOrigin;
  uniform sampler2D uRandom;
  uniform sampler2D uFluidVelocity;
  uniform sampler2D uFluidDensity;

  uniform float uTime;
  uniform float uHZ;
  uniform mat4 uProjView;
  uniform mat4 uModel;
  uniform mat3 uCamNormal;
  uniform mat3 uGroupInvRot;

  // Analytic curl of three Bridson-style sine-sum potentials, normalized
  vec3 curlNoise(vec3 p) {
    // Potentials:
    // psi_x(y, z, x) = sin(1.7*y + 1.3*z) + 0.5*sin(3.1*y - 2.7*z + 1.1*x)
    // psi_y(z, x, y) = sin(1.5*z + 1.9*x) + 0.5*sin(2.9*z - 3.3*x + 1.3*y)
    // psi_z(x, y, z) = sin(1.9*x + 1.5*y) + 0.5*sin(3.3*x - 2.5*y + 1.7*z)

    float dPsiZ_dy = 1.5 * cos(1.9 * p.x + 1.5 * p.y) - 1.25 * cos(3.3 * p.x - 2.5 * p.y + 1.7 * p.z);
    float dPsiY_dz = 1.5 * cos(1.5 * p.z + 1.9 * p.x) + 1.45 * cos(2.9 * p.z - 3.3 * p.x + 1.3 * p.y);

    float dPsiX_dz = 1.3 * cos(1.7 * p.y + 1.3 * p.z) - 1.35 * cos(3.1 * p.y - 2.7 * p.z + 1.1 * p.x);
    float dPsiZ_dx = 1.9 * cos(1.9 * p.x + 1.5 * p.y) + 1.65 * cos(3.3 * p.x - 2.5 * p.y + 1.7 * p.z);

    float dPsiY_dx = 1.9 * cos(1.5 * p.z + 1.9 * p.x) - 1.65 * cos(2.9 * p.z - 3.3 * p.x + 1.3 * p.y);
    float dPsiX_dy = 1.7 * cos(1.7 * p.y + 1.3 * p.z) + 1.55 * cos(3.1 * p.y - 2.7 * p.z + 1.1 * p.x);

    vec3 c = vec3(
      dPsiZ_dy - dPsiY_dz,
      dPsiX_dz - dPsiZ_dx,
      dPsiY_dx - dPsiX_dy
    );
    float len = length(c);
    return len > 1e-5 ? c / len : vec3(0.0, 1.0, 0.0);
  }

  vec3 rotateQuat(vec3 v, vec4 q) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
  }

  float sdfShape(vec3 p) {
    float rBound = length(p);
    if (rBound > 0.8) {
      return rBound - 0.7;
    }

    // Mirror depth axis with soft seam
    p.z = sqrt(p.z * p.z + 0.0215) - sqrt(0.012);
    // Rotate by quaternion (0.5, 0.5, 0.5, 0.5)
    p = rotateQuat(p, vec4(0.5, 0.5, 0.5, 0.5));

    // Organic bent, hollow torus-like mass with one large opening and softer lobes
    float angle = atan(p.z, p.y);
    vec3 w = p;
    w.x -= 0.088 + 0.042 * sin(angle * 2.0 + 0.55);
    w.y += 0.026 * sin(p.z * 5.2 + 0.35);
    w.z += 0.026 * cos(p.y * 4.6 - 0.45);

    float majorR = 0.255 + 0.032 * sin(angle * 2.0 - 0.5) + 0.016 * cos(angle * 3.0 + 1.1);
    float minorR = 0.076 + 0.022 * sin(angle * 3.0 + 0.75) + 0.012 * cos(p.x * 11.0);

    vec2 q = vec2(length(w.yz) - majorR, w.x);
    float d = length(q) - minorR;

    // Subtle sine-network sculpting
    d += 0.011 * sin(p.x * 9.5 + p.y * 6.5) * cos(p.z * 7.5);
    return d * 0.75;
  }

  vec3 sdfNormal(vec3 p) {
    const float eps = 0.001;
    vec3 n = vec3(
      sdfShape(p + vec3(eps, 0.0, 0.0)) - sdfShape(p - vec3(eps, 0.0, 0.0)),
      sdfShape(p + vec3(0.0, eps, 0.0)) - sdfShape(p - vec3(0.0, eps, 0.0)),
      sdfShape(p + vec3(0.0, 0.0, eps)) - sdfShape(p - vec3(0.0, 0.0, eps))
    );
    float len = length(n);
    return len > 1e-6 ? n / len : vec3(0.0, 0.0, 1.0);
  }

  void main() {
    vec3 pos = texture2D(uPositions, vUv).xyz;
    vec3 origin = texture2D(uOrigin, vUv).xyz;
    vec4 rnd = texture2D(uRandom, vUv);

    if (length(pos) > 0.7) {
      pos /= 2.0;
    }

    // Curl drift (uCurlNoiseScale 1, uCurlTimeScale 0.5, uCurlNoiseSpeed 1)
    pos += curlNoise(pos * 0.1 + uTime * 0.05) * 1.0 * 0.0002 * uHZ;

    vec3 gradient = sdfNormal(pos);
    float sdf = sdfShape(pos);

    float posLen = length(pos);
    float gradLen = length(gradient);
    if (posLen > 1e-5 && gradLen > 1e-5) {
      pos += cross(pos / posLen, gradient / gradLen) * 0.0005;
    }

    pos += -gradient * sdf * 0.5;
    pos += (origin - pos) * (0.0002 + rnd.w * 0.00004) * uHZ;

    // Mouse fluid push
    vec4 clip = uProjView * uModel * vec4(pos, 1.0);
    if (clip.w > 0.001) {
      vec2 screenUV = (clip.xy / clip.w) * 0.5 + 0.5;
      if (screenUV.x >= 0.0 && screenUV.x <= 1.0 && screenUV.y >= 0.0 && screenUV.y <= 1.0) {
        vec2 vel = texture2D(uFluidVelocity, screenUV).xy;
        float dens = texture2D(uFluidDensity, screenUV).r;
        vec3 flowWorld = uCamNormal * vec3(vel, 0.0);
        vec3 flowLocal = uGroupInvRot * flowWorld;
        pos += flowLocal * 0.0001 * uHZ * 0.4 * dens;
      }
    }

    gl_FragColor = vec4(pos, 1.0);
  }
`;

const POINTS_VERTEX = `
  attribute vec4 random;

  uniform sampler2D uPositions;
  uniform float uDPR;
  uniform float uTime;

  varying vec4 vRandom;
  varying float vScale;

  void main() {
    vRandom = random;
    vec3 pos = texture2D(uPositions, position.xy).xyz;
    float pY = pow(max(random.y, 1e-4), 150.0);
    pos *= mix(1.0, 1.5, pY);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float viewDistance = max(0.001, -mvPosition.z);
    float distToCamera = length(mvPosition.xyz);

    float scale = smoothstep(3.0, 15.0, distToCamera) * mix(0.5, 1.0, random.z);
    vScale = scale;

    gl_PointSize = 0.04 * uDPR * 2.0 * scale * (1000.0 / viewDistance);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const POINTS_FRAGMENT = `
  precision highp float;

  uniform sampler2D uMatcap;
  uniform float uTime;

  varying vec4 vRandom;
  varying float vScale;

  vec3 blendSoftLight(vec3 base, vec3 blend) {
    return mix(
      2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
      sqrt(max(base, vec3(1e-5))) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend),
      step(0.5, blend)
    );
  }

  vec3 blendOverlay(vec3 base, vec3 blend) {
    return mix(
      2.0 * base * blend,
      1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
      step(0.5, base)
    );
  }

  void main() {
    vec2 uv = gl_PointCoord;
    if (length(uv - 0.5) > 0.5) discard;
    if (vScale < 0.1) discard;

    float rz = max(vRandom.z, 1e-4);
    vec3 baseCol = vec3(mix(0.0, 0.2, vRandom.x));
    baseCol = mix(baseCol, vec3(0.6, 0.45, 1.0), pow(rz, 100.0));

    float sparkle = 0.5 + (0.4 + sin(uTime * 4.0 + vRandom.y * 20.0)) * pow(rz, 10.0) * 2.5;
    vec3 col = baseCol * sparkle;

    float angle = sin(uTime + vRandom.z * 20.0) * 0.5 + 1.0;
    float c = cos(angle);
    float s = sin(angle);
    vec2 centered = uv - 0.5;
    vec2 rotUv = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c) + 0.5;
    vec3 matcap = texture2D(uMatcap, clamp(rotUv, 0.0, 1.0)).rgb;

    col = mix(col, blendSoftLight(col, matcap), 0.8);
    col = mix(col, blendOverlay(col, matcap), 0.2);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class ParticleSystem {
  public group: any;

  private renderer: any;
  private size: number;
  private simScene: any;
  private simCamera: any;
  private simQuad: any;
  private simGeo: any;

  private originTexture: any;
  private randomTexture: any;
  private matcapTexture: any;

  private rtA: any;
  private rtB: any;
  private copyMat: any;
  private simMat: any;

  private pointsGeo: any;
  private pointsMat: any;
  private points: any;

  private projView = new THREE.Matrix4();
  private camNormal = new THREE.Matrix3();
  private groupInvRot = new THREE.Matrix3();
  private tmpMat4 = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();

  constructor(renderer: any, isMobile: boolean, dpr: number) {
    this.renderer = renderer;
    this.size = isMobile ? 128 : 512;
    const count = this.size * this.size;

    const gl = renderer.getContext();
    const hasFloatRT =
      typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
        ? Boolean(gl.getExtension('EXT_color_buffer_float'))
        : Boolean(gl.getExtension('WEBGL_color_buffer_float') || gl.getExtension('EXT_color_buffer_float'));

    const rtType = hasFloatRT ? THREE.FloatType : THREE.HalfFloatType;

    // Initial random origin positions uniform in [-1, 1]^3 and random vec4 attribs in [0, 1)
    const originData = new Float32Array(count * 4);
    const randomData = new Float32Array(count * 4);
    const pointPosAttr = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i4 = i * 4;
      originData[i4] = Math.random() * 2 - 1;
      originData[i4 + 1] = Math.random() * 2 - 1;
      originData[i4 + 2] = Math.random() * 2 - 1;
      originData[i4 + 3] = 1.0;

      randomData[i4] = Math.random();
      randomData[i4 + 1] = Math.random();
      randomData[i4 + 2] = Math.random();
      randomData[i4 + 3] = Math.random();

      const x = i % this.size;
      const y = Math.floor(i / this.size);
      const i3 = i * 3;
      pointPosAttr[i3] = (x + 0.5) / this.size;
      pointPosAttr[i3 + 1] = (y + 0.5) / this.size;
      pointPosAttr[i3 + 2] = 0;
    }

    this.originTexture = new THREE.DataTexture(
      originData,
      this.size,
      this.size,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.originTexture.minFilter = THREE.NearestFilter;
    this.originTexture.magFilter = THREE.NearestFilter;
    this.originTexture.needsUpdate = true;

    this.randomTexture = new THREE.DataTexture(
      randomData,
      this.size,
      this.size,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.randomTexture.minFilter = THREE.NearestFilter;
    this.randomTexture.magFilter = THREE.NearestFilter;
    this.randomTexture.needsUpdate = true;

    const rtOpts = {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: rtType,
      depthBuffer: false,
      stencilBuffer: false,
    };

    this.rtA = new THREE.WebGLRenderTarget(this.size, this.size, rtOpts);
    this.rtB = new THREE.WebGLRenderTarget(this.size, this.size, rtOpts);

    this.simScene = new THREE.Scene();
    this.simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.simGeo = new THREE.PlaneGeometry(2, 2);

    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: SIM_VERTEX,
      fragmentShader: COPY_FRAGMENT,
      uniforms: {
        uSource: { value: this.originTexture },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.simQuad = new THREE.Mesh(this.simGeo, this.copyMat);
    this.simScene.add(this.simQuad);

    // Seed rtA and rtB from originTexture
    this.renderer.setRenderTarget(this.rtA);
    this.renderer.render(this.simScene, this.simCamera);
    this.renderer.setRenderTarget(this.rtB);
    this.renderer.render(this.simScene, this.simCamera);
    this.renderer.setRenderTarget(null);

    this.simMat = new THREE.ShaderMaterial({
      vertexShader: SIM_VERTEX,
      fragmentShader: SIM_FRAGMENT,
      uniforms: {
        uPositions: { value: this.rtA.texture },
        uOrigin: { value: this.originTexture },
        uRandom: { value: this.randomTexture },
        uFluidVelocity: { value: null },
        uFluidDensity: { value: null },
        uTime: { value: 0 },
        uHZ: { value: 1 },
        uProjView: { value: this.projView },
        uModel: { value: new THREE.Matrix4() },
        uCamNormal: { value: this.camNormal },
        uGroupInvRot: { value: this.groupInvRot },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.simQuad.material = this.simMat;

    // Matcap texture from embedded 64x64 PNG data URI
    const matcapUri = createMatcapDataUri();
    const img = new Image();
    this.matcapTexture = new THREE.Texture(img);
    this.matcapTexture.minFilter = THREE.LinearFilter;
    this.matcapTexture.magFilter = THREE.LinearFilter;
    this.matcapTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.matcapTexture.wrapT = THREE.ClampToEdgeWrapping;
    img.onload = () => {
      this.matcapTexture.needsUpdate = true;
    };
    img.src = matcapUri;

    // Points geometry & material
    this.pointsGeo = new THREE.BufferGeometry();
    this.pointsGeo.setAttribute('position', new THREE.BufferAttribute(pointPosAttr, 3));
    this.pointsGeo.setAttribute('random', new THREE.BufferAttribute(randomData, 4));
    // Generous bounding sphere so frustum culling never clips displaced particles
    this.pointsGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 3.0);

    this.pointsMat = new THREE.ShaderMaterial({
      vertexShader: POINTS_VERTEX,
      fragmentShader: POINTS_FRAGMENT,
      uniforms: {
        uPositions: { value: this.rtA.texture },
        uMatcap: { value: this.matcapTexture },
        uDPR: { value: dpr },
        uTime: { value: 0 },
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.pointsGeo, this.pointsMat);
    this.points.frustumCulled = false;

    const deg = THREE.MathUtils.degToRad;
    this.group = new THREE.Group();
    this.group.position.set(0.343, 0.16, -1);
    this.group.rotation.set(deg(-28.4), deg(390), deg(4.92));
    this.group.scale.set(5, 5, 6);
    this.group.add(this.points);
    this.group.updateMatrixWorld(true);
  }

  public setDPR(dpr: number) {
    this.pointsMat.uniforms.uDPR.value = dpr;
  }

  public update(
    time: number,
    dt: number,
    camera: any,
    fluidVelocityTex: any,
    fluidDensityMaskTex: any,
  ) {
    const hz = Math.min(3.0, Math.max(0.1, dt * 60.0));

    camera.updateMatrixWorld();
    this.group.updateMatrixWorld();

    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.camNormal.setFromMatrix4(camera.matrixWorld);

    this.tmpQuat.copy(this.group.quaternion).invert();
    this.tmpMat4.makeRotationFromQuaternion(this.tmpQuat);
    this.groupInvRot.setFromMatrix4(this.tmpMat4);

    this.simMat.uniforms.uPositions.value = this.rtA.texture;
    this.simMat.uniforms.uFluidVelocity.value = fluidVelocityTex;
    this.simMat.uniforms.uFluidDensity.value = fluidDensityMaskTex;
    this.simMat.uniforms.uTime.value = time;
    this.simMat.uniforms.uHZ.value = hz;
    this.simMat.uniforms.uModel.value.copy(this.group.matrixWorld);

    this.renderer.setRenderTarget(this.rtB);
    this.renderer.render(this.simScene, this.simCamera);
    this.renderer.setRenderTarget(null);

    // Swap ping-pong targets
    const tmp = this.rtA;
    this.rtA = this.rtB;
    this.rtB = tmp;

    this.pointsMat.uniforms.uPositions.value = this.rtA.texture;
    this.pointsMat.uniforms.uTime.value = time;
  }

  public dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.originTexture.dispose();
    this.randomTexture.dispose();
    this.matcapTexture.dispose();
    this.simGeo.dispose();
    this.copyMat.dispose();
    this.simMat.dispose();
    this.pointsGeo.dispose();
    this.pointsMat.dispose();
  }
}
