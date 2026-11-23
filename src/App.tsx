import { useEffect, useMemo, useRef, useState } from 'react';
import { STUDIES, TAGS } from './data/studies';
import { AxonScene } from './engine/AxonScene';

const STAR_POINTS = Array.from({ length: 16 }, (_, i) => {
  const angle = (i * Math.PI) / 8 - Math.PI / 2;
  const r = i % 2 === 0 ? 13.5 : 4.2;
  const x = (20 + Math.cos(angle) * r).toFixed(2);
  const y = (20 + Math.sin(angle) * r).toFixed(2);
  return `${x},${y}`;
}).join(' ');

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [activeTag, setActiveTag] = useState<string>('All');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof THREE === 'undefined') return;

    const scene = new AxonScene(canvas);
    return () => {
      scene.dispose();
    };
  }, []);

  const visibleStudies = useMemo(() => {
    if (activeTag === 'All') return STUDIES;
    return STUDIES.filter((study) => study.tags.includes(activeTag));
  }, [activeTag]);

  const handleResetIndex = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setActiveTag('All');
    if (listRef.current) {
      listRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <>
      <canvas id="bg" ref={canvasRef} aria-hidden="true" />

      <div className="ui">
        <header className="brand blend">
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="20"
              cy="20"
              r="18.5"
              stroke="#ffffff"
              strokeWidth="1.6"
            />
            <polygon points={STAR_POINTS} fill="#ffffff" />
          </svg>
          <div>
            <div className="brand-name">AXON</div>
            <div className="brand-sub">Motion research</div>
          </div>
        </header>

        <div className="counter blend" aria-label="Study counter">
          07
        </div>

        <nav className="tags blend" aria-label="Filter studies by tag">
          {TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`chip${activeTag === tag ? ' active' : ''}`}
              onClick={() => setActiveTag(tag)}
              aria-pressed={activeTag === tag}
            >
              {tag}
            </button>
          ))}
        </nav>

        <div className="list" ref={listRef} aria-label="Motion studies">
          {visibleStudies.map((study) => (
            <article key={study.id} className="card">
              <div className="thumb">
                <video
                  src={study.videoUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                />
              </div>
              <div className="meta">
                <div className="meta-left">{study.titleLines}</div>
                <div className="meta-right">{study.metaLines}</div>
              </div>
            </article>
          ))}
        </div>

        <aside className="about blend">
          <section>
            <h2>info</h2>
            <p>
              Studies are published as they are built and may not run on every
              device.
            </p>
          </section>

          <section>
            <h2>aims</h2>
            <p>
              An open logbook of real-time rendering research: surfaces, fluids,
              fields, and the little tools we build to shape them.
            </p>
            <p>
              It is here to keep the work in view and to give each new project a
              place to grow.
            </p>
          </section>

          <section>
            <h2>exploring</h2>
            <ul>
              <li>Signed surfaces</li>
              <li>Cursor turbulence</li>
              <li>Compute passes</li>
              <li>Type in 3D space</li>
            </ul>
          </section>

          <section>
            <h2>connect</h2>
            <a href="#" onClick={handleResetIndex}>
              Index -&gt; AXON
            </a>
            <a href="mailto:hello@axonlab.dev">Mail -&gt; hello@axonlab.dev</a>
          </section>
        </aside>
      </div>
    </>
  );
}
