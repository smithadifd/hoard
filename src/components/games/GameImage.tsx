'use client';

import Image, { type ImageProps } from 'next/image';
import { useState } from 'react';

type GameImageProps = Omit<ImageProps, 'src' | 'onError' | 'alt'> & {
  src: string | null | undefined;
  title: string;
  alt?: string;
};

/**
 * Wraps next/image with an error fallback. When the source is missing or
 * fails to load (Steam CDN 404 for newer apps using the legacy URL pattern),
 * renders a deterministic gradient placeholder with the title.
 */
export function GameImage({ src, title, alt, ...rest }: GameImageProps) {
  // Reset failure when src changes, using React's "derive state from props" pattern.
  const [prevSrc, setPrevSrc] = useState(src);
  const [failed, setFailed] = useState(false);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setFailed(false);
  }

  if (!src || failed) {
    return <GameImagePlaceholder title={title} />;
  }

  return (
    <Image
      src={src}
      alt={alt ?? title}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}

function GameImagePlaceholder({ title }: { title: string }) {
  const hue = stringHash(title) % 360;
  const style = {
    background: `linear-gradient(135deg, hsl(${hue}, 28%, 22%), hsl(${(hue + 60) % 360}, 32%, 14%))`,
  };
  return (
    <div
      className="flex items-center justify-center h-full w-full px-3"
      style={style}
    >
      <span className="font-headline font-semibold text-foreground/85 text-sm leading-tight text-center line-clamp-3">
        {title}
      </span>
    </div>
  );
}

function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
