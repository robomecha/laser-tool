// 프로젝트 파일(.ltp, JSON) 저장/불러오기. LightBurn 의 .lbrn, RDWorks 의 .rld 에 해당.
import { LaserDocument } from '../core/document';
import { LayerSettings } from '../core/layers';
import { Shape } from '../core/shapes';

export const PROJECT_EXT = '.ltp';
const FORMAT = 'laser-tool-project';
const VERSION = 1;

export interface ProjectFile {
  format: typeof FORMAT;
  version: number;
  layers: LayerSettings[];
  shapes: Shape[];
}

export function serializeProject(doc: LaserDocument): string {
  const p: ProjectFile = {
    format: FORMAT,
    version: VERSION,
    layers: [...doc.layers.values()],
    shapes: doc.shapes,
  };
  return JSON.stringify(p);
}

export function parseProject(text: string): ProjectFile {
  const p = JSON.parse(text) as ProjectFile;
  if (p.format !== FORMAT) throw new Error('laser-tool 프로젝트 파일이 아닙니다');
  if (p.version > VERSION) throw new Error(`더 최신 버전(v${p.version})의 파일입니다`);
  if (!Array.isArray(p.shapes) || !Array.isArray(p.layers)) throw new Error('손상된 프로젝트 파일입니다');
  return p;
}

export function loadProjectInto(doc: LaserDocument, text: string): void {
  const p = parseProject(text);
  doc.load(p.shapes, p.layers);
}
