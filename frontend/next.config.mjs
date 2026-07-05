/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // react-konva / konva 는 node 'canvas' 모듈을 선택적으로 참조한다. 서버 번들에서 제외.
  webpack: (config) => {
    config.externals = [...(config.externals || []), { canvas: "canvas" }];
    return config;
  },
};

export default nextConfig;
