/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
    NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK,
    NEXT_PUBLIC_CONTRACT_ADDRESS: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS,
  },
  webpack: (config, { isServer }) => {
    // @aztec/bb.js uses top-level await inside its WASM loading code.
    // asyncWebAssembly: true handles WASM modules; topLevelAwait: true
    // handles modules that use the top-level await syntax.
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      topLevelAwait: true,
    }

    // pino (pulled in via Thirdweb → WalletConnect) optionally requires
    // `pino-pretty` for dev log formatting. It's never used in the browser
    // bundle, so resolve it to an empty module to silence the build warning.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      'pino-pretty': false,
    }

    // Tell webpack the client output environment supports async functions
    // (modern browsers all do). Without this webpack emits the noisy
    // "target environment does not appear to support async/await" warning
    // when it encounters @aztec/bb.js which relies on top-level await.
    if (!isServer) {
      config.output = {
        ...config.output,
        environment: {
          ...config.output?.environment,
          asyncFunction: true,
        },
      }
    }

    return config
  },
}

module.exports = nextConfig
