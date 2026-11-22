"use client";

import { Download, ExternalLink, FileText, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { SheetData } from "read-excel-file/browser";

import { kbImageMediaType, kbPreviewKind } from "@/lib/kb-file";
import type { DemoFile } from "@/lib/server/demo-store";

type Preview =
  | { kind: "docx" | "xlsx"; blob: Blob }
  | { kind: "image" | "pdf" | "web"; url: string }
  | { kind: "html" | "text"; text: string };

type Labels = {
  btnCancel: string;
  btnDownload: string;
  btnOpenLink: string;
  previewLoading: string;
  previewMissing: string;
  previewFailed: string;
  previewEmpty: string;
};

const documentPolicy = `default-src 'none'; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
const documentHead = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${documentPolicy}">`;
const wordFrame = `${documentHead}<style>html,body{margin:0;min-height:100%;background:#e9edf2}
  .docx-wrapper{padding:16px!important} .docx-wrapper section.docx{max-width:100%;box-sizing:border-box}</style>`;

export function kbOriginalUrl(file: Pick<DemoFile, "id">): string {
  return `/api/admin/files/${file.id}`;
}

export function kbSourceLink(sourceUrl?: string): string | undefined {
  return sourceUrl && /^https?:\/\//i.test(sourceUrl) ? sourceUrl : undefined;
}

function WordPreview({ blob, filename, loading, onError }: { blob: Blob; filename: string; loading: string; onError: () => void }) {
  const [rendered, setRendered] = useState(false);
  const renderedFrame = useRef<HTMLIFrameElement | null>(null);

  const renderDocument = async (event: SyntheticEvent<HTMLIFrameElement>) => {
    const frame = event.currentTarget;
    const doc = frame.contentDocument;
    if (!doc || doc.URL !== "about:srcdoc" || renderedFrame.current === frame) return;
    renderedFrame.current = frame;
    try {
      const { renderAsync } = await import("docx-preview");
      if (!frame.isConnected) return;
      await renderAsync(blob, doc.body, doc.head, {
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        renderAltChunks: false,
        useBase64URL: true,
      });
      if (frame.isConnected) setRendered(true);
    } catch {
      if (frame.isConnected) onError();
    }
  };

  return (
    <div className="relative h-full">
      {!rendered && <p role="status" className="absolute inset-0 grid place-items-center text-sm text-slate-500">{loading}</p>}
      <iframe
        title={filename}
        srcDoc={wordFrame}
        sandbox="allow-same-origin"
        onLoad={(event) => void renderDocument(event)}
        className={`h-full w-full border-0 ${rendered ? "" : "invisible"}`}
      />
    </div>
  );
}

function WorkbookPreview({ blob, labels, onError }: { blob: Blob; labels: Labels; onError: () => void }) {
  const [sheets, setSheets] = useState<{ sheet: string; data: SheetData }[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);

  useEffect(() => {
    let cancelled = false;
    import("read-excel-file/browser")
      .then(({ default: readWorkbook }) => readWorkbook(blob))
      .then((workbook) => { if (!cancelled) setSheets(workbook); })
      .catch(() => { if (!cancelled) onError(); });
    return () => { cancelled = true; };
  }, [blob, onError]);

  if (!sheets) return <p role="status" className="grid h-full place-items-center text-sm text-slate-500">{labels.previewLoading}</p>;
  const rows = sheets[activeSheet]?.data ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length ? (
          <table className="w-max min-w-full border-collapse text-left text-sm text-slate-800">
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="even:bg-slate-50">
                  <th scope="row" className="sticky left-0 border border-slate-200 bg-slate-100 px-2 py-1.5 text-right font-normal text-slate-500">{rowIndex + 1}</th>
                  {row.map((cell, colIndex) => (
                    <td key={colIndex} className="min-w-24 whitespace-pre-wrap border border-slate-200 px-2 py-1.5">{cell instanceof Date ? cell.toLocaleDateString() : String(cell ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="p-4 text-sm text-slate-500">{labels.previewEmpty}</p>}
      </div>
      {sheets.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-slate-200 bg-slate-50 p-1.5">
          {sheets.map(({ sheet }, index) => (
            <button type="button" key={sheet} aria-pressed={index === activeSheet} onClick={() => setActiveSheet(index)} className="shrink-0 rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 aria-pressed:bg-white aria-pressed:font-semibold aria-pressed:text-blue-700">
              {sheet}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewBody({ preview, filename, labels, onError }: { preview: Preview; filename: string; labels: Labels; onError: () => void }) {
  switch (preview.kind) {
    case "docx": return <WordPreview blob={preview.blob} filename={filename} loading={labels.previewLoading} onError={onError} />;
    case "xlsx": return <WorkbookPreview blob={preview.blob} labels={labels} onError={onError} />;
    case "pdf": return <iframe src={`${preview.url}#view=FitH`} title={filename} className="h-full w-full border-0" />;
    case "image": return (
      <div className="grid h-full place-items-center overflow-auto p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.url} alt={filename} onError={onError} className="max-h-full max-w-full object-contain" />
      </div>
    );
    case "text": return <pre className="h-full overflow-auto whitespace-pre-wrap break-words bg-white p-4 text-sm leading-6 text-slate-800">{preview.text}</pre>;
    case "html": return <iframe sandbox="" srcDoc={documentHead + preview.text} title={filename} className="h-full w-full border-0 bg-white" />;
    case "web": return <iframe sandbox="" src={preview.url} referrerPolicy="no-referrer" title={filename} className="h-full w-full border-0 bg-white" />;
  }
}

export function KbFilePreview({ file, labels, onClose }: { file: DemoFile; labels: Labels; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<"missing" | "failed" | null>(null);
  const sourceLink = kbSourceLink(file.sourceUrl);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;

    const load = async () => {
      if (sourceLink && !file.uploadKey) {
        setPreview({ kind: "web", url: sourceLink });
        return;
      }
      try {
        const response = await fetch(kbOriginalUrl(file), { signal: controller.signal, cache: "no-store" });
        if (!response.ok) {
          if (!controller.signal.aborted) setError(response.status === 404 ? "missing" : "failed");
          return;
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const kind = kbPreviewKind(file.filename, file.mediaType);
        if (kind === "docx" || kind === "xlsx") {
          setPreview({ kind, blob });
        } else if (kind === "pdf" || kind === "image") {
          const type = kind === "pdf" ? "application/pdf" : kbImageMediaType(file.filename, file.mediaType);
          objectUrl = URL.createObjectURL(blob.slice(0, blob.size, type));
          setPreview({ kind, url: objectUrl });
        } else if (kind === "html" || kind === "text") {
          const text = await blob.text();
          if (!controller.signal.aborted) setPreview({ kind, text });
        } else {
          setError("failed");
        }
      } catch {
        if (!controller.signal.aborted) setError("failed");
      }
    };

    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, sourceLink]);

  const setRenderFailed = useCallback(() => setError("failed"), []);
  const actionClass = "inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100";
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="kb-preview-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="fixed inset-0 m-auto h-[min(88dvh,55rem)] w-[calc(100%-1rem)] max-w-6xl overflow-hidden rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/55 sm:w-[calc(100%-3rem)]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
          <FileText className="h-5 w-5 shrink-0 text-blue-600" />
          <h3 id="kb-preview-title" className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-900" title={file.filename}>{file.filename}</h3>
          <button type="button" aria-label={labels.btnCancel} onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="m-3 min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 sm:mx-6 sm:my-4">
          {error ? (
            <p role="alert" className="grid h-full place-items-center px-6 text-center text-sm text-slate-700">{error === "missing" ? labels.previewMissing : labels.previewFailed}</p>
          ) : preview ? (
            <PreviewBody preview={preview} filename={file.filename} labels={labels} onError={setRenderFailed} />
          ) : (
            <p role="status" className="grid h-full place-items-center text-sm text-slate-500">{labels.previewLoading}</p>
          )}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
          {sourceLink && (
            <a href={sourceLink} target="_blank" rel="noreferrer" className={actionClass}><ExternalLink className="h-4 w-4" />{labels.btnOpenLink}</a>
          )}
          {preview && preview.kind !== "web" && (
            <a href={kbOriginalUrl(file)} download={file.filename} className={actionClass}><Download className="h-4 w-4" />{labels.btnDownload}</a>
          )}
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">{labels.btnCancel}</button>
        </footer>
      </div>
    </dialog>
  );
}
