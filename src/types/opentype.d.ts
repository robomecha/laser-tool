// opentype.js 2.x 는 타입 선언을 제공하지 않으므로 이 프로젝트에서 쓰는 부분만 선언한다.
declare module 'opentype.js' {
  export type PathCommand =
    | { type: 'M' | 'L'; x: number; y: number }
    | { type: 'Q'; x1: number; y1: number; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Z' };

  export interface Path {
    commands: PathCommand[];
  }

  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    names: { fontFamily?: Record<string, string>; fullName?: Record<string, string> };
    getPath(text: string, x: number, y: number, fontSize: number, options?: { kerning?: boolean; letterSpacing?: number }): Path;
    getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean; letterSpacing?: number }): number;
  }

  export function parse(buffer: ArrayBuffer, opt?: object): Font;
}
