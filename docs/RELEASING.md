# Windows releases

1. Update `package.json`, `package-lock.json`, the app's version label and release notes together.
2. Run `npm ci`, `npm test`, and `npm run package` on Windows. The build prepares all PDF/OCR resources and creates the app icon from the checked-in SVG.
3. Test the portable app with synthetic PDFs: edit/save/reopen, wrong-password rejection, recovery, final preview, cancel printing, arrange/merge and local OCR. Verify the installer in a clean Windows test account before broad distribution.
4. Check `release/` contains only application installers and portable builds. Verify hashes and inspect Authenticode status before uploading. Documents, workspaces and signatures are excluded by the build allowlist.
5. A `v*` tag triggers the Windows workflow, tests, builds, checksum creation and GitHub release publication. Do not publish a second release for a tag that already exists.

## Publisher signing

The repository is ready for signing but does not include an identity or certificate. Publisher signing requires an externally verified certificate/provider account. The source must never contain a private key or its password.

For certificate-based signing, configure `CSC_LINK` (certificate path or base64 certificate) and `CSC_KEY_PASSWORD` locally. GitHub builds use the `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD` repository secrets. Set repository variable `PAPERDESK_REQUIRE_SIGNING` to `1` after provisioning signing; the build then fails rather than releasing unsigned binaries. Without a credential, builds are unsigned and must be described that way.

Official setup: [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing), [electron-builder Windows signing](https://www.electron.build/docs/features/code-signing/code-signing-win/).

Verify with PowerShell:

```powershell
Get-AuthenticodeSignature release/*.exe | Select-Object Path, Status, SignerCertificate
Get-FileHash release/*.exe -Algorithm SHA256
```

The app's Help menu offers a user-initiated update check. It checks only the official GitHub repository and opens the official download page; it does not silently install executables.
