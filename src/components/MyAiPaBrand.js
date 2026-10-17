import React from "react";

// Original navy headset, orange waveform and blue wordmark shared by both pages.
export default function MyAiPaBrand({ className, markClassName, href = "#/" }) {
  return (
    <a className={className} href={href} aria-label="My AI PA home">
      <svg className={markClassName} viewBox="0 0 72 72" fill="none" aria-hidden="true">
        <path d="M14 40v-6C14 21.8 23.8 12 36 12s22 9.8 22 22v6" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        <path d="M14 37h7v18h-7a5 5 0 0 1-5-5v-8a5 5 0 0 1 5-5Zm44 0h-7v18h7a5 5 0 0 0 5-5v-8a5 5 0 0 0-5-5Z" fill="currentColor" />
        <path d="M52 54c0 6.2-5.7 10-13.2 10M36 64h-5.5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        {[21, 26, 31, 36, 41, 46, 51].map((x, index) => {
          const height = [15, 22, 28, 32, 28, 22, 15][index];
          return <rect key={x} x={x} y={36 - height / 2} width="3.6" height={height} rx="1.8" fill="#ff7a00" />;
        })}
      </svg>
      <span>My <strong>AI PA</strong></span>
    </a>
  );
}
