import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import type { ApiRosterStudent } from './api';
import { colors } from './theme';

export function ResultStudentPicker({ students, selectedId, disabled = false, onSelect }: { students: ApiRosterStudent[]; selectedId: string; disabled?: boolean; onSelect: (id: string) => void }) {
  return <View style={styles.list} accessibilityLabel="Choose one student for this result">
    {students.map(student => <Pressable key={student.id} accessibilityRole="radio" accessibilityLabel={`${student.displayName}, admission ${student.admissionNumber || 'not available'}`} accessibilityState={{ checked: selectedId === student.id, disabled }} disabled={disabled} onPress={() => { if (!disabled && selectedId !== student.id) onSelect(student.id); }} style={[styles.row, selectedId === student.id && styles.active]}>
      <View style={[styles.checkbox, selectedId === student.id && styles.checked]}>{selectedId === student.id && <Check size={15} color="#fff" />}</View>
      <View style={styles.identity}>
        <Text style={styles.name} numberOfLines={2} ellipsizeMode="tail" textBreakStrategy="simple">{student.displayName}</Text>
        <Text style={styles.admission}>Admission no. {student.admissionNumber || 'not available'}</Text>
      </View>
    </Pressable>)}
  </View>;
}
const styles = StyleSheet.create({
  list: { gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  active: { borderColor: colors.primary, backgroundColor: colors.background },
  checkbox: { width: 24, height: 24, flexShrink: 0, borderRadius: 7, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checked: { borderColor: colors.primary, backgroundColor: colors.primary },
  identity: { flex: 1, minWidth: 0 },
  name: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: colors.ink },
  admission: { fontFamily: 'Poppins_400Regular', fontSize: 11, lineHeight: 17, color: colors.muted, marginTop: 3 },
});
