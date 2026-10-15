'use client';
import dynamic from 'next/dynamic';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { EditorView } from '@codemirror/view';
const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), { ssr: false, loading: () => <div className="studio-code-loading">Loading editor…</div> });
export function CodeEditor({ value, onChange, label, language = 'json', height = '220px', readOnly = false }: { value: string; onChange?: (value: string) => void; label: string; language?: 'json' | 'expression'; height?: string; readOnly?: boolean }) {
  return <div className="studio-code" data-code-editor={label}><CodeMirror value={value} onChange={onChange} height={height} readOnly={readOnly} extensions={[language === 'json' ? json() : javascript(), EditorView.lineWrapping, EditorView.contentAttributes.of({ 'aria-label': label })]} theme="light" basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: !readOnly, autocompletion: !readOnly }} /></div>;
}
