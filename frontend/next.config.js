/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },

  // Lighthouse flags "Missing source maps for large first-party JavaScript"
  // under Best Practices. The repo is public, so there is nothing to hide by
  // shipping maps, and they make production stack traces debuggable.
  productionBrowserSourceMaps: true,

  async headers() {
    return [{
      source: '/:path*',
      headers: [
        // Lighthouse "Use a strong HSTS policy".
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options',    value: 'nosniff' },
        { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
        // Deliberately ABSENT, do not "complete the set" without device testing:
        //  • X-Frame-Options / CSP frame-ancestors — MiniPay renders dapps in an
        //    in-app webview and its own guidance talks about redirecting *the
        //    iframe*. Frame-blocking risks making the app unopenable in the one
        //    client this submission targets.
        //  • Cross-Origin-Opener-Policy — severs window.opener, which breaks
        //    WalletConnect and other popup-based wallet flows.
        //  • Trusted Types — thirdweb and the Aztec WASM loader both inject
        //    script/HTML that would violate it.
        // Each is worth revisiting individually, with a real device to test on.
      ],
    }]
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
