import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MobileSession } from './api';
import type { Role } from './domain';
import { colors } from './theme';
const labels:Record<Role,string>={PARENT:'Parent',TEACHER:'Teacher',SCHOOL_ADMIN:'School administrator',PLATFORM_OWNER:'Platform owner'};
export function VerifiedWorkspacePicker({session,busy,error,onChoose,onCancel,cancelLabel='Sign out'}:{session:MobileSession;busy:boolean;error:string;onChoose:(membershipId:string)=>void;onCancel:()=>void;cancelLabel?:string}) {
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
    <Text style={s.title}>Choose your workspace</Text>
    <Text style={s.body}>Your verified number has multiple linked accounts. Choose the workspace to open.</Text>
    {session.memberships.map((membership,index)=><Pressable key={membership.id} accessibilityRole="button" disabled={busy} onPress={()=>onChoose(membership.id)} style={[s.card,busy && {opacity:.5}]}>
      <Text style={s.label}>{labels[membership.role]}</Text><Text style={s.body}>{membership.schoolName ?? (membership.schoolId ? `School account ${index+1}` : 'Platform workspace')}</Text>
    </Pressable>)}
    {busy && <ActivityIndicator color={colors.primary}/>}
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    <View><Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={s.card}><Text style={s.label}>{cancelLabel}</Text></Pressable></View>
  </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:colors.background},page:{padding:24,paddingVertical:40,gap:16},title:{fontFamily:'Poppins_600SemiBold',fontSize:25,color:colors.ink},body:{fontFamily:'Poppins_400Regular',fontSize:14,lineHeight:23,color:colors.muted},label:{fontFamily:'Poppins_600SemiBold',fontSize:17,color:colors.primary},card:{padding:20,borderRadius:18,gap:6,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},error:{fontFamily:'Poppins_400Regular',fontSize:13,color:colors.danger}});
