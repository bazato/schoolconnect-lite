import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { FeeImport, FeePreview, FeeReport } from '@schoolconnect/contracts';
import { parseFeesWorkbook } from './fees-workbook';
import { recognitionConstructor, voiceError, type Recognition } from './fee-voice';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const message = (error: unknown) => error instanceof Error ? error.message.replaceAll('_',' ') : 'Please try again.';
const examples = ['This month how many fees are pending','From 3rd grade how many fees are due','This month how much fees collected'];

export function FeesPage({ request }: { request: Request }) {
  const [data,setData] = useState<FeeImport | null>(null), [preview,setPreview] = useState<FeePreview | null>(null);
  const [fileName,setFileName] = useState(''), [batchId,setBatchId] = useState('');
  const [busy,setBusy] = useState(false), [searching,setSearching] = useState(false);
  const [error,setError] = useState(''), [searchError,setSearchError] = useState(''), [notice,setNotice] = useState('');
  const [question,setQuestion] = useState(examples[0]), [report,setReport] = useState<FeeReport | null>(null);
  const [listening,setListening] = useState(false), [consent,setConsent] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const supported = Boolean(recognitionConstructor());
  useEffect(() => () => { const instance=recognition.current; if (instance) { instance.onresult=null; instance.onerror=null; instance.onend=null; instance.abort(); } }, []);
  const review = async (value: FeeImport) => { setPreview(await request<FeePreview>('/admin/fees/import-preview',{ method:'POST',body:JSON.stringify(value) })); };
  const selectFile = async (file?: File) => {
    setError(''); setNotice(''); setPreview(null); setData(null); setFileName(file?.name ?? '');
    if (!file) return;
    setBusy(true);
    try { const value=await parseFeesWorkbook(file); setData(value); setBatchId(crypto.randomUUID()); await review(value); }
    catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  };
  const commit = async () => {
    if (!data || !preview?.valid) return;
    setBusy(true);setError('');setNotice('');
    try {
      const result=await request<FeePreview['counts']>('/admin/fees/import-commit',{ method:'POST',body:JSON.stringify({ ...data,batchId,revision:preview.revision }) });
      setNotice(`Saved: ${result.feesAdded} fees added, ${result.feesUpdated} updated; ${result.collectionsAdded} collections added, ${result.collectionsUpdated} updated. Re-uploading the same references will not duplicate records.`);
      setPreview(null);setData(null);setReport(null);
    } catch (failure) { setError(message(failure)); if (failure instanceof Error && failure.message.includes('FEE_LEDGER_CHANGED')) setPreview(null); }
    finally { setBusy(false); }
  };
  const search = async (event: FormEvent) => {
    event.preventDefault(); setSearching(true);setSearchError('');setReport(null);
    try { setReport(await request<FeeReport>('/admin/fees/search',{ method:'POST',body:JSON.stringify({ question }) })); }
    catch (failure) { setSearchError(message(failure)); } finally { setSearching(false); }
  };
  const listen = () => {
    if (listening) { recognition.current?.stop(); return; }
    const Constructor=recognitionConstructor(); if (!Constructor || !consent) return;
    const instance=new Constructor(); recognition.current=instance;instance.lang='en-IN';instance.continuous=false;instance.interimResults=false;
    instance.onresult=(event) => { setQuestion(event.results[0]?.[0]?.transcript ?? '');setReport(null); };
    instance.onerror=(event) => { setSearchError(voiceError(event.error));setListening(false); };
    instance.onend=() => { setListening(false);recognition.current=null; };
    setSearchError('');
    try { instance.start();setListening(true); } catch { setSearchError('Microphone could not start. Please type the question.');setListening(false); }
  };
  return <div className="fees-layout">
    <section className="panel fees-panel" aria-labelledby="fee-import-heading">
      <div className="panel-heading"><div><h2 id="fee-import-heading">Import fee dues & collections</h2><p>Match students by admission number, review, then add or update safely.</p></div><a className="button secondary small" href="/nexqon-fees-template.xlsx" download>Download Excel template</a></div>
      <div className="fees-guide"><p><strong>Fees sheet:</strong> admissionNumber, feeReference, academicYear, dueDate, amount, currency, description (optional).</p><p><strong>Collections sheet:</strong> admissionNumber, feeReference, collectionReference, collectionDate, amount. Each collection reference is unique within your school.</p><p>Keep the same references when correcting a row. Enter identifiers as text, dates as YYYY-MM-DD and an explicit ISO currency (e.g. INR or SAR). Up to 200 rows / 5 MB; values only, no formulas. Either sheet can be uploaded on its own.</p></div>
      <label className="fee-file-label">Choose fee workbook<input type="file" accept=".xlsx" disabled={busy} onChange={(event) => { const file=event.target.files?.[0];event.target.value='';void selectFile(file); }} /></label>
      {busy && <p role="status">Validating or saving your school’s fee records…</p>}
      {fileName && <p className="muted">{fileName}</p>}
      {error && <div className="alert danger" role="alert">{error}</div>}
      {notice && <div className="alert success" role="status">{notice}</div>}
      {data && !preview && !busy && <button className="button secondary" onClick={() => { setBusy(true);void review(data).catch((failure) => setError(message(failure))).finally(() => setBusy(false)); }}>Review again</button>}
      {preview && <>
        <div className="fees-preview-counts"><span>Fees: {preview.counts.feesAdded} new · {preview.counts.feesUpdated} update · {preview.counts.feesUnchanged} unchanged</span><span>Collections: {preview.counts.collectionsAdded} new · {preview.counts.collectionsUpdated} update · {preview.counts.collectionsUnchanged} unchanged</span></div>
        {preview.issues.length > 0 && <div className="alert danger" role="alert"><div><strong>Nothing has been saved. Correct these rows and upload again.</strong><ul>{preview.issues.map((issue,index) => <li key={index}>{issue.sheet}, row {issue.row}: {issue.message}</li>)}</ul></div></div>}
        <div className="table-scroll"><table><thead><tr><th>Sheet / row</th><th>Admission no.</th><th>Reference</th><th>Amount</th><th>Date / year</th><th>Action</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={`${row.sheet}-${row.row}`}><td>{row.sheet} / {row.row}</td><td>{row.admissionNumber}</td><td>{row.reference}</td><td>{row.currency} {row.amount}{row.action==='UPDATE' && row.previousAmount && <small className="fee-student-name">Previously {row.previousAmount}</small>}</td><td>{row.date}{row.academicYear && <small className="fee-student-name">{row.academicYear}</small>}{row.action==='UPDATE' && <small className="fee-student-name">Previously {row.previousDate} {row.previousAcademicYear}</small>}</td><td>{row.action}</td></tr>)}</tbody></table></div>
        <button className="button primary" disabled={busy || !preview.valid} onClick={() => { void commit(); }}>Confirm add / update</button><p className="muted">All rows commit together. Updating a collection corrects its amount/date; it does not add another receipt. Omitting a row never deletes it.</p>
      </>}
    </section>
    <section className="panel fees-panel" aria-labelledby="fee-search-heading">
      <h2 id="fee-search-heading">Ask about your school’s fees</h2><p>Type a question or dictate it in English. Review the transcript, then select Search.</p>
      <div className="fee-examples">{examples.map((example) => <button key={example} className="button quiet small" onClick={() => { setQuestion(example);setReport(null); }}>{example}</button>)}</div>
      <form className="fees-search" onSubmit={(event) => { void search(event); }}><label>Fee question<input value={question} maxLength={300} onChange={(event) => { setQuestion(event.target.value);setReport(null); }} required disabled={listening} /></label><div className="fees-actions"><button type="button" className="button secondary" disabled={!supported || !consent || searching} onClick={listen}>{listening ? 'Stop listening' : 'Use microphone'}</button><button className="button primary" disabled={searching || listening}>{searching ? 'Searching…' : 'Search'}</button></div></form>
      {supported ? <label className="fee-consent"><input type="checkbox" checked={consent} disabled={listening} onChange={(event) => setConsent(event.target.checked)} />I agree to use my browser’s speech service. It may send audio to its provider; Nexqon stores neither audio nor transcripts.</label> : <p className="muted">Voice input is not supported here. Use a compatible browser over HTTPS (or localhost), or type your question.</p>}
      {listening && <p role="status">Listening… No search runs until you confirm the transcript.</p>}
      {searchError && <div className="alert danger" role="alert">{searchError}</div>}
      {report && <div className="fees-report"><h3>{report.query.label}</h3><p>{report.studentCount} students · {report.recordCount} {report.query.metric==='PENDING' ? 'unpaid fee records' : 'collection receipts'}</p><div className="fees-totals">{report.currencies.map((total) => <div key={total.currency}><span>{total.currency}</span><strong>{total.amount}</strong></div>)}{!report.currencies.length && <p>No matching fee records.</p>}</div><p className="muted">Pending: remaining balance now, filtered by fee due date. Collected: receipts filtered by collection date. “This month” uses your school’s timezone. Grade filters use current active class enrolments and grade codes (3, G3, GRADE_3 or GRADE-3). Currencies are never added together.</p><div className="table-scroll"><table><thead><tr><th>Admission / student</th><th>Fee / receipt</th><th>{report.query.metric==='PENDING' ? 'Due date' : 'Collection date'}</th><th>Amount</th></tr></thead><tbody>{report.records.map((row,index) => <tr key={index}><td>{row.admissionNumber}<small className="fee-student-name">{row.studentName}</small></td><td>{row.feeReference}{row.collectionReference && <small className="fee-student-name">{row.collectionReference}</small>}</td><td>{row.date}</td><td>{row.currency} {row.amount}</td></tr>)}</tbody></table></div>{report.truncated && <p>Showing the first 200 records; the totals above include every matching record.</p>}</div>}
    </section>
  </div>;
}
