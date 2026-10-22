import React, { useEffect, useRef, useState } from 'react';
import { Check, PenLine, Trash2, X } from 'lucide-react';
import { cleanSignaturePhoto } from './lib/signature-image.mjs';

function croppedSignature(canvas) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height).data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] < 20) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top) throw new Error('Draw a signature before saving it.');
  const padding = 16;
  const x = Math.max(0, left - padding), y = Math.max(0, top - padding);
  const output = document.createElement('canvas');
  output.width = Math.min(width - x, right - x + padding + 1);
  output.height = Math.min(height - y, bottom - y + padding + 1);
  output.getContext('2d').drawImage(canvas, x, y, output.width, output.height, 0, 0, output.width, output.height);
  return { dataUrl: output.toDataURL('image/png'), width: output.width, height: output.height };
}

export default function SignatureDialog({ signatures, target, onSave, onRemove, onPlace, onClose }) {
  const canvasRef = useRef(null), drawing = useRef(false), photoRun = useRef(0);
  const [signer, setSigner] = useState('');
  const [mode, setMode] = useState('draw'), [photo, setPhoto] = useState(null), [cleanedPhoto, setCleanedPhoto] = useState(null), [threshold, setThreshold] = useState(65);
  const [hasInk, setHasInk] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = 1120; canvas.height = 320;
    const context = canvas.getContext('2d');
    context.strokeStyle = '#192935'; context.lineWidth = 4.2;
    context.lineCap = 'round'; context.lineJoin = 'round';
  }, []);
  useEffect(() => {
    const previous = document.activeElement;
    const escape = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('keydown', escape); previous?.focus(); };
  }, [onClose]);
  function point(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvasRef.current.width / rect.width, y: (event.clientY - rect.top) * canvasRef.current.height / rect.height };
  }
  function start(event) {
    event.preventDefault();
    const canvas = canvasRef.current, context = canvas.getContext('2d'), { x, y } = point(event);
    canvas.setPointerCapture(event.pointerId);
    drawing.current = true;
    context.beginPath(); context.moveTo(x, y); context.lineTo(x + 0.1, y + 0.1); context.stroke();
    setHasInk(true); setError('');
  }
  function move(event) {
    if (!drawing.current) return;
    const { x, y } = point(event), context = canvasRef.current.getContext('2d');
    context.lineTo(x, y); context.stroke();
  }
  function stop() { drawing.current = false; }
  function clear() { canvasRef.current.getContext('2d').clearRect(0, 0, 1120, 320); setHasInk(false); setError(''); }
  async function processPhoto(file, level = threshold) {
    if (!file) return;
    const run = ++photoRun.current;
    setBusy(true); setError(''); setCleanedPhoto(null);
    try { const result = await cleanSignaturePhoto(file, level); if (run === photoRun.current) setCleanedPhoto(result); }
    catch (cause) { if (run === photoRun.current) setError(cause.message); }
    finally { if (run === photoRun.current) setBusy(false); }
  }
  async function save() {
    try {
      setBusy(true); setError('');
      if (!signer.trim()) throw new Error('Enter the signer’s name before saving.');
      await onSave({ signer: signer.trim(), ...(mode === 'photo' ? cleanedPhoto : croppedSignature(canvasRef.current)) });
      clear();
      setPhoto(null); setCleanedPhoto(null);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal wide signature-dialog" role="dialog" aria-modal="true" aria-label="Your signatures"><div className="modal-heading"><h2>Your signatures</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></div>
    <p className="muted">{target ? 'Choose the person signing this line. Paperdesk will place the saved signature and fill its nearby signing date with today’s date. Review both before saving.' : 'Choose Place, then click the signature line on the PDF. You can move and resize it before saving.'}</p>
    <div className="signature-library">{signatures.length ? signatures.map(saved => <div className="signature-card" key={saved.signer}><strong>{saved.signer}</strong><div className="signature-preview"><img src={saved.dataUrl} alt={`${saved.signer}'s saved signature`} /></div><button className="primary" onClick={() => onPlace(saved)}><PenLine size={15} /> {target ? 'Sign this box' : 'Place'}</button><button className="icon-button" title={`Remove ${saved.signer}'s saved signature`} aria-label={`Remove ${saved.signer}'s saved signature`} onClick={() => onRemove(saved.signer)}><Trash2 size={16} /></button></div>) : <div className="notice">No signatures saved yet. Each person can draw their own below.</div>}</div>
    <label className="input-label" htmlFor="signature-signer">Signer’s name <span>Use the same name to replace a saved signature</span></label><input id="signature-signer" maxLength={80} placeholder="Full name" value={signer} onChange={event => setSigner(event.target.value)} />
    <div className="signature-mode"><button className={mode === 'draw' ? 'active' : ''} onClick={() => setMode('draw')}>Draw here</button><button className={mode === 'photo' ? 'active' : ''} onClick={() => setMode('photo')}>Import a photo</button></div>
    <canvas ref={canvasRef} hidden={mode !== 'draw'} className="signature-canvas" aria-label="Draw the signature" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} />
    {mode === 'photo' && <div className="signature-photo"><label className="input-label" htmlFor="signature-photo-file">Choose a photo from this computer</label><input id="signature-photo-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; setPhoto(file); processPhoto(file); }} /><p className="tiny muted">Use dark ink on plain white paper, with space around the signature. The photo is processed on this computer.</p>{photo && <><label className="input-label" htmlFor="signature-threshold">Remove paper and shadows <span>{threshold}</span></label><input id="signature-threshold" type="range" min="30" max="120" value={threshold} onChange={event => { const level = Number(event.target.value); setThreshold(level); processPhoto(photo, level); }} /></>}{cleanedPhoto && <div className="signature-photo-preview"><img src={cleanedPhoto.dataUrl} alt="Cleaned transparent signature preview" /></div>}</div>}
    {error && <div className="error-box" role="alert">{error}</div>}
    <div className="modal-actions">{mode === 'draw' && <button className="secondary" onClick={clear}>Clear</button>}<button className="primary" disabled={busy || !signer.trim() || (mode === 'draw' ? !hasInk : !cleanedPhoto)} onClick={save}><Check size={16} /> Save signature</button></div>
    <p className="tiny muted">Signatures are stored only on this computer. Placing one creates a visible ink image, not a certificate-based digital signature. Each person should draw and place their own signature after reviewing the form.</p>
  </section></div>;
}
