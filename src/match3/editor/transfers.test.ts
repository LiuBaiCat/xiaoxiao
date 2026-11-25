import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Level } from '../engine/types';
import { createTemplate, levelKey, parsePack, validateLevel } from '../levels/schema';
import { copyLevel } from './model';
import { byteSize, changedFields, commitCollection, DRAFT_KEY, downloadJson, encodeExport, FILE_LIMIT, importConflicts, isDraftLevel, loadDraft, mergeImport, normalizeImported, PACK_LIMIT, prepareTrial, readImport, saveDraft, type DraftBundle, type ImportFile } from './transfers';

const make = (id: string, rest: Partial<Level> = {}): Level => ({ ...createTemplate(), packId: 'user', id, ...rest });
function file(level: Level | string, name = 'level.json'): ImportFile {
  const text = typeof level === 'string' ? level : JSON.stringify(level);
  return { name, size: byteSize(text), text: async () => text };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('atomic and bounded file import', () => {
  it('imports multiple valid JSON files and packs using the real parser', async () => {
    const files = [file(make('one')), file(encodeExport([make('two'), make('three')]))];
    const result = await readImport(files, []);
    expect(result.errors).toEqual([]); expect(result.levels.map(l => l.id)).toEqual(['one', 'two', 'three']);
  });
  it('rejects the entire batch if any JSON is broken or a level is out of bounds', async () => {
    for (const bad of ['{broken}', JSON.stringify(make('bad', { width: 13 })), JSON.stringify({ ...make('evil'), title: '<script>alert(1)</script>' })]) {
      const result = await readImport([file(make('ok')), file(bad, 'bad.json')], []);
      expect(result.levels).toEqual([]); expect(result.errors.join('')).toContain('bad.json');
    }
  });
  it('rejects dangerous keys without prototype pollution', async () => {
    const raw = JSON.stringify(make('evil')).replace('"title":', '"__proto__":{"polluted":true},"title":');
    expect((await readImport([file(raw)], [])).levels).toEqual([]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
  it('enforces file size before reading, and total package size', async () => {
    const read = vi.fn(async () => '{}');
    expect((await readImport([{ name: 'huge.json', size: FILE_LIMIT + 1, text: read }], [])).errors.join('')).toContain('256');
    expect(read).not.toHaveBeenCalled();
    expect((await readImport(Array.from({ length: 9 }, () => ({ name: 'part.json', size: FILE_LIMIT, text: read })), [])).errors.join('')).toContain('2 MiB');
    expect(read).not.toHaveBeenCalled();
    const spoofed = { name: 'spoof.json', size: 1, text: async () => ' '.repeat(FILE_LIMIT + 1) };
    expect((await readImport([spoofed], [])).levels).toEqual([]);
  });
  it('rejects duplicate IDs across files, read failures and more than 200 levels', async () => {
    const duplicate = await readImport([file(make('a')), file(make('a'))], []);
    expect(duplicate.levels).toEqual([]); expect(duplicate.errors.join('')).toContain('重复');
    expect((await readImport([{ name: 'unreadable', size: 4, text: async () => { throw new Error('read'); } }], [])).errors.join('')).toContain('读取');
    expect((await readImport(Array.from({ length: 201 }, (_, i) => file(make(`l-${i}`))), [])).errors.join('')).toContain('200');
    const files = Array.from({ length: 3 }, (_, batch) => file(encodeExport(Array.from({ length: 70 }, (_, i) => make(`l-${batch}-${i}`)))));
    expect((await readImport(files, [])).errors.join('')).toContain('200');
  });
  it('normalizes builtin namespaces to stable user keys without source mutation', async () => {
    const builtin = make('b1', { packId: 'builtin' }), original = copyLevel(builtin);
    const first = await readImport([file(builtin)], [builtin]);
    const again = await readImport([file(builtin)], [builtin]);
    expect(first.errors).toEqual([]);
    expect(first.levels[0].packId).toMatch(/^user-import-/);
    expect(levelKey(first.levels[0])).toBe(levelKey(again.levels[0]));
    expect(builtin).toEqual(original);
    expect(normalizeImported(make('b1', { packId: 'builtin-other' }), []).packId).not.toBe(first.levels[0].packId);
  });
});

describe('conflict decisions never silently overwrite', () => {
  it('shows comparison and does not return partial data before every conflict has a decision', () => {
    const before = make('a'), incoming = make('a', { title: '修改名称', moves: 42 });
    expect(importConflicts([incoming], [before])).toEqual([{ key: 'user/a', existing: before, incoming }]);
    expect(changedFields(before, incoming)).toEqual(['名称', '步数']);
    const result = mergeImport([before], [make('new'), incoming], {});
    expect(result.levels).toEqual([]); expect(result.imported).toEqual([]); expect(result.errors.length).toBe(1);
    expect(before.moves).toBe(32);
  });
  it('applies explicit overwrite only and keeps untouched levels', () => {
    const previous = [make('a'), make('b')], incoming = make('a', { moves: 51 });
    const result = mergeImport(previous, [incoming], { 'user/a': 'overwrite' });
    expect(result.errors).toEqual([]); expect(result.levels).toHaveLength(2);
    expect(result.levels.find(l => l.id === 'a')!.moves).toBe(51);
    expect(previous[0].moves).toBe(32);
    result.levels[0].mask[0] = '#########'; expect(incoming.mask[0]).toBe('.........');
  });
  it('saves conflicts as new IDs avoiding both imported keys and unsaved draft keys', () => {
    const previous = [make('a')], incoming = [make('a'), make('a-copy')], drafts = [make('a-copy-2')];
    const result = mergeImport(previous, incoming, { 'user/a': 'copy' }, drafts);
    expect(result.errors).toEqual([]);
    expect(result.imported[0].id).toBe('a-copy-3');
    expect(result.levels.find(l => l.id === 'a')!.title).toBe(previous[0].title);
  });
  it('requires a decision for collisions with unpublished drafts', () => {
    const incoming = make('draft');
    expect(mergeImport([], [incoming], {}, [incoming]).errors).toHaveLength(1);
    expect(mergeImport([], [incoming], { 'user/draft': 'copy' }, [incoming]).imported[0].id).not.toBe('draft');
  });
  it('rejects final collection overflow, leaving input arrays untouched', () => {
    const previous = Array.from({ length: 200 }, (_, i) => make(`l-${i}`));
    const result = mergeImport(previous, [make('extra')], {});
    expect(result.errors.join('')).toContain('200'); expect(result.levels).toEqual([]); expect(previous).toHaveLength(200);
    expect(PACK_LIMIT).toBe(2 * 1024 * 1024);
  });
});

describe('publication and trial API boundary', () => {
  it('submits a full detached user collection exactly once', () => {
    const levels = [make('a'), make('b')];
    const save = vi.fn((submitted: Level[]) => { submitted[0].title = 'parent mutation'; return true; });
    expect(commitCollection(levels, [], save)).toEqual([]);
    expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0]).toHaveLength(2);
    expect(levels[0].title).not.toBe('parent mutation');
  });
  it('reports false/throw honestly, and refuses invalid/builtin/duplicate collections before callbacks', () => {
    expect(commitCollection([make('a')], [], () => false).join('')).toContain('失败');
    expect(commitCollection([make('a')], [], () => { throw new Error('quota'); }).join('')).toContain('错误');
    const save = vi.fn(() => true);
    expect(commitCollection([make('a', { moves: 0 })], [], save).length).toBeGreaterThan(0);
    expect(commitCollection([make('a', { packId: 'builtin' })], [], save).join('')).toContain('只读');
    expect(commitCollection([make('a'), make('a')], [], save).join('')).toContain('重复');
    expect(save).not.toHaveBeenCalled();
  });
  it('validates before trial, and returns a deeply independent level without saving anything', () => {
    const level = make('trial'), trial = prepareTrial(level);
    expect(trial.errors).toEqual([]); expect(trial.level).toEqual(level);
    trial.level!.mask[0] = '#########'; trial.level!.tools.hammer = 99;
    expect(level.mask[0]).toBe('.........'); expect(level.tools.hammer).toBe(2);
    expect(prepareTrial({ ...level, palette: [] }).level).toBeUndefined();
  });
});

describe('independent invalid-capable drafts and downloads', () => {
  const bundle = (): DraftBundle => ({ version: 1, selected: 'user/a', levels: [make('a', { title: '', goals: [], moves: 0 })] });
  it('saves and restores semantically invalid but structurally safe drafts under only its own key', () => {
    const values = new Map([['slow-paws-link:save:v1', 'legacy'], ['slow-paws-match3:save:v1', 'normal']]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(validateLevel(bundle().levels[0]).errors.length).toBeGreaterThan(0);
    expect(saveDraft(storage, bundle())).toBeUndefined();
    expect(values.has(DRAFT_KEY)).toBe(true);
    expect(loadDraft(storage).bundle).toEqual(bundle());
    expect(values.get('slow-paws-link:save:v1')).toBe('legacy'); expect(values.get('slow-paws-match3:save:v1')).toBe('normal');
  });
  it('reports read/write/quota failures without deleting old storage or claiming success', () => {
    const setItem = vi.fn(() => { throw new Error('quota'); });
    expect(saveDraft({ setItem, getItem: () => null }, bundle())).toContain('保存失败');
    const invalid = { getItem: () => '{bad', setItem: vi.fn() };
    expect(loadDraft(invalid).error).toContain('原草稿未覆盖'); expect(invalid.setItem).not.toHaveBeenCalled();
    expect(loadDraft({ getItem: () => { throw new Error('security'); }, setItem }).error).toBeTruthy();
  });
  it('rejects corrupt shapes, oversized data and duplicate draft keys without requiring semantic validity', () => {
    for (const bad of [{}, { ...make('a'), width: 999 }, { ...make('a'), initialPieces: [{}] }, { ...make('a'), blockers: [{ row: 1, col: 1, blocker: { type: 'gift' } }] }]) expect(isDraftLevel(bad)).toBe(false);
    expect(isDraftLevel(bundle().levels[0])).toBe(true);
    const duplicate = { ...bundle(), levels: [make('a'), make('a')] };
    expect(loadDraft({ getItem: () => JSON.stringify(duplicate), setItem: vi.fn() }).error).toBeTruthy();
    expect(loadDraft({ getItem: () => ' '.repeat(4 * PACK_LIMIT + 1), setItem: vi.fn() }).error).toBeTruthy();
  });
  it('round-trips a single level and a complete package through the shared parser', () => {
    const levels = [make('a'), make('b')];
    expect(parsePack(encodeExport([levels[0]], true)).levels).toEqual([levels[0]]);
    expect(parsePack(encodeExport(levels)).levels).toEqual(levels);
  });
  it('creates a local Blob download, removes the anchor and revokes its URL', () => {
    vi.useFakeTimers();
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:editor-test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } });
    downloadJson('level:1.json', encodeExport([make('a')], true));
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(anchor.download).toBe('level_1.json'); expect(anchor.click).toHaveBeenCalledOnce(); expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled(); vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith('blob:editor-test');
  });
});
