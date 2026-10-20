import { describe, expect, it } from 'vitest';
import { handlers } from '../src/ai/handlers';
import { apiTools, TOOL_DEFS } from '../src/ai/tool-defs';

describe('AI tool definitions', () => {
  it('every tool has a browser handler', () => {
    for (const t of TOOL_DEFS) expect(handlers[t.name], t.name).toBeTypeOf('function');
  });

  it('converts to Claude API JSON Schema objects', () => {
    const tools = apiTools();
    expect(tools).toHaveLength(TOOL_DEFS.length);
    for (const t of tools) {
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.$schema).toBeUndefined();
      expect(t.description.length).toBeGreaterThan(5);
    }
    const draw = tools.find((t) => t.name === 'draw_shapes')!;
    expect(draw.input_schema.required).toEqual(['shapes']);
  });
});
