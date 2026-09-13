"use client";

import { useState } from "react";

/**
 * The Draft outreach page's email preview: the rendered document in an
 * iframe sized to its content. `allow-same-origin` (and nothing else) lets
 * the parent read the height; scripts stay off, and the two response links
 * are "#" in a preview so a click goes nowhere.
 */
export function OutreachEmailPreview({ html, title }: { html: string; title: string }) {
  const [height, setHeight] = useState(1240);
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox="allow-same-origin"
      scrolling="no"
      style={{ height }}
      onLoad={(e) => {
        const doc = e.currentTarget.contentDocument;
        if (doc) setHeight(Math.max(600, doc.documentElement.scrollHeight));
      }}
      className="block w-full rounded-card border border-line bg-[#eef0f3]"
    />
  );
}
