import React, { useEffect, useRef, useState } from 'react';
import { AnnotationMode, TextLayer } from 'pdfjs-dist';
import { Check } from 'lucide-react';

export function FieldInput({ field, value, onChange, compact = false, radioOption, disabled = false, style }) {
  const common = { 'aria-label': field.label, title: field.name, disabled: disabled || field.readOnly, style, onFocus: event => event.target.select?.() };
  if (field.type === 'checkbox') return <input {...common} type="checkbox" checked={Boolean(value)} onChange={event => onChange(event.target.checked)} />;
  if (field.type === 'radio' && compact) return <input {...common} type="radio" name={`page-${field.name}`} checked={value === radioOption} onChange={() => onChange(radioOption)} />;
  if (['dropdown', 'radio', 'list'].includes(field.type)) {
    if (field.editable) return <input {...common} value={value ?? ''} onChange={event => onChange(event.target.value)} />;
    return <select {...common} multiple={field.type === 'list' && field.multiselect} value={field.type === 'list' && !field.multiselect ? value?.[0] ?? '' : value ?? ''} onChange={event => onChange(field.type === 'list' ? [...event.target.selectedOptions].map(option => option.value).filter(Boolean) : event.target.value)}>
      {!(field.type === 'list' && field.multiselect) && <option value="">Select…</option>}
      {field.options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>;
  }
  if (field.type !== 'text') return <span className="readonly-value">{field.type === 'signature' ? 'Digital signature field' : 'Read-only field'}</span>;
  const props = { ...common, value: value ?? '', maxLength: field.maxLength, onChange: event => onChange(event.target.value) };
  return field.multiline ? <textarea {...props} rows={compact ? 1 : 3} /> : <input {...props} type={field.password ? 'password' : 'text'} />;
}

export function Thumbnail({ pdf, pageNumber, current, onClick }) {
  const canvasRef = useRef(null);
  const buttonRef = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(buttonRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let canceled = false, task;
    pdf.getPage(pageNumber).then(page => {
      if (canceled) return;
      const scale = 110 / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = viewport.width * 1.5;
      canvas.height = viewport.height * 1.5;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      task = page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport, transform: [1.5, 0, 0, 1.5, 0, 0] });
      return task.promise;
    }).catch(() => {});
    return () => { canceled = true; task?.cancel(); };
  }, [pdf, pageNumber, visible]);
  return <button ref={buttonRef} className={`thumbnail ${current ? 'current' : ''}`} aria-label={`Go to page ${pageNumber}`} aria-current={current ? 'page' : undefined} onClick={onClick}><span className="thumbnail-paper"><canvas ref={canvasRef} /></span><span>{pageNumber}</span></button>;
}

export default function PdfPage({ pdf, number, zoom, rotation, fields, values, additions, tool, onChange, onPlace, onSelect, onMove, selected, highlight, readOnly, query, onError }) {
  const hostRef = useRef(null), canvasRef = useRef(null), textRef = useRef(null), paperRef = useRef(null);
  const [hostWidth, setHostWidth] = useState(700);
  const [ready, setReady] = useState(null);
  const [rendering, setRendering] = useState(true);
  const drag = useRef(null);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setHostWidth(entries[0].contentRect.width));
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false, task, textLayer;
    setRendering(true); setReady(null);
    const render = async () => {
      const page = await pdf.getPage(number);
      if (disposed) return;
      const viewRotation = (page.rotate + rotation) % 360;
      const base = page.getViewport({ scale: 1, rotation: viewRotation });
      const scale = zoom === 'fit' ? Math.max(0.2, Math.min(2, (hostWidth - 72) / base.width)) : Number(zoom);
      const viewport = page.getViewport({ scale, rotation: viewRotation });
      const annotations = await page.getAnnotations({ intent: 'display' });
      if (disposed) return;
      const canvas = canvasRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2, 12000 / Math.max(viewport.width, viewport.height));
      canvas.width = Math.floor(viewport.width * dpr); canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      paperRef.current.style.width = `${viewport.width}px`; paperRef.current.style.height = `${viewport.height}px`;
      paperRef.current.style.setProperty('--total-scale-factor', scale * page.userUnit);
      // Keep all original annotation appearances visible, including unsupported
      // buttons/signature widgets. Editable controls cover their own appearance.
      task = page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport, transform: [dpr, 0, 0, dpr, 0, 0], annotationMode: AnnotationMode.ENABLE });
      await task.promise;
      if (disposed) return;
      textRef.current.replaceChildren();
      textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: textRef.current, viewport });
      await textLayer.render();
      if (disposed) return;
      setReady({ viewport, annotations, scale }); setRendering(false);
    };
    render().catch(error => { if (!disposed && error.name !== 'RenderingCancelledException' && error.name !== 'AbortException') { setRendering(false); onError(error.message); } });
    return () => { disposed = true; task?.cancel(); textLayer?.cancel(); };
  }, [pdf, number, zoom, rotation, hostWidth, readOnly]);
  useEffect(() => {
    for (const span of textRef.current.querySelectorAll('span')) span.classList.toggle('search-hit', Boolean(query && span.textContent.toLowerCase().includes(query.toLowerCase())));
  }, [ready, query]);
  function coordinates(event) {
    const bounds = paperRef.current.getBoundingClientRect();
    return ready.viewport.convertToPdfPoint(event.clientX - bounds.left, event.clientY - bounds.top);
  }
  function clickPage(event) {
    if (!ready || readOnly || event.target.closest('input, textarea, select, button, .addition')) return;
    if (tool === 'text' || tool === 'check' || tool === 'signature') {
      const [x, y] = coordinates(event);
      onPlace({ x, y, page: number, rotation: ready.viewport.rotation });
    } else onSelect(null);
  }
  function moveStart(event, item) {
    event.stopPropagation(); onSelect(item.id);
    if (tool !== 'select' || readOnly) return;
    const [x, y] = coordinates(event);
    drag.current = { item, x, y, target: event.currentTarget, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event) {
    if (!drag.current || !ready) return;
    const [x, y] = coordinates(event);
    const dx = x - drag.current.x, dy = y - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) < 2 && !drag.current.moved) return;
    drag.current.moved = true;
    const [beforeX, beforeY] = ready.viewport.convertToViewportPoint(drag.current.item.x, drag.current.item.y);
    const [afterX, afterY] = ready.viewport.convertToViewportPoint(drag.current.item.x + dx, drag.current.item.y + dy);
    drag.current.target.style.translate = `${afterX - beforeX}px ${afterY - beforeY}px`;
  }
  function moveEnd(event) {
    if (!drag.current) return;
    const { item, x, y, moved, target } = drag.current;
    const [endX, endY] = coordinates(event);
    target.style.translate = '';
    if (moved) onMove(item.id, { x: item.x + endX - x, y: item.y + endY - y });
    drag.current = null;
  }
  return <div className="page-scroll" ref={hostRef}>
    <div className="page-stage"><div ref={paperRef} className={`pdf-paper tool-${tool} ${highlight ? 'highlight-fields' : ''}`} onClick={clickPage} aria-label={`PDF page ${number}`}>
      <canvas ref={canvasRef} />
      <div ref={textRef} className="textLayer" />
      {ready && !readOnly && ready.annotations.filter(annotation => annotation.subtype === 'Widget' && !annotation.hidden && !annotation.noView).map(annotation => {
        const field = fields.find(field => field.name === annotation.fieldName);
        if (!field || ['signature', 'button', 'unsupported'].includes(field.type)) return null;
        const rect = [...ready.viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]), ...ready.viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3])];
        const left = Math.min(rect[0], rect[2]), top = Math.min(rect[1], rect[3]), width = Math.abs(rect[2] - rect[0]), height = Math.abs(rect[3] - rect[1]);
        const option = field.radioValues?.[annotation.buttonValue] ?? annotation.buttonValue;
        return <div key={annotation.id} className={`pdf-field field-${field.type} ${field.multiline ? 'field-multiline' : ''}`} style={{ left, top, width, height }} onClick={event => {
          event.stopPropagation();
          if (event.target === event.currentTarget) event.currentTarget.querySelector('textarea')?.focus();
        }}><FieldInput compact field={field} value={values[field.name]} radioOption={option} onChange={value => onChange(field.name, value)} style={{ fontSize: Math.max(1, Math.min(annotation.defaultAppearanceData?.fontSize || 11, height / ready.scale * 0.65)) * ready.scale, textAlign: annotation.textAlignment === 1 ? 'center' : annotation.textAlignment === 2 ? 'right' : 'left' }} /></div>;
      })}
      {ready && additions.filter(item => item.page === number).map(item => {
        const [left, top] = ready.viewport.convertToViewportPoint(item.x, item.y);
        return <div key={item.id} role="button" tabIndex={0} aria-label={`Edit ${item.label || item.kind}`} className={`addition ${selected === item.id ? 'selected' : ''}`} onKeyDown={event => { if (event.key === 'Enter') onSelect(item.id); }} onPointerDown={event => moveStart(event, item)} onPointerMove={move} onPointerUp={moveEnd} onPointerCancel={moveEnd} style={{ left, top, fontSize: item.size * ready.scale, transform: `rotate(${ready.viewport.rotation - (item.rotation || 0)}deg)` }}>
          {item.kind === 'signature' ? <img className="placed-signature" src={item.dataUrl} alt={item.label} draggable={false} style={{ width: item.width * ready.scale, height: item.height * ready.scale }} /> : item.kind === 'check' ? <Check size={item.size * ready.scale} strokeWidth={2.8} /> : <span>{item.text || 'Text'}</span>}
        </div>;
      })}
      {rendering && <div className="rendering-indicator">Rendering page…</div>}
    </div><div className="page-caption">PAGE {number} OF {pdf.numPages} <span>•</span> {ready ? `${Math.round(ready.scale * 100)}%` : 'Loading'}</div></div>
  </div>;
}
