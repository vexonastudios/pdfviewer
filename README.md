# Paperdesk PDF

A local Windows Electron app for viewing PDFs, filling standard forms, placing text, checkmarks, and ink-image signatures, and making filled copies in bulk. Documents and pasted data are processed on your computer. No account, API key, or server is required.

## Run the app

Download the Windows installer or portable executable from [GitHub Releases](https://github.com/vexonastudios/pdfviewer/releases/latest). The installer adds a Start menu shortcut; the portable app runs directly. Current builds are unsigned, so Windows may show a publisher warning. For a local build, run the commands under [Development](#development), then open the executable in `release/`.

Releases contain only the application code and bundled open-source assets. Your PDFs, editable workspaces, pasted data, saved signatures, and initials remain on your computer and are excluded from this source repository and release builds.

Version 1.1.0 adds crash recovery, encrypted save history, optional password-protected workspaces, final-PDF preview and checks, local English OCR, printing, page extraction/reordering/rotation and PDF merging. Existing workspaces remain compatible. Help includes a manual update check against the official GitHub release page; it sends no document content.

## Everyday use

1. Click **Open PDF**, or drag a PDF onto the window. **Try a practice form** provides a sample.
2. Fill existing fields directly on the page or in the Fields panel. Use **Add text** or **Checkmark** on flat/scanned forms. Select an added item to edit it, change its size, or drag it into position.
3. To sign a fillable signature box, click **Sign here** and choose the saved signer. Paperdesk places the signature, the printed name when requested, and the signing date. The **Today** button also fills a signing date on its own. To create a saved signature, click **Sign**, then draw it or choose **Import a photo**. Each person should review the form and place their own signature.
4. To initial a HSEGH report, click **Initial** and have each caregiver draw or import their own initials. Click **Initial** above a caregiver blank at the bottom of a page. Choose **Initial here** for that page, or **All pages** after reviewing the complete report. The form's last page has separate parent signature lines.
5. Click **Save** (or Ctrl+S) while working. An opened `.paperdesk.json` workspace saves back to that same file; the first Save from a PDF asks where to create a workspace. This draft retains the original PDF, field values, and movable additions. Workspace files contain your document and entered information, including placed signature images; store them like the original PDF.
6. When the form is final, click **Export final PDF**. Paperdesk checks field fit, page edges and blanks, then shows the actual output. Review every page, confirm any remaining blanks are intentional, and export. The Save dialog starts in a **Final PDFs** folder beside the draft, with a `-final.pdf` filename. Flattening removes interactive form fields but does not make a PDF tamper-proof. View-only documents are preserved and labeled `-copy.pdf` instead.

For a group of forms, click **Open packet** and select their folder. Paperdesk lists PDFs and saved workspaces in that folder and its subfolders, preferring an editable workspace when it sits beside its source PDF. Review each document, Save any changes, then click **Mark reviewed**. The queue shows obvious blank required fields, signing dates, signature lines, and caregiver initials as prompts; it cannot decide which agency-only sections apply to you. **Export reviewed finals** writes the marked forms to one **Final PDFs** folder in the selected packet folder with distinct names. Opening the folder again shows finals that are newer than their workspaces.

Saved signatures and initials are protected with Windows user encryption in `%APPDATA%\Paperdesk PDF\signatures.enc`. Paperdesk migrates an existing `signatures.json` library on first use and removes the old plaintext file after a successful migration. The encrypted library is tied to your Windows account; keep your original signed PDFs or a separate backup if you move to another computer. Imported photos are cleaned in memory; Paperdesk stores only the cropped transparent PNG. These ink images are visual marks, not certificate-backed digital signatures. Editable `.paperdesk.json` workspaces still contain your PDF, answers, and placed marks in ordinary JSON, so store them like other sensitive documents.

When you resize a placed saved signature, Paperdesk remembers that width for that signer’s next placement. A smaller signature box still limits the size so the ink fits. This preference stays on this computer with the saved signature.

**Save** updates an opened workspace; exporting creates a separate PDF and does not mark the draft as saved. Closing or replacing an edited document offers **Save first**. After a short pause in editing, a separate recovery snapshot is encrypted with Windows account encryption. An interrupted session offers recovered drafts when reopened; Help also opens recovery drafts. Recovery failure is displayed in the status bar. Recovery is a fallback and may omit the most recent few seconds of changes.

**Tools → Restore saved version** opens the previous five saved versions of each workspace (up to 100 versions overall). These backups are encrypted for the Windows account and remain on the computer. Restoring opens a separate draft and asks where to save it.

**Tools → Protect workspace** saves a portable encrypted draft using AES-256-GCM with a PBKDF2-SHA-256 password key (310,000 iterations). Its password is needed on any computer and cannot be recovered by Paperdesk. Subsequent Save operations keep that protection. Legacy ordinary-JSON workspaces remain readable; use Protect workspace to convert them. Older unprotected copies and exported PDFs retain their existing protection. Recovery/history use Windows encryption independently of a workspace password.

## PDF tools

- **Print** (Ctrl+P) opens the Windows print dialog using rendered pages, including current answers and placed marks. Printing uses raster images at up to 144 DPI. Review the printer's page and scaling settings. If Windows leaves a session pending after canceling, **End print session** releases it while keeping your document open.
- **Arrange/extract pages** accepts ranges and individual pages, such as `1-3, 5, 4` or `5-1`. Rotation is applied to the output pages. Omitted pages are excluded from the new copy. **Append PDFs** adds files in the displayed order. Page operations create a separate PDF with current form values flattened; save the editable draft first. Protected, digitally signed and unsupported PDFs cannot be rearranged or appended.
- **Recognize text** uses the bundled Tesseract English model locally, without a download or cloud OCR service. Choose all pages or a range. Text and confidence estimates can be copied, saved in a workspace and searched inside Paperdesk. Recognition can be canceled and may contain mistakes. OCR does not create fillable fields or embed a searchable text layer in exported PDFs.
- Packet export checks and prepares all selected outputs before writing. It rolls back output changes if committing the packet fails and writes `packet-manifest.json` with filenames, output modes and SHA-256 hashes. This manifest stays with the local finals; it contains no field values. Preview and checks are aids, not a determination that a legal or agency form is complete.

## Using this chat to help fill forms

1. Open the PDF and choose **Bulk fill**.
2. Click **Prepare this form with ChatGPT**. It copies field names, types, and allowed choices, without current field values.
3. Paste that field list into your Codex/ChatGPT conversation along with the information to use. Ask for a JSON object using the exact field names, or a JSON array for multiple records.
4. Paste the response into Bulk fill, select **Review field matches**, check the mapping, and apply it. Unmatched columns are skipped until manually mapped. Missing data is not guessed.

This is a copy/paste workflow with the chat. The app has no built-in model, model connection, or automatic access to your chats. Anything you paste into a chat is shared with that chat service.

Bulk fill also accepts `Field: value` lines and CSV/tab-separated tables with headers. Quoted CSV values, multiline CSV cells, and leading zeros are preserved. Checkboxes accept true/false or yes/no. Choice values must match an allowed option. Multiple records produce a ZIP containing one PDF per record (up to 200 records / 300 MB per batch). **Flatten batch PDFs for sharing** is selected by default; clear it if recipients need editable form fields. Unmapped fields retain their current values.

For a flat form, place text boxes first, give them unique field names, and save a workspace to reuse the layout. They can then be mapped in Bulk fill, just like existing PDF fields.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Open | Ctrl+O |
| Save editable work | Ctrl+S |
| Find document text | Ctrl+F |
| Undo / redo | Ctrl+Z / Ctrl+Y (outside text inputs) |
| Previous / next page | Left / right arrow (outside inputs) |
| Remove selected addition | Delete |
| Cancel placement | Escape |

Rotation changes the viewing orientation, not the original page rotation. Text placed in a rotated view retains its intended orientation when exported.

## Current limits

- Standard AcroForm text, checkbox, radio, dropdown, and list fields are supported. Encrypted PDFs, XFA forms, and documents with existing digital signatures are view-only. PDF scripts and calculations are not executed.
- Text and ink can be placed over scanned pages. English OCR supports local copying and search. Paperdesk detects some flat signature lines and the caregiver initials footer on Form K-908-2649; other unrecognized lines can be filled with the toolbar tools.
- No existing-page text editing, secure redaction, certificate-based PDF signing, or searchable-PDF OCR export.
- The bundled Noto Sans font supports many alphabets, but not all scripts or emoji. Export reports unsupported characters instead of silently substituting them. Long answers shrink only to a readable size; if they still cannot fit, export asks you to shorten them.
- Added text, checkmarks, and signatures are permanent in exported PDFs. Retain a workspace for future editing.
- Individual files are limited to 300 MB. Complex PDFs may take longer to render.

## Development

Requires Node.js 22.12 or later.

```powershell
npm ci
npm run build
npm start
npm test
npm run package
```

For browser development use `npm run dev -- --port 5184`. The browser preview uses downloads instead of native Windows dialogs. All fonts, PDF.js workers, CMaps, and rendering assets are bundled in the built app; no CDN is used.

Automated Windows builds run through GitHub Actions. `npm run test:ui` runs five browser workflow tests against a built app, including recovery, Save first, final output preview, page arrangement, offline OCR, and keyboard navigation at a smaller size. Run `npx playwright install chromium` once to prepare that test browser. See [release and signing instructions](docs/RELEASING.md). Signing credentials belong in local environment settings or GitHub Secrets, never in source control. Accessibility improvements include larger controls, keyboard focus, modal focus trapping, reduced motion and layouts for smaller windows; screen-reader behavior still needs testing with users and does not imply accessibility certification.

`npm test` covers bulk parsing/mapping, PDF value round trips, appearances, flattening, independent records, Unicode validation, signature image export and photo cleanup, native file-operation handlers, local protocol boundaries, and unsaved-change handling. Test artifacts are written to `tmp/qa`.

PDF rendering uses [Mozilla PDF.js](https://mozilla.github.io/pdf.js/). PDF writing uses [pdf-lib](https://pdf-lib.js.org/). The local desktop protocol follows the [Electron protocol API](https://www.electronjs.org/docs/latest/api/protocol/). Noto Sans is licensed under the SIL Open Font License; its license is included in `public/fonts`.
