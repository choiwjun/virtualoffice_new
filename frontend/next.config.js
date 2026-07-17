/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker 배포용 슬림 런타임(D29/D30, P0-1): .next/standalone 자립 서버 생성
  output: 'standalone',
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
};

module.exports = nextConfig;
