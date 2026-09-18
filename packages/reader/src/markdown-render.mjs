import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import katex from 'katex';

const renderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

renderer.use(texmath, {
  engine: katex,
  delimiters: 'dollars',
  katexOptions: {
    throwOnError: false,
    strict: 'warn',
    trust: false,
    output: 'htmlAndMathml',
  },
});

const defaultLinkOpen = renderer.renderer.rules.link_open
  ?? ((tokens, index, options, _environment, self) => self.renderToken(tokens, index, options));
renderer.renderer.rules.link_open = (tokens, index, options, environment, self) => {
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, index, options, environment, self);
};

export function renderMarkdown(source) {
  return renderer.render(source);
}
