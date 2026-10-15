/* global require, module */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Expo loads local config plugins through CommonJS.
const { withAppBuildGradle } = require('expo/config-plugins');

const begin = '// nexqon-release-signing:start';
const end = '// nexqon-release-signing:end';

function patchReleaseSigning(contents) {
  const start = contents.indexOf(begin);
  if (start !== -1) {
    const finish = contents.indexOf(end, start);
    if (finish === -1) throw new Error('Incomplete Nexqon signing block');
    contents = contents.slice(0, start) + contents.slice(finish + end.length);
  }
  // Override Expo's generated debug signing only for release. No secrets are
  // serialized into native files or Expo's public app configuration.
  return contents.trimEnd() + '\n\n' + `${begin}
def nexqonSigning = [
    file: System.getenv('NEXQON_ANDROID_STORE_FILE'),
    password: System.getenv('NEXQON_ANDROID_STORE_PASSWORD'),
    alias: System.getenv('NEXQON_ANDROID_KEY_ALIAS'),
    keyPassword: System.getenv('NEXQON_ANDROID_KEY_PASSWORD')
]
def nexqonHasSigning = nexqonSigning.values().every { it != null && !it.trim().isEmpty() }
android.buildTypes.release.signingConfig = null
if (nexqonHasSigning) {
    android.signingConfigs.create('nexqonRelease') {
        storeFile file(nexqonSigning.file)
        storePassword nexqonSigning.password
        keyAlias nexqonSigning.alias
        keyPassword nexqonSigning.keyPassword
    }
    android.buildTypes.release.signingConfig = android.signingConfigs.nexqonRelease
}
gradle.taskGraph.whenReady { graph ->
    def needsRelease = graph.allTasks.any { it.project == project && it.name.toLowerCase().contains('release') }
    if (needsRelease) {
        if (!nexqonHasSigning) throw new GradleException('Permanent Android release signing credentials are required; debug fallback is forbidden.')
        if (!new File(nexqonSigning.file).isFile()) throw new GradleException('Android release keystore not found.')
        def api = System.getenv('EXPO_PUBLIC_API_URL') ?: ''
        if (!api.startsWith('https://')) throw new GradleException('Release requires an explicit HTTPS API URL.')
        if (System.getenv('EXPO_PUBLIC_DEMO_MODE') != 'false') throw new GradleException('Release requires EXPO_PUBLIC_DEMO_MODE=false.')
    }
}
${end}\n`;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, mod => {
    if (mod.modResults.language !== 'groovy') throw new Error('Nexqon signing requires Groovy app build.gradle');
    mod.modResults.contents = patchReleaseSigning(mod.modResults.contents);
    return mod;
  });
};
module.exports.patchReleaseSigning = patchReleaseSigning;
