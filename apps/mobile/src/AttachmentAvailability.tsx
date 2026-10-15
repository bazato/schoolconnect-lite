import { Pressable, StyleSheet, Text, View } from 'react-native';
import { attachmentsDisabledMessage } from './attachmentUpload';
import { colors } from './theme';

export function AttachmentAvailability({ state, onRetry }: { state: 'checking' | 'disabled' | 'error'; onRetry: () => void }) {
  return <View accessibilityRole="alert" style={styles.panel}>
    <Text style={styles.title}>{state === 'checking' ? 'Checking upload availability…' : state === 'disabled' ? 'Document uploads unavailable' : 'Unable to check upload availability'}</Text>
    <Text style={styles.body}>{state === 'disabled' ? attachmentsDisabledMessage : state === 'error' ? 'The upload service could not be reached. Your draft is safe. Please retry; files cannot be published until availability is confirmed.' : 'Please wait before choosing a private attachment.'}</Text>
    {state !== 'checking' && <Pressable accessibilityRole="button" accessibilityLabel="Check upload availability again" onPress={onRetry}><Text style={styles.link}>Check again</Text></Pressable>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { padding: 16, borderRadius: 16, backgroundColor: colors.primarySoft, gap: 8 },
  title: { fontFamily: 'Poppins_600SemiBold', color: colors.ink, fontSize: 14 },
  body: { fontFamily: 'Poppins_400Regular', color: colors.muted, fontSize: 12, lineHeight: 19 },
  link: { fontFamily: 'Poppins_500Medium', color: colors.primary, fontSize: 13, paddingVertical: 8 },
});
