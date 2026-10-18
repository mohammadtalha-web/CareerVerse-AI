"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

export default function ImageLightbox({
  src,
  alt,
  width,
  height,
  onError,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  onError?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [imageSize, setImageSize] = useState<{
    width: number;
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "+" || event.key === "=") {
        setZoom((current) => Math.min(4, Math.round((current + 0.25) * 100) / 100));
      }
      if (event.key === "-") {
        setZoom((current) => Math.max(0.5, Math.round((current - 0.25) * 100) / 100));
      }
      if (event.key === "0") setZoom(1);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !imageSize) return;
    const { naturalWidth, naturalHeight } = imageSize;
    function resize() {
      const stage = stageRef.current;
      if (!stage) return;
      const maxWidth = Math.max(1, stage.clientWidth - 36);
      const maxHeight = Math.max(1, stage.clientHeight - 36);
      const fit = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
      setImageSize((current) => current
        ? { ...current, width: Math.round(naturalWidth * fit) }
        : current);
    }
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [imageSize, open]);

  return (
    <>
      <button
        ref={triggerRef}
        className="uploaded-image-trigger"
        type="button"
        aria-label={`Open ${alt} in image viewer`}
        onClick={() => {
          setZoom(1);
          setOpen(true);
        }}
      >
        <Image src={src} alt={alt} width={width} height={height} unoptimized onError={onError} />
        <span className="uploaded-image-hint" aria-hidden="true">⌕ View image</span>
      </button>
      {open && createPortal(
        <div
          className="image-lightbox-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`Image viewer: ${alt}`}
          >
            <header className="image-lightbox-toolbar">
              <div className="image-lightbox-title">
                <strong>{alt}</strong>
                <span>Use + and − to zoom · Press Esc to close</span>
              </div>
              <div className="image-lightbox-controls">
                <button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={zoom <= 0.5} onClick={() => setZoom((current) => Math.max(0.5, Math.round((current - 0.25) * 100) / 100))}>−</button>
                <button className="image-lightbox-zoom-value" type="button" aria-label="Reset zoom" title="Reset zoom (0)" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
                <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={zoom >= 4} onClick={() => setZoom((current) => Math.min(4, Math.round((current + 0.25) * 100) / 100))}>+</button>
                <button ref={closeButtonRef} className="image-lightbox-close" type="button" aria-label="Close image viewer" title="Close (Esc)" onClick={() => setOpen(false)}>×</button>
              </div>
            </header>
            <div ref={stageRef} className="image-lightbox-stage" role="region" aria-label="Zoomable image">
              <Image
                className="image-lightbox-image"
                src={src}
                alt={alt}
                width={width}
                height={height}
                unoptimized
                draggable={false}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  const stage = stageRef.current;
                  if (!stage) return;
                  const maxWidth = Math.max(1, stage.clientWidth - 36);
                  const maxHeight = Math.max(1, stage.clientHeight - 36);
                  const fit = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
                  setImageSize({
                    naturalWidth: image.naturalWidth,
                    naturalHeight: image.naturalHeight,
                    width: Math.round(image.naturalWidth * fit),
                  });
                }}
                style={{ width: `${imageSize ? Math.round(imageSize.width * zoom) : 100}%` }}
              />
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
