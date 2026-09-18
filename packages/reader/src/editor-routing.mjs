const extensions = new Set([
  'md', 'markdown', 'mdx', 'tex', 'txt', 'text', 'log', 'csv', 'tsv',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'css', 'scss', 'sass', 'less',
  'html', 'htm', 'xml', 'svg', 'vue', 'svelte', 'astro',
  'py', 'pyi', 'rb', 'php', 'go', 'rs', 'java', 'kt', 'kts', 'swift',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'fs', 'fsx',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'graphql', 'gql',
  'r', 'lua', 'pl', 'pm', 'ex', 'exs', 'erl', 'hrl', 'clj', 'cljs', 'scala',
]);
const basenames = new Set(['dockerfile', 'makefile', 'cmakelists.txt', 'license', 'readme', 'gitignore', 'gitattributes']);

export function editorKind(path) {
  const name = path.split('/').pop().toLowerCase();
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  if (name.endsWith('.tex')) return 'latex';
  const dot = name.lastIndexOf('.');
  const extension = dot >= 0 ? name.slice(dot + 1) : '';
  return extensions.has(extension) || basenames.has(name) ? 'text' : null;
}
