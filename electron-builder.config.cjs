module.exports = {
  appId: 'local.paperdesk.pdf', productName: 'Paperdesk PDF',
  directories: { output: 'release' },
  files: ['dist/**/*', 'electron/**/*', 'package.json', '!node_modules/**/*'],
  asar: true,
  forceCodeSigning: process.env.PAPERDESK_REQUIRE_SIGNING === '1',
  win: { target: ['nsis', 'portable'], icon: 'public/app-icon.ico', signAndEditExecutable: true },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, shortcutName: 'Paperdesk PDF', artifactName: 'Paperdesk-PDF-Setup-${version}.exe' },
  portable: { artifactName: 'Paperdesk-PDF-${version}.exe' },
  fileAssociations: [{ ext: 'pdf', name: 'PDF document', role: 'Editor', icon: 'public/app-icon.ico' }],
};
