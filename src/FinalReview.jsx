import React, { useEffect, useState } from 'react';
import { getDocument } from 'pdfjs-dist';
import PdfPage from './PdfPage.jsx';

export default function FinalReview({ entries, onExport, onError, busy }) {
  const [index, setIndex] = useState(0), [pdf, setPdf] = useState(null), [page, setPage] = useState(1), [confirmed, setConfirmed] = useState(false);
  const entry = entries[index];
  useEffect(() => {
    setPdf(null); setPage(1);
    if (entry.previewPdf) { setPdf(entry.previewPdf); return; }
    const task = getDocument({ data: entry.bytes.slice(), isEvalSupported: false, cMapUrl: new URL('./pdfjs/cmaps/', document.baseURI).href, cMapPacked: true, standardFontDataUrl: new URL('./pdfjs/standard_fonts/', document.baseURI).href, wasmUrl: new URL('./pdfjs/wasm/', document.baseURI).href });
    let active = true;
    task.promise.then(value => { if (active) setPdf(value); }).catch(error => { if (active) onError(error.message); });
    return () => { active = false; task.destroy(); };
  }, [entry]);
  return <div className="final-review">
    {entries.length > 1 && <label className="input-label">Document<select aria-label="Document to preview" value={index} onChange={event => setIndex(Number(event.target.value))}>{entries.map((item, i) => <option key={i} value={i}>{i + 1}. {item.name}{item.copy ? ' (original copy)' : ''}</option>)}</select></label>}
    <p className="muted">Preview the actual output. Blank agency sections may be intentional; these checks cannot decide which answers apply.</p>
    <div className="final-review-layout"><section className="final-preview" aria-label="Final PDF preview">
      {pdf ? <><div className="record-nav"><button onClick={() => setPage(page - 1)} disabled={page === 1}>Previous page</button><span>Page {page} of {pdf.numPages}</span><button onClick={() => setPage(page + 1)} disabled={page === pdf.numPages}>Next page</button></div><PdfPage pdf={pdf} number={page} zoom="fit" rotation={0} fields={[]} values={{}} additions={[]} tool="select" readOnly onError={onError} /></> : <p role="status">Loading preview…</p>}
    </section><section className="preflight-list" aria-label="Document checks"><h3>{entry.copy ? 'Original copy' : 'Verified flattened PDF'}</h3><p className="tiny muted">{entry.copy ? 'This view-only file stays unchanged. Its filename ends in -copy.pdf.' : 'No interactive form fields remain. Answers were checked for readable fit.'}</p>
      {entry.issues.length ? entry.issues.map((issue, i) => <button className="preflight-issue" key={i} onClick={() => setPage(issue.page)}><strong>Page {issue.page}</strong><span>{issue.message}</span></button>) : <p>No missing required fields or recognized signing marks found.</p>}
    </section></div>
    <label className="toggle-label"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I reviewed {entries.length === 1 ? 'this document' : `all ${entries.length} documents`} and confirmed any remaining blanks are intentional.</label>
    <button className="primary full" disabled={!confirmed || busy} onClick={onExport}>Export {entries.length === 1 ? entry.copy ? 'PDF copy' : 'flattened final' : `${entries.length} reviewed PDFs`}</button>
  </div>;
}
