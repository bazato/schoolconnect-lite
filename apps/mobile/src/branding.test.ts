import { describe, expect, it } from 'vitest';
import appConfig from '../app.json';

describe('Nexqon app branding', () => {
  it('uses the requested display name and a custom launcher icon', () => {
    expect(appConfig.expo.name).toBe('Nexqon School App');
    expect(appConfig.expo.icon).toBe('./assets/nexqon-icon.png');
    expect(appConfig.expo.android.adaptiveIcon.foregroundImage).toBe(appConfig.expo.icon);
    expect(appConfig.expo.web.favicon).toBe(appConfig.expo.icon);
    expect(appConfig.expo.plugins).toContainEqual(['expo-splash-screen', {
      image: appConfig.expo.icon, imageWidth: 200, resizeMode: 'contain', backgroundColor: '#5D08C9',
    }]);
  });

  it('preserves installed app identity and advances the preview version', () => {
    expect(appConfig.expo.android.package).toBe('com.schoolconnect.lite');
    expect(appConfig.expo.ios.bundleIdentifier).toBe('com.schoolconnect.lite');
    expect(appConfig.expo.scheme).toBe('schoolconnect');
    expect(appConfig.expo.android.versionCode).toBeGreaterThan(1);
  });
});
