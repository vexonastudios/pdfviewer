# Paperdesk PDF

A local Windows Electron app for viewing PDFs, filling standard forms, placing text and checkmarks, and making filled copies in bulk. Documents and pasted data are processed on your computer. No account, API key, or server is required.

## Run the app

For a local Windows build, run the commands under [Development](#development), then open `release/Paperdesk-PDF-1.0.1.exe`. This is a portable app; it does not require installation. Alternatively, keep the entire `release/win-unpacked` folder together and open `Paperdesk PDF.exe` inside it. The build is unsigned. Generated executables and document data are excluded from this source repository.

Version 1.0.1 centers short answers vertically in multiline PDF fields, including dates in tall boxes. The correction applies in the viewer, editable PDF copies, flattened copies, and bulk exports. Square checkbox marks are also drawn as vectors so selected choices stay visible in exported PDFs. Longer entries wrap and scroll in the editor. Existing workspaces remain compatible. Save your work and close the previous version before opening the updated app.

## Everyday use

1. Click **Open PDF**, or drag a PDF onto the window. **Try a practice form** provides a sample.
2. Fill existing fields directly on the page or in the Fields panel. Use **Add text** or **Checkmark** on flat/scanned forms. Select an added item to edit it, change its size, or drag it into position.
3. Choose **Save a copy**. Editable PDF copies preserve existing form fields. Flattened copies make field appearances permanent. Added text/checkmarks become page content in either PDF export.
4. Choose **Save editable workspace** to retain the original PDF, field values, and movable text boxes in a `.paperdesk.json` file. Reopen that file using Open PDF. Workspace files contain your document and entered information; store them like the original PDF.

The app does not save silently. It warns before replacing a document with unsaved edits or closing with changes. Saving opens a Save As dialog; your original remains untouched unless you explicitly select it for replacement.

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
| Save copy | Ctrl+S |
| Find document text | Ctrl+F |
| Undo / redo | Ctrl+Z / Ctrl+Y (outside text inputs) |
| Previous / next page | Left / right arrow (outside inputs) |
| Remove selected text/checkmark | Delete |
| Cancel placement | Escape |

Rotation changes the viewing orientation, not the original page rotation. Text placed in a rotated view retains its intended orientation when exported.

## Current limits

- Standard AcroForm text, checkbox, radio, dropdown, and list fields are supported. Encrypted PDFs, XFA forms, and documents with existing digital signatures are view-only. PDF scripts and calculations are not executed.
- Text can be placed over scanned pages, but OCR and automatic detection of blank lines are not included.
- No existing-page text editing, page reordering, redaction, certificate signing, or built-in printing in this first version.
- The bundled Noto Sans font supports many alphabets, but not all scripts or emoji. Export reports unsupported characters instead of silently substituting them. Review long values for fit.
- Added text and checkmarks are permanent in exported PDFs. Retain a workspace for future editing.
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

`npm test` covers bulk parsing/mapping, PDF value round trips, appearances, flattening, independent records, Unicode validation, native file-operation handlers, local protocol boundaries, and unsaved-change handling. Test artifacts are written to `tmp/qa`. Additional manual verification opened and filled the practice form in the browser preview, placed named text, saved a PDF and two-record ZIP, and independently checked exported field data and text with pypdf and rendered output with Poppler. Native Windows dialog interaction was not exercised because computer-use approval timed out; its IPC/file-operation backend is tested with dialog mocks.

PDF rendering uses [Mozilla PDF.js](https://mozilla.github.io/pdf.js/). PDF writing uses [pdf-lib](https://pdf-lib.js.org/). The local desktop protocol follows the [Electron protocol API](https://www.electronjs.org/docs/latest/api/protocol/). Noto Sans is licensed under the SIL Open Font License; its license is included in `public/fonts`.
