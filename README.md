# Paperdesk PDF

A local Windows Electron app for viewing PDFs, filling standard forms, placing text, checkmarks, and ink-image signatures, and making filled copies in bulk. Documents and pasted data are processed on your computer. No account, API key, or server is required.

## Run the app

For a local Windows build, run the commands under [Development](#development), then open the portable executable in `release/`. Alternatively, keep the entire `release/win-unpacked` folder together and open `Paperdesk PDF.exe` inside it. The build is unsigned. Generated executables and document data are excluded from this source repository.

Version 1.0.4 includes separate locally saved initials, HSEGH caregiver initials targets, and printed-name placement beside flat-form signatures. Existing workspaces remain compatible.

## Everyday use

1. Click **Open PDF**, or drag a PDF onto the window. **Try a practice form** provides a sample.
2. Fill existing fields directly on the page or in the Fields panel. Use **Add text** or **Checkmark** on flat/scanned forms. Select an added item to edit it, change its size, or drag it into position.
3. To sign a fillable signature box, click **Sign here** and choose the saved signer. Paperdesk places the signature, the printed name when requested, and the signing date. The **Today** button also fills a signing date on its own. To create a saved signature, click **Sign**, then draw it or choose **Import a photo**. Each person should review the form and place their own signature.
4. To initial a HSEGH report, click **Initial** and have each caregiver draw or import their own initials. Click **Initial** above a caregiver blank at the bottom of a page. Choose **Initial here** for that page, or **All pages** after reviewing the complete report. The form's last page has separate parent signature lines.
5. Click **Save** (or Ctrl+S) while working. An opened `.paperdesk.json` workspace saves back to that same file; the first Save from a PDF asks where to create a workspace. This draft retains the original PDF, field values, and movable additions. Workspace files contain your document and entered information, including placed signature images; store them like the original PDF.
6. When the form is final, click **Export final PDF**, then **Export flattened PDF**. The Save dialog starts in a **Final PDFs** folder beside the draft, with a `-final.pdf` filename. This makes one share-ready PDF per form. Flattening removes interactive form fields, but does not make a PDF tamper-proof against deliberate editing with PDF software.

Saved signatures and initials are kept separately in `%APPDATA%\Paperdesk PDF\signatures.json` on this computer. Imported photos are cleaned in memory; Paperdesk stores only the cropped transparent PNG. These ink images are visual marks, not certificate-backed digital signatures.

When you resize a placed saved signature, Paperdesk remembers that width for that signer’s next placement. A smaller signature box still limits the size so the ink fits. This preference stays on this computer with the saved signature.

The app does not save silently. It warns before replacing a document with unsaved edits or closing with changes. **Save** updates an opened workspace; exporting creates a separate PDF and does not mark the draft as saved.

## Using this chat to help fill forms

1. Open the PDF and choose **Bulk fill**.
2. Click **Prepare this form with ChatGPT**. It copies field names, types, and allowed choices, without current field values.
3. Paste that field list into your Codex/ChatGPT conversation along with the information to use. Ask for a JSON object using the exact field names, or a JSON array for multiple records.
4. Paste the response into Bulk fill, select **Review field matches**, check the mapping, and apply it. Unmatched columns are skipped until manually mapped. Missing data is not guessed.

This is a copy/paste workflow with the chat. The app has no built-in model, model connection, or automatic access to your chats. Anything you paste into a chat is shared with that chat service.

Bulk fill also accepts `Field: value` lines and CSV/tab-separated tables with headers. Quoted CSV values, multiline CSV cells, and leading zeros are preserved. Checkboxes accept true/false or yes/no. Choice values must match an allowed option. Multiple records produce a ZIP containing one PDF per record (up to 200 records / 300 MB per batch). Unmapped fields retain their current values.

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
- Text and ink can be placed over scanned pages. OCR is not included. Paperdesk detects some flat signature lines and the caregiver initials footer on Form K-908-2649; other unrecognized lines can be filled with the toolbar tools.
- No existing-page text editing, page reordering, redaction, certificate signing, or built-in printing in this first version.
- The bundled Noto Sans font supports many alphabets, but not all scripts or emoji. Export reports unsupported characters instead of silently substituting them. Review long values for fit.
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

`npm test` covers bulk parsing/mapping, PDF value round trips, appearances, flattening, independent records, Unicode validation, signature image export and photo cleanup, native file-operation handlers, local protocol boundaries, and unsaved-change handling. Test artifacts are written to `tmp/qa`.

PDF rendering uses [Mozilla PDF.js](https://mozilla.github.io/pdf.js/). PDF writing uses [pdf-lib](https://pdf-lib.js.org/). The local desktop protocol follows the [Electron protocol API](https://www.electronjs.org/docs/latest/api/protocol/). Noto Sans is licensed under the SIL Open Font License; its license is included in `public/fonts`.
