import { useLayoutEffect, useRef } from 'react';
import DOMPurify from 'dompurify';

/**
 * Shows a full HTML email (<!DOCTYPE html>…<body>…</body></html>) as the
 * recipient will see it, and lets the sender click into any text and edit it
 * in place. The layout, colors and inline styles stay as they are because the
 * sender only types inside the existing elements.
 *
 * The document wrapper (doctype, <head>, <body> tag) can't live inside a <div>,
 * so it's split off, kept as-is, and put back around the edited body on every
 * change. The server relies on that wrapper: it detects a full HTML email by
 * the leading <!DOCTYPE html> and inserts the footer before </body></html>.
 */

interface EditableEmailPreviewProps {
  html: string;
  onChange: (html: string) => void;
  /** Locks editing, e.g. while the AI is rewriting the email. */
  readOnly?: boolean;
  'data-testid'?: string;
}

const DOC_PATTERN = /^([\s\S]*?<body[^>]*>)([\s\S]*?)(<\/body>\s*<\/html>\s*)$/i;

export function splitEmailDocument(html: string): {
  prefix: string;
  body: string;
  suffix: string;
} {
  const match = html.match(DOC_PATTERN);
  if (!match) return { prefix: '', body: html, suffix: '' };
  return { prefix: match[1], body: match[2], suffix: match[3] };
}

export function EditableEmailPreview({
  html,
  onChange,
  readOnly = false,
  'data-testid': testId,
}: EditableEmailPreviewProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  // The last HTML this editor produced. When `html` equals it, the change came
  // from typing here, so the DOM is already right; rewriting innerHTML would
  // move the cursor to the start.
  const lastEmittedRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || html === lastEmittedRef.current) return;
    editor.innerHTML = DOMPurify.sanitize(splitEmailDocument(html).body);
    lastEmittedRef.current = html;
  }, [html]);

  const emitChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const { prefix, suffix } = splitEmailDocument(html);
    const next = prefix + DOMPurify.sanitize(editor.innerHTML) + suffix;
    lastEmittedRef.current = next;
    onChange(next);
  };

  // Paste as plain text so formatting copied from Word, Gmail or a web page
  // can't bring in its own fonts, colors or layout.
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  return (
    <div
      ref={editorRef}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      onInput={emitChange}
      onPaste={handlePaste}
      onDrop={(e) => e.preventDefault()}
      className="p-4 max-h-[400px] overflow-y-auto outline-none focus:ring-2 focus:ring-inset focus:ring-brand-primary/40 cursor-text"
      role="textbox"
      aria-multiline="true"
      aria-label="Email content. Click any text to edit it."
      data-testid={testId}
    />
  );
}
