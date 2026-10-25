import React from 'react';
import ReactMarkdown, {defaultUrlTransform} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {fileUrl} from './api';

// Raw HTML in agent output is dropped (skipHtml). Relative links to a task's output files point at the file.
export function Markdown({text, taskId, files = []}: {text: string; taskId?: string; files?: string[]}) {
  return <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    skipHtml
    urlTransform={url => {
      const name = url.replace(/^\.\//, '');
      if (taskId && files.includes(name)) return fileUrl(taskId, name, true);
      return defaultUrlTransform(url);
    }}
    components={{a: ({node, ...props}) => <a {...props} target="_blank" rel="noreferrer noopener"/>}}
  >{text}</ReactMarkdown>;
}
