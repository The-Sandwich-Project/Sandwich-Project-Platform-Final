import DOMPurify from 'dompurify';
import { splitEmailDocument } from '@/components/editable-email-preview';

/**
 * The AI never sees or returns the designed email's HTML. We send only its
 * visible text, one piece per text node, and put the new text back into the
 * same nodes, so layout, colors, buttons and links can't break.
 */

export interface EmailTextSegment {
  id: string;
  text: string;
}

function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (parent && ['STYLE', 'SCRIPT', 'TITLE'].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.textContent && node.textContent.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

function parseBody(html: string) {
  const { prefix, body, suffix } = splitEmailDocument(html);
  const container = document.createElement('div');
  container.innerHTML = DOMPurify.sanitize(body);
  return { prefix, suffix, container };
}

export function extractEmailTextSegments(html: string): EmailTextSegment[] {
  const { container } = parseBody(html);
  return textNodes(container).map((node, i) => ({
    id: String(i),
    text: node.textContent || '',
  }));
}

export function applyEmailTextSegments(
  html: string,
  updates: EmailTextSegment[]
): string {
  const { prefix, suffix, container } = parseBody(html);
  const nodes = textNodes(container);
  for (const { id, text } of updates) {
    const node = nodes[Number(id)];
    if (node) node.textContent = text;
  }
  return prefix + DOMPurify.sanitize(container.innerHTML) + suffix;
}
