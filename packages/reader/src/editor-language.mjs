import { languages } from '@codemirror/language-data';

export async function languageExtension(path) {
  const description = languages.find(language => language.filename?.test(path))
    ?? languages.find(language => language.extensions?.some(extension => path.toLowerCase().endsWith(`.${extension}`)));
  return description ? description.load() : [];
}
