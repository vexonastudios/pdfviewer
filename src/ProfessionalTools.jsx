import React, { useState } from 'react';
import { parsePageOrder, organizePdf } from './lib/page-tools.mjs';
import { recognizePages } from './lib/ocr.mjs';

export function DocumentTools({ documentState, state, readOnly, onMaterialize, onPrepareExtra, onOrganize, onPassword, onHistory, onPrint, printPending, onCancelPrint, onOcr, onShowOcr, onBusy, onError, onClose }) {
  const [order, setOrder] = useState(`1-${documentState.pdf.numPages}`), [rotation, setRotation] = useState(0), [extras, setExtras] = useState([]), [working, setWorking] = useState(false), [progress, setProgress] = useState('');
  const [ocrScope, setOcrScope] = useState('all'), [controller, setController] = useState(null);
  const controllerRef = React.useRef(null);
  React.useEffect(() => () => controllerRef.current?.abort(), []);
  async function organize() {
    setWorking(true);
    try {
      const pages = parsePageOrder(order, documentState.pdf.numPages);
      onBusy('Preparing pages…');
      const attachments = [];
      for (const file of extras) attachments.push(await onPrepareExtra(file));
      const bytes = await organizePdf(await onMaterialize(), pages, rotation, attachments);
      onBusy('');
      await onOrganize(bytes);
    } catch (error) { onError(error.message); } finally { setWorking(false); onBusy(''); }
  }
  async function ocr() {
    setWorking(true);
    const abort = new AbortController(); controllerRef.current = abort; setController(abort);
    try {
      const numbers = ocrScope === 'all' ? Array.from({ length: documentState.pdf.numPages }, (_, i) => i + 1) : parsePageOrder(ocrScope, documentState.pdf.numPages).map(i => i + 1);
      const result = await recognizePages(documentState.pdf, numbers, setProgress, abort.signal);
      onOcr(result); onClose();
    } catch (error) { if (!abort.signal.aborted) onError(error.message); } finally { setWorking(false); setController(null); setProgress(''); }
  }
  return <div className="document-tools"><div className="tool-actions"><button className="secondary" disabled={!window.paperdesk || working || printPending} onClick={onPrint}>Print… <kbd>Ctrl+P</kbd></button>{printPending && <button className="secondary" onClick={onCancelPrint}>End print session</button>}<button className="secondary" disabled={readOnly || working} onClick={onPassword}>Protect workspace…</button><button className="secondary" disabled={!window.paperdesk || working} onClick={onHistory}>Restore saved version…</button></div>
    <h3>Arrange, extract, or merge pages</h3><p className="muted">Creates a separate PDF with your current answers and marks fixed on the pages. Save your editable draft first to keep its movable fields.</p>
    <label className="input-label">Pages in output order<input disabled={readOnly || working} value={order} onChange={event => setOrder(event.target.value)} placeholder="1-3, 5, 4" /></label><p className="tiny muted">Use ranges, reverse ranges, or individual pages. Omitted pages are excluded from the new copy.</p>
    <label className="input-label">Rotate these pages<select disabled={readOnly || working} value={rotation} onChange={event => setRotation(Number(event.target.value))}><option value="0">Keep current orientation</option><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">90° counterclockwise</option></select></label>
    {window.paperdesk && <button className="secondary full" disabled={readOnly || working} onClick={async () => { try { const files = await window.paperdesk.mergeOpen(); setExtras(current => [...current, ...files]); } catch (error) { onError(error.message); } }}>Append PDFs…</button>}
    {extras.map((file, i) => <div className="history-row" key={i}><span>{file.name}</span><button aria-label={`Remove ${file.name}`} onClick={() => setExtras(current => current.filter((_, index) => index !== i))}>Remove</button></div>)}
    <button className="primary full" disabled={readOnly || working} onClick={organize}>Create PDF with these pages</button>
    {readOnly && <p className="notice">Page editing is unavailable for this protected, signed, or unsupported document.</p>}
    <h3>Read text from scanned pages</h3><p className="muted">English OCR runs locally. Recognized text is available for copying and search inside Paperdesk. Review it for recognition errors.</p>{state.ocr && <button className="secondary full" disabled={working} onClick={onShowOcr}>View recognized text</button>}<label className="input-label">Pages to recognize<input disabled={working} value={ocrScope} onChange={event => setOcrScope(event.target.value)} placeholder="all or 1-3, 5" /></label>
    {controller ? <><p role="status">{progress || 'Starting offline OCR…'}</p><button className="secondary" onClick={() => controller.abort()}>Cancel recognition</button></> : <button className="secondary full" disabled={working || readOnly} onClick={ocr}>Recognize text</button>}
  </div>;
}

export function HistoryList({ kind, onRestore, onError }) {
  const [items, setItems] = useState(null);
  React.useEffect(() => { let active = true; window.paperdesk?.recoveryList(kind).then(records => { if (active) setItems(records); }).catch(error => onError(error.message)); return () => { active = false; }; }, [kind]);
  return <div><p className="muted">{kind === 'history' ? 'The previous five saved versions of each workspace are retained locally.' : 'These drafts contain changes recovered after an interruption.'} Copies are encrypted for your Windows account.</p>{items?.length === 0 ? <p>No {kind === 'history' ? 'previous versions' : 'recovery drafts'} found.</p> : !items ? <p role="status">Loading…</p> : items.map(item => <div className="history-row" key={item.id}><span><strong>{item.name}</strong><small>{new Date(item.time).toLocaleString()}</small></span><button className="secondary" onClick={() => onRestore(kind, item)}>Open</button><button className="icon-button" aria-label={`Delete saved copy of ${item.name}`} onClick={async () => { try { await window.paperdesk.recoveryRemove(kind, item.id); setItems(current => current.filter(entry => entry.id !== item.id)); } catch (error) { onError(error.message); } }}>×</button></div>)}</div>;
}
