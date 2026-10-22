import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';
import { FileText, FolderOpen, Download, ShieldCheck, ArrowUpRight, ArrowRight, Plus, Minus, Maximize, ChevronLeft, ChevronRight, MousePointer2, Type, Check, Undo2, Redo2, RotateCw, Search, SlidersHorizontal, List, Sparkles, Copy, X, Trash2, CheckCircle2, AlertCircle, FileStack, PanelLeftClose, PanelLeftOpen, HelpCircle, Save, LockKeyhole, Layers, ClipboardPaste, PenLine, CalendarDays } from 'lucide-react';
import PdfPage, { FieldInput, Thumbnail } from './PdfPage.jsx';
import SignatureDialog from './SignatureDialog.jsx';
import { inspectPdf, writePdf, fieldSchema } from './lib/pdf.mjs';
import { parseBulk, suggestMapping, previewRecord } from './lib/bulk.mjs';
import { createSample } from './lib/sample.mjs';
import { formatLocalDate, isDateSignedField } from './lib/form-utils.mjs';
import { preferredSignatureWidth, signatureSizeForField, initialSizeForField } from './lib/signature-size.mjs';
import { findFlatInitialTargets } from './lib/initial-targets.mjs';

GlobalWorkerOptions.workerSrc = workerUrl;
const emptyState = { values: {}, additions: [] };
const fingerprint = state => JSON.stringify(state);
const fileStem = name => name.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
const signatureSigner = item => item.signer || (item.label?.endsWith(' signature') ? item.label.slice(0, -' signature'.length) : null);
const inkKind = item => item?.markType === 'initials' || item?.kind === 'initials' ? 'initials' : 'signature';
const inkKey = (signer, kind) => JSON.stringify([kind, signer]);
function finalFolder(filePath) {
  if (!filePath) return null;
  const parent = filePath.replace(/[\\/][^\\/]+$/, '');
  return `${parent}${filePath.includes('\\') ? '\\' : '/'}Final PDFs`;
}
function reviewLabel(name) {
  const stem = name.replace(/\.paperdesk\.json$/i, '').replace(/\.pdf$/i, '');
  const match = /^K-904-(2250|2253a|2253b) - (.+)$/i.exec(stem);
  if (!match) return stem;
  const form = { '2250': 'Request', '2253a': 'Needs worksheet', '2253b': 'Resources worksheet' }[match[1].toLowerCase()];
  return `${match[2]} · ${form} (${match[1]})`;
}
let fontPromise;
async function getFont() {
  fontPromise ??= fetch(new URL('./fonts/NotoSans-Regular.ttf', document.baseURI)).then(response => { if (!response.ok) throw new Error('The local font could not be loaded. Restart the app.'); return response.arrayBuffer(); }).then(buffer => new Uint8Array(buffer));
  return fontPromise;
}
async function saveArtifact(bytes, name, kind = 'pdf', options = {}) {
  if (window.paperdesk) return window.paperdesk.save({ bytes, name, kind, ...options });
  const url = URL.createObjectURL(new Blob([bytes], { type: kind === 'zip' ? 'application/zip' : kind === 'json' ? 'application/json' : 'application/pdf' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  return { name };
}
function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}

function Modal({ title, children, onClose, wide = false }) {
  const panel = useRef(null), closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const focusable = () => [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')];
    focusable()[0]?.focus();
    function keyboard(event) {
      if (event.key === 'Escape') closeRef.current?.();
      if (event.key === 'Tab') {
        const nodes = focusable(), first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}><section ref={panel} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2>{onClose && <button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button>}</div>{children}</section></div>;
}

function BulkPanel({ fields, onApply, onBatch, onCopy, busy, duplicateNames, active }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [record, setRecord] = useState(0);
  const [error, setError] = useState('');
  const preview = parsed ? previewRecord(parsed.rows[record], mapping, fields) : null;
  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const batchErrors = useMemo(() => parsed ? parsed.rows.flatMap((row, index) => previewRecord(row, mapping, fields).errors.map(error => `Record ${index + 1}: ${error}`)) : [], [parsed, mapping, fields]);
  function analyze() {
    try { const result = parseBulk(text); setParsed(result); setMapping(suggestMapping(result.keys, fields)); setRecord(0); setError(''); } catch (error) { setError(error.message); setParsed(null); }
  }
  return <div className="panel-body bulk-panel" hidden={!active}>
    <div className="section-eyebrow">LESS TYPING, MORE DONE</div><h2>Paste once. Fill faster.</h2><p className="muted">Paste details or a table. Review which PDF fields they’ll fill before applying.</p>
    <button className="assistant-card" onClick={onCopy}><span className="soft-icon"><Sparkles size={19} /></span><span><strong>Prepare this form with ChatGPT</strong><small>Copy field list to paste into your chat</small></span><Copy size={16} /></button>
    {!fields.length && <div className="notice">This PDF has no fillable fields. Choose <b>Add text</b>, place a text box, and give it a field name first.</div>}
    {duplicateNames && <div className="error-box">Give each added text box a unique field name before bulk filling.</div>}
    <label className="input-label" htmlFor="bulk-input">Your information <span>JSON · CSV · field: value</span></label>
    <textarea id="bulk-input" className="bulk-input" placeholder={'Full name: Jamie Parker\nEmail address: jamie@example.com\nPhone number: (555) 010-0248'} value={text} onChange={event => { setText(event.target.value); setParsed(null); setError(''); }} spellCheck={false} />
    <button className="primary full" disabled={!text.trim() || !fields.length || busy || duplicateNames} onClick={analyze}><SlidersHorizontal size={16} /> Review field matches <ArrowRight size={16} /></button>
    {error && <div className="error-box" role="alert">{error}</div>}
    {parsed && <div className="mapping-section">
      <div className="section-heading"><h3>Review matches</h3><span className="pill">{mappedCount} / {parsed.keys.length} mapped</span></div>
      <div className="record-nav"><button className="icon-button" aria-label="Previous record" disabled={record === 0} onClick={() => setRecord(record - 1)}><ChevronLeft size={16} /></button><span>Record {record + 1} of {parsed.rows.length}</span><button className="icon-button" aria-label="Next record" disabled={record === parsed.rows.length - 1} onClick={() => setRecord(record + 1)}><ChevronRight size={16} /></button></div>
      {parsed.keys.map(key => <div className="mapping-row" key={key}><div><strong>{key}</strong><span title={String(parsed.rows[record][key] ?? '')}>{String(parsed.rows[record][key] ?? '(not supplied)')}</span></div><select aria-label={`Map ${key}`} value={mapping[key] || ''} onChange={event => setMapping({ ...mapping, [key]: event.target.value })}><option value="">Skip this column</option>{fields.filter(field => !field.readOnly).map(field => <option key={field.name} value={field.name}>{field.label}</option>)}</select></div>)}
      {parsed.keys.some(key => !mapping[key]) && <div className="notice small">Unmapped columns will be skipped. Choose a field manually if a match is missing.</div>}
      {preview.errors.length > 0 && <div className="error-box">{preview.errors.map(error => <p key={error}>{error}</p>)}</div>}
      <button className="primary full" disabled={!mappedCount || preview.errors.length > 0 || busy || duplicateNames} onClick={() => onApply(preview.values)}><Check size={16} /> Apply this record</button>
      {parsed.rows.length > 1 && <><button className="secondary full" disabled={!mappedCount || batchErrors.length > 0 || busy || duplicateNames} onClick={() => onBatch(parsed.rows, mapping)}><FileStack size={16} /> Save {parsed.rows.length} filled PDFs as ZIP</button>{batchErrors.length > 0 && <div className="error-box">{batchErrors.slice(0, 4).map((error, index) => <p key={index}>{error}</p>)}{batchErrors.length > 4 && <p>And {batchErrors.length - 4} more issues.</p>}</div>}<p className="tiny muted">Each record creates a separate PDF. Unmapped fields keep their current values. Batch files keep form fields editable.</p></>}
    </div>}
    <div className="bulk-tip"><ClipboardPaste size={18} /><p><strong>Filling for several people?</strong><br />Paste spreadsheet rows with their column headers, or a JSON array. You’ll get one PDF per record.</p></div>
  </div>;
}

export default function App() {
  const [documentState, setDocument] = useState(null);
  const [review, setReview] = useState(null);
  const [history, setHistory] = useState({ past: [], present: emptyState, future: [] });
  const [saved, setSaved] = useState(fingerprint(emptyState));
  const [page, setPage] = useState(1), [zoom, setZoom] = useState('fit'), [rotation, setRotation] = useState(0);
  const [tab, setTab] = useState('fields'), [tool, setTool] = useState('select'), [selected, setSelected] = useState(null);
  const [highlight, setHighlight] = useState(true), [showPages, setShowPages] = useState(true);
  const [busy, setBusy] = useState(''), [toast, setToast] = useState(null), [error, setError] = useState('');
  const [modal, setModal] = useState(null), [pendingAction, setPendingAction] = useState(null);
  const [passwordRequest, setPasswordRequest] = useState(null), [password, setPassword] = useState('');
  const [fieldSearch, setFieldSearch] = useState(''), [search, setSearch] = useState(''), [searchResults, setSearchResults] = useState([]), [searching, setSearching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [signatures, setSignatures] = useState([]), [activeSignature, setActiveSignature] = useState(null), [signTarget, setSignTarget] = useState(null);
  const inputRef = useRef(null), loadTask = useRef(null), documentRef = useRef(null), searchRun = useRef(0), dragCount = useRef(0);
  const signatureWidthTimers = useRef(new Map()), signatureWidthWrites = useRef(Promise.resolve());
  const state = history.present;
  const dirty = Boolean(documentState && fingerprint(state) !== saved);
  const readOnly = Boolean(documentState?.readOnlyReason);
  const fields = documentState?.fields ?? [];
  const additions = state.additions;
  const selectedItem = additions.find(item => item.id === selected);
  const selectedSignatureSigner = selectedItem?.kind === 'signature' ? signatureSigner(selectedItem) : null;
  const selectedSavedSignature = signatures.find(record => record.signer === selectedSignatureSigner && inkKind(record) === inkKind(selectedItem) && record.dataUrl === selectedItem?.dataUrl);
  const allFields = useMemo(() => [...fields.filter(field => !['signature', 'button', 'unsupported'].includes(field.type)), ...additions.filter(item => item.kind === 'text').map(item => ({ name: `Text: ${item.label}`, label: item.label, type: 'text', value: item.text, readOnly: false, options: [] }))], [fields, additions]);
  const labels = additions.filter(item => item.kind === 'text').map(item => item.label.trim().toLowerCase());
  const duplicateNames = labels.some(label => !label) || new Set(labels).size !== labels.length;
  const editableCount = fields.filter(field => !field.readOnly).length;
  const filledCount = fields.filter(field => !field.readOnly && (Array.isArray(state.values[field.name]) ? state.values[field.name].length : state.values[field.name])).length;
  const update = useCallback(transform => setHistory(history => {
    const next = typeof transform === 'function' ? transform(history.present) : transform;
    if (fingerprint(next) === fingerprint(history.present)) return history;
    return { past: [...history.past.slice(-49), history.present], present: next, future: [] };
  }), []);
  const undo = () => setHistory(history => history.past.length ? { past: history.past.slice(0, -1), present: history.past.at(-1), future: [history.present, ...history.future] } : history);
  const redo = () => setHistory(history => history.future.length ? { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) } : history);
  const notify = message => setToast(typeof message === 'string' ? { message } : message);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(null), 6500); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => { window.paperdesk?.setDirty(dirty); }, [dirty]);
  useEffect(() => {
    (window.paperdesk?.listSignatures?.() || Promise.resolve(JSON.parse(localStorage.getItem('paperdesk-signatures') || '[]')))
      .then(setSignatures).catch(error => setError(`Saved signatures could not be loaded: ${error.message}`));
  }, []);
  async function saveSignature(record) {
    const previous = signatures.find(item => item.signer === record.signer && inkKind(item) === inkKind(record));
    const replacement = { ...record, ...(previous?.placementWidth === undefined ? {} : { placementWidth: previous.placementWidth }) };
    const next = window.paperdesk ? await window.paperdesk.saveSignature(replacement) : [...signatures.filter(item => item.signer !== record.signer || inkKind(item) !== inkKind(record)), replacement];
    if (!window.paperdesk) localStorage.setItem('paperdesk-signatures', JSON.stringify(next));
    setSignatures(next); notify(`${record.signer}’s ${inkKind(record)} ${inkKind(record) === 'initials' ? 'are' : 'is'} saved on this computer.`);
  }
  function flushSignatureWidth(signer, kind = 'signature') {
    const key = inkKey(signer, kind);
    const pending = signatureWidthTimers.current.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    signatureWidthTimers.current.delete(key);
    if (!window.paperdesk) return;
    signatureWidthWrites.current = signatureWidthWrites.current.catch(() => {}).then(() => window.paperdesk.setSignatureWidth(signer, pending.width, kind));
    signatureWidthWrites.current.catch(error => setError(`Signature size could not be saved: ${error.message}`));
  }
  function resizeSignature(item, width) {
    updateItem(item.id, { width, height: item.height * width / item.width });
    const signer = signatureSigner(item);
    const kind = inkKind(item), key = inkKey(signer, kind);
    const record = signatures.find(saved => saved.signer === signer && inkKind(saved) === kind && saved.dataUrl === item.dataUrl);
    if (!record) return;
    setSignatures(current => current.map(saved => saved.signer === signer && inkKind(saved) === kind ? { ...saved, placementWidth: width } : saved));
    setActiveSignature(current => current?.signer === signer && inkKind(current) === kind ? { ...current, placementWidth: width } : current);
    if (!window.paperdesk) {
      const stored = JSON.parse(localStorage.getItem('paperdesk-signatures') || '[]');
      localStorage.setItem('paperdesk-signatures', JSON.stringify(stored.map(saved => saved.signer === signer && inkKind(saved) === kind ? { ...saved, placementWidth: width } : saved)));
    } else {
      clearTimeout(signatureWidthTimers.current.get(key)?.timer);
      signatureWidthTimers.current.set(key, { width, timer: setTimeout(() => flushSignatureWidth(signer, kind), 350) });
    }
  }
  async function removeSignature(signer, kind = 'signature') {
    try {
      const next = window.paperdesk ? await window.paperdesk.removeSignature(signer, kind) : signatures.filter(item => item.signer !== signer || inkKind(item) !== kind);
      if (!window.paperdesk) localStorage.setItem('paperdesk-signatures', JSON.stringify(next));
      setSignatures(next);
      if (activeSignature?.signer === signer && inkKind(activeSignature) === kind) { setActiveSignature(null); setTool('select'); }
      notify(`${signer}’s saved ${kind} ${kind === 'initials' ? 'were' : 'was'} removed.`);
    } catch (error) { setError(error.message); }
  }
  useEffect(() => { const beforeUnload = event => { if (dirty && !window.paperdesk) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload); }, [dirty]);
  useEffect(() => { document.title = `${dirty ? '• ' : ''}${documentState ? documentState.name + ' — ' : ''}Paperdesk PDF`; }, [documentState, dirty]);
  function guard(action) { if (dirty) { setPendingAction(() => action); setModal('discard'); } else action(); }
  function changeValue(name, value) { update(current => ({ ...current, values: { ...current.values, [name]: value } })); }
  function updateItem(id, change) { update(current => ({ ...current, additions: current.additions.map(item => item.id === id ? { ...item, ...change } : item) })); }
  function removeSelected() {
    if (!selected) return;
    update(current => {
      const signature = current.additions.find(item => item.id === selected);
      const flatSignature = signature?.kind === 'signature' && signature.targetField?.startsWith('flat-signature:') ? signature.targetField : null;
      return { ...current, additions: current.additions.filter(item => item.id !== selected && item.targetField !== `${flatSignature}:date` && item.targetField !== `${flatSignature}:printed-name`) };
    });
    setSelected(null);
  }
  function applyValues(values, current = state) {
    const nextValues = { ...current.values };
    for (const field of fields) if (Object.hasOwn(values, field.name)) nextValues[field.name] = values[field.name];
    return { values: nextValues, additions: current.additions.map(item => Object.hasOwn(values, `Text: ${item.label}`) ? { ...item, text: String(values[`Text: ${item.label}`]) } : item) };
  }
  async function loadFile(file) {
    if (!file) return false;
    setBusy('Opening your PDF…'); setError('');
    let candidate;
    try {
      let bytes = new Uint8Array(file.bytes), name = file.name, restored = null;
      if (bytes.length > 300 * 1024 * 1024) throw new Error('Choose a PDF smaller than 300 MB.');
      if (name.endsWith('.json')) {
        const draft = JSON.parse(new TextDecoder().decode(bytes));
        if (draft.format !== 'paperdesk-workspace-v1' || typeof draft.pdf !== 'string' || typeof draft.name !== 'string') throw new Error('This is not a Paperdesk workspace. Paste bulk-fill JSON into the Bulk fill panel.');
        bytes = Uint8Array.from(atob(draft.pdf), char => char.charCodeAt(0)); name = draft.name;
        if (!draft.state?.values || typeof draft.state.values !== 'object' || !Array.isArray(draft.state.additions)) throw new Error('This workspace is missing its saved edits.');
        restored = draft.state;
      }
      candidate = getDocument({ data: bytes.slice(), cMapUrl: new URL('./pdfjs/cmaps/', document.baseURI).href, cMapPacked: true, standardFontDataUrl: new URL('./pdfjs/standard_fonts/', document.baseURI).href, wasmUrl: new URL('./pdfjs/wasm/', document.baseURI).href, iccUrl: new URL('./pdfjs/iccs/', document.baseURI).href, isEvalSupported: false, enableXfa: true });
      loadTask.current = candidate;
      candidate.onPassword = (submit, reason) => { setBusy(''); setPassword(''); setPasswordRequest({ submit, incorrect: reason === 2 }); };
      const pdf = await candidate.promise;
      setPasswordRequest(null);
      const info = await inspectPdf(bytes);
      const fieldObjects = await pdf.getFieldObjects().catch(() => null);
      info.fields = info.fields.map(field => { const widgets = fieldObjects?.get?.(field.name) ?? fieldObjects?.[field.name] ?? []; return { ...field, label: widgets.find(widget => widget.alternativeText)?.alternativeText || field.label, page: widgets.find(widget => widget.page >= 0)?.page + 1 || 1 }; });
      if (restored) {
        const valid = restored.additions.every(item => ['text', 'check', 'signature'].includes(item.kind) && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.text === 'string' && Number.isFinite(item.x) && Number.isFinite(item.y) && item.page >= 1 && item.page <= pdf.numPages && Number.isInteger(item.page) && item.size >= 6 && item.size <= 96 && [0, 90, 180, 270].includes(item.rotation || 0) && (item.kind !== 'signature' || (typeof item.dataUrl === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.dataUrl) && item.dataUrl.length < 2_000_000 && Number.isFinite(item.width) && item.width >= 5 && item.width <= 500 && Number.isFinite(item.height) && item.height >= 1 && item.height <= 500 && [undefined, 'signature', 'initials'].includes(item.markType))));
        if (!valid) throw new Error('This workspace has invalid text placements.');
        if (info.readOnlyReason) restored = null;
        else {
          const mapping = Object.fromEntries(info.fields.filter(field => !field.readOnly).map(field => [field.name, field.name]));
          const checked = previewRecord(restored.values, mapping, info.fields);
          if (checked.errors.length) throw new Error(`This workspace contains invalid field values: ${checked.errors.join(' ')}`);
          restored = { values: { ...Object.fromEntries(info.fields.map(field => [field.name, field.value])), ...checked.values }, additions: restored.additions };
        }
      }
      const initial = restored || { values: Object.fromEntries(info.fields.map(field => [field.name, field.value])), additions: [] };
      const previous = documentRef.current;
      const next = { pdf, bytes, name, sourcePath: file.path, workspacePath: file.name.endsWith('.paperdesk.json') ? file.path : null, ...info, id: crypto.randomUUID() };
      documentRef.current = next; setDocument(next);
      setHistory({ past: [], present: initial, future: [] }); setSaved(fingerprint(initial));
      setPage(1); setZoom('fit'); setRotation(0); setSelected(null); setTool('select'); setSignTarget(null); setSearch(''); setSearchResults([]); searchRun.current++; setSearching(false); setFieldSearch(''); setTab('fields');
      previous?.pdf.loadingTask.destroy();
      notify(`${name} is ready`);
      return true;
    } catch (error) {
      await candidate?.destroy();
      if (!/cancel|destroy/i.test(error.message)) setError(error.message || 'This PDF could not be opened.');
      return false;
    } finally { setBusy(''); loadTask.current = null; setPasswordRequest(null); }
  }
  async function open() {
    if (window.paperdesk) { try { const file = await window.paperdesk.open(); if (file) guard(async () => { if (await loadFile(file)) setReview(null); }); } catch (error) { setError(error.message); } }
    else inputRef.current.click();
  }
  async function browserFile(file) { if (!file) return; try { const bytes = new Uint8Array(await file.arrayBuffer()); guard(async () => { if (await loadFile({ name: file.name, bytes })) setReview(null); }); } catch (error) { setError(error.message); } }
  function showReviewItem(index) {
    if (!review || index === review.index || index < 0 || index >= review.items.length || busy) return;
    guard(async () => {
      try {
        const file = await window.paperdesk.reviewFile(review.id, index);
        if (await loadFile(file)) setReview(current => current?.id === review.id ? { ...current, index } : current);
      } catch (error) { setError(error.message); }
    });
  }
  useEffect(() => {
    window.paperdesk?.initialFile().then(async open => { if (open && await loadFile(open.file)) setReview(open.review ? { ...open.review, index: 0 } : null); }).catch(error => setError(error.message));
    return () => { documentRef.current?.pdf.loadingTask.destroy(); };
  }, []);
  useEffect(() => window.paperdesk?.onOpen(file => guard(async () => { if (await loadFile(file)) setReview(null); })), [dirty]);
  useEffect(() => window.paperdesk?.onReview(open => guard(async () => { if (await loadFile(open.file)) setReview({ ...open.review, index: 0 }); })), [dirty]);
  useEffect(() => {
    const keyboard = event => {
      if (modal || passwordRequest || busy) return;
      const editing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName);
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'o') { event.preventDefault(); open(); }
        if (event.key.toLowerCase() === 's' && documentState) { event.preventDefault(); readOnly ? setModal('export') : saveWorkspace(); }
        if (event.key.toLowerCase() === 'f' && documentState) { event.preventDefault(); setTab('search'); setTimeout(() => document.getElementById('document-search')?.focus(), 50); }
        if (event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); event.shiftKey ? redo() : undo(); }
        if (event.key.toLowerCase() === 'y' && !editing) { event.preventDefault(); redo(); }
      }
      if (!editing && !event.ctrlKey && !event.metaKey) {
        if (event.key === 'Escape') { setTool('select'); setSelected(null); }
        if (event.key === 'Delete' && selected) { removeSelected(); }
        if (event.key === 'ArrowRight' && documentState) setPage(page => Math.min(documentState.pdf.numPages, page + 1));
        if (event.key === 'ArrowLeft') setPage(page => Math.max(1, page - 1));
      }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  });
  async function exportFinal() {
    setBusy('Preparing and verifying your final PDF…');
    try {
      const bytes = readOnly ? documentState.bytes : await writePdf(documentState.bytes, fields, state.values, additions, { flatten: true, fontBytes: await getFont() });
      const result = await saveArtifact(bytes, `${fileStem(documentState.name)}-final.pdf`, readOnly ? 'pdf' : 'final-pdf', { sourcePath: documentState.sourcePath });
      if (result) { setModal(null); notify({ message: `Exported ${result.name}`, path: result.path }); }
    } catch (error) { setError(error.message); } finally { setBusy(''); }
  }
  async function saveWorkspace() {
    if (readOnly) return;
    setBusy('Saving your editable work…');
    try {
      const json = JSON.stringify({ format: 'paperdesk-workspace-v1', name: documentState.name, pdf: base64(documentState.bytes), state });
      const result = await saveArtifact(new TextEncoder().encode(json), `${fileStem(documentState.name)}.paperdesk.json`, 'json', { overwritePath: documentState.workspacePath });
      if (result) {
        if (result.path) setDocument(current => { const next = { ...current, sourcePath: result.path, workspacePath: result.path }; documentRef.current = next; return next; });
        setSaved(fingerprint(state)); setModal(null); notify({ message: `Saved your editable work in ${result.name}`, path: result.path });
      }
    } catch (error) { setError(error.message); } finally { setBusy(''); }
  }
  async function copySchema() {
    if (!allFields.length) { setError('Add a named text box first, or open a fillable PDF.'); return; }
    if (duplicateNames) { setError('Give your added text boxes unique names first.'); return; }
    const text = JSON.stringify(fieldSchema(fields, additions), null, 2);
    try { await navigator.clipboard.writeText(text); notify('Field list copied. Paste it into this chat with the information to fill.'); } catch { setModal({ type: 'copy', text }); }
  }
  async function batch(rows, mapping) {
    setBusy('Preparing the batch…');
    try {
      const zip = new JSZip(), fontBytes = await getFont();
      let totalBytes = 0;
      for (let index = 0; index < rows.length; index++) {
        setBusy(`Creating PDF ${index + 1} of ${rows.length}…`);
        const result = previewRecord(rows[index], mapping, allFields);
        if (result.errors.length) throw new Error(`Record ${index + 1}: ${result.errors.join(' ')}`);
        const next = applyValues(result.values);
        const output = await writePdf(documentState.bytes, fields, next.values, next.additions, { fontBytes });
        totalBytes += output.length;
        if (totalBytes > 300 * 1024 * 1024) throw new Error('This batch exceeds 300 MB. Split your data into smaller batches.');
        zip.file(`${String(index + 1).padStart(3, '0')}-${fileStem(documentState.name)}.pdf`, output);
      }
      setBusy('Packaging your filled PDFs…');
      const result = await saveArtifact(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), `${fileStem(documentState.name)}-batch.zip`, 'zip');
      if (result) notify({ message: `Saved ${rows.length} filled PDFs in ${result.name}`, path: result.path });
    } catch (error) { setError(error.message); } finally { setBusy(''); }
  }
  async function findText(event) {
    event?.preventDefault();
    const query = search.trim().toLowerCase(), run = ++searchRun.current;
    if (!query) { setSearchResults([]); return; }
    setSearching(true); setSearchResults([]);
    const results = [];
    try {
      for (let i = 1; i <= documentState.pdf.numPages; i++) {
        const page = await documentState.pdf.getPage(i);
        const content = await page.getTextContent();
        if (run !== searchRun.current) return;
        const text = content.items.map(item => item.str || '').join(' ');
        const index = text.toLowerCase().indexOf(query);
        if (index >= 0) results.push({ page: i, snippet: `${index > 45 ? '…' : ''}${text.slice(Math.max(0, index - 45), index + query.length + 90)}…` });
      }
      if (run === searchRun.current) setSearchResults(results);
    } catch (error) { if (run === searchRun.current) setError(error.message); } finally { if (run === searchRun.current) setSearching(false); }
  }
  function place(position) {
    const id = crypto.randomUUID();
    if (tool === 'signature' || tool === 'initials') {
      if (!activeSignature) return;
      const width = preferredSignatureWidth(activeSignature), height = width * activeSignature.height / activeSignature.width;
      const markType = inkKind(activeSignature);
      update(current => ({ ...current, additions: [...current.additions, { id, ...position, kind: 'signature', markType, text: '', label: `${activeSignature.signer} ${markType}`, signer: activeSignature.signer, dataUrl: activeSignature.dataUrl, width, height, size: 12 }] }));
      setSelected(id); setTool('select'); setTab('fields');
      return;
    }
    if (tool === 'date') {
      let number = additions.filter(item => item.kind === 'text' && /^Date \d+$/.test(item.label)).length + 1;
      while (additions.some(item => item.label === `Date ${number}`)) number++;
      update(current => ({ ...current, additions: [...current.additions, { id, ...position, kind: 'text', text: formatLocalDate(), label: `Date ${number}`, size: 10 }] }));
      setSelected(id); setTool('select'); setTab('fields');
      return;
    }
    let number = additions.filter(item => item.kind === 'text').length + 1;
    while (additions.some(item => item.label === `Text ${number}`)) number++;
    update(current => ({ ...current, additions: [...current.additions, { id, ...position, kind: tool, text: tool === 'text' ? '' : '✓', label: tool === 'text' ? `Text ${number}` : 'Checkmark', size: tool === 'text' ? 12 : 16 }] }));
    setSelected(id); setTool('select'); setTab('fields');
    if (tool === 'text') setTimeout(() => document.getElementById('added-text-value')?.focus(), 50);
  }
  function placeSignatureInField(record, target) {
    const [x1, y1, x2, y2] = target.rect;
    const left = Math.min(x1, x2), top = Math.max(y1, y2);
    const boxHeight = Math.abs(y2 - y1);
    const { width, height } = signatureSizeForField(record, target.rect);
    const id = crypto.randomUUID();
    const item = { id, kind: 'signature', markType: 'signature', targetField: target.fieldName, page: target.page, x: left + 16, y: top - (boxHeight - height) / 2, text: '', label: `${record.signer} signature`, signer: record.signer, dataUrl: record.dataUrl, width, height, size: 12, rotation: 0 };
    const dateField = fields.find(field => field.name === target.dateFieldName);
    const flatDate = target.date && { id: crypto.randomUUID(), kind: 'text', targetField: `${target.fieldName}:date`, page: target.page, x: target.date.x, y: target.date.y, text: formatLocalDate(), label: target.date.label, size: 10, rotation: 0 };
    const printedName = target.printedName && { id: crypto.randomUUID(), kind: 'text', targetField: `${target.fieldName}:printed-name`, page: target.page, x: target.printedName.x, y: target.printedName.y, text: record.signer, label: target.printedName.label, size: 10, rotation: 0 };
    update(current => ({
      values: isDateSignedField(dateField) && !current.values[target.dateFieldName] ? { ...current.values, [target.dateFieldName]: formatLocalDate() } : current.values,
      additions: [...current.additions.filter(existing => (existing.targetField !== target.fieldName && existing.targetField !== `${target.fieldName}:date` && existing.targetField !== `${target.fieldName}:printed-name`) || existing.page !== target.page), item, ...(flatDate ? [flatDate] : []), ...(printedName ? [printedName] : [])],
    }));
    setSelected(id); setPage(target.page); setTool('select'); setActiveSignature(null); setSignTarget(null); setModal(null);
    notify(`${record.signer}’s signature was placed${flatDate || isDateSignedField(dateField) ? ' and the signing date was filled' : ''}. Review it before saving.`);
  }
  function initialAddition(record, target) {
    const [x1, y1, x2, y2] = target.rect;
    const left = Math.min(x1, x2), top = Math.max(y1, y2);
    const { width, height } = initialSizeForField(record, target.rect);
    return { id: crypto.randomUUID(), kind: 'signature', markType: 'initials', targetField: target.fieldName, page: target.page,
      x: left + (Math.abs(x2 - x1) - width) / 2, y: top - (Math.abs(y2 - y1) - height) / 2,
      text: '', label: `${record.signer} initials`, signer: record.signer, dataUrl: record.dataUrl, width, height, size: 12, rotation: 0 };
  }
  function placeInitialInField(record, target) {
    try {
      const item = initialAddition(record, target);
      update(current => ({ ...current, additions: [...current.additions.filter(existing => existing.targetField !== target.fieldName), item] }));
      setSelected(item.id); setPage(target.page); setTool('select'); setActiveSignature(null); setSignTarget(null); setModal(null);
      notify(`${record.signer}’s initials were placed in caregiver space ${target.slot} on page ${target.page}. Review the placement before saving.`);
    } catch (cause) { setError(cause.message); }
  }
  async function placeInitialsOnAllPages(record, target) {
    if (!documentState) return;
    setBusy('Finding caregiver initials on every page…');
    try {
      const targets = [];
      for (let number = 1; number <= documentState.pdf.numPages; number++) {
        const pdfPage = await documentState.pdf.getPage(number);
        const content = await pdfPage.getTextContent();
        const found = findFlatInitialTargets(content.items, number).find(item => item.slot === target.slot);
        if (!found) throw new Error(`Page ${number} has no matching caregiver initials line. No initials were added.`);
        targets.push(found);
      }
      const names = new Set(targets.map(item => item.fieldName));
      const items = targets.map(item => initialAddition(record, item));
      update(current => ({ ...current, additions: [...current.additions.filter(existing => !names.has(existing.targetField)), ...items] }));
      setSelected(null); setTool('select'); setActiveSignature(null); setSignTarget(null); setModal(null);
      notify(`${record.signer}’s initials were placed in caregiver space ${target.slot} on all ${targets.length} pages. Review before saving.`);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(''); }
  }
  function fillFlatSigningDate(target) {
    const fieldName = `${target.fieldName}:date`;
    update(current => ({ ...current, additions: [...current.additions.filter(item => item.targetField !== fieldName || item.page !== target.page), { id: crypto.randomUUID(), kind: 'text', targetField: fieldName, page: target.page, x: target.date.x, y: target.date.y, text: formatLocalDate(), label: target.date.label, size: 10, rotation: 0 }] }));
    notify('Today’s date was placed. Review it before saving.');
  }
  const fieldList = fields.filter(field => `${field.label} ${field.name}`.toLowerCase().includes(fieldSearch.toLowerCase()));
  return <div className={`app ${documentState ? 'has-document' : ''}`} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragCount.current++; setDragging(true); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDragLeave={event => { event.preventDefault(); dragCount.current--; if (dragCount.current <= 0) setDragging(false); }} onDrop={event => { event.preventDefault(); dragCount.current = 0; setDragging(false); if (!busy) browserFile(event.dataTransfer.files[0]); }}>
    <input ref={inputRef} className="visually-hidden" type="file" accept=".pdf,.paperdesk.json" aria-label="Choose PDF file" onChange={event => { browserFile(event.target.files?.[0]); event.target.value = ''; }} />
    <header className="app-header"><button className="brand" title="Paperdesk home" onClick={() => guard(() => { const previous = documentRef.current; documentRef.current = null; setDocument(null); setReview(null); setHistory({ past: [], present: emptyState, future: [] }); setSaved(fingerprint(emptyState)); previous?.pdf.loadingTask.destroy(); })}><span className="brand-mark"><FileText size={23} strokeWidth={1.7} /></span><span>paperdesk<span className="brand-pdf">PDF</span></span></button>
      <div className="header-center">{documentState ? <><FileText size={15} /><span title={documentState.name}>{documentState.name}</span><span className={`save-status ${dirty ? 'unsaved' : ''}`}>{dirty ? 'Unsaved changes' : 'All set'}</span></> : <span className="header-tagline">A little less paperwork.</span>}</div>
      <div className="header-actions"><button className="icon-button help-button" aria-label="Help" onClick={() => setModal('help')}><HelpCircle size={19} /></button><button className="secondary" onClick={open} disabled={Boolean(busy)}><FolderOpen size={16} /> Open PDF</button>{documentState && <>{!readOnly && <button className="secondary" onClick={saveWorkspace} disabled={Boolean(busy)}><Save size={16} /> Save</button>}<button className="primary" onClick={() => setModal('export')} disabled={Boolean(busy)}><Download size={16} /> {readOnly ? 'Save a copy' : 'Export final PDF'}</button></>}</div>
    </header>
    {review && documentState && <nav className="review-queue" aria-label="Document review queue"><span className="review-queue-title">REVIEW QUEUE</span><strong>{review.index + 1} of {review.items.length}</strong><select aria-label="Jump to form" value={review.index} onChange={event => showReviewItem(Number(event.target.value))} disabled={Boolean(busy)}>{review.items.map((item, index) => <option key={index} value={index}>{index + 1}. {reviewLabel(item.name)}</option>)}</select><button className="secondary" onClick={() => showReviewItem(review.index - 1)} disabled={review.index === 0 || Boolean(busy)}><ChevronLeft size={16} /> Previous form</button><button className="primary" onClick={() => showReviewItem(review.index + 1)} disabled={review.index === review.items.length - 1 || Boolean(busy)}>Next form <ChevronRight size={16} /></button></nav>}
    {!documentState ? <main className="welcome"><div className="welcome-main"><span className="welcome-kicker"><span /> YOUR EVERYDAY PDF WORKSPACE</span><h1>Paperwork,<br /><em>without the work.</em></h1><p className="welcome-description">Open it. Fill it. Make it yours.<br />A simpler home for your PDFs, right on your computer.</p><div className="drop-card" onClick={open} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }} role="button" tabIndex={0} aria-label="Open a PDF"><div className="drop-icon"><FileText size={30} strokeWidth={1.4} /><span><Plus size={13} /></span></div><div><h2>Drop your PDF here</h2><p>or click to choose a file</p></div><span className="drop-arrow"><ArrowUpRight size={22} /></span></div><div className="welcome-under"><span><LockKeyhole size={13} /> Files stay on your computer</span><button className="text-button" onClick={() => guard(async () => { try { setBusy('Creating a practice form…'); await loadFile({ name: 'Welcome to Paperdesk.pdf', bytes: await createSample() }); } catch (error) { setBusy(''); setError(error.message); } })}>Try a practice form <ArrowRight size={14} /></button></div></div>
      <div className="welcome-art" aria-hidden="true"><div className="paper-back" /><div className="illustration-paper"><div className="mini-brand"><span /> PAPERDESK</div><div className="paper-title">Goodbye, busywork.</div><div className="paper-subtitle">Hello, done.</div><div className="illustration-rule" /><div className="mock-label">FULL NAME</div><div className="mock-field">Jamie Parker<span className="caret" /></div><div className="mock-two"><div><div className="mock-label">YOUR EMAIL</div><div className="mock-line" /></div><div><div className="mock-label">DATE</div><div className="mock-line short" /></div></div><div className="mock-checkbox"><span><Check size={13} /></span> A much better way to PDF.</div><div className="mock-signature">All taken care of.</div><div className="paper-bottom">ONE LESS THING ON YOUR LIST <span>01</span></div></div><div className="floating-chip"><CheckCircle2 size={20} /><span>Filled, saved, sorted.</span></div><div className="annotation-chip"><Sparkles size={14} /> A helping hand, built in</div></div>
      <div className="welcome-features"><div><span className="feature-icon"><FileText size={20} /></span><section><h3>Read comfortably</h3><p>A clear view. Every page, every detail.</p></section></div><div><span className="feature-icon"><Type size={20} /></span><section><h3>Fill any layout</h3><p>Use form fields or add your own text.</p></section></div><div><span className="feature-icon"><Layers size={20} /></span><section><h3>Skip the repetitive bits</h3><p>Paste your details and fill in bulk.</p></section></div></div>
    </main> : <>
      <div className="toolbar"><div className="toolbar-group"><button className="icon-button" title="Toggle page thumbnails" aria-label="Toggle page thumbnails" onClick={() => setShowPages(!showPages)}>{showPages ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button><span className="toolbar-divider" /><button className={`tool-button ${tool === 'select' ? 'active' : ''}`} onClick={() => setTool('select')}><MousePointer2 size={16} /> Select</button><button className={`tool-button ${tool === 'text' ? 'active' : ''}`} onClick={() => setTool('text')} disabled={readOnly}><Type size={17} /> Add text</button><button className={`tool-button ${tool === 'check' ? 'active' : ''}`} onClick={() => setTool('check')} disabled={readOnly}><Check size={17} /> Checkmark</button><button className={`tool-button ${tool === 'date' ? 'active' : ''}`} onClick={() => setTool('date')} disabled={readOnly}><CalendarDays size={17} /> Date</button><button className={`tool-button ${tool === 'signature' ? 'active' : ''}`} onClick={() => { setSignTarget(null); setModal('signatures'); }} disabled={readOnly}><PenLine size={17} /> Sign</button><button className={`tool-button ${tool === 'initials' ? 'active' : ''}`} onClick={() => { setSignTarget(null); setModal('initials'); }} disabled={readOnly}><PenLine size={17} /> Initial</button><span className="toolbar-divider" /><button className="icon-button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!history.past.length} onClick={undo}><Undo2 size={17} /></button><button className="icon-button" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!history.future.length} onClick={redo}><Redo2 size={17} /></button></div>
      <div className="toolbar-group zoom-controls"><button className="icon-button" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.25, (zoom === 'fit' ? 1 : Number(zoom)) - 0.25))}><Minus size={16} /></button><select aria-label="Zoom" value={zoom} onChange={event => setZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}>{[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3].map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}<option value="fit">Fit width</option></select><button className="icon-button" aria-label="Zoom in" onClick={() => setZoom(Math.min(3, (zoom === 'fit' ? 1 : Number(zoom)) + 0.25))}><Plus size={16} /></button><button className="icon-button" title="Fit width" aria-label="Fit width" onClick={() => setZoom('fit')}><Maximize size={16} /></button><button className="icon-button" title="Rotate view (does not change saved PDF)" aria-label="Rotate view" onClick={() => setRotation((rotation + 90) % 360)}><RotateCw size={16} /></button></div>
      <div className="toolbar-group page-controls"><button className="icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button><input aria-label="Page number" type="number" min={1} max={documentState.pdf.numPages} value={page} onChange={event => { const value = Number(event.target.value); if (value >= 1 && value <= documentState.pdf.numPages) setPage(value); }} /><span>/ {documentState.pdf.numPages}</span><button className="icon-button" aria-label="Next page" disabled={page >= documentState.pdf.numPages} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button></div></div>
      {documentState.readOnlyReason && <div className="document-warning"><LockKeyhole size={15} />{documentState.readOnlyReason}</div>}
      {tool !== 'select' && <div className="placement-hint"><MousePointer2 size={14} /> Click on the page to place {tool === 'text' ? 'a text box' : tool === 'check' ? 'a checkmark' : tool === 'date' ? 'today’s date' : `${activeSignature?.signer || 'the'} ${tool === 'initials' ? 'initials' : 'signature'}`}. <button onClick={() => setTool('select')}>Cancel</button></div>}
      <main className={`editor ${showPages ? '' : 'pages-hidden'}`}>
        {showPages && <aside className="pages-sidebar"><div className="sidebar-heading"><span>PAGES</span><span>{documentState.pdf.numPages}</span></div><div className="thumbnails">{Array.from({ length: documentState.pdf.numPages }, (_, index) => <Thumbnail key={`${documentState.id}-${index}`} pdf={documentState.pdf} pageNumber={index + 1} current={page === index + 1} onClick={() => setPage(index + 1)} />)}</div></aside>}
        <PdfPage pdf={documentState.pdf} number={page} zoom={zoom} rotation={rotation} fields={fields} values={state.values} additions={additions} tool={tool} onChange={changeValue} onPlace={place} onSignField={target => { if (tool === 'signature' && activeSignature) placeSignatureInField(activeSignature, target); else { setSignTarget(target); setTool('select'); setModal('signatures'); } }} onInitialField={target => { if (tool === 'initials' && activeSignature) placeInitialInField(activeSignature, target); else { setSignTarget(target); setTool('select'); setModal('initials'); } }} onDateTarget={fillFlatSigningDate} onSelect={setSelected} onMove={updateItem} selected={selected} highlight={highlight} readOnly={readOnly} query={tab === 'search' ? search.trim() : ''} onError={setError} />
        <aside className="inspector"><div className="panel-tabs" role="tablist" aria-label="Document tools"><button role="tab" aria-selected={tab === 'fields'} className={tab === 'fields' ? 'active' : ''} onClick={() => setTab('fields')}><List size={16} /> Fields</button><button role="tab" aria-selected={tab === 'bulk'} className={tab === 'bulk' ? 'active' : ''} onClick={() => setTab('bulk')} disabled={readOnly}><Sparkles size={16} /> Bulk fill</button><button role="tab" aria-selected={tab === 'search'} className={tab === 'search' ? 'active search-tab' : 'search-tab'} onClick={() => setTab('search')} title="Find text (Ctrl+F)" aria-label="Find text"><Search size={17} /></button></div>
          <BulkPanel key={documentState.id} active={tab === 'bulk'} fields={allFields} busy={Boolean(busy)} duplicateNames={duplicateNames} onApply={values => { update(current => applyValues(values, current)); notify(`${Object.keys(values).length} field values applied. Review the page before saving.`); }} onBatch={batch} onCopy={copySchema} />
          {tab === 'search' ? <div className="panel-body"><div className="section-eyebrow">FIND YOUR PLACE</div><h2>Search this PDF</h2><form onSubmit={findText} className="search-form"><input id="document-search" aria-label="Search document text" placeholder="Find a word or phrase…" value={search} onChange={event => { setSearch(event.target.value); setSearchResults([]); searchRun.current++; setSearching(false); }} /><button className="primary" disabled={searching || !search.trim()} aria-label="Search"><Search size={16} /></button></form><p className="tiny muted">Searches existing document text. Scanned images need OCR, which this version does not include.</p>{searching ? <p className="muted">Searching pages…</p> : <><div className="section-heading"><h3>Matching pages</h3><span className="pill">{searchResults.length}</span></div>{searchResults.map(result => <button key={result.page} className="search-result" onClick={() => setPage(result.page)}><strong>Page {result.page}</strong><span>{result.snippet}</span></button>)}</>}</div> : tab === 'fields' ? <div className="panel-body fields-panel">
            {selectedItem && <section className="added-editor"><div className="section-heading"><h3>{selectedItem.kind === 'text' ? 'Your text box' : selectedItem.kind === 'signature' ? selectedItem.label : 'Your checkmark'}</h3><button className="icon-button" aria-label="Delete selected item" onClick={() => { removeSelected(); }}><Trash2 size={16} /></button></div>{selectedItem.kind === 'text' && <><label className="input-label" htmlFor="added-text-value">Text</label><textarea id="added-text-value" rows={3} value={selectedItem.text} onChange={event => updateItem(selectedItem.id, { text: event.target.value })} /><label className="input-label" htmlFor="added-text-label">Field name <span>for bulk filling</span></label><input id="added-text-label" value={selectedItem.label} onChange={event => updateItem(selectedItem.id, { label: event.target.value })} /></>}{selectedItem.kind === 'signature' ? <><label className="input-label" htmlFor="signature-width">{inkKind(selectedItem) === 'initials' ? 'Initials width' : 'Signature width'}</label><input id="signature-width" type="range" min={inkKind(selectedItem) === 'initials' ? 5 : 20} max="350" value={selectedItem.width} onChange={event => resizeSignature(selectedItem, Number(event.target.value))} onPointerUp={() => selectedSignatureSigner && flushSignatureWidth(selectedSignatureSigner, inkKind(selectedItem))} onKeyUp={() => selectedSignatureSigner && flushSignatureWidth(selectedSignatureSigner, inkKind(selectedItem))} onBlur={() => selectedSignatureSigner && flushSignatureWidth(selectedSignatureSigner, inkKind(selectedItem))} /><span className="tiny muted">{Math.round(selectedItem.width)} pt wide</span>{selectedSavedSignature && <p className="tiny muted">This size is saved for {selectedSignatureSigner}’s next {inkKind(selectedItem)}.</p>}</> : <><label className="input-label" htmlFor="text-size">{selectedItem.kind === 'text' ? 'Font size' : 'Size'}</label><select id="text-size" value={selectedItem.size} onChange={event => updateItem(selectedItem.id, { size: Number(event.target.value) })}>{[6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72, 96].map(size => <option key={size} value={size}>{size} pt</option>)}</select></>}<p className="tiny muted">Drag on the page to reposition. Save a workspace to keep placements editable.</p></section>}
            <div className="section-eyebrow">MAKE IT COMPLETE</div><div className="section-heading"><h2>Form fields</h2><span className="pill">{editableCount}</span></div><p className="muted">{editableCount ? 'Fill here or click a field on the page.' : 'This page can still be filled out.'}</p>
            {editableCount > 0 && <><div className="progress-track"><span style={{ width: `${filledCount / editableCount * 100}%` }} /></div><div className="progress-label"><span>{filledCount} of {editableCount} fields have values</span><span>{Math.round(filledCount / editableCount * 100)}%</span></div><label className="toggle-label"><input type="checkbox" checked={highlight} onChange={event => setHighlight(event.target.checked)} /> Highlight fields on page</label><div className="field-filter"><Search size={15} /><input aria-label="Filter form fields" placeholder="Find a field…" value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} /></div></>}
            {fieldList.map(field => <div className="field-editor" key={field.name}><div className="field-label-row"><label htmlFor={undefined}>{field.label}{field.required && <span className="required" title="Required field"> *</span>}</label><button className="page-link" title="Go to this field’s page" onClick={() => setPage(field.page)}>p. {field.page}</button></div><FieldInput field={field} value={state.values[field.name]} onChange={value => changeValue(field.name, value)} disabled={readOnly} />{isDateSignedField(field) && !readOnly && <button className="field-today-button" type="button" onClick={() => changeValue(field.name, formatLocalDate())}>Use today’s date</button>}{field.readOnly && <span className="tiny muted">Read-only</span>}</div>)}
            {!fields.length && <div className="empty-fields"><span className="soft-icon"><Type size={26} /></span><h3>No form fields? No problem.</h3><p>Use Add text to type anywhere on the page, including on scanned forms.</p><button className="secondary" disabled={readOnly} onClick={() => setTool('text')}><Plus size={15} /> Add a text box</button></div>}
            {additions.length > 0 && <div className="added-list"><div className="section-heading"><h3>Added to the page</h3><span className="pill">{additions.length}</span></div>{additions.map(item => <button key={item.id} className={`added-list-item ${selected === item.id ? 'active' : ''}`} onClick={() => { setSelected(item.id); setPage(item.page); }}>{item.kind === 'text' ? <Type size={15} /> : item.kind === 'signature' ? <PenLine size={15} /> : <Check size={15} />}<span>{item.label || 'Unnamed text'}</span><small>p. {item.page}</small></button>)}</div>}
            {!readOnly && <button className="panel-bottom-cta" onClick={() => setTab('bulk')}><Sparkles size={17} /><span>Have these details already?<br /><strong>Try bulk fill</strong></span><ArrowRight size={16} /></button>}
          </div> : null}
        </aside>
      </main>
    </>}
    <footer className="status-bar"><span><span className="status-dot" /> Local workspace <span className="status-separator">/</span> No uploads. No account.</span><span>{documentState ? <>{readOnly ? 'View only' : 'Changes are saved only when you choose Save'}<span className="status-separator">·</span>Ctrl+S to save</> : <>Made for the everyday.<span className="status-separator">·</span>Paperdesk 1.0.4</>}</span></footer>
    {dragging && <div className="drop-overlay"><FileText size={48} /><h2>Drop it here. We’ll take it from there.</h2><p>PDF or Paperdesk workspace</p></div>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={19} /><span>{toast.message}</span>{toast.path && <button onClick={() => window.paperdesk?.showOutput(toast.path)}>Show file</button>}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16} /></button></div>}
    {(modal === 'signatures' || modal === 'initials') && <SignatureDialog signatures={signatures} kind={modal === 'initials' ? 'initials' : 'signature'} target={signTarget} pageCount={documentState?.pdf.numPages || 1} onSave={saveSignature} onRemove={removeSignature} onPlace={record => { if (signTarget) modal === 'initials' ? placeInitialInField(record, signTarget) : placeSignatureInField(record, signTarget); else { setActiveSignature(record); setTool(modal === 'initials' ? 'initials' : 'signature'); setModal(null); } }} onPlaceAll={record => placeInitialsOnAllPages(record, signTarget)} onClose={() => { setModal(null); setSignTarget(null); }} />}
    {modal === 'help' && <Modal title="A simpler way to PDF" onClose={() => setModal(null)}><div className="help-content"><p><b>1. Open your PDF.</b> Use Open PDF or drag a file into the window. Fillable fields appear in the right panel.</p><p><b>2. Fill in the details.</b> Type in the fields, or use Add text and Checkmark for flat forms. Name text boxes to use them in bulk filling.</p><p><b>3. Sign when ready.</b> Click Sign here beside a signature line and choose the signer. Paperdesk places the saved signature, printed name where requested, and signing date. Use Today beside a signing date to set it separately. Review before saving.</p><p><b>4. Initial reports.</b> Click Initial in the toolbar to draw or import each person's initials. On a HSEGH page, click Initial above either caregiver blank. Choose Initial here for that page, or All pages after you have reviewed the complete report. Each person's initials are saved separately from their full signature.</p><p><b>5. Get help from this chat.</b> In Bulk fill, copy the field list and paste it here with your details. Paste the JSON response into the app, review matches, and apply. This workflow doesn’t require an API key.</p><p><b>6. Save and export.</b> Use Save to keep an editable workspace. When the form is final, use Export final PDF to put one flattened PDF in the Final PDFs folder beside your source file. A CSV or JSON array can produce one filled PDF per record.</p><div className="notice">This version supports standard PDF forms and placed text or ink-image signatures and initials. It does not include OCR, certificate signing, or editing existing page text. Encrypted, XFA, and digitally signed files open in view-only mode.</div><p className="tiny muted">PDF rendering: <a href="https://mozilla.github.io/pdf.js/" onClick={event => event.preventDefault()}>Mozilla PDF.js</a>. PDF writing: <a href="https://pdf-lib.js.org/" onClick={event => event.preventDefault()}>pdf-lib</a>. Fonts: Inter and Noto Sans.</p></div></Modal>}
    {modal === 'export' && <Modal title={readOnly ? 'Save a PDF copy' : 'Export final PDF'} onClose={busy ? null : () => setModal(null)}>
      <p className="muted">{readOnly ? 'This file is view-only. Save a separate PDF copy.' : 'Create one finished PDF for this form, with answers and signatures fixed on the page.'}</p>
      {!readOnly && <><div className="notice small"><b>Finals folder:</b> <code className="final-folder">{finalFolder(documentState.sourcePath) || 'Choose a folder in the Save dialog'}</code></div><p className="tiny muted">Flattening removes editable form fields. Another PDF editor could still change the file.</p></>}
      <button className="primary full" onClick={exportFinal} disabled={Boolean(busy)}><Download size={17} /> {readOnly ? 'Save PDF copy' : 'Export flattened PDF'}</button>
      <p className="tiny muted">Your draft stays editable. Exporting does not overwrite it.</p>
    </Modal>}
    {modal === 'discard' && <Modal title="You have unsaved changes" onClose={() => { setModal(null); setPendingAction(null); }}><p className="muted">Use Save first if you want to keep editing the details you entered.</p><div className="modal-actions"><button className="secondary" onClick={() => { const action = pendingAction; setModal(null); setPendingAction(null); action?.(); }}>Discard changes</button><button className="primary" onClick={() => { setPendingAction(null); saveWorkspace(); }}>Save first</button></div></Modal>}
    {modal?.type === 'copy' && <Modal title="Copy this field list into your chat" onClose={() => setModal(null)}><textarea className="schema-text" readOnly value={modal.text} onFocus={event => event.target.select()} /><p className="tiny muted">Select all and press Ctrl+C, then paste into your chat with the details to fill.</p></Modal>}
    {passwordRequest && <Modal title="This PDF needs a password" onClose={() => { loadTask.current?.destroy(); setPasswordRequest(null); setBusy(''); }}><form onSubmit={event => { event.preventDefault(); passwordRequest.submit(password); setPasswordRequest(null); setBusy('Unlocking your PDF…'); }}><p className="muted">{passwordRequest.incorrect ? 'That password did not work. Try again.' : 'Enter the password to view this document.'}</p><input type="password" aria-label="PDF password" value={password} onChange={event => setPassword(event.target.value)} autoFocus /><button className="primary full" type="submit">Open document</button></form></Modal>}
    {error && <Modal title="That didn’t quite work" onClose={() => setError('')}><div className="error-detail"><AlertCircle size={24} /><p>{error}</p></div><button className="primary full" onClick={() => setError('')}>Got it</button></Modal>}
    {busy && <div className="busy-overlay" role="status" aria-live="polite"><div className="busy-card"><span className="spinner" /><strong>{busy}</strong><small>Working locally on your computer</small></div></div>}
  </div>;
}

