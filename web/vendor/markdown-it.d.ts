// Minimal types for the vendored markdown-it bundle: only what web/js/markdown.js uses.
export interface Token {
  type: string;
  tag: string;
  content: string;
  children: Token[] | null;
  meta: any;
  attrGet(name: string): string | null;
  attrSet(name: string, value: string): void;
}
export interface StateCore {
  env: object;
  tokens: Token[];
  Token: new (type: string, tag: string, nesting: number) => Token;
}
export type RenderRule = (tokens: Token[], idx: number, options: object, env: object, self: Renderer) => string;
export interface Renderer {
  rules: Record<string, RenderRule | undefined>;
  renderToken(tokens: Token[], idx: number, options: object): string;
}
export default class MarkdownIt {
  constructor(options?: { html?: boolean; linkify?: boolean; typographer?: boolean; breaks?: boolean });
  core: { ruler: { push(name: string, fn: (state: StateCore) => void): void } };
  renderer: Renderer;
  validateLink: (url: string) => boolean;
  render(src: string, env?: object): string;
}
