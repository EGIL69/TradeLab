"use client";

import dynamic from "next/dynamic";

// The terminal reads localStorage and the browser clock, so it renders on the client only.
const Terminal = dynamic(() => import("../components/Terminal"), {
  ssr: false,
  loading: () => <p style={{ padding: 24, color: "#8493a6" }}>Loading terminal…</p>,
});

export default function Page() {
  return <Terminal />;
}
