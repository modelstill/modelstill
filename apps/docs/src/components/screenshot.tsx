export function Screenshot({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  return (
    <figure className="ms-shot not-prose">
      <div className="ms-shot-stage">
        <div aria-hidden="true" className="ms-shot-glow" />
        <div className="ms-shot-window">
          <div aria-hidden="true" className="ms-shot-bar">
            <span />
            <span />
            <span />
          </div>
          <img src={src} alt={alt} loading="lazy" className="block w-full" />
        </div>
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
