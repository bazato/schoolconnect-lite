import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
type Request=<T>(path:string,init?:RequestInit)=>Promise<T>;
export type SchoolNotice={id:string;title:string;body:string;status:string;revisionNumber:number;authorMembershipId:string;publishedAt:string|null;recipientCount:number;teacherCount:number};
const failureText=(failure:unknown)=>failure instanceof Error?failure.message.replaceAll('_',' ').toLowerCase():'Unable to publish. Please retry.';
export function SchoolAnnouncements({request,membershipId}:{request:Request;membershipId:string}) {
  const [items,setItems]=useState<SchoolNotice[]>([]),[title,setTitle]=useState(''),[body,setBody]=useState('');
  const [editing,setEditing]=useState<SchoolNotice|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');const key=useRef(crypto.randomUUID());
  const load=useCallback(async()=>{setItems(await request<SchoolNotice[]>('/admin/announcements'));},[request]);
  useEffect(()=>{let active=true;void request<SchoolNotice[]>('/admin/announcements').then((rows)=>{if(active)setItems(rows);}).catch((failure)=>{if(active)setError(failureText(failure));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[request]);
  const reset=()=>{setTitle('');setBody('');setEditing(null);key.current=crypto.randomUUID();};
  const submit=async(event:FormEvent)=>{event.preventDefault();if(!window.confirm(editing?'Send this updated announcement to the original parent and teacher audience?':'Publish this announcement to parents in every active class and all active teachers in this school?'))return;
    setBusy(true);setError('');setNotice('');try{await request(editing?`/admin/announcements/${editing.id}`:'/admin/announcements',{method:editing?'PATCH':'POST',body:JSON.stringify({title,body,...(editing?{expectedRevisionNumber:editing.revisionNumber}:{idempotencyKey:key.current})})});
      reset();setNotice('Announcement saved. Delivery to parents and teachers is processing.');await load();
    }catch(failure){setError(failureText(failure));}finally{setBusy(false);}};
  return <div className="content-stack"><section className="section-card"><span className="eyebrow">SCHOOL ANNOUNCEMENTS</span><h3>{editing?'Edit announcement':'New announcement'}</h3>
    <p className="muted">All classes · Parents and teachers in this school. Teachers receive this as a read-only school notice.</p>
    <form className="data-form" onSubmit={(event)=>{void submit(event);}}><label>Title<input value={title} required maxLength={150} disabled={busy} onChange={(event)=>{setTitle(event.target.value);key.current=crypto.randomUUID();}}/></label>
      <label>Message<textarea value={body} required maxLength={20000} rows={6} disabled={busy} onChange={(event)=>{setBody(event.target.value);key.current=crypto.randomUUID();}}/></label>
      <label>Audience<input readOnly value="All classes — Parents and teachers"/></label>
      <div className="form-actions">{editing && <button type="button" className="button secondary" disabled={busy} onClick={reset}>Cancel edit</button>}<button className="button primary" disabled={busy || !title.trim() || !body.trim()}>{busy?'Saving…':editing?'Publish update':'Publish announcement'}</button></div></form>
    {error && <div className="alert danger" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}</section>
    <section className="section-card"><div className="card-heading"><h3>School-wide announcements</h3><button className="text-button" disabled={busy} onClick={()=>{void load().catch((failure)=>setError(failureText(failure)));}}>Refresh announcements</button></div>
      {loading?<p>Loading announcements…</p>:!items.length?<p>No school-wide announcements yet.</p>:items.map((item)=><article className="section-card" key={item.id}><h3>{item.title}</h3><p style={{whiteSpace:'pre-wrap'}}>{item.body}</p><p className="muted">{item.status} · {item.recipientCount} parent-child deliveries · {item.teacherCount} teachers · Revision {item.revisionNumber}</p>
        {item.authorMembershipId===membershipId && item.status!=='ARCHIVED' && <div className="form-actions"><button className="button secondary" disabled={busy} onClick={()=>{setEditing(item);setTitle(item.title);setBody(item.body);setError('');setNotice('');}}>Edit announcement</button>
        <button className="text-button" disabled={busy} onClick={async()=>{if(!window.confirm('Archive this announcement? It will disappear from active feeds; notifications already delivered cannot be recalled.'))return;setBusy(true);setError('');try{await request(`/admin/announcements/${item.id}/archive`,{method:'POST',body:JSON.stringify({expectedRevisionNumber:item.revisionNumber})});await load();}catch(failure){setError(failureText(failure));}finally{setBusy(false);}}}>Archive announcement</button></div>}</article>)}
      <p className="muted">Showing the latest 100 notices. Only the publishing account can edit or archive its notice. New guardians or teachers added later do not receive retrospective notifications.</p>
    </section></div>;
}
