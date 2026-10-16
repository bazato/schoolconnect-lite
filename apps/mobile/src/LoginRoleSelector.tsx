import { Pressable, Text, View } from 'react-native';
import type { Role } from './domain';
import { colors } from './theme';
const labels:Record<Role,string>={PARENT:'Parent',TEACHER:'Teacher',SCHOOL_ADMIN:'School administrator',PLATFORM_OWNER:'Platform owner'};
export function LoginRoleSelector({value,onChange,disabled=false}:{value:Role;onChange:(role:Role)=>void;disabled?:boolean}) {
  return <View accessibilityLabel="Sign in as" style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['PARENT','TEACHER','SCHOOL_ADMIN','PLATFORM_OWNER'] as Role[]).map((role)=><Pressable key={role} accessibilityRole="radio" accessibilityLabel={labels[role]} accessibilityState={{checked:value===role,disabled}} disabled={disabled} onPress={()=>{if(!disabled)onChange(role);}} style={{padding:10,borderRadius:10,backgroundColor:value===role?colors.primarySoft:colors.surface}}><Text style={{fontFamily:'Poppins_500Medium',color:colors.primary}}>{labels[role]}</Text></Pressable>)}</View>;
}
