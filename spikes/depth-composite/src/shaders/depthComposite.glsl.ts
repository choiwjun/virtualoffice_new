/**
 * depthComposite.glsl.ts
 * @TASK T0.3 — 깊이합성 셰이더 (핵심 알고리즘)
 * @SPEC docs/3d-design/photoreal-web-strategy.md#2
 *
 * 원리:
 *   1. 아바타 프래그먼트의 뷰공간 깊이 계산
 *   2. 같은 화면 좌표에서 office_depth 텍스처 샘플
 *   3. 아바타가 배경보다 뒤에 있으면 discard → 자연스러운 오클루전
 *
 * 깊이 정규화 규약:
 *   - office_depth.png: 0.0 = near (카메라에 가까움), 1.0 = far (멀리 있음)
 *   - 직교 카메라에서 gl_FragCoord.z 는 [0,1] (near=0, far=1) 로 선형 매핑됨
 *
 * 오클루전 판정:
 *   avatarDepth > bgDepth + BIAS → 배경보다 뒤 → discard
 */

export const depthCompositeVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vViewPos;

  void main() {
    vUv = uv;
    vViewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * vViewPos;
  }
`;

export const depthCompositeFragmentShader = /* glsl */ `
  uniform sampler2D uOfficeDepth;
  uniform vec2 uResolution;
  uniform float uNear;
  uniform float uFar;
  uniform float uDepthBias;
  uniform vec3 uAvatarColor;

  varying vec2 vUv;
  varying vec4 vViewPos;

  void main() {
    // 화면 좌표 → UV (깊이 텍스처 샘플 좌표)
    vec2 screenUV = gl_FragCoord.xy / uResolution;

    // 배경 깊이 샘플
    // generate_test_assets.py: 0=near(흰색)이나 PNG 저장은 0=black 규약 확인 필요
    // → 픽셀값 0=near(black), 1=far(white) 로 통일
    float bgDepth = texture2D(uOfficeDepth, screenUV).r;

    // 아바타 NDC 깊이 (직교 카메라에서 선형)
    // gl_FragCoord.z: [0,1], 0=near, 1=far
    float avatarDepth = gl_FragCoord.z;

    // 오클루전: 아바타가 배경보다 뒤에 있으면 버림
    if (avatarDepth > bgDepth + uDepthBias) {
      discard;
    }

    gl_FragColor = vec4(uAvatarColor, 1.0);
  }
`;

/** 아바타 색상 상수 */
export const AVATAR_COLORS = {
  body: [0.2, 0.6, 0.9] as [number, number, number],
  head: [0.9, 0.7, 0.5] as [number, number, number],
  foot: [0.1, 0.1, 0.1] as [number, number, number],
};
