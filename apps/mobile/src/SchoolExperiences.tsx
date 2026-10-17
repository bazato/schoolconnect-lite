import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import { validateLeaveApplication, validateTimetable, type LeaveApplication, type PublishedTimetable, type ResultChartPoint, type TimetableSlot } from '../../../packages/contracts/src/school-experiences';
import { mobileApi, type ApiRosterStudent, type ApiTeachingAssignment, type MobileSession } from './api';
import { TeachingClassSelector } from './TeachingClassSelector';
import { colors } from './theme';

type Props = { feature:'leave-applications'|'timetable'|'result-charts'; teacher:boolean; session:MobileSession|null; studentId:string; studentName:string; assignment?:ApiTeachingAssignment; scope:ApiTeachingAssignment[]; schoolName:string; onSelect:(id:string)=>void; onBack:()=>void };
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const today=()=>new Date().toLocaleDateString('en-CA');
const errorText=(error:unknown)=>error instanceof Error ? error.message.replaceAll('_',' ') : 'Unable to load. Check your connection and try again.';
function Button({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button,disabled && {opacity:.45}]}><Text style={s.buttonText}>{label}</Text></Pressable>;
}
function Input({label,value,onChange,numeric=false,multiline=false,maxLength=160}:{label:string;value:string;onChange:(value:string)=>void;numeric?:boolean;multiline?:boolean;maxLength?:number}) {
  return <View style={s.gap}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} style={[s.input,multiline && {minHeight:96,textAlignVertical:'top'}]} value={value} onChangeText={onChange} keyboardType={numeric ? 'decimal-pad' : 'default'} multiline={multiline} maxLength={maxLength}/></View>;
}
function Panel({children}:{children:ReactNode}) {return <View style={s.card}>{children}</View>;}

export function SchoolExperiences(props:Props) {
  const {teacher,feature,session,assignment,studentId}=props;
  const id=teacher ? assignment?.classId : studentId;
  const [refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [leaves,setLeaves]=useState<LeaveApplication[]>([]),[timetable,setTimetable]=useState<PublishedTimetable|null>(null),[points,setPoints]=useState<ResultChartPoint[]>([]),[roster,setRoster]=useState<ApiRosterStudent[]>([]);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');
    if(!session || !id) {setLoading(false);setError('Sign in with a linked child or assigned class to use this feature.');return;}
    const load=async()=>{
      if(feature==='leave-applications') {const rows=await mobileApi.leaveApplications(session,teacher,id);if(active)setLeaves(rows);}
      if(feature==='timetable') {const result=await mobileApi.timetable(session,teacher,id);if(active)setTimetable(result);}
      if(feature==='result-charts') {
        const result=await mobileApi.resultCharts(session,teacher,id);if(active)setPoints(result.points);
        if(teacher) {const rows=await mobileApi.resultRoster(session,id);if(active)setRoster(rows);}
      }
    };
    void load().catch((failure)=>{if(active)setError(errorText(failure));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[session,id,teacher,feature,refresh]);
  const title=feature==='leave-applications' ? teacher ? 'Parent leave requests' : 'Leave applications' : feature==='timetable' ? 'Class timetable' : 'Result charts';
  const scope=feature==='result-charts' ? props.scope.filter((item)=>item.canPublishResults) : props.scope;
  return <SafeAreaView style={s.safe}>
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Pressable accessibilityRole="button" onPress={props.onBack}><Text style={s.link}>← Back to dashboard</Text></Pressable>
      <Text style={s.title}>{title}</Text>
      {teacher ? <TeachingClassSelector scope={scope} selected={assignment} schoolName={props.schoolName} onSelect={props.onSelect} confirmSelection="Switch class? Unsaved changes on this screen will be discarded."/> : <Text style={s.label}>{props.studentName} · {props.schoolName}</Text>}
      <Button label={loading ? 'Refreshing…' : 'Refresh'} disabled={loading} onPress={()=>setRefresh((value)=>value+1)}/>
      {loading && <ActivityIndicator color={colors.primary}/>}
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
      {!loading && !error && session && id && <>
        {feature==='leave-applications' && <LeaveApplications key={id} teacher={teacher} session={session} studentId={studentId} leaves={leaves} onSaved={()=>setRefresh((value)=>value+1)}/>}
        {feature==='timetable' && <Timetable key={`${id}:${timetable?.version ?? 0}`} teacher={teacher} session={session} classId={id} published={timetable} onSaved={()=>setRefresh((value)=>value+1)}/>}
        {feature==='result-charts' && <><ResultBars points={points} teacher={teacher}/>{teacher && <ScoreForm key={assignment?.assignmentId} session={session} assignment={assignment!} roster={roster} onSaved={()=>setRefresh((value)=>value+1)}/>}</>}
      </>}
    </ScrollView>
  </SafeAreaView>;
}

function LeaveApplications({teacher,session,studentId,leaves,onSaved}:{teacher:boolean;session:MobileSession;studentId:string;leaves:LeaveApplication[];onSaved:()=>void}) {
  const [start,setStart]=useState(today),[end,setEnd]=useState(today),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submit=async()=>{setBusy(true);setError('');try{validateLeaveApplication({startDate:start,endDate:end,reason});await mobileApi.applyLeave(session,{studentId,startDate:start,endDate:end,reason});onSaved();}catch(failure){setError(errorText(failure));}finally{setBusy(false);}};
  return <>
    {!teacher && <Panel><Text style={s.heading}>Apply for leave</Text><Text style={s.body}>Sent to teachers assigned to this child’s class. Acknowledgement means received; attendance is recorded separately.</Text><Input label="From date (YYYY-MM-DD)" value={start} onChange={setStart} maxLength={10}/><Input label="To date (YYYY-MM-DD)" value={end} onChange={setEnd} maxLength={10}/><Input label="Reason" value={reason} onChange={setReason} multiline maxLength={2000}/>{error ? <Text style={s.error}>{error}</Text> : null}<Button label={busy ? 'Submitting…' : 'Submit to teacher'} disabled={busy} onPress={()=>{void submit();}}/></Panel>}
    <Text style={s.heading}>{teacher ? 'Class applications' : 'Submitted applications'}</Text>
    {!leaves.length && <Text style={s.body}>No leave applications yet.</Text>}
    {leaves.map((leave)=><LeaveCard key={leave.id} leave={leave} teacher={teacher} session={session} onSaved={onSaved}/>)}
  </>;
}
function LeaveCard({leave,teacher,session,onSaved}:{leave:LeaveApplication;teacher:boolean;session:MobileSession;onSaved:()=>void}) {
  const [note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const acknowledge=async()=>{setBusy(true);setError('');try{await mobileApi.acknowledgeLeave(session,leave.id,note);onSaved();}catch(failure){setError(errorText(failure));}finally{setBusy(false);}};
  return <Panel>{teacher && <Text style={s.heading}>{leave.studentName}</Text>}<Text style={s.label}>{leave.startDate} — {leave.endDate}</Text><Text style={s.body}>{leave.reason}</Text><Text style={s.link}>{leave.status==='ACKNOWLEDGED' ? '✓ Acknowledged by teacher' : 'Awaiting teacher acknowledgement'}</Text>{leave.acknowledgedAt && <Text style={s.body}>{new Date(leave.acknowledgedAt).toLocaleString()}</Text>}{leave.acknowledgementNote && <Text style={s.body}>Teacher reply: {leave.acknowledgementNote}</Text>}{teacher && leave.status==='SUBMITTED' && <><Input label="Reply (optional)" value={note} onChange={setNote} maxLength={1000}/><Button label={busy ? 'Acknowledging…' : 'Acknowledge application'} disabled={busy} onPress={()=>{void acknowledge();}}/></>}{error ? <Text style={s.error}>{error}</Text> : null}</Panel>;
}

function Timetable({teacher,session,classId,published,onSaved}:{teacher:boolean;session:MobileSession;classId:string;published:PublishedTimetable|null;onSaved:()=>void}) {
  const [editing,setEditing]=useState(!published && teacher),[title,setTitle]=useState(published?.title ?? 'Weekly timetable'),[slots,setSlots]=useState<TimetableSlot[]>(published?.slots ?? []);
  const [day,setDay]=useState(1),[start,setStart]=useState('08:00'),[end,setEnd]=useState('09:00'),[subject,setSubject]=useState(''),[room,setRoom]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const publish=async()=>{setBusy(true);setError('');try{validateTimetable({title,slots,expectedVersion:published?.version ?? 0});await mobileApi.publishTimetable(session,{classId,title,slots,expectedVersion:published?.version ?? 0});onSaved();}catch(failure){setError(errorText(failure));}finally{setBusy(false);}};
  const add=()=>{try{const next=validateTimetable({title,expectedVersion:0,slots:[...slots,{day,start,end,subject,room}]});setSlots(next);setSubject('');setError('');}catch(failure){setError(errorText(failure));}};
  return <>
    <Panel><Text style={s.heading}>{published?.title ?? 'No timetable published yet'}</Text><Text style={s.body}>{published ? `Published ${new Date(published.publishedAt).toLocaleString()} · Version ${published.version}` : teacher ? 'Create a weekly schedule for this class.' : 'Your teacher has not published a timetable for this class yet.'}</Text>{teacher && !editing && <Button label="Update timetable" onPress={()=>setEditing(true)}/>}</Panel>
    {editing && <Panel><Input label="Timetable title" value={title} onChange={setTitle}/><Text style={s.label}>Add a lesson · day</Text><View style={s.wrap}>{days.map((name,index)=><Pressable key={name} accessibilityRole="button" accessibilityState={{selected:day===index+1}} onPress={()=>setDay(index+1)} style={[s.chip,day===index+1 && s.selected]}><Text style={s.link}>{name.slice(0,3)}</Text></Pressable>)}</View><Input label="Start (HH:mm)" value={start} onChange={setStart} maxLength={5}/><Input label="End (HH:mm)" value={end} onChange={setEnd} maxLength={5}/><Input label="Subject" value={subject} onChange={setSubject}/><Input label="Room (optional)" value={room} onChange={setRoom} maxLength={100}/><Button label="Add lesson" onPress={add}/></Panel>}
    {(editing ? slots : published?.slots ?? []).map((slot,index)=><Panel key={`${slot.day}:${slot.start}:${index}`}><Text style={s.label}>{days[slot.day-1]} · {slot.start}–{slot.end}</Text><Text style={s.heading}>{slot.subject}</Text>{slot.room ? <Text style={s.body}>{slot.room}</Text> : null}{editing && <Button label="Remove lesson" onPress={()=>setSlots((rows)=>rows.filter((_,i)=>i!==index))}/>}</Panel>)}
    {error ? <Text style={s.error}>{error}</Text> : null}
    {editing && <><Text style={s.body}>This replaces the class’s current weekly timetable for all linked parents. Times are the school’s local time. Conflicting concurrent edits are rejected; refresh before retrying.</Text><Button label={busy ? 'Publishing…' : 'Publish timetable to parents'} disabled={busy || !slots.length} onPress={()=>{void publish();}}/>{published && <Button label="Cancel editing" disabled={busy} onPress={()=>{setEditing(false);setSlots(published.slots);setTitle(published.title);setError('');}}/>}</>}
  </>;
}

export function ResultBars({points,teacher}:{points:ResultChartPoint[];teacher:boolean}) {
  return <Panel><Text style={s.heading}>{teacher ? 'Class average scores' : 'Your child’s scores'}</Text><Text style={s.body}>Percentages use recorded numeric marks, not PDF/image attachments. Each bar represents an exam and subject; these are not class ranks.</Text>{!points.length && <Text style={s.body}>No numeric result data yet. Uploaded result documents remain in Posts. New numeric results and Excel result imports will appear here.</Text>}{points.map((point)=><View key={`${point.examName}:${point.subjectName}`} style={s.gap} accessible accessibilityLabel={`${point.examName}, ${point.subjectName}, ${point.percentage.toFixed(1)} percent, ${point.count} recorded scores`}><Text style={s.label}>{point.examName} · {point.subjectName}</Text><View style={s.track}><View style={[s.bar,{width:`${Math.max(0,Math.min(100,point.percentage))}%`}]}/></View><Text style={s.body}>{point.percentage.toFixed(1)}% · {point.count} recorded score{point.count===1 ? '' : 's'}{point.resultDate ? ` · ${point.resultDate}` : ''}</Text></View>)}</Panel>;
}
function ScoreForm({session,assignment,roster,onSaved}:{session:MobileSession;assignment:ApiTeachingAssignment;roster:ApiRosterStudent[];onSaved:()=>void}) {
  const [student,setStudent]=useState(''),[exam,setExam]=useState(''),[subject,setSubject]=useState(assignment.subjectName),[marks,setMarks]=useState(''),[maximum,setMaximum]=useState('100'),[date,setDate]=useState(today),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const retry=useRef<{payload:string;key:string}|null>(null);
  const publish=async()=>{setBusy(true);setError('');try{
    if(!student || !exam.trim() || !subject.trim() || !marks.trim() || !maximum.trim()) throw Error('COMPLETE_REQUIRED_FIELDS');
    const payload={classId:assignment.classId,studentId:student,examName:exam.trim(),subjectName:subject.trim(),marksObtained:Number(marks),maxMarks:Number(maximum),resultDate:date};
    const serialized=JSON.stringify(payload);if(retry.current?.payload!==serialized)retry.current={payload:serialized,key:randomUUID()};
    await mobileApi.recordResultScore(session,{...payload,idempotencyKey:retry.current!.key});onSaved();
  }catch(failure){setError(errorText(failure));}finally{setBusy(false);}};
  return <Panel><Text style={s.heading}>Publish numeric result</Text><Text style={s.body}>Private to the selected student’s guardians. Publishes a result post and updates charts.</Text><Text style={s.label}>Student</Text>{roster.map((row)=><Pressable key={row.id} accessibilityRole="radio" accessibilityState={{checked:student===row.id}} onPress={()=>setStudent(row.id)} style={[s.chip,student===row.id && s.selected]}><Text style={s.label}>{student===row.id ? '● ' : '○ '}{row.displayName}</Text></Pressable>)}<Input label="Exam name" value={exam} onChange={setExam}/><Input label="Subject name" value={subject} onChange={setSubject}/><Input label="Marks obtained" value={marks} onChange={setMarks} numeric/><Input label="Maximum marks" value={maximum} onChange={setMaximum} numeric/><Input label="Result date (YYYY-MM-DD)" value={date} onChange={setDate} maxLength={10}/>{error ? <Text style={s.error}>{error}</Text> : null}<Button label={busy ? 'Publishing…' : 'Publish private result'} disabled={busy || !student} onPress={()=>{void publish();}}/></Panel>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:colors.surface},page:{padding:20,paddingBottom:44,gap:16},title:{fontFamily:'Poppins_600SemiBold',fontSize:25,color:colors.ink},heading:{fontFamily:'Poppins_600SemiBold',fontSize:17,color:colors.ink},label:{fontFamily:'Poppins_500Medium',fontSize:14,color:colors.ink},body:{fontFamily:'Poppins_400Regular',fontSize:13,lineHeight:21,color:colors.muted},link:{fontFamily:'Poppins_500Medium',fontSize:13,color:colors.primary},card:{padding:18,gap:12,borderRadius:20,backgroundColor:colors.primarySoft},input:{borderWidth:1,borderColor:'#D8D2E1',borderRadius:14,backgroundColor:'#FFF',padding:12,fontFamily:'Poppins_400Regular',fontSize:14,color:colors.ink},button:{backgroundColor:colors.primary,borderRadius:14,padding:13,alignItems:'center'},buttonText:{color:'#FFF',fontFamily:'Poppins_500Medium',fontSize:13},error:{color:colors.danger,fontSize:13},gap:{gap:7},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},chip:{padding:12,borderWidth:1,borderColor:'#D8D2E1',borderRadius:12,backgroundColor:'#FFF'},selected:{borderColor:colors.primary,borderWidth:2},track:{height:20,borderRadius:6,backgroundColor:'#E0D4F1',overflow:'hidden'},bar:{height:20,backgroundColor:colors.primary}});
