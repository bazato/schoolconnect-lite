import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import type { ApiTeachingAssignment } from './api';
import { colors, radius } from './theme';

function PrimaryButton({ label, onPress, disabled, loading, secondary }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled || loading} onPress={onPress} style={[styles.button, secondary && { backgroundColor: colors.primarySoft }]}>
    <Text style={[styles.buttonText, secondary && { color: colors.primary }]}>{loading ? 'Saving…' : label}</Text>
  </Pressable>;
}

export function TeachingClassSelector({ scope, selected, onSelect, schoolName, disabled = false, confirmSelection }: { scope: ApiTeachingAssignment[]; selected?: ApiTeachingAssignment; onSelect: (id: string) => void | Promise<void>; schoolName: string; disabled?: boolean; confirmSelection?: string }) {
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const choose = async (id: string) => {
    if (disabled || choosing) return;
    setChoosing(true); setSelectionError('');
    try { await onSelect(id); setOpen(false); setPendingId(''); }
    catch (failure) { setSelectionError(failure instanceof Error ? failure.message : 'CLASS_SWITCH_FAILED'); }
    finally { setChoosing(false); }
  };
  return <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 6 }}>
    <Text style={styles.schoolName} numberOfLines={2} ellipsizeMode="tail" textBreakStrategy="simple">{schoolName || 'Your school'}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Select teaching class and subject" accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => { setPendingId(''); setSelectionError(''); setOpen(true); }} style={styles.scopeCard}>
      <View style={styles.flex}><Text style={styles.scopeTitle} numberOfLines={1}>{selected?.className ?? 'No assigned classes'}</Text><Text style={styles.scopeMeta} numberOfLines={1}>{selected?.subjectName ?? 'Ask your school administrator for an assignment'} · {scope.length} assignment{scope.length === 1 ? '' : 's'}</Text></View><ChevronDown size={20} color={colors.primary} />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => { if (!choosing) setOpen(false); }}>
      <View style={styles.selectorBackdrop}><View style={styles.selectorPanel}>
        <View style={styles.inline}><Text style={[styles.sectionTitle, styles.flex]}>Select class and subject</Text><Pressable disabled={choosing} accessibilityRole="button" accessibilityLabel="Close class selector" onPress={() => setOpen(false)}><Text style={styles.linkInline}>Close</Text></Pressable></View>
        {selectionError ? <Text style={styles.errorText}>{selectionError}</Text> : null}
        {pendingId ? <View style={{ gap: 12 }}>
          <Text style={styles.cardBody}>{confirmSelection}</Text>
          <PrimaryButton label="Switch class" loading={choosing} disabled={disabled || choosing} onPress={() => { void choose(pendingId); }} />
          <PrimaryButton label="Keep current class" secondary disabled={choosing} onPress={() => setPendingId('')} />
        </View> :
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10 }}>
          {scope.map((item) => <Pressable key={item.assignmentId} disabled={disabled || choosing} accessibilityRole="button" accessibilityLabel={`${item.className}, ${item.subjectName}`} accessibilityState={{ selected: item.assignmentId === selected?.assignmentId, disabled: disabled || choosing }} onPress={() => { if (item.assignmentId === selected?.assignmentId) { setOpen(false); return; } if (confirmSelection) setPendingId(item.assignmentId); else void choose(item.assignmentId); }} style={[styles.scopeCard, item.assignmentId === selected?.assignmentId && { borderColor: colors.primary }]}>
            <View style={styles.flex}><Text style={styles.scopeTitle} numberOfLines={2}>{item.className}</Text><Text style={styles.scopeMeta} numberOfLines={1}>{item.subjectName}</Text></View>{item.assignmentId === selected?.assignmentId && <Check size={20} color={colors.primary} />}
          </Pressable>)}
          {scope.length < 2 && <Text style={styles.cardBody}>{scope.length ? 'Only one assignment is available for this action. Ask your administrator to check class assignments and permissions.' : 'No assignment is available for this action. Ask your administrator to check class assignments and permissions.'}</Text>}
        </ScrollView>}
      </View></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, color: colors.ink, marginTop: 4 },
  schoolName: { fontFamily: 'Poppins_500Medium', fontSize: 13, lineHeight: 20, letterSpacing: 0, color: colors.primary, flexShrink: 1, minWidth: 0 },
  scopeCard: { minHeight: 83, borderRadius: radius.card, padding: 16, backgroundColor: colors.primarySoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: 'transparent' },
  scopeTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, color: colors.ink },
  scopeMeta: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: colors.muted, marginTop: 2 },
  linkInline: { fontFamily: 'Poppins_500Medium', fontSize: 12, color: colors.primary },
  cardBody: { fontFamily: 'Poppins_400Regular', fontSize: 12, lineHeight: 19, color: colors.muted },
  errorText: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: colors.danger },
  selectorBackdrop: { flex: 1, backgroundColor: '#22143680', justifyContent: 'center', padding: 20 },
  selectorPanel: { backgroundColor: colors.surface, borderRadius: 18, padding: 18, gap: 14, maxHeight: '75%' },
  button: { borderRadius: radius.button, padding: 14, backgroundColor: colors.primary, alignItems: 'center' },
  buttonText: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#fff' },
});
