/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEXT_DIST_DIR=.next-build npx next build → verify a production build while `next dev` keeps its own .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
  async redirects() {
    return [
      {
        source: "/funding-opportunities",
        destination: "/opportunities",
        permanent: false,
      },
      {
        source: "/funding-opportunities/:id",
        destination: "/opportunities/:id",
        permanent: false,
      },
      {
        source: "/watched-pis",
        destination: "/investigators",
        permanent: false,
      },
      {
        source: "/watched-pis/:path*",
        destination: "/investigators",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
